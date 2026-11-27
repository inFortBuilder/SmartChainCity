import { randomUUID } from 'node:crypto';

import { buildApp as buildEconomy } from '@scc/economy/src/app.js';
import { loadConfig as economyConfig } from '@scc/economy/src/config.js';
import { MemoryLedgerStore } from '@scc/economy/src/infra/memory-store.js';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Building } from '../src/domain/buildings.js';
import { type UnitStore, generateUnits, leaseSplit, saleSplit, unitCode } from '../src/domain/units.js';
import { PostgresBuildingStore } from '../src/infra/db/postgres-building-store.js';
import { PostgresUnitStore } from '../src/infra/db/postgres-unit-store.js';
import { PostgresWorldStore } from '../src/infra/db/postgres-store.js';
import { LedgerLandPayments } from '../src/infra/ledger-payments.js';
import { LedgerUnitPayments } from '../src/infra/ledger-unit-payments.js';
import { MemoryBuildingStore } from '../src/infra/memory-building-store.js';
import { MemoryUnitStore } from '../src/infra/memory-unit-store.js';
import { MemoryWorldStore } from '../src/infra/memory-store.js';
import { testCity, testLots, uniqueCode } from './fixtures.js';

/** Unidades dos prédios (E3.11): geração, venda primária, revenda com royalty e aluguel para morar. */
const T0 = new Date('2026-11-20T12:00:00Z');
const DAY = 24 * 3_600_000;
const at = (days: number) => new Date(T0.getTime() + days * DAY);

const approved = (owner: string, over: Partial<Building> = {}): Building => ({
  id: randomUUID(),
  city: 'teste',
  lotId: 4,
  ownerAccountId: owner,
  jobId: 'job_abc',
  modelId: 'mdl_1',
  modelVersion: 1,
  rotationDeg: 0,
  position: [85, 5],
  heightM: 12,
  footprintM2: 400,
  floors: 3,
  gfaM2: 1200,
  outorgaWei: 0n,
  checks: [],
  artifacts: {},
  modelSha256: null,
  status: 'approved',
  reviewNote: null,
  createdAt: T0,
  reviewedAt: T0,
  ...over,
});

