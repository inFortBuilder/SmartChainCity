import { randomUUID } from 'node:crypto';

import { buildApp as buildEconomy } from '@scc/economy/src/app.js';
import { loadConfig as economyConfig } from '@scc/economy/src/config.js';
import { MemoryLedgerStore } from '@scc/economy/src/infra/memory-store.js';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import {
  DAY_MS,
  type Property,
  type PropertyStore,
  type PropertyWork,
  applyWorkAt,
  nextLevel,
  repairCostCents,
  wearAt,
} from '../src/domain/properties.js';
import { PostgresPropertyStore } from '../src/infra/db/postgres-property-store.js';
import { LedgerLandPayments } from '../src/infra/ledger-payments.js';
import { LedgerPropertyPayments } from '../src/infra/ledger-property-payments.js';
import { MemoryPropertyStore } from '../src/infra/memory-property-store.js';
import { MemoryWorldStore } from '../src/infra/memory-store.js';
import { testCity, testLots, uniqueCode } from './fixtures.js';

const T0 = new Date('2026-11-20T12:00:00Z');
const at = (days: number) => new Date(T0.getTime() + days * DAY_MS);

const house = (over: Partial<Property> = {}): Property => ({
  id: randomUUID(),
  city: 'teste',
  lotId: 1,
  ownerAccountId: randomUUID(),
  type: 't1',
  level: 1,
  status: 'active',
  priceCents: 4000_00,
  createdAt: at(-1),
  readyAt: T0,
  wearBase: 100,
  wearSince: T0,
  lastClaimAt: T0,
  ...over,
});

const work = (p: Property, over: Partial<PropertyWork> = {}): PropertyWork => ({
  id: randomUUID(),
  propertyId: p.id,
  accountId: p.ownerAccountId,
  kind: 'repair',
  costCents: 1,
  toLevel: null,
  status: 'pending',
  createdAt: T0,
  ...over,
});

describe('reparo e upgrade (regras)', () => {
  it('reparo custa 2 THALER por ponto de desgaste na T1', () => {
    expect(repairCostCents(house(), at(30))).toBe(6000);
    expect(repairCostCents(house(), at(0.2))).toBe(0); // menos de meio ponto: nada a reparar
  });

  it('reparo fecha a renda até ali e volta o desgaste a 100', () => {
    const p = house();
    const { property, claim } = applyWorkAt(p, work(p), at(10));
    expect(claim?.amountCents).toBe(6755); // 7 dias (teto), como numa coleta
    expect(property.lastClaimAt).toEqual(at(10));
    expect(wearAt(property, at(10))).toBe(100);
    expect(wearAt(property, at(15))).toBeCloseTo(95);
  });

  it('upgrade sobe o nível e o desgaste segue de onde estava', () => {
    const p = house({ lastClaimAt: at(8) });
    const { property, claim } = applyWorkAt(p, work(p, { kind: 'upgrade', toLevel: 2 }), at(10));
    expect(property.level).toBe(2);
    expect(wearAt(property, at(10))).toBeCloseTo(90);
    expect(wearAt(property, at(12))).toBeCloseTo(88);
    // 2 dias de 92 a 90 de desgaste, no nível 1: 10 × 1,82
    expect(claim?.amountCents).toBe(1820);
  });

  it('obra nunca refaz um período já coletado', () => {
    const p = house({ lastClaimAt: at(12) });
    const { property, claim } = applyWorkAt(p, work(p), at(10));
    expect(claim).toBeNull();
    expect(property.lastClaimAt).toEqual(at(12));
  });

  it('T1 sobe até o nível 3', () => {
    expect(nextLevel(house())?.level).toBe(2);
    expect(nextLevel(house({ level: 2 }))?.upgradeCostCents).toBe(4000_00);
    expect(nextLevel(house({ level: 3 }))).toBeUndefined();
  });
});

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 10 }) : null;
afterAll(async () => {
  await pool?.end();
});

