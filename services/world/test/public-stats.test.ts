import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { TaxBill, TaxStore } from '../src/domain/taxes.js';
import { PostgresTaxStore } from '../src/infra/db/postgres-tax-store.js';
import { MemoryWorldStore } from '../src/infra/memory-store.js';
import { MemoryTaxStore } from '../src/infra/memory-tax-store.js';
import { testCity, testLots, uniqueCode } from './fixtures.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const T0 = new Date('2026-11-22T12:00:00Z');
const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 3 }) : null;
afterAll(async () => {
  await pool?.end();
});

const bill = (city: string, over: Partial<TaxBill> = {}): TaxBill => ({
  id: randomUUID(),
  city,
  lotId: 1,
  accountId: randomUUID(),
  kind: 'pt',
  period: 1,
  amountCents: 12_345,
  fineCents: 655,
  dueAt: T0,
  status: 'pending',
  paidAt: null,
  createdAt: T0,
  ...over,
});

describe.each([
  ['memória', () => new MemoryTaxStore() as TaxStore, true],
  ['postgres', () => new PostgresTaxStore(pool!) as TaxStore, pool !== null],
] as const)('impostos pagos (%s)', (_n, make, enabled) => {
  it.runIf(enabled)('soma valor e multa só das contas pagas', async () => {
    const s = make();
    const before = await s.paidTotalCents();
    const city = uniqueCode();
    const paid = bill(city);
    await s.upsertBills([paid, bill(city, { lotId: 2 })]);
    await s.markPaid(paid.id, T0);
    expect((await s.paidTotalCents()) - before).toBe(13_000n);
  });
});

describe('números públicos do world (site)', () => {
  it('lotes vendidos e impostos pagos em THALER, com cache de 1 minuto', async () => {
    const lots = new MemoryWorldStore();
    await lots.importCity(testCity('teste'), testLots());
    const taxes = new MemoryTaxStore();
    let clock = T0;
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET }), lots, () => clock, null, null, null, {
      store: taxes,
      payments: null,
    });
    const p = await lots.reserve('teste', 0, randomUUID(), T0, () => ({ priceWei: 1n, priceUsd: 1 }));
    await lots.confirm(p.id, T0);
    const b = bill('teste');
    await taxes.upsertBills([b]);
    await taxes.markPaid(b.id, T0);
    expect((await app.inject({ url: '/v1/public/stats' })).json()).toEqual({ lands: 1, taxes: 130 });

    const p2 = await lots.reserve('teste', 1, randomUUID(), T0, () => ({ priceWei: 1n, priceUsd: 1 }));
    await lots.confirm(p2.id, T0);
    expect((await app.inject({ url: '/v1/public/stats' })).json().lands).toBe(1);
    clock = new Date(T0.getTime() + 60_000);
    expect((await app.inject({ url: '/v1/public/stats' })).json().lands).toBe(2);
  });
});
