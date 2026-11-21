import { randomUUID } from 'node:crypto';

import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { type ChainSyncStore, type FeedEvent, lotOfToken, propertyIdOfToken, syncChain } from '../src/domain/chain-sync.js';
import { lotTokenId } from '../src/domain/land-quote.js';
import { DAY_MS, type Property, type PropertyPayments } from '../src/domain/properties.js';
import { propertyTokenId } from '../src/domain/property-voucher.js';
import { PostgresChainSyncStore } from '../src/infra/db/postgres-chain-sync-store.js';
import { MemoryChainSyncStore } from '../src/infra/memory-chain-sync-store.js';
import { MemoryPropertyStore } from '../src/infra/memory-property-store.js';
import { MemoryWorldStore } from '../src/infra/memory-store.js';
import { testCity, testLots } from './fixtures.js';

const T0 = new Date('2026-11-21T12:00:00Z');
const ZERO = '0x0000000000000000000000000000000000000000';
const ALICE_WALLET = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
const BOB_WALLET = '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc';
const CAROL_WALLET = '0x90f79bf6eb2c4f870365e785982e1f101e93b906';

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 5 }) : null;
afterAll(async () => {
  await pool?.end();
});

describe('ids dos tokens', () => {
  it('lote e imóvel voltam do tokenId', () => {
    expect(lotOfToken(lotTokenId(1, 42))).toEqual({ city: 1, lot: 42 });
    const id = randomUUID();
    expect(propertyIdOfToken(propertyTokenId(id))).toBe(id);
    expect(propertyIdOfToken(0n)).toBeNull();
  });
});

/** Feed de mentira com a mesma forma do /internal/v1/chain/events. */
class Feed {
  list: FeedEvent[] = [];
  push(contract: string, from: string, to: string, tokenId: bigint) {
    this.list.push({ id: this.list.length + 1, contract, event: 'Transfer', args: { from, to, tokenId: tokenId.toString() } });
  }
  async events(after: number, limit: number) {
    const events = this.list.filter((e) => e.id > after).slice(0, limit);
    return { events, nextAfter: events.at(-1)?.id ?? after };
  }
}

describe('chain.sync', () => {
  let lots: MemoryWorldStore;
  let properties: MemoryPropertyStore;
  let feed: Feed;
  let links: Map<string, string>;
  let syncStore: MemoryChainSyncStore;
  let alice: string;
  let house: Property;

  beforeEach(async () => {
    lots = new MemoryWorldStore();
    await lots.importCity(testCity('teste'), testLots());
    properties = new MemoryPropertyStore();
    feed = new Feed();
    syncStore = new MemoryChainSyncStore();
    alice = randomUUID();
    links = new Map([[ALICE_WALLET, alice]]);
    const p = await lots.reserve('teste', 4, alice, T0, () => ({ priceWei: 1n, priceUsd: 1 }));
    await lots.confirm(p.id, T0);
    house = {
      id: randomUUID(),
      city: 'teste',
      lotId: 4,
      ownerAccountId: alice,
      type: 't1',
      level: 1,
      status: 'active',
      priceCents: 4000_00,
      createdAt: T0,
      readyAt: T0,
      wearBase: 100,
      wearSince: T0,
      lastClaimAt: T0,
    };
    await properties.createProperty(house);
  });

  const run = () =>
    syncChain(
      { feed, owners: { ownerOf: async (a) => links.get(a) ?? null }, store: syncStore, lots, properties, cityOf: (n) => (n === 1 ? 'teste' : undefined) },
      2,
    );

  it('o lote vendido na blockchain passa para a conta da carteira; o mint é ignorado; repetir não muda nada', async () => {
    const bob = randomUUID();
    links.set(BOB_WALLET, bob);
    feed.push('LandNFT', ZERO, ALICE_WALLET, lotTokenId(1, 4)); // mint: o jogo já sabe
    feed.push('LandNFT', ALICE_WALLET, BOB_WALLET, lotTokenId(1, 4));
    feed.push('LuckyBox', ZERO, BOB_WALLET, 1n); // outro contrato: ignorado
    expect(await run()).toEqual({ applied: 1, pending: 0 });
    expect((await lots.getLot('teste', 4))!.ownerAccountId).toBe(bob);
    expect(await syncStore.cursor()).toBe(3);
    expect(await run()).toEqual({ applied: 0, pending: 0 });
  });

  it('carteira sem conta: fica pendente e passa quando a carteira for ligada', async () => {
    feed.push('PropertyNFT', ALICE_WALLET, BOB_WALLET, propertyTokenId(house.id));
    expect(await run()).toEqual({ applied: 0, pending: 1 });
    expect((await properties.getProperty(house.id))!.ownerAccountId).toBe(alice);
    const bob = randomUUID();
    links.set(BOB_WALLET, bob);
    expect(await run()).toEqual({ applied: 1, pending: 0 });
    expect((await properties.getProperty(house.id))!.ownerAccountId).toBe(bob);
    expect(await syncStore.pending(10)).toEqual([]);
  });

  it('transferências seguidas do mesmo token: vale a última, mesmo com uma pendente antes', async () => {
    const carol = randomUUID();
    links.set(CAROL_WALLET, carol);
    feed.push('LandNFT', ALICE_WALLET, BOB_WALLET, lotTokenId(1, 4)); // Bob sem conta: pendente
    feed.push('LandNFT', BOB_WALLET, CAROL_WALLET, lotTokenId(1, 4));
    await run();
    expect((await lots.getLot('teste', 4))!.ownerAccountId).toBe(carol);
    // Bob liga a carteira depois: não toma o lote de volta.
    links.set(BOB_WALLET, randomUUID());
    await run();
    expect((await lots.getLot('teste', 4))!.ownerAccountId).toBe(carol);
  });
});

