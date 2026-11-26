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
  accrued,
  settleProperties,
  wearAt,
} from '../src/domain/properties.js';
import { PostgresPropertyStore } from '../src/infra/db/postgres-property-store.js';
import { PostgresWorldStore } from '../src/infra/db/postgres-store.js';
import { LedgerLandPayments } from '../src/infra/ledger-payments.js';
import { LedgerPropertyPayments } from '../src/infra/ledger-property-payments.js';
import { MemoryPropertyStore } from '../src/infra/memory-property-store.js';
import { MemoryWorldStore } from '../src/infra/memory-store.js';
import { testCity, testLots, uniqueCode } from './fixtures.js';

const T0 = new Date('2026-11-20T12:00:00Z');
const at = (days: number) => new Date(T0.getTime() + days * DAY_MS);

/** Casa T1 pronta em T0, desgaste 100, nunca coletada. */
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
  // Regularizada, com água e energia: renda de 100% (doc 03 §3).
  regularizedAt: at(-1),
  waterFrom: at(-1),
  waterUntil: at(1000),
  powerFrom: at(-1),
  powerUntil: at(1000),
  ...over,
});

describe('renda e desgaste (doc 03 §6.3)', () => {
  it('desgaste cai 1 por dia depois da obra e não cai durante ela', () => {
    const p = house();
    expect(wearAt(p, at(-0.5))).toBe(100);
    expect(wearAt(p, at(10))).toBeCloseTo(90);
    expect(wearAt(p, at(200))).toBe(0);
  });

  it('um dia rende 10 THALER × desgaste médio (99,5%)', () => {
    expect(accrued(house(), at(1)).cents).toBe(995);
  });

  it('acumula no máximo 7 dias', () => {
    const r = accrued(house(), at(30));
    expect(r.capped).toBe(true);
    // ∫ de 0 a 7 de 10 × (100 − x)/100 = 10 × (700 − 24,5)/100 = 67,55 THALER
    expect(r.cents).toBe(6755);
  });

  it('abaixo de 30 de desgaste para de render', () => {
    const p = house({ lastClaimAt: at(69) });
    // Só o trecho de 69 a 70 dias rende: 10 × (31 + 30)/2/100
    expect(accrued(p, at(72)).cents).toBe(305);
    expect(accrued(house({ lastClaimAt: at(71) }), at(73)).cents).toBe(0);
  });

  it('em obra ou sem pagar não rende', () => {
    expect(accrued(house({ readyAt: at(1), wearSince: at(1), lastClaimAt: at(1) }), at(0.5)).cents).toBe(0);
    expect(accrued(house({ status: 'pending' }), at(2)).cents).toBe(0);
  });
});

// ---------------------------------------------------------------- store (memória e Postgres)

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 10 }) : null;
afterAll(async () => {
  await pool?.end();
});

const stores: [string, () => PropertyStore, boolean][] = [
  ['memória', () => new MemoryPropertyStore(), true],
  ['postgres', () => new PostgresPropertyStore(pool!), pool !== null],
];

