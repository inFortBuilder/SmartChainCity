import { Pool } from 'pg';
import { type Hex, keccak256, stringToHex, toHex } from 'viem';
import { afterAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { ChainEvent, ContractName, EventArgs } from '../src/domain/events.js';
import { creditDeposits } from '../src/domain/deposits.js';
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

  it.skipIf(!enabled)('depósito do GameVault: credita uma vez, espera a carteira ser ligada e sobrevive à reorganização', async () => {
    const id = newChainId();
    const chain = new FakeChain(id);
    const store = make();
    const opt = options(id, { confirmations: 0, reorgDepth: 3 });
    const links = new Map<string, string>([[ALICE, 'conta-alice']]);
    const owners = { ownerOf: async (a: string) => links.get(a) ?? null };
    const posted = new Map<string, { accountId: string; amountWei: string }>();
    const ledger = {
      credit: async (key: string, accountId: string, amountWei: string) => {
        if (!posted.has(key)) posted.set(key, { accountId, amountWei }); // o ledger devolve o antigo com a mesma chave
      },
    };
    chain.mine(1);
    chain.emit('GameVault', 'Deposited', { account: ALICE, amount: '5000000000000000000' });
    chain.emit('GameVault', 'Deposited', { account: BOB, amount: '7' });
    chain.mine(4);
    await drain(chain, store, opt);

    expect(await creditDeposits(store, id, owners, ledger)).toEqual({ credited: 1, unlinked: 1 });
    expect([...posted.values()]).toEqual([{ accountId: 'conta-alice', amountWei: '5000000000000000000' }]);
    expect([...posted.keys()][0]).toMatch(new RegExp(`^chain:${id}:0x[0-9a-f]{64}:0$`));
    expect(await creditDeposits(store, id, owners, ledger)).toEqual({ credited: 0, unlinked: 1 });

    links.set(BOB, 'conta-bob');
    expect(await creditDeposits(store, id, owners, ledger)).toEqual({ credited: 1, unlinked: 0 });
    expect((await store.depositsOf(id, BOB))[0]).toMatchObject({ status: 'credited', accountId: 'conta-bob', amountWei: '7' });

    // Reorganização depois do bloco 1: as projeções voltam a pendente, mas a chave não credita de novo.
    chain.fork(4n);
    await tick(chain, store, opt);
    await creditDeposits(store, id, owners, ledger);
    expect(posted.size).toBe(2);
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

describe('Marketplace no indexer', () => {
  const LAND = '0x00000000000000000000000000000000000000aa';
  const AVATAR = '0x00000000000000000000000000000000000000bb';
  const MARKET = '0x00000000000000000000000000000000000000cc';
  const lotId = mintLot(ALICE, 1, 9).tokenId;
  const later = () => String(Math.floor(Date.now() / 1000) + 86_400);
  const listed = (listingId: string, seller: string, collections: string[], tokenIds: string[], price = '1000', expiresAt = later()) => ({
    listingId,
    seller,
    price,
    expiresAt,
    collections: collections.join(','),
    tokenIds: tokenIds.join(','),
  });

  it.each([
    ['memória', () => new MemoryIndexerStore() as IndexerStore, true],
    ['postgres', () => new PostgresIndexerStore(pool!) as IndexerStore, pool !== null],
  ] as const)('listagens: aberta, velha, substituída, vendida e cancelada (%s)', async (_n, make, enabled) => {
    if (!enabled) return;
    const id = newChainId();
    const chain = new FakeChain(id);
    const store = make();
    const opt = options(id, { confirmations: 0 });
    chain.mine(1);
    chain.emit('LandNFT', 'Transfer', mintLot(ALICE, 1, 9));
    chain.emit('AvatarNFT', 'Transfer', { from: ZERO, to: ALICE, tokenId: '5' });
    chain.emit('Marketplace', 'Listed', listed('1', ALICE, [LAND], [lotId]));
    chain.emit('Marketplace', 'Listed', listed('2', ALICE, [AVATAR], ['5'], '300'));
    chain.emit('Marketplace', 'Listed', listed('3', ALICE, [AVATAR], ['6'], '1', '100')); // já vencida
    chain.mine(1);
    await drain(chain, store, opt);
    expect((await store.activeListings(id, 10)).map((l) => l.listingId)).toEqual(['3', '2', '1']);
    expect(await store.listing(id, '1')).toMatchObject({ seller: ALICE, priceWei: '1000', items: [{ collection: LAND, tokenId: lotId }] });

    const app = await buildApp(
      { ...loadConfig({ NODE_ENV: 'test', CHAIN_ID: String(id) }), contracts: { LandNFT: LAND, AvatarNFT: AVATAR, Marketplace: MARKET } },
      store,
    );
    const list = async (q = '') => (await app.inject({ method: 'GET', url: `/v1/market/listings${q}` })).json();
    expect((await list()).listings.map((l: { listing_id: string }) => l.listing_id)).toEqual(['2', '1']);
    expect((await list()).listings[1]).toMatchObject({ items: [{ collection: 'LandNFT', token_id: lotId, owner: ALICE }], stale: false });

    // Alice vende o lote fora do mercado: a listagem 1 fica velha e sai da lista.
    chain.mine(1);
    chain.emit('LandNFT', 'Transfer', { from: ALICE, to: BOB, tokenId: lotId });
    chain.mine(1);
    await drain(chain, store, opt);
    expect((await list()).listings.map((l: { listing_id: string }) => l.listing_id)).toEqual(['2']);
    expect((await list('?all=true')).listings.find((l: { listing_id: string }) => l.listing_id === '1')).toMatchObject({ stale: true });

    // Bob lista o lote: a velha é substituída. A 2 é vendida e a 4 cancelada.
    chain.mine(1);
    chain.emit('Marketplace', 'Listed', listed('4', BOB, [LAND], [lotId], '2000'));
    chain.emit('Marketplace', 'Sold', { listingId: '2', seller: ALICE, buyer: BOB, price: '300', fee: '7', royalty: '7' });
    chain.mine(1);
    await drain(chain, store, opt);
    expect((await store.listing(id, '1'))!.status).toBe('replaced');
    expect(await store.listing(id, '2')).toMatchObject({ status: 'sold', buyer: BOB });
    expect((await list()).listings.map((l: { listing_id: string }) => l.listing_id)).toEqual(['4']);
    chain.mine(1);
    chain.emit('Marketplace', 'Cancelled', { listingId: '4' });
    chain.mine(1);
    await drain(chain, store, opt);
    expect((await list()).listings).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/v1/market/listings/2' })).json().listing).toMatchObject({ status: 'sold', buyer: BOB });
    expect((await app.inject({ method: 'GET', url: '/v1/market/listings/99' })).statusCode).toBe(404);

    // Reorganização: as listagens são refeitas a partir dos eventos que ficaram.
    await store.rewind(id, { block: 1n, hash: (await chain.blockHash(1n))! });
    expect((await store.activeListings(id, 10)).map((l) => l.listingId)).toEqual(['3', '2', '1']);
  });

  it.each([
    ['memória', () => new MemoryIndexerStore() as IndexerStore, true],
    ['postgres', () => new PostgresIndexerStore(pool!) as IndexerStore, pool !== null],
  ] as const)('leilões: lances, vencedor, sem lance e cancelado (%s)', async (_n, make, enabled) => {
    if (!enabled) return;
    const id = newChainId();
    const chain = new FakeChain(id);
    const store = make();
    const opt = options(id, { confirmations: 0 });
    const CAROL = '0x90f79bf6eb2c4f870365e785982e1f101e93b906';
    const created = (auctionId: string, startPrice = '100') => ({
      auctionId, seller: ALICE, startPrice, endsAt: later(), collections: LAND, tokenIds: lotId,
    });
    chain.mine(1);
    chain.emit('Marketplace', 'AuctionCreated', created('1'));
    chain.emit('Marketplace', 'BidPlaced', { auctionId: '1', bidder: BOB, amount: '100', endsAt: later() });
    chain.emit('Marketplace', 'BidPlaced', { auctionId: '1', bidder: CAROL, amount: '200', endsAt: String(Number(later()) + 600) });
    chain.emit('Marketplace', 'AuctionCreated', created('2'));
    chain.emit('Marketplace', 'AuctionCreated', created('3'));
    chain.mine(1);
    await drain(chain, store, opt);
    const app = await buildApp(
      { ...loadConfig({ NODE_ENV: 'test', CHAIN_ID: String(id) }), contracts: { LandNFT: LAND, Marketplace: MARKET } },
      store,
    );
    const list = async () => (await app.inject({ method: 'GET', url: '/v1/market/auctions' })).json().auctions;
    expect((await list()).map((a: { auction_id: string }) => a.auction_id)).toEqual(['3', '2', '1']);
    expect((await list())[2]).toMatchObject({
      highest_bid_wei: '200', highest_bidder: CAROL, bids: 2, minimum_bid_wei: '210', ended: false,
      items: [{ collection: 'LandNFT', token_id: lotId }],
    });

    chain.mine(1);
    chain.emit('Marketplace', 'AuctionSettled', { auctionId: '1', seller: ALICE, winner: CAROL, price: '200', fee: '5', royalty: '0' });
    chain.emit('Marketplace', 'AuctionSettled', { auctionId: '2', seller: ALICE, winner: ZERO, price: '0', fee: '0', royalty: '0' });
    chain.emit('Marketplace', 'AuctionCancelled', { auctionId: '3' });
    chain.mine(1);
    await drain(chain, store, opt);
    expect(await list()).toEqual([]);
    const one = async (n: string) => (await app.inject({ method: 'GET', url: `/v1/market/auctions/${n}` })).json().auction;
    expect(await one('1')).toMatchObject({ status: 'settled', winner: CAROL });
    expect(await one('2')).toMatchObject({ status: 'settled', winner: null });
    expect(await one('3')).toMatchObject({ status: 'cancelled' });
    expect((await app.inject({ method: 'GET', url: '/v1/market/auctions/9' })).statusCode).toBe(404);
  });
});