describe.each([
  ['memória', () => new MemoryPropertyStore() as PropertyStore, true],
  ['postgres', () => new PostgresPropertyStore(pool!) as PropertyStore, pool !== null],
] as const)('obras no PropertyStore (%s)', (_name, make, enabled) => {
  it.skipIf(!enabled)('uma obra pendente por imóvel; aplica uma vez só', async () => {
    const store = make();
    const p = house({ city: uniqueCode() });
    await store.createProperty(p);
    const w = work(p);
    await store.createWork(w);
    await expect(store.createWork(work(p))).rejects.toMatchObject({ code: 'work_in_progress' });

    const first = await store.applyWork(w.id, (cur) => applyWorkAt(cur, w, at(10)));
    expect(first?.claim?.amountCents).toBe(6755);
    expect(await store.applyWork(w.id, (cur) => applyWorkAt(cur, w, at(11)))).toBeNull();

    const saved = (await store.getProperty(p.id))!;
    expect(saved.wearBase).toBe(100);
    expect(saved.wearSince.getTime()).toBe(at(10).getTime());
    expect((await store.pendingClaims(at(11))).map((c) => c.amountCents)).toContain(6755);

    // Depois de aplicada, outra obra pode começar.
    const next = work(p, { kind: 'upgrade', toLevel: 2 });
    await store.createWork(next);
    await store.failWork(next.id);
    expect((await store.pendingWorks(at(1))).map((x) => x.id)).not.toContain(next.id);
  });
});

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const LEDGER_TOKEN = 'chave-interna-do-economy-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)