describe.each(stores)('PropertyStore (%s)', (_name, make, enabled) => {
  it.skipIf(!enabled)('um imóvel por lote', async () => {
    const store = make();
    const city = uniqueCode();
    await store.createProperty(house({ city, status: 'pending' }));
    await expect(store.createProperty(house({ city }))).rejects.toMatchObject({ code: 'lot_has_property' });
  });

  it.skipIf(!enabled)('obra pendente: ativa ou some', async () => {
    const store = make();
    const a = house({ city: uniqueCode(), status: 'pending' });
    const b = house({ city: uniqueCode(), status: 'pending' });
    await store.createProperty(a);
    await store.createProperty(b);
    const pending = (await store.pendingProperties(at(1))).map((p) => p.id);
    expect(pending).toEqual(expect.arrayContaining([a.id, b.id]));
    await store.activateProperty(a.id);
    await store.dropPendingProperty(b.id);
    await store.dropPendingProperty(a.id); // ativo: não apaga
    expect((await store.getProperty(a.id))?.status).toBe('active');
    expect(await store.getProperty(b.id)).toBeNull();
  });

  it.skipIf(!enabled)('duas coletas ao mesmo tempo: só uma fecha o período', async () => {
    const store = make();
    const p = house({ city: uniqueCode() });
    await store.createProperty(p);
    const claim = (n: number) => ({
      id: randomUUID(),
      propertyId: p.id,
      accountId: p.ownerAccountId,
      amountCents: n,
      status: 'pending' as const,
      createdAt: at(1),
    });
    const [x, y] = await Promise.all([store.startClaim(claim(1), p.lastClaimAt, at(1)), store.startClaim(claim(2), p.lastClaimAt, at(1))]);
    expect([x, y].filter(Boolean)).toHaveLength(1);
    expect((await store.getProperty(p.id))?.lastClaimAt.getTime()).toBe(at(1).getTime());
    const won = (x ?? y)!;
    expect((await store.pendingClaims(at(2))).map((c) => c.id)).toContain(won.id);
    await store.markClaimPaid(won.id);
    expect((await store.pendingClaims(at(2))).map((c) => c.id)).not.toContain(won.id);
  });
});

// ---------------------------------------------------------------- ponta a ponta com o economy

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const LEDGER_TOKEN = 'chave-interna-do-economy-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)

