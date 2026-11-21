import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { recoverTypedDataAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { type FeedEvent, syncChain } from '../src/domain/chain-sync.js';
import { landDomain, lotTokenId } from '../src/domain/land-quote.js';
import { MemoryPropertyStore } from '../src/infra/memory-property-store.js';
import { MemoryWorldStore } from '../src/infra/memory-store.js';
import { SEIZURE_TYPES, type SeizureStore, issueSeizureVoucher, newSeizure } from '../src/domain/seizures.js';
import { PostgresSeizureStore } from '../src/infra/db/postgres-seizure-store.js';
import { LocalKeySeizureSigner } from '../src/infra/land-chain.js';
import { MemoryChainSyncStore } from '../src/infra/memory-chain-sync-store.js';
import { MemorySeizureStore } from '../src/infra/memory-seizure-store.js';
import { testCity, testLots } from './fixtures.js';

const T0 = new Date('2026-11-21T12:00:00Z');
const LAND = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const SELLER = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
const ESCAPE = '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc';
const WINNER = '0x90f79bf6eb2c4f870365e785982e1f101e93b906';

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 5 }) : null;
afterAll(async () => {
  await pool?.end();
});

describe('voucher de apreensão', () => {
  const key = generatePrivateKey();
  const signer = new LocalKeySeizureSigner(key, 31337, LAND, 'land');
  let store: MemorySeizureStore;
  const winner = randomUUID();
  const wallets = { walletsOf: async (id: string) => (id === winner ? [WINNER] : []) };

  beforeEach(() => {
    store = new MemorySeizureStore();
  });

  it('assina para a carteira ligada do vencedor, no domínio do LandNFT', async () => {
    const s = await store.openSeizure(newSeizure({ kind: 'lot', tokenId: lotTokenId(1, 4), city: 'teste', lotId: 4, toAccountId: winner }, T0));
    const r = await issueSeizureVoucher(
      { store, wallets, signers: { lot: signer }, chain: { exists: async () => true } },
      { seizureId: s.id, accountId: winner, wallet: WINNER },
      T0,
    );
    expect(r.voucher).toMatchObject({ tokenId: lotTokenId(1, 4), nonce: s.nonce });
    expect(r.voucher.to.toLowerCase()).toBe(WINNER);
    expect(Number(r.voucher.deadline) - T0.getTime() / 1000).toBe(86_400);
    const recovered = await recoverTypedDataAddress({
      domain: landDomain(31337, LAND),
      types: SEIZURE_TYPES,
      primaryType: 'Seizure',
      message: r.voucher,
      signature: r.signature,
    });
    expect(recovered).toBe(privateKeyToAccount(key).address);
  });

  it('recusa outra conta, carteira não ligada e token fora da blockchain (que cancela)', async () => {
    const s = await store.openSeizure(newSeizure({ kind: 'lot', tokenId: lotTokenId(1, 5), city: 'teste', lotId: 5, toAccountId: winner }, T0));
    const deps = { store, wallets, signers: { lot: signer }, chain: { exists: async () => false } };
    await expect(issueSeizureVoucher(deps, { seizureId: s.id, accountId: randomUUID(), wallet: WINNER }, T0)).rejects.toMatchObject({ code: 'not_found' });
    await expect(issueSeizureVoucher(deps, { seizureId: s.id, accountId: winner, wallet: ESCAPE }, T0)).rejects.toMatchObject({ code: 'wallet_not_linked' });
    await expect(issueSeizureVoucher(deps, { seizureId: s.id, accountId: winner, wallet: WINNER }, T0)).rejects.toMatchObject({ code: 'not_onchain' });
    expect((await store.get(s.id))!.status).toBe('cancelled');
    await expect(issueSeizureVoucher(deps, { seizureId: s.id, accountId: winner, wallet: WINNER }, T0)).rejects.toMatchObject({ code: 'seizure_closed' });
  });
});

