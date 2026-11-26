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
  type PropertyWork,
  accrued,
  applyWorkAt,
  extendUtility,
  isRegular,
  regularWindow,
  utilityCostCents,
} from '../src/domain/properties.js';
import { PostgresPropertyStore } from '../src/infra/db/postgres-property-store.js';
import { PostgresWorldStore } from '../src/infra/db/postgres-store.js';
import { LedgerLandPayments } from '../src/infra/ledger-payments.js';
import { LedgerPropertyPayments } from '../src/infra/ledger-property-payments.js';
import { MemoryPropertyStore } from '../src/infra/memory-property-store.js';
import { MemoryWorldStore } from '../src/infra/memory-store.js';
import { testCity, testLots, uniqueCode } from './fixtures.js';

/**
 * Regularização na Prefeitura, água e energia (doc 03 §3 e §4; doc 04 §4): sem as três, o imóvel
 * rende 50%; a casa regular é a moradia própria que o game-core consulta.
 */
const T0 = new Date('2026-11-20T12:00:00Z');
const at = (days: number) => new Date(T0.getTime() + days * DAY_MS);

/** Casa T1 pronta em T0, desgaste 100, sem regularização nem serviços. */
const house = (over: Partial<Property> = {}): Property => ({
  id: randomUUID(),
  city: 'teste',
  lotId: 4,
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

const work = (p: Property, kind: PropertyWork['kind']): PropertyWork => ({
  id: randomUUID(),
  propertyId: p.id,
  accountId: p.ownerAccountId,
  kind,
  costCents: 0,
  toLevel: null,
  status: 'pending',
  createdAt: T0,
});

describe('regras da regularização e dos serviços', () => {
  it('sem regularização, água ou energia, o imóvel rende 50%', () => {
    // 1 dia: 10 × 99,5% = 995 com tudo em dia.
    expect(accrued(house(), at(1)).cents).toBe(497);
    expect(accrued(house({ regularizedAt: at(-1), waterFrom: at(-1), waterUntil: at(30) }), at(1)).cents).toBe(497);
    const full = house({ regularizedAt: at(-1), waterFrom: at(-1), waterUntil: at(30), powerFrom: at(-1), powerUntil: at(30) });
    expect(accrued(full, at(1)).cents).toBe(995);
    expect(isRegular(full, at(1))).toBe(true);
    expect(isRegular(full, at(30))).toBe(false);
  });

  it('a renda muda no instante em que a janela regular começa ou acaba', () => {
    // Regular só no primeiro meio dia: metade a 100%, metade a 50%.
    const p = house({ regularizedAt: T0, waterFrom: T0, waterUntil: at(0.5), powerFrom: T0, powerUntil: at(2) });
    expect(regularWindow(p)).toEqual([T0, at(0.5)]);
    // ∫0..0,5 de 10(100−x)/100 = 4,9875; ∫0,5..1 = 4,9625 → 4,9875 + 0,5 × 4,9625 = 7,46875
    expect(accrued(p, at(1)).cents).toBe(746);
  });

  it('água e energia: em dia estende, vencida recomeça; o custo sobe até o dobro na borda', () => {
    const p = house({ waterFrom: T0, waterUntil: at(30) });
    expect(extendUtility(p, 'water', at(10))).toEqual({ from: T0, until: at(60) });
    expect(extendUtility(p, 'water', at(40))).toEqual({ from: at(40), until: at(70) });
    expect(extendUtility(p, 'power', at(5))).toEqual({ from: at(5), until: at(35) });
    expect(utilityCostCents('water', 0, 3)).toBe(60_00);
    expect(utilityCostCents('power', 0, 3)).toBe(90_00);
    expect(utilityCostCents('power', 1, 3)).toBe(135_00);
    expect(utilityCostCents('power', 2, 3)).toBe(180_00);
    expect(utilityCostCents('water', 5, 1)).toBe(60_00);
  });

  it('cada obra fecha a renda até ali com o estado antigo', () => {
    const p = house();
    const reg = applyWorkAt(p, work(p, 'regularize'), at(1));
    expect(reg.claim?.amountCents).toBe(497);
    expect(reg.property).toMatchObject({ regularizedAt: at(1), lastClaimAt: at(1) });
    const water = applyWorkAt(reg.property, work(p, 'water'), at(1));
    const power = applyWorkAt(water.property, work(p, 'power'), at(1));
    expect(power.property).toMatchObject({ waterFrom: at(1), waterUntil: at(31), powerFrom: at(1), powerUntil: at(31) });
    // Daqui em diante, 100%: 1 dia de 99 a 98 de desgaste = 10 × 0,985.
    expect(accrued(power.property, at(2)).cents).toBe(985);
  });
});

// ---------------------------------------------------------------- ponta a ponta com o economy

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const LEDGER_TOKEN = 'chave-interna-do-economy-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const WORLD_TOKEN = 'chave-interna-do-world-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)

describe('regularização, água e energia de ponta a ponta (world + economy)', () => {
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
      loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: WORLD_TOKEN }),
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

  const auth = async (accountId: string) => ({
    authorization: `Bearer ${await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(accountId)
      .setIssuer('scc-gateway')
      .setAudience('scc-api')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET))}`,
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

  const homes = (accountId: string) =>
    world.inject({ method: 'GET', url: `/internal/v1/accounts/${accountId}/homes`, headers: { 'x-service-token': WORLD_TOKEN } });

  it('regulariza, liga água e energia, e a casa passa a render 100% e a contar como moradia', async () => {
    await credit({ owner_type: 'pool', owner_id: 'p2e' }, 'THALER', 1_000_000n);
    const me = randomUUID();
    const headers = await auth(me);
    await credit({ owner_type: 'player', owner_id: me }, 'SCITY', 1000n * 10n ** 18n);
    await credit({ owner_type: 'player', owner_id: me }, 'THALER', 5000_00n);
    expect((await world.inject({ method: 'POST', url: '/v1/world/cities/teste/lots/4/buy', headers })).statusCode).toBe(201);
    const id = (
      await world.inject({ method: 'POST', url: '/v1/world/cities/teste/lots/4/property', headers, payload: { type: 't1' } })
    ).json().property.id as string;

    // Em obra: a casa ainda não é moradia nem aceita a Prefeitura.
    expect((await homes(me)).json().homes).toEqual([]);
    const early = await world.inject({ method: 'POST', url: `/v1/world/properties/${id}/regularize`, headers });
    expect(early.json().error.code).toBe('property_not_ready');

    clock = at(1); // obra pronta
    const ready = (await world.inject({ method: 'GET', url: '/v1/world/me/properties', headers })).json().properties[0];
    expect(ready).toMatchObject({
      use: 'residencial',
      regular: false,
      income_factor: 0.5,
      regularization_cost_cents: 80_00,
      utility_cost_cents: { water: 60_00, power: 90_00 },
    });
    expect((await homes(me)).json().homes[0]).toMatchObject({ id, regular: false, regular_until: null, regularized: false });

    const reg = await world.inject({ method: 'POST', url: `/v1/world/properties/${id}/regularize`, headers });
    expect(reg.statusCode).toBe(200);
    expect(reg.json().work).toMatchObject({ kind: 'regularize', cost_cents: 80_00 });
    const twice = await world.inject({ method: 'POST', url: `/v1/world/properties/${id}/regularize`, headers });
    expect(twice.json().error.code).toBe('already_regularized');
    await world.inject({ method: 'POST', url: `/v1/world/properties/${id}/water`, headers });
    const power = await world.inject({ method: 'POST', url: `/v1/world/properties/${id}/power`, headers });
    expect(power.json().property).toMatchObject({ regular: true, income_factor: 1, regularization_cost_cents: 0 });
    // 1000 − 80 − 60 − 90 THALER.
    expect(await thalerOf(headers)).toBe(String(1000_00 - 80_00 - 60_00 - 90_00));

    const home = (await homes(me)).json().homes[0];
    expect(home).toMatchObject({ id, regular: true, regularized: true, regular_until: at(31).toISOString() });

    clock = at(2);
    const claimed = await world.inject({ method: 'POST', url: `/v1/world/properties/${id}/claim`, headers });
    expect(claimed.json().claim).toMatchObject({ amount_cents: 995 });

    // Até 60 dias pagos adiantado: a segunda água passa, a terceira não.
    expect((await world.inject({ method: 'POST', url: `/v1/world/properties/${id}/water`, headers })).statusCode).toBe(200);
    const third = await world.inject({ method: 'POST', url: `/v1/world/properties/${id}/water`, headers });
    expect(third.json().error.code).toBe('utility_prepaid');

    // Sem água (a energia vence no dia 31): a moradia deixa de ser regular e a renda volta a 50%.
    clock = at(40);
    const late = (await homes(me)).json().homes[0];
    expect(late).toMatchObject({ regular: false, regular_until: null });
  });

  it('a rota interna pede a chave do serviço', async () => {
    const r = await world.inject({ method: 'GET', url: `/internal/v1/accounts/${randomUUID()}/homes` });
    expect(r.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------- Postgres

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 5 }) : null;
afterAll(async () => {
  await pool?.end();
});

it.skipIf(!pool)('o Postgres guarda a regularização e os serviços pela obra', async () => {
  const code = uniqueCode();
  await new PostgresWorldStore(pool!).importCity(testCity(code), testLots());
  const store = new PostgresPropertyStore(pool!);
  const p = house({ city: code });
  await store.createProperty(p);
  await store.activateProperty(p.id);
  for (const kind of ['regularize', 'water', 'power'] as const) {
    const w = { ...work(p, kind), id: randomUUID() };
    await store.createWork(w);
    await store.applyWork(w.id, (cur) => applyWorkAt(cur, w, at(1)));
  }
  const saved = await store.getProperty(p.id);
  expect(saved).toMatchObject({ regularizedAt: at(1), waterFrom: at(1), waterUntil: at(31), powerFrom: at(1), powerUntil: at(31) });
  expect(isRegular(saved!, at(2))).toBe(true);
});