describe.each([
  ['memória', () => new MemoryChainSyncStore() as ChainSyncStore, true],
  ['postgres', () => new PostgresChainSyncStore(pool!) as ChainSyncStore, pool !== null],
] as const)('ChainSyncStore (%s)', (_name, make, enabled) => {
  it.skipIf(!enabled)('cursor e pendentes', async () => {
    const store = make();
    const base = Math.floor(Math.random() * 1e8);
    await store.setCursor(base);
    expect(await store.cursor()).toBe(base);
    const token = String(base);
    await store.addPending({ eventId: base + 1, kind: 'lot', tokenId: token, to: BOB_WALLET });
    await store.addPending({ eventId: base + 1, kind: 'lot', tokenId: token, to: BOB_WALLET });
    await store.addPending({ eventId: base + 2, kind: 'property', tokenId: token, to: BOB_WALLET });
    const mine = (await store.pending(10_000)).filter((t) => t.tokenId === token);
    expect(mine.map((t) => t.kind)).toEqual(['lot', 'property']);
    await store.dropPendingFor('lot', token);
    await store.dropPending(base + 2);
    expect((await store.pending(10_000)).filter((t) => t.tokenId === token)).toEqual([]);
  });
});

describe('renda e dono do lote', () => {
  const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)

  it('quem vendeu o lote na blockchain não coleta mais a renda do imóvel', async () => {
    const lots = new MemoryWorldStore();
    await lots.importCity(testCity('teste'), testLots());
    const properties = new MemoryPropertyStore();
    const paid: number[] = [];
    const payments = { payIncome: async (c: { amountCents: number }) => void paid.push(c.amountCents) } as unknown as PropertyPayments;
    const me = randomUUID();
    const p = await lots.reserve('teste', 4, me, T0, () => ({ priceWei: 1n, priceUsd: 1 }));
    await lots.confirm(p.id, T0);
    const house: Property = {
      id: randomUUID(),
      city: 'teste',
      lotId: 4,
      ownerAccountId: me,
      type: 't1',
      level: 1,
      status: 'active',
      priceCents: 4000_00,
      createdAt: T0,
      readyAt: T0,
      wearBase: 100,
      wearSince: T0,
      lastClaimAt: T0,
    };
    await properties.createProperty(house);
    const world = await buildApp(loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET }), lots, () => new Date(T0.getTime() + DAY_MS), null, null, {
      store: properties,
      payments,
    });
    const headers = {
      authorization: `Bearer ${await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(me)
        .setIssuer('scc-gateway')
        .setAudience('scc-api')
        .setExpirationTime('1h')
        .sign(new TextEncoder().encode(SECRET))}`,
    };
    await lots.transferLot('teste', 4, me, randomUUID());
    const r = await world.inject({ method: 'POST', url: `/v1/world/properties/${house.id}/claim`, headers });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('lot_not_owned');
    expect(paid).toEqual([]);
  });
});