describe('chain.sync com apreensão aberta', () => {
  it('a venda do dono antigo não muda o dono no jogo; a chegada ao vencedor fecha a apreensão', async () => {
    const lots = new MemoryWorldStore();
    await lots.importCity(testCity('teste'), testLots());
    const seller = randomUUID();
    const escaped = randomUUID();
    const winner = randomUUID();
    const p = await lots.reserve('teste', 4, seller, T0, () => ({ priceWei: 1n, priceUsd: 1 }));
    await lots.confirm(p.id, T0);
    await lots.transferLot('teste', 4, seller, winner); // o leilão já passou o lote no jogo
    const seizures = new MemorySeizureStore();
    const s = await seizures.openSeizure(newSeizure({ kind: 'lot', tokenId: lotTokenId(1, 4), city: 'teste', lotId: 4, toAccountId: winner }, T0));

    const events: FeedEvent[] = [];
    const push = (from: string, to: string) =>
      events.push({ id: events.length + 1, contract: 'LandNFT', event: 'Transfer', args: { from, to, tokenId: lotTokenId(1, 4).toString() } });
    const links = new Map([
      [SELLER, seller],
      [ESCAPE, escaped],
      [WINNER, winner],
    ]);
    const deps = {
      feed: { events: async (after: number, limit: number) => {
        const list = events.filter((e) => e.id > after).slice(0, limit);
        return { events: list, nextAfter: list.at(-1)?.id ?? after };
      } },
      owners: { ownerOf: async (a: string) => links.get(a) ?? null },
      store: new MemoryChainSyncStore(),
      lots,
      properties: new MemoryPropertyStore(),
      cityOf: (n: number) => (n === 1 ? 'teste' : undefined),
      seizures,
      now: () => T0,
    };

    push(SELLER, ESCAPE); // o dono antigo tenta fugir vendendo
    await syncChain(deps);
    expect((await lots.getLot('teste', 4))!.ownerAccountId).toBe(winner);
    expect((await seizures.get(s.id))!.status).toBe('open');

    push(ESCAPE, WINNER); // LandNFT.seize leva o token ao vencedor
    await syncChain(deps);
    expect((await seizures.get(s.id))!.status).toBe('done');
    expect((await lots.getLot('teste', 4))!.ownerAccountId).toBe(winner);

    // Depois de concluída, a posse volta a seguir a blockchain normalmente.
    push(WINNER, ESCAPE);
    await syncChain(deps);
    expect((await lots.getLot('teste', 4))!.ownerAccountId).toBe(escaped);
  });
});

describe.each([
  ['memória', () => new MemorySeizureStore() as SeizureStore, true],
  ['postgres', () => new PostgresSeizureStore(pool!) as SeizureStore, pool !== null],
] as const)('SeizureStore (%s)', (_name, make, enabled) => {
  it.skipIf(!enabled)('uma aberta por token: a nova cancela a anterior; fecha uma vez', async () => {
    const store = make();
    const token = BigInt(Math.floor(Math.random() * 1e12));
    const a = randomUUID();
    const b = randomUUID();
    const first = await store.openSeizure(newSeizure({ kind: 'lot', tokenId: token, city: 'teste', lotId: 4, toAccountId: a }, T0));
    const second = await store.openSeizure(newSeizure({ kind: 'lot', tokenId: token, city: 'teste', lotId: 4, toAccountId: b }, T0));
    expect((await store.get(first.id))!.status).toBe('cancelled');
    expect((await store.openFor('lot', token.toString()))!.id).toBe(second.id);
    expect((await store.openOf(b)).map((x) => x.id)).toEqual([second.id]);
    expect(second.nonce).toBe(BigInt(`0x${second.id.replace(/-/g, '')}`));
    expect(await store.close(second.id, 'done', T0)).toBe(true);
    expect(await store.close(second.id, 'cancelled', T0)).toBe(false);
    expect(await store.openFor('lot', token.toString())).toBeNull();
  });
});