describe('imóveis de ponta a ponta (world + economy)', () => {
  let economy: Awaited<ReturnType<typeof buildEconomy>>;
  let world: Awaited<ReturnType<typeof buildApp>>;
  let propertyStore: MemoryPropertyStore;
  let propertyPayments: LedgerPropertyPayments;
  let clock: Date;

  beforeEach(async () => {
    economy = await buildEconomy(
      economyConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: LEDGER_TOKEN }),
      new MemoryLedgerStore(),
    );
    const ledgerUrl = await economy.listen({ port: 0, host: '127.0.0.1' });
    const store = new MemoryWorldStore();
    await store.importCity(testCity('teste'), testLots());
    propertyStore = new MemoryPropertyStore();
    propertyPayments = new LedgerPropertyPayments(ledgerUrl, LEDGER_TOKEN);
    clock = T0;
    world = await buildApp(
      loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET }),
      store,
      () => clock,
      new LedgerLandPayments(ledgerUrl, LEDGER_TOKEN),
      null,
      { store: propertyStore, payments: propertyPayments },
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

  /** Crédito de teste: a ponte para o jogador ou para o pool P2E. */
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

  /** Jogador com o lote 4 comprado e THALER na conta. */
  const owner = async (thalerCents: bigint) => {
    const me = randomUUID();
    const headers = await auth(me);
    await credit({ owner_type: 'player', owner_id: me }, 'SCITY', 1000n * 10n ** 18n);
    await credit({ owner_type: 'player', owner_id: me }, 'THALER', thalerCents);
    const bought = await world.inject({ method: 'POST', url: '/v1/world/cities/teste/lots/4/buy', headers });
    expect(bought.statusCode).toBe(201);
    return { me, headers };
  };

  it('constrói a Casa T1, espera a obra e coleta a renda do pool P2E', async () => {
    await credit({ owner_type: 'pool', owner_id: 'p2e' }, 'THALER', 1_000_000n);
    const { headers } = await owner(5000_00n);

    const types = (await world.inject({ method: 'GET', url: '/v1/world/property-types' })).json();
    expect(types.types[0]).toMatchObject({ code: 't1', price_cents: 400000, build_minutes: 1440 });

    const built = await world.inject({
      method: 'POST',
      url: '/v1/world/cities/teste/lots/4/property',
      headers,
      payload: { type: 't1' },
    });
    expect(built.statusCode).toBe(201);
    const property = built.json().property;
    expect(property).toMatchObject({ type: 't1', phase: 'building', accrued_cents: 0 });
    expect(await thalerOf(headers)).toBe('100000');

    const early = await world.inject({ method: 'POST', url: `/v1/world/properties/${property.id}/claim`, headers });
    expect(early.json().error.code).toBe('property_not_ready');

    clock = new Date(T0.getTime() + 2 * DAY_MS); // 1 dia de obra + 1 dia de renda, sem regularização (50%)
    const mine = (await world.inject({ method: 'GET', url: '/v1/world/me/properties', headers })).json().properties;
    expect(mine[0]).toMatchObject({ phase: 'ready', producing: true, accrued_cents: 497, wear: 99, regular: false, income_factor: 0.5 });

    const claimed = await world.inject({ method: 'POST', url: `/v1/world/properties/${property.id}/claim`, headers });
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json().claim).toMatchObject({ amount_cents: 497, status: 'paid' });
    expect(await thalerOf(headers)).toBe('100497');

    const again = await world.inject({ method: 'POST', url: `/v1/world/properties/${property.id}/claim`, headers });
    expect(again.json().error.code).toBe('nothing_to_claim');
  });

  it('sem THALER a obra não existe e nada é cobrado', async () => {
    const { headers } = await owner(100_00n);
    const r = await world.inject({ method: 'POST', url: '/v1/world/cities/teste/lots/4/property', headers, payload: { type: 't1' } });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('insufficient_thaler');
    expect(await thalerOf(headers)).toBe('10000');
    expect((await world.inject({ method: 'GET', url: '/v1/world/me/properties', headers })).json().properties).toEqual([]);
  });

  it('só o dono do lote constrói, um imóvel por lote, tipo conhecido', async () => {
    const { headers } = await owner(10_000_00n);
    const stranger = await auth(randomUUID());
    const notMine = await world.inject({ method: 'POST', url: '/v1/world/cities/teste/lots/4/property', headers: stranger, payload: { type: 't1' } });
    expect(notMine.json().error.code).toBe('not_lot_owner');
    const unknown = await world.inject({ method: 'POST', url: '/v1/world/cities/teste/lots/4/property', headers, payload: { type: 'castelo' } });
    expect(unknown.json().error.code).toBe('unknown_property_type');
    await world.inject({ method: 'POST', url: '/v1/world/cities/teste/lots/4/property', headers, payload: { type: 't1' } });
    const twice = await world.inject({ method: 'POST', url: '/v1/world/cities/teste/lots/4/property', headers, payload: { type: 't1' } });
    expect(twice.statusCode).toBe(409);
    expect(twice.json().error.code).toBe('lot_has_property');
  });

  it('pool P2E vazio: a renda fica guardada e o job paga depois', async () => {
    const { headers } = await owner(5000_00n);
    const property = (
      await world.inject({ method: 'POST', url: '/v1/world/cities/teste/lots/4/property', headers, payload: { type: 't1' } })
    ).json().property;
    clock = new Date(T0.getTime() + 2 * DAY_MS);

    const r = await world.inject({ method: 'POST', url: `/v1/world/properties/${property.id}/claim`, headers });
    expect(r.statusCode).toBe(503);
    expect(r.json().error.code).toBe('pool_empty');
    expect(await thalerOf(headers)).toBe('100000');

    await credit({ owner_type: 'pool', owner_id: 'p2e' }, 'THALER', 1_000_000n);
    expect(await settleProperties(propertyStore, propertyPayments, new Date(clock.getTime() + 60_000))).toBe(1);
    expect(await thalerOf(headers)).toBe('100497');
  });
});

// Garante que o store de lotes em Postgres continua importável com os imóveis no mesmo esquema.
it.skipIf(!pool)('lotes e imóveis convivem no esquema world', async () => {
  const code = uniqueCode();
  await new PostgresWorldStore(pool!).importCity(testCity(code), testLots());
  const store = new PostgresPropertyStore(pool!);
  expect(await store.propertyOnLot(code, 1)).toBeNull();
});