describe('reparo e upgrade de ponta a ponta (world + economy)', () => {
  let economy: Awaited<ReturnType<typeof buildEconomy>>;
  let world: Awaited<ReturnType<typeof buildApp>>;
  let clock: Date;

  beforeEach(async () => {
    economy = await buildEconomy(
      economyConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: LEDGER_TOKEN }),
      new MemoryLedgerStore(),
    );
    const ledgerUrl = await economy.listen({ port: 0, host: '127.0.0.1' });
    const store = new MemoryWorldStore();
    await store.importCity(testCity('teste'), testLots());
    clock = T0;
    world = await buildApp(
      loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET }),
      store,
      () => clock,
      new LedgerLandPayments(ledgerUrl, LEDGER_TOKEN),
      null,
      { store: new MemoryPropertyStore(), payments: new LedgerPropertyPayments(ledgerUrl, LEDGER_TOKEN) },
    );
  });
  afterEach(async () => {
    await economy.close();
  });

  const credit = (owner: { owner_type: string; owner_id: string }, currency: 'SCITY' | 'THALER', amount: bigint) =>
    economy.inject({
      method: 'POST',
      url: '/internal/v1/ledger/transactions',
      headers: { 'x-service-token': LEDGER_TOKEN, 'idempotency-key': `credito-${randomUUID()}` },
      payload: {
        kind: 'test_credit',
        legs: [
          { owner_type: 'system', owner_id: 'bridge', currency, amount: `-${amount}` },
          { ...owner, currency, amount: `${amount}` },
        ],
      },
    });

  const thalerOf = async (headers: Record<string, string>) =>
    (await economy.inject({ method: 'GET', url: '/v1/economy/balances', headers })).json().balances.find(
      (b: { currency: string }) => b.currency === 'THALER',
    )?.amount ?? '0';

  /** Dono de uma Casa T1 pronta há 30 dias, com `thaler` centavos depois da obra. */
  const readyHouse = async (thalerAfterBuild: bigint) => {
    const me = randomUUID();
    const headers = {
      authorization: `Bearer ${await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(me)
        .setIssuer('scc-gateway')
        .setAudience('scc-api')
        .setExpirationTime('1h')
        .sign(new TextEncoder().encode(SECRET))}`,
    };
    await credit({ owner_type: 'pool', owner_id: 'p2e' }, 'THALER', 10_000_000n);
    await credit({ owner_type: 'player', owner_id: me }, 'SCITY', 1000n * 10n ** 18n);
    await credit({ owner_type: 'player', owner_id: me }, 'THALER', 4000_00n + thalerAfterBuild);
    await world.inject({ method: 'POST', url: '/v1/world/cities/teste/lots/4/buy', headers });
    const built = await world.inject({ method: 'POST', url: '/v1/world/cities/teste/lots/4/property', headers, payload: { type: 't1' } });
    clock = at(31); // 1 dia de obra + 30 dias pronta
    return { headers, id: built.json().property.id as string };
  };

  it('reparo cobra pelo desgaste, paga a renda acumulada e volta o desgaste a 100', async () => {
    const { headers, id } = await readyHouse(100_00n);
    const before = (await world.inject({ method: 'GET', url: '/v1/world/me/properties', headers })).json().properties[0];
    expect(before).toMatchObject({ wear: 70, repair_cost_cents: 6000, accrued_cents: 6755 });

    const r = await world.inject({ method: 'POST', url: `/v1/world/properties/${id}/repair`, headers });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      work: { kind: 'repair', cost_cents: 6000 },
      claim: { amount_cents: 6755, status: 'paid' },
      property: { wear: 100, accrued_cents: 0, repair_cost_cents: 0 },
    });
    expect(await thalerOf(headers)).toBe(String(100_00 - 6000 + 6755));

    const again = await world.inject({ method: 'POST', url: `/v1/world/properties/${id}/repair`, headers });
    expect(again.json().error.code).toBe('nothing_to_repair');
  });

  it('upgrade sobe o nível e a renda; sem saldo não muda nada; no nível 3 para', async () => {
    const { headers, id } = await readyHouse(1000_00n);
    const poor = await world.inject({ method: 'POST', url: `/v1/world/properties/${id}/upgrade`, headers });
    expect(poor.statusCode).toBe(409);
    expect(poor.json().error.code).toBe('insufficient_thaler');
    const unchanged = (await world.inject({ method: 'GET', url: '/v1/world/me/properties', headers })).json().properties[0];
    expect(unchanged).toMatchObject({ level: 1, accrued_cents: 6755 });

    await credit({ owner_type: 'player', owner_id: unchangedOwner(headers) }, 'THALER', 6000_00n);
    const up = await world.inject({ method: 'POST', url: `/v1/world/properties/${id}/upgrade`, headers });
    expect(up.statusCode).toBe(200);
    expect(up.json().property).toMatchObject({ level: 2, wear: 70, next_level: { level: 3, cost_cents: 400000 } });
    expect(up.json().property.income_cents_per_day).toBe(1050); // 15 THALER × 70%

    const top = await world.inject({ method: 'POST', url: `/v1/world/properties/${id}/upgrade`, headers });
    expect(top.json().property.level).toBe(3);
    const max = await world.inject({ method: 'POST', url: `/v1/world/properties/${id}/upgrade`, headers });
    expect(max.json().error.code).toBe('max_level');
  });

  it('só o dono faz obra, e não durante a construção', async () => {
    const { id } = await readyHouse(0n);
    const stranger = {
      authorization: `Bearer ${await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(randomUUID())
        .setIssuer('scc-gateway')
        .setAudience('scc-api')
        .setExpirationTime('1h')
        .sign(new TextEncoder().encode(SECRET))}`,
    };
    const r = await world.inject({ method: 'POST', url: `/v1/world/properties/${id}/repair`, headers: stranger });
    expect(r.statusCode).toBe(404);
  });
});

/** O `sub` do token de teste (para creditar a mesma conta). */
function unchangedOwner(headers: { authorization: string }): string {
  const payload = headers.authorization.split('.')[1]!;
  return JSON.parse(Buffer.from(payload, 'base64url').toString()).sub as string;
}
