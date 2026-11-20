import { Pool } from 'pg';
import { type Hex, keccak256, stringToHex, toHex } from 'viem';
import { afterAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { ChainEvent, ContractName, EventArgs } from '../src/domain/events.js';
import { type ChainReader, type IndexerOptions, type IndexerStore, tick } from '../src/domain/indexer.js';
import { PostgresIndexerStore } from '../src/infra/db/postgres-store.js';
import { MemoryIndexerStore } from '../src/infra/memory-store.js';

const ALICE = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
const BOB = '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc';
const ZERO = '0x0000000000000000000000000000000000000000';

/** Rede de mentira: blocos com hash e eventos; `fork` troca a história a partir de um bloco. */
class FakeChain implements ChainReader {
  height = 0n;
  private hashes = new Map<bigint, Hex>();
  private events: ChainEvent[] = [];
  private salt = 'a';

  constructor(private readonly chainId: number) {}

  private hashOf = (n: bigint) => keccak256(stringToHex(`${this.salt}:${n}`));

  mine(n: number) {
    for (let i = 0; i < n; i++) {
      this.height++;
      this.hashes.set(this.height, this.hashOf(this.height));
    }
  }

  emit(contract: ContractName, event: string, args: EventArgs, at: number | bigint = this.height) {
    const block = BigInt(at);
    const logIndex = this.events.filter((e) => e.blockNumber === block).length;
    this.events.push({
      chainId: this.chainId,
      blockNumber: block,
      blockHash: this.hashes.get(block)!,
      txHash: keccak256(toHex(`${this.salt}:${block}:${logIndex}`)),
      logIndex,
      contract,
      event,
      args,
    });
  }

  /** Reorganização: a partir de `from`, novos hashes e a história some. */
  fork(from: bigint) {
    this.salt += 'b';
    this.events = this.events.filter((e) => e.blockNumber < from);
    for (let n = from; n <= this.height; n++) this.hashes.set(n, this.hashOf(n));
  }

  async head() {
    return this.height;
  }
  async blockHash(n: bigint) {
    return this.hashes.get(n) ?? null;
  }
  async logs(from: bigint, to: bigint) {
    return this.events.filter((e) => e.blockNumber >= from && e.blockNumber <= to);
  }
}

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 5 }) : null;
afterAll(async () => {
  await pool?.end();
});

/** Rede diferente por teste: no Postgres compartilhado, cada um tem a sua. */
const newChainId = () => 900_000 + Math.floor(Math.random() * 1_000_000);
const options = (chainId: number, over: Partial<IndexerOptions> = {}): IndexerOptions => ({
  chainId,
  confirmations: 2,
  startBlock: 1n,
  batchBlocks: 100,
  reorgDepth: 5,
  ...over,
});
const mintLot = (to: string, city: number, lot: number) => ({
  from: ZERO,
  to,
  tokenId: ((BigInt(city) << 32n) | BigInt(lot)).toString(),
});
const padeiro = stringToHex('padeiro', { size: 32 });

/** Lê até não haver mais blocos confirmados. */
async function drain(chain: ChainReader, store: IndexerStore, opt: IndexerOptions) {
  for (let i = 0; i < 50; i++) {
    const r = await tick(chain, store, opt);
    if (r.kind === 'idle') return r;
  }
  throw new Error('não terminou');
}

