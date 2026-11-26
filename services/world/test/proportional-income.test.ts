import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { type FeedEvent, syncChain } from '../src/domain/chain-sync.js';
import { lotTokenId } from '../src/domain/land-quote.js';
import {
  DAY_MS,
  type Property,
  type PropertyStore,
  accrued,
  applyWorkAt,
  closeIncomeBeforeTransfer,
} from '../src/domain/properties.js';
import { propertyTokenId } from '../src/domain/property-voucher.js';
import { PostgresPropertyStore } from '../src/infra/db/postgres-property-store.js';
import { MemoryChainSyncStore } from '../src/infra/memory-chain-sync-store.js';
import { MemoryPropertyStore } from '../src/infra/memory-property-store.js';
import { MemoryWorldStore } from '../src/infra/memory-store.js';
import { testCity, testLots } from './fixtures.js';

const T0 = new Date('2026-11-21T12:00:00Z');
const at = (days: number) => new Date(T0.getTime() + days * DAY_MS);
const WALLET_A = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
const WALLET_B = '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc';

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 3 }) : null;
afterAll(async () => {
  await pool?.end();
});

const house = (owner: string, lotId: number, over: Partial<Property> = {}): Property => ({
  id: randomUUID(),
  city: 'teste',
  lotId,
  ownerAccountId: owner,
  type: 't1',
  level: 1,
  status: 'active',
  priceCents: 4000_00,
  createdAt: at(-1),
  readyAt: T0,
  wearBase: 100,
  wearSince: T0,
  lastClaimAt: T0,
  // Regularizada, com água e energia: renda de 100% (doc 03 §3).
  regularizedAt: at(-1),
  waterFrom: at(-1),
  waterUntil: at(1000),
  powerFrom: at(-1),
  powerUntil: at(1000),
  ...over,
});

/** Lote `lotId` vendido a `owner`, com uma T1 pronta desde T0. */
async function setup(owner: string, lotId = 4) {
  const lots = new MemoryWorldStore();
  await lots.importCity(testCity('teste'), testLots());
  const p = await lots.reserve('teste', lotId, owner, at(-2), () => ({ priceWei: 1n, priceUsd: 1 }));
  await lots.confirm(p.id, at(-2));
  const properties = new MemoryPropertyStore();
  const property = house(owner, lotId);
  await properties.createProperty(property);
  return { lots, properties, property };
}

// T1 nível 1: 10 THALER/dia × desgaste/100, com o desgaste caindo 1 por dia desde T0.
const income = (fromDay: number, toDay: number) => accrued(house('x', 1, { lastClaimAt: at(fromDay) }), at(toDay)).cents;

describe('renda proporcional ao tempo em que os donos coincidiram', () => {
  it('pelo chain.sync: o lote sai, o imóvel vai atrás, e cada um leva só o seu período', async () => {
    const a = randomUUID();
    const b = randomUUID();
    const { lots, properties, property } = await setup(a);
    const events: FeedEvent[] = [];
    const push = (contract: string, tokenId: bigint) =>
      events.push({ id: events.length + 1, contract, event: 'Transfer', args: { from: WALLET_A, to: WALLET_B, tokenId: tokenId.toString() } });
    let clock = at(3);
    const deps = {
      feed: {
        events: async (after: number, limit: number) => {
          const list = events.filter((e) => e.id > after).slice(0, limit);
          return { events: list, nextAfter: list.at(-1)?.id ?? after };
        },
      },
      owners: { ownerOf: async (w: string) => (w === WALLET_A ? a : w === WALLET_B ? b : null) },
      store: new MemoryChainSyncStore(),
      lots,
      properties,
      cityOf: (n: number) => (n === 1 ? 'teste' : undefined),
      now: () => clock,
    };

    // Dia 3: A vende o lote na blockchain. Os 3 dias em que A tinha os dois viram uma coleta de A.
    push('LandNFT', lotTokenId(1, 4));
    await syncChain(deps);
    const claims = await properties.pendingClaims(at(100));
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ accountId: a, amountCents: income(0, 3) });
    expect((await lots.getLot('teste', 4))!.ownerAccountId).toBe(b);

    // Dia 5: o imóvel vai para B. Os 2 dias separados não rendem para ninguém.
    clock = at(5);
    push('PropertyNFT', propertyTokenId(property.id));
    await syncChain(deps);
    const moved = (await properties.getProperty(property.id))!;
    expect(moved.ownerAccountId).toBe(b);
    expect(moved.lastClaimAt).toEqual(at(5));
    expect(await properties.pendingClaims(at(100))).toHaveLength(1);

    // Dia 6: B coleta só o dia em que tem os dois.
    expect(accrued(moved, at(6)).cents).toBe(income(5, 6));
    expect(income(0, 3)).toBe(2955);
    expect(income(5, 6)).toBe(945);
  });

  it('separados e depois juntos de novo: o período separado não rende', async () => {
    const a = randomUUID();
    const b = randomUUID();
    const { lots, properties, property } = await setup(a);
    // Dia 1: o lote vai para B (A coleta o dia 0-1). Dia 4: volta para A (período separado perdido).
    await closeIncomeBeforeTransfer({ lots, properties }, 'teste', 4, at(1));
    await lots.transferLot('teste', 4, a, b);
    expect(await closeIncomeBeforeTransfer({ lots, properties }, 'teste', 4, at(4))).toEqual({ kind: 'forfeited', cents: income(1, 4) });
    await lots.transferLot('teste', 4, b, a);
    expect(accrued((await properties.getProperty(property.id))!, at(6)).cents).toBe(income(4, 6));
  });

  it('obra com os donos separados fecha o período sem renda', async () => {
    const p = house(randomUUID(), 4);
    const w = { id: randomUUID(), propertyId: p.id, accountId: p.ownerAccountId, kind: 'repair' as const, costCents: 1, toLevel: null, status: 'pending' as const, createdAt: at(3) };
    expect(applyWorkAt(p, w, at(3), false)).toMatchObject({ claim: null, property: { lastClaimAt: at(3), wearBase: 100 } });
    expect(applyWorkAt(p, w, at(3), true).claim?.amountCents).toBe(income(0, 3));
  });

  it('imóvel em obra ou sem renda acumulada: nada a fechar', async () => {
    const a = randomUUID();
    const { lots, properties } = await setup(a);
    expect(await closeIncomeBeforeTransfer({ lots, properties }, 'teste', 4, at(-0.5))).toEqual({ kind: 'none' });
    expect(await closeIncomeBeforeTransfer({ lots, properties }, 'teste', 5, at(3))).toEqual({ kind: 'none' });
  });
});

describe.each([
  ['memória', () => new MemoryPropertyStore() as PropertyStore, true],
  ['postgres', () => new PostgresPropertyStore(pool!) as PropertyStore, pool !== null],
] as const)('skipIncome (%s)', (_name, make, enabled) => {
  it.skipIf(!enabled)('fecha o período sem coleta, só se ninguém coletou antes', async () => {
    const store = make();
    const p = house(randomUUID(), 1000 + Math.floor(Math.random() * 1e6), { city: `skip-${randomUUID().slice(0, 8)}` });
    await store.createProperty(p);
    expect(await store.skipIncome(p.id, at(1), at(2))).toBe(false);
    expect(await store.skipIncome(p.id, T0, at(2))).toBe(true);
    expect((await store.getProperty(p.id))!.lastClaimAt).toEqual(at(2));
    expect(await store.skipIncome(p.id, T0, at(3))).toBe(false);
  });
});