describe('regras das unidades', () => {
  it('divisão da venda e do aluguel', () => {
    const b = randomUUID();
    expect(saleSplit({ priceCents: 10_000, primary: true, sellerAccountId: b, builderAccountId: b })).toEqual({ seller: 9500, royalty: 0, fee: 500 });
    expect(saleSplit({ priceCents: 10_000, primary: false, sellerAccountId: randomUUID(), builderAccountId: b })).toEqual({
      seller: 9800,
      royalty: 200,
      fee: 0,
    });
    expect(saleSplit({ priceCents: 10_000, primary: false, sellerAccountId: b, builderAccountId: b })).toMatchObject({ royalty: 0 });
    expect(leaseSplit(4500)).toEqual({ owner: 4050, fee: 450 });
    expect(unitCode({ floor: 3, number: 2 })).toBe('0302');
  });

  it('gera andares × unidades com a mesma área, o térreo comercial e o preço por m²; só com alvará e uma vez', async () => {
    const builder = randomUUID();
    const buildings = new MemoryBuildingStore();
    const units = new MemoryUnitStore();
    const b = approved(builder);
    await buildings.createBuilding(b);
    const list = await generateUnits(buildings, units, { buildingId: b.id, accountId: builder, unitsPerFloor: 4, groundCommercial: true, priceCentsPerM2: 1000 }, T0);
    expect(list).toHaveLength(12);
    expect(list[0]).toMatchObject({ floor: 0, number: 1, areaM2: 100, kind: 'comercial', priceCents: 100_000, ownerAccountId: null });
    expect(list[4]).toMatchObject({ floor: 1, kind: 'residencial' });
    await expect(
      generateUnits(buildings, units, { buildingId: b.id, accountId: builder, unitsPerFloor: 4, groundCommercial: false, priceCentsPerM2: 1000 }, T0),
    ).rejects.toMatchObject({ code: 'units_exist' });
    const review = approved(builder, { status: 'pending_review', lotId: 5 });
    await buildings.createBuilding(review);
    await expect(
      generateUnits(buildings, units, { buildingId: review.id, accountId: builder, unitsPerFloor: 2, groundCommercial: false, priceCentsPerM2: 1 }, T0),
    ).rejects.toMatchObject({ code: 'building_not_approved' });
    await expect(
      generateUnits(buildings, units, { buildingId: b.id, accountId: randomUUID(), unitsPerFloor: 2, groundCommercial: false, priceCentsPerM2: 1 }, T0),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const LEDGER_TOKEN = 'chave-interna-do-economy-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const WORLD_TOKEN = 'chave-interna-do-world-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)

describe('unidades de ponta a ponta (world + economy)', () => {
  let economy: Awaited<ReturnType<typeof buildEconomy>>;
  let world: Awaited<ReturnType<typeof buildApp>>;
  let buildings: MemoryBuildingStore;
  let clock: Date;

  beforeEach(async () => {
    economy = await buildEconomy(economyConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: LEDGER_TOKEN }), new MemoryLedgerStore());
    const ledgerUrl = await economy.listen({ port: 0, host: '127.0.0.1' });
    const store = new MemoryWorldStore();
    await store.importCity(testCity('teste'), testLots());
    buildings = new MemoryBuildingStore();
    clock = T0;
    world = await buildApp(
      loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: WORLD_TOKEN }),
      store,
      () => clock,
      new LedgerLandPayments(ledgerUrl, LEDGER_TOKEN),
      null,
      null,
      null,
      { store: buildings, builder: null, payments: null, units: { store: new MemoryUnitStore(), payments: new LedgerUnitPayments(ledgerUrl, LEDGER_TOKEN) } },
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
  const credit = (accountId: string, amount: bigint) =>
    economy.inject({
      method: 'POST',
      url: '/internal/v1/ledger/transactions',
      headers: { 'x-service-token': LEDGER_TOKEN, 'idempotency-key': `credito-${randomUUID()}` },
      payload: {
        kind: 'test_credit',
        legs: [
          { owner_type: 'system', owner_id: 'bridge', currency: 'THALER', amount: `-${amount}` },
          { owner_type: 'player', owner_id: accountId, currency: 'THALER', amount: `${amount}` },
        ],
      },
    });
  const thalerOf = async (accountId: string) =>
    BigInt(
      (await economy.inject({ method: 'GET', url: '/v1/economy/balances', headers: await auth(accountId) })).json().balances.find(
        (b: { currency: string }) => b.currency === 'THALER',
      )?.amount ?? '0',
    );

  it('o construtor gera e vende; o comprador revende com royalty e aluga para outro avatar morar', async () => {
    const builder = randomUUID();
    const buyer = randomUUID();
    const third = randomUUID();
    const tenant = randomUUID();
    const tenantAvatar = randomUUID();
    const b = approved(builder);
    await buildings.createBuilding(b);

    const gen = await world.inject({
      method: 'POST',
      url: `/v1/world/buildings/${b.id}/units`,
      headers: await auth(builder),
      payload: { units_per_floor: 2, ground_commercial: false, price_cents_per_m2: 50 },
    });
    expect(gen.statusCode).toBe(201);
    const units = gen.json().units;
    expect(units).toHaveLength(6);
    expect(units[0]).toMatchObject({ code: '0001', area_m2: 200, price_cents: 10_000, mine: true, owned: false });
    const unitId = units[2].id as string;

    // Venda primária: 95% ao construtor, 5% de taxa.
    await credit(buyer, 20_000n);
    const poor = await world.inject({ method: 'POST', url: `/v1/world/units/${unitId}/buy`, headers: await auth(third) });
    expect(poor.json().error.code).toBe('insufficient_thaler');
    const sold = await world.inject({ method: 'POST', url: `/v1/world/units/${unitId}/buy`, headers: await auth(buyer) });
    expect(sold.statusCode).toBe(201);
    expect(sold.json()).toMatchObject({ sale: { primary: true, price_cents: 10_000 }, unit: { mine: true, owned: true, price_cents: null } });
    expect(await thalerOf(builder)).toBe(9_500n);
    expect(await thalerOf(buyer)).toBe(10_000n);

    // Aluguel: 45/dia; o inquilino paga 2 dias, 90% ao dono.
    const offer = await world.inject({ method: 'PUT', url: `/v1/world/units/${unitId}/offer`, headers: await auth(buyer), payload: { rent_cents_per_day: 4500 } });
    expect(offer.json().unit).toMatchObject({ rent_cents_per_day: 4500 });
    const listed = (await world.inject({ url: '/v1/world/cities/teste/units/for-rent' })).json().units;
    expect(listed.map((u: { id: string }) => u.id)).toEqual([unitId]);
    await credit(tenant, 10_000n);
    const lease = await world.inject({
      method: 'POST',
      url: `/v1/world/units/${unitId}/lease`,
      headers: await auth(tenant),
      payload: { avatar_id: tenantAvatar, days: 2 },
    });
    expect(lease.statusCode).toBe(201);
    expect(lease.json().lease).toMatchObject({ amount_cents: 9000, ends_at: at(2).toISOString() });
    expect(await thalerOf(buyer)).toBe(10_000n + 8_100n);
    const other = await world.inject({
      method: 'POST',
      url: `/v1/world/units/${unitId}/lease`,
      headers: await auth(third),
      payload: { avatar_id: randomUUID(), days: 1 },
    });
    expect(other.json().error.code).toBe('unit_rented');
    const own = await world.inject({ method: 'POST', url: `/v1/world/units/${unitId}/lease`, headers: await auth(buyer), payload: { avatar_id: randomUUID(), days: 1 } });
    expect(own.json().error.code).toBe('own_unit');

    // A moradia do inquilino: a unidade, só para o avatar dele.
    const homes = await world.inject({ url: `/internal/v1/accounts/${tenant}/homes`, headers: { 'x-service-token': WORLD_TOKEN } });
    expect(homes.json().homes).toEqual([
      expect.objectContaining({ id: unitId, regular: true, regular_until: at(2).toISOString(), avatar_id: tenantAvatar, lease: true }),
    ]);
    const mine = (await world.inject({ url: '/v1/world/me/units', headers: await auth(tenant) })).json();
    expect(mine.rented).toEqual([expect.objectContaining({ id: unitId, rented_by_me: true, avatar_id: tenantAvatar })]);

    // Revenda: 2% de royalty ao construtor.
    await world.inject({ method: 'PUT', url: `/v1/world/units/${unitId}/offer`, headers: await auth(buyer), payload: { price_cents: 15_000 } });
    await credit(third, 20_000n);
    const resale = await world.inject({ method: 'POST', url: `/v1/world/units/${unitId}/buy`, headers: await auth(third) });
    expect(resale.json().sale).toMatchObject({ primary: false, price_cents: 15_000 });
    expect(await thalerOf(builder)).toBe(9_500n + 300n);
    expect(await thalerOf(buyer)).toBe(18_100n + 14_700n);
    // O aluguel pago continua até o fim.
    expect((await world.inject({ url: `/internal/v1/accounts/${tenant}/homes`, headers: { 'x-service-token': WORLD_TOKEN } })).json().homes).toHaveLength(1);
    clock = at(2);
    expect((await world.inject({ url: `/internal/v1/accounts/${tenant}/homes`, headers: { 'x-service-token': WORLD_TOKEN } })).json().homes).toEqual([]);
  });
});

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 5 }) : null;
afterAll(async () => {
  await pool?.end();
});

describe.skipIf(!pool)('unidades no Postgres', () => {
  it('gera, vende em duas fases e aluga com a vaga travada', async () => {
    const code = uniqueCode();
    await new PostgresWorldStore(pool!).importCity(testCity(code), testLots());
    const buildings = new PostgresBuildingStore(pool!);
    const store: UnitStore = new PostgresUnitStore(pool!);
    const builder = randomUUID();
    const b = approved(builder, { city: code });
    await buildings.createBuilding(b);
    const [u] = await generateUnits(buildings, store, { buildingId: b.id, accountId: builder, unitsPerFloor: 1, groundCommercial: false, priceCentsPerM2: 10 }, T0);
    const buyer = randomUUID();
    const sale = {
      id: randomUUID(),
      unitId: u!.id,
      buyerAccountId: buyer,
      sellerAccountId: builder,
      builderAccountId: builder,
      primary: true,
      priceCents: u!.priceCents!,
      status: 'pending' as const,
      createdAt: T0,
    };
    expect(await store.beginSale(sale)).not.toBeNull();
    expect(await store.beginSale({ ...sale, id: randomUUID() })).toBeNull();
    await store.finishSale(sale.id);
    expect(await store.getUnit(u!.id)).toMatchObject({ ownerAccountId: buyer, priceCents: null, pendingSaleId: null });

    await store.setOffer(u!.id, { priceCents: null, rentCentsPerDay: 3000 });
    const avatar = randomUUID();
    const lease = { id: randomUUID(), unitId: u!.id, ownerAccountId: buyer, tenantAccountId: randomUUID(), avatarId: avatar, centsPerDay: 3000, days: 1, startsAt: T0, endsAt: at(1), status: 'pending' as const, createdAt: T0 };
    await store.beginLease(lease, T0);
    await expect(store.beginLease({ ...lease, id: randomUUID(), avatarId: randomUUID() }, T0)).rejects.toMatchObject({ code: 'unit_rented' });
    await store.finishLease(lease.id);
    // O mesmo avatar estende do fim do atual.
    const more = await store.beginLease({ ...lease, id: randomUUID() }, T0);
    expect(more).toMatchObject({ startsAt: at(1), endsAt: at(2) });
    expect(await store.activeLeasesOf(lease.tenantAccountId, at(0.5))).toHaveLength(1);
    expect((await store.unitsForRent(code, 10)).map((x) => x.id)).toEqual([u!.id]);
  });
});

it('CORS: a tela pode usar PUT (preços da unidade) e DELETE', async () => {
  const store = new MemoryWorldStore();
  const app = await buildApp(loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, CORS_ORIGINS: 'http://localhost:8081' }), store);
  for (const method of ['PUT', 'DELETE']) {
    const r = await app.inject({
      method: 'OPTIONS',
      url: `/v1/world/units/${randomUUID()}/offer`,
      headers: { origin: 'http://localhost:8081', 'access-control-request-method': method },
    });
    expect(r.headers['access-control-allow-methods']).toContain(method);
  }
});