describe.each([
  ['memória', () => new MemoryIndexerStore() as IndexerStore, true],
  ['postgres', () => new PostgresIndexerStore(pool!) as IndexerStore, pool !== null],
] as const)('indexer (%s)', (_name, make, enabled) => {
  it.skipIf(!enabled)('só lê blocos confirmados e espelha a posse do lote', async () => {
    const id = newChainId();
    const chain = new FakeChain(id);
    const store = make();
    chain.mine(3);
    chain.emit('LandNFT', 'Transfer', mintLot(ALICE, 1, 42), 3);
    chain.mine(1); // altura 4, com 2 confirmações lê até o bloco 2

    expect(await tick(chain, store, options(id))).toMatchObject({ kind: 'indexed', from: 1n, to: 2n, inserted: 0 });
    expect(await store.lot(id, mintLot(ALICE, 1, 42).tokenId)).toBeNull();

    chain.mine(1); // altura 5: o bloco 3 tem 2 em cima
    expect(await tick(chain, store, options(id))).toMatchObject({ kind: 'indexed', from: 3n, to: 3n, inserted: 1 });
    expect(await store.lot(id, mintLot(ALICE, 1, 42).tokenId)).toMatchObject({ city: 1, lot: 42, owner: ALICE });

    chain.emit('LandNFT', 'Transfer', { from: ALICE, to: BOB, tokenId: mintLot(ALICE, 1, 42).tokenId }, 5);
    chain.mine(2);
    await drain(chain, store, options(id));
    expect((await store.lotsOf(id, BOB)).map((l) => l.lot)).toEqual([42]);
    expect(await store.lotsOf(id, ALICE)).toEqual([]);
  });

  it.skipIf(!enabled)('cada evento entra uma vez, mesmo relendo a faixa', async () => {
    const id = newChainId();
    const chain = new FakeChain(id);
    const store = make();
    chain.mine(1);
    chain.emit('LandNFT', 'Transfer', mintLot(ALICE, 1, 7));
    const events = await chain.logs(1n, 1n);
    const c = { block: 1n, hash: (await chain.blockHash(1n))! };
    expect(await store.commit(id, events, c)).toBe(1);
    expect(await store.commit(id, events, c)).toBe(0);
    expect(await store.eventsAfter(id, 0, 10)).toHaveLength(1);
  });

  it.skipIf(!enabled)('avatar e caixa: abertura, sorteio e mint', async () => {
    const id = newChainId();
    const chain = new FakeChain(id);
    const store = make();
    chain.mine(1);
    chain.emit('LuckyBox', 'BoxOpened', { requestId: '1', buyer: ALICE, tierId: 1 });
    chain.mine(1);
    chain.emit('AvatarNFT', 'Transfer', { from: ZERO, to: ALICE, tokenId: '1' });
    chain.emit('AvatarNFT', 'AvatarMinted', { tokenId: '1', to: ALICE, rarity: 2, profession: padeiro });
    chain.emit('LuckyBox', 'AvatarRevealed', { requestId: '1', buyer: ALICE, tokenId: '1', rarity: 2, profession: padeiro });
    chain.mine(2);
    await drain(chain, store, options(id));

    expect(await store.box(id, '1')).toMatchObject({ buyer: ALICE, tierId: 1, status: 'revealed', tokenId: '1' });
    expect(await store.avatar(id, '1')).toMatchObject({ owner: ALICE, rarity: 2, profession: 'padeiro' });
    expect((await store.avatarsOf(id, ALICE)).map((a) => a.tokenId)).toEqual(['1']);
  });

  it.skipIf(!enabled)('reorganização: volta, descarta o que mudou e refaz as projeções', async () => {
    const id = newChainId();
    const chain = new FakeChain(id);
    const store = make();
    const opt = options(id, { confirmations: 0, reorgDepth: 3 });
    chain.mine(2);
    chain.emit('LandNFT', 'Transfer', mintLot(ALICE, 1, 1), 2);
    chain.mine(4);
    chain.emit('LandNFT', 'Transfer', { from: ALICE, to: BOB, tokenId: mintLot(ALICE, 1, 1).tokenId }, 6);
    await drain(chain, store, opt);
    expect((await store.lot(id, mintLot(ALICE, 1, 1).tokenId))?.owner).toBe(BOB);

    // A rede troca os blocos 5 e 6: a transferência para o Bob some.
    chain.fork(5n);
    const r = await tick(chain, store, opt);
    expect(r).toMatchObject({ kind: 'reorg', rewoundTo: 3n, dropped: 1 });
    expect((await store.lot(id, mintLot(ALICE, 1, 1).tokenId))?.owner).toBe(ALICE);

    chain.mine(1);
    await drain(chain, store, opt);
    expect(await store.cursor(id)).toMatchObject({ block: 7n, hash: await chain.blockHash(7n) });
    expect((await store.lot(id, mintLot(ALICE, 1, 1).tokenId))?.owner).toBe(ALICE);
  });

  it.skipIf(!enabled)('imóvel: mint com lote, tipo e nível; upgrade, venda e reorganização', async () => {
    const id = newChainId();
    const chain = new FakeChain(id);
    const store = make();
    const opt = options(id, { confirmations: 0, reorgDepth: 3 });
    const lotId = mintLot(ALICE, 1, 42).tokenId;
    const tokenId = '147735337091412453395938540624009591403';
    chain.mine(1);
    chain.emit('PropertyNFT', 'Transfer', { from: ZERO, to: ALICE, tokenId });
    chain.emit('PropertyNFT', 'PropertyMinted', { tokenId, lotId, owner: ALICE, typeCode: stringToHex('t1', { size: 32 }), level: 1 });
    chain.mine(1);
    chain.emit('PropertyNFT', 'PropertyUpgraded', { tokenId, level: 2 });
    chain.mine(3);
    chain.emit('PropertyNFT', 'Transfer', { from: ALICE, to: BOB, tokenId }, 5);
    await drain(chain, store, opt);
    expect(await store.property(id, tokenId)).toMatchObject({ owner: BOB, lotId, typeCode: 't1', level: 2 });
    expect((await store.propertiesOf(id, BOB)).map((p) => p.tokenId)).toEqual([tokenId]);

    // A venda some numa reorganização; o nível, que veio antes, fica.
    chain.fork(5n);
    await tick(chain, store, opt);
    expect(await store.property(id, tokenId)).toMatchObject({ owner: ALICE, level: 2 });
  });

  it.skipIf(!enabled)('lê em lotes de no máximo `batchBlocks`', async () => {
    const id = newChainId();
    const chain = new FakeChain(id);
    const store = make();
    chain.mine(30);
    const r = await tick(chain, store, options(id, { batchBlocks: 10, confirmations: 0 }));
    expect(r).toMatchObject({ kind: 'indexed', from: 1n, to: 10n });
  });
});

describe('API', () => {
  const INTERNAL = 'token-interno-do-indexer-com-32-caracteres'; // gitleaks:allow (só no teste)

  it('posse por dono, lote, status e feed interno', async () => {
    const id = 31337;
    const chain = new FakeChain(id);
    const store = new MemoryIndexerStore();
    chain.mine(1);
    chain.emit('LandNFT', 'Transfer', mintLot(ALICE, 1, 77));
    chain.emit('LandNFT', 'LotSold', {
      tokenId: mintLot(ALICE, 1, 77).tokenId,
      city: 1,
      lot: 77,
      buyer: ALICE,
      currency: ZERO,
      price: '0',
      nonce: mintLot(ALICE, 1, 77).tokenId,
    });
    chain.mine(1);
    await drain(chain, store, options(id, { confirmations: 0 }));

    const app = await buildApp(loadConfig({ NODE_ENV: 'test', CHAIN_ID: '31337', INTERNAL_TOKEN: INTERNAL }), store);
    const owner = (await app.inject({ method: 'GET', url: `/v1/chain/owners/${ALICE}` })).json();
    expect(owner.lots).toEqual([{ token_id: '4294967373', city: 1, lot: 77, owner: ALICE, block: '1' }]);
    expect((await app.inject({ method: 'GET', url: '/v1/chain/lots/4294967373' })).json().lot.owner).toBe(ALICE);
    expect((await app.inject({ method: 'GET', url: '/v1/chain/lots/1' })).statusCode).toBe(404);
    expect(owner.properties).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/v1/chain/properties/1' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/v1/chain/status' })).json()).toMatchObject({ chain_id: 31337, indexed_block: '2' });

    expect((await app.inject({ method: 'GET', url: '/internal/v1/chain/events' })).statusCode).toBe(403);
    const feed = (
      await app.inject({ method: 'GET', url: '/internal/v1/chain/events?after=0', headers: { 'x-service-token': INTERNAL } })
    ).json();
    expect(feed.events.map((e: { event: string }) => e.event)).toEqual(['Transfer', 'LotSold']);
    expect(feed.next_after).toBe(feed.events[1].id);
  });
});
