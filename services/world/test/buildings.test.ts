import { randomUUID } from 'node:crypto';

import { buildApp as buildEconomy } from '@scc/economy/src/app.js';
import { loadConfig as economyConfig } from '@scc/economy/src/config.js';
import { MemoryLedgerStore } from '@scc/economy/src/infra/memory-store.js';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type {
  BuilderClient,
  BuilderValidateInput,
  BuilderValidation,
  Building,
  BuildingStore,
} from '../src/domain/buildings.js';
import type { Lot } from '../src/domain/lots.js';
import { DAY_MS } from '../src/domain/properties.js';
import { billsDue } from '../src/domain/taxes.js';
import { HttpBuilderClient } from '../src/infra/builder-client.js';
import { PostgresBuildingStore } from '../src/infra/db/postgres-building-store.js';
import { LedgerLandPayments } from '../src/infra/ledger-payments.js';
import { LedgerOutorgaPayments } from '../src/infra/ledger-outorga-payments.js';
import { LedgerPropertyPayments } from '../src/infra/ledger-property-payments.js';
import { MemoryBuildingStore } from '../src/infra/memory-building-store.js';
import { MemoryPropertyStore } from '../src/infra/memory-property-store.js';
import { MemoryWorldStore } from '../src/infra/memory-store.js';
import { testCity, testLots, uniqueCode } from './fixtures.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const LEDGER_TOKEN = 'chave-interna-do-economy-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const INTERNAL = 'token-interno-do-world-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const T0 = new Date('2026-11-20T12:00:00Z');

const validation = (over: Partial<BuilderValidation> = {}, far: Record<string, unknown> = { ok: true, gfa_m2: 120, max_m2: 350 }) =>
  ({
    valid: true,
    checks: [
      { code: 'scale', ok: true, value: 9.6 },
      { code: 'fits_setback', ok: true, outside: 0, points: 8 },
      { code: 'height', ok: true, value: 9.6, max: 60 },
      { code: 'far', ...far },
      { code: 'triangles', ok: true, value: 20_000, max: 300_000 },
    ],
    footprint: { hull: [[83, 3], [87, 3], [87, 7], [83, 7]], area_m2: 16 },
    suggested_floors: 3,
    placement: { position: [85, 5], rotation_deg: 0, scale: 1 },
    job_id: 'job_abc',
    model_id: 'mdl_1',
    version: 1,
    artifacts: { glb: 'builder/x/mdl_1/v1/modelo.glb', lod1: null, lod2: null, meta: 'builder/x/mdl_1/v1/modelo.meta.json', thumb: null },
    ...over,
  }) as BuilderValidation;

/** SCC Builder de mentira: guarda o que o world mandou e responde o que o teste pedir. */
class FakeBuilder implements BuilderClient {
  calls: { input: BuilderValidateInput; authorization: string }[] = [];
  next: BuilderValidation = validation();
  async validate(input: BuilderValidateInput, authorization: string) {
    this.calls.push({ input, authorization });
    return this.next;
  }
}

describe('HttpBuilderClient', () => {
  it('manda job, lote e transformação com o token do jogador', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return Response.json({ data: validation() });
    }) as unknown as typeof fetch;
    const client = new HttpBuilderClient('http://builder/', fake);
    const input: BuilderValidateInput = {
      jobId: 'job_abc',
      lot: { id: 'teste:4', polygon: [[0, 0], [10, 0], [10, 10]], setback_m: 3, max_height_m: 60, far: 3.5 },
      transform: { rotation_deg: 90, units: 'm' },
    };
    expect((await client.validate(input, 'Bearer abc')).valid).toBe(true);
    expect(seen!.url).toBe('http://builder/api/validate-lot.php');
    expect((seen!.init.headers as Record<string, string>).authorization).toBe('Bearer abc');
    expect(JSON.parse(seen!.init.body as string)).toEqual({ job_id: 'job_abc', lot: input.lot, transform: input.transform });
  });

  it('traduz os erros do Builder', async () => {
    const answer = (status: number, code: string) =>
      (async () => Response.json({ error: { code, message: 'x' } }, { status })) as unknown as typeof fetch;
    const input = { jobId: 'j', lot: { id: 'l', polygon: [], setback_m: 0, max_height_m: 1, far: 1 }, transform: { rotation_deg: 0, units: 'm' } };
    await expect(new HttpBuilderClient('http://b', answer(404, 'not_found')).validate(input, 'B')).rejects.toMatchObject({ code: 'model_not_found' });
    await expect(new HttpBuilderClient('http://b', answer(409, 'job_not_completed')).validate(input, 'B')).rejects.toMatchObject({
      code: 'job_not_completed',
      status: 409,
    });
    await expect(new HttpBuilderClient('http://b', answer(500, 'x')).validate(input, 'B')).rejects.toMatchObject({ code: 'builder_unavailable' });
  });
});

describe('PT do lote com prédio', () => {
  it('o prédio também para o imposto do lote vazio', () => {
    const lot: Lot = {
      city: 'teste', id: 4, district: 0, zone: 'mixed', areaM2: 100, status: 'sold', ownerAccountId: randomUUID(),
      reservedBy: null, reservedUntil: null, reservationId: null, soldAt: T0, polygon: null,
    };
    const at = (d: number) => new Date(T0.getTime() + d * DAY_MS);
    expect(billsDue(lot, null, at(95)).length).toBe(3);
    expect(billsDue(lot, null, at(95), at(40)).map((b) => b.period)).toEqual([1]);
  });
});

// ---------------------------------------------------------------- store (memória e Postgres)

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 5 }) : null;
afterAll(async () => {
  await pool?.end();
});

const building = (over: Partial<Building> = {}): Building => ({
  id: randomUUID(),
  city: uniqueCode(),
  lotId: 4,
  ownerAccountId: randomUUID(),
  jobId: 'job_abc',
  modelId: 'mdl_1',
  modelVersion: 1,
  rotationDeg: 0,
  position: [85, 5],
  heightM: 9.6,
  footprintM2: 16,
  floors: 3,
  gfaM2: 41,
  outorgaWei: 0n,
  checks: [],
  artifacts: {},
  modelSha256: null,
  status: 'pending_review',
  reviewNote: null,
  createdAt: T0,
  reviewedAt: null,
  ...over,
});

describe.each([
  ['memória', () => new MemoryBuildingStore() as BuildingStore, true],
  ['postgres', () => new PostgresBuildingStore(pool!) as BuildingStore, pool !== null],
] as const)('BuildingStore (%s)', (_name, make, enabled) => {
  it.skipIf(!enabled)('um prédio vigente por lote; recusado libera o lote', async () => {
    const store = make();
    const b = building();
    await store.createBuilding(b);
    await expect(store.createBuilding(building({ city: b.city }))).rejects.toMatchObject({ code: 'lot_has_building' });
    expect(await store.moveBuilding(b.id, 'pending_payment', 'pending_review', null, T0)).toBe(false);
    expect(await store.moveBuilding(b.id, 'pending_review', 'rejected', 'marca de terceiros', T0)).toBe(true);
    expect(await store.buildingOnLot(b.city, 4)).toBeNull();
    const again = building({ city: b.city });
    await store.createBuilding(again);
    expect((await store.buildingOnLot(b.city, 4))?.id).toBe(again.id);
    expect((await store.getBuilding(b.id))?.reviewNote).toBe('marca de terceiros');
  });

  it.skipIf(!enabled)('outorga pendente: aparece no job e pode ser descartada', async () => {
    const store = make();
    const b = building({ status: 'pending_payment', outorgaWei: 10n ** 20n });
    await store.createBuilding(b);
    expect((await store.pendingPaymentBuildings(new Date(T0.getTime() + 60_000))).map((x) => x.id)).toContain(b.id);
    expect((await store.getBuilding(b.id))?.outorgaWei).toBe(10n ** 20n);
    await store.dropPendingBuilding(b.id);
    expect(await store.getBuilding(b.id)).toBeNull();
  });
});

// ---------------------------------------------------------------- ponta a ponta com o economy

describe('prédios de ponta a ponta (world + economy + Builder de mentira)', () => {
  let economy: Awaited<ReturnType<typeof buildEconomy>>;
  let world: Awaited<ReturnType<typeof buildApp>>;
  let builder: FakeBuilder;

  beforeEach(async () => {
    economy = await buildEconomy(
      economyConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: LEDGER_TOKEN }),
      new MemoryLedgerStore(),
    );
    const ledgerUrl = await economy.listen({ port: 0, host: '127.0.0.1' });
    const store = new MemoryWorldStore();
    await store.importCity(testCity('teste'), testLots());
    builder = new FakeBuilder();
    world = await buildApp(
      loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: INTERNAL }),
      store,
      () => T0,
      new LedgerLandPayments(ledgerUrl, LEDGER_TOKEN),
      null,
      { store: new MemoryPropertyStore(), payments: new LedgerPropertyPayments(ledgerUrl, LEDGER_TOKEN) },
      null,
      { store: new MemoryBuildingStore(), builder, payments: new LedgerOutorgaPayments(ledgerUrl, LEDGER_TOKEN) },
    );
  });
  afterEach(async () => {
    await economy.close();
  });

  const credit = (accountId: string, currency: 'SCITY' | 'THALER', amount: bigint) =>
    economy.inject({
      method: 'POST',
      url: '/internal/v1/ledger/transactions',
      headers: { 'x-service-token': LEDGER_TOKEN, 'idempotency-key': `credito-${randomUUID()}` },
      payload: {
        kind: 'test_credit',
        legs: [
          { owner_type: 'system', owner_id: 'bridge', currency, amount: `-${amount}` },
          { owner_type: 'player', owner_id: accountId, currency, amount: `${amount}` },
        ],
      },
    });

  const scityOf = async (headers: Record<string, string>) =>
    (await economy.inject({ method: 'GET', url: '/v1/economy/balances', headers })).json().balances.find(
      (b: { currency: string }) => b.currency === 'SCITY',
    )?.amount ?? '0';

  /** Dono do lote 4 (quadrado de 10 m com canto em x = 80), com `scity` SCITY depois da compra. */
  const ownerOfLot4 = async (scityAfter: bigint) => {
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
    await credit(me, 'SCITY', (156n + scityAfter) * 10n ** 18n);
    await credit(me, 'THALER', 10_000_00n);
    expect((await world.inject({ method: 'POST', url: '/v1/world/cities/teste/lots/4/buy', headers })).statusCode).toBe(201);
    return { me, headers };
  };

  const submit = (headers: Record<string, string>, payload: Record<string, unknown> = { job_id: 'job_abc' }) =>
    world.inject({ method: 'POST', url: '/v1/world/cities/teste/lots/4/building', headers, payload });

  const review = (id: string, approve: boolean, note?: string) =>
    world.inject({
      method: 'POST',
      url: `/internal/v1/buildings/${id}/review`,
      headers: { 'x-service-token': INTERNAL },
      payload: { approve, ...(note ? { note } : {}) },
    });

  it('o world manda o polígono e as regras do próprio banco; o prédio vai para o alvará', async () => {
    const { headers } = await ownerOfLot4(0n);
    const r = await submit(headers, { job_id: 'job_abc', rotation_deg: 90, units: 'cm', position: [85, 5] });
    expect(r.statusCode).toBe(201);
    expect(r.json().building).toMatchObject({ status: 'pending_review', floors: 3, outorga_scity: '0', model: { model_id: 'mdl_1' } });

    const call = builder.calls[0]!;
    expect(call.authorization).toBe(headers.authorization);
    expect(call.input).toEqual({
      jobId: 'job_abc',
      lot: { id: 'teste:4', polygon: [[80, 0], [90, 0], [90, 10], [80, 10]], setback_m: 3, max_height_m: 60, far: 3.5 },
      transform: { rotation_deg: 90, units: 'cm', position: [85, 5] },
    });

    // Antes do alvará, o prédio não aparece para os outros.
    expect((await world.inject({ method: 'GET', url: '/v1/world/cities/teste/lots/4/building' })).statusCode).toBe(404);
    const id = r.json().building.id as string;
    expect((await review(id, true)).json().building.status).toBe('approved');
    const shown = (await world.inject({ method: 'GET', url: '/v1/world/cities/teste/lots/4/building' })).json().building;
    expect(shown).toMatchObject({ id, status: 'approved', artifacts: { glb: 'builder/x/mdl_1/v1/modelo.glb' } });
    expect((await review(id, false)).json().error.code).toBe('building_not_in_review');
  });

  it('reprovado na validação: 422 com as checagens e nada gravado', async () => {
    const { headers } = await ownerOfLot4(0n);
    builder.next = validation({
      valid: false,
      checks: [{ code: 'fits_setback', ok: false, outside: 4, points: 8 }],
    });
    const r = await submit(headers);
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ error: { code: 'building_invalid' }, checks: [{ code: 'fits_setback', ok: false }] });
    expect((await world.inject({ method: 'GET', url: '/v1/world/me/buildings', headers })).json().buildings).toEqual([]);
  });

  it('passou do coeficiente: cobra a outorga em SCITY; sem saldo, o prédio não entra', async () => {
    builder.next = validation({}, { ok: false, severity: 'fee', gfa_m2: 500, max_m2: 350, outorga_scity: 375 });
    const poor = await ownerOfLot4(100n);
    const refused = await submit(poor.headers);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('insufficient_scity');
    expect((await world.inject({ method: 'GET', url: '/v1/world/me/buildings', headers: poor.headers })).json().buildings).toEqual([]);

    await credit(poor.me, 'SCITY', 300n * 10n ** 18n);
    const ok = await submit(poor.headers);
    expect(ok.statusCode).toBe(201);
    expect(ok.json().building).toMatchObject({ status: 'pending_review', outorga_scity: '375', gfa_m2: 500 });
    expect(await scityOf(poor.headers)).toBe(`${25n * 10n ** 18n}`);
  });

  it('lote com prédio não aceita imóvel do catálogo, e vice-versa; recusado libera', async () => {
    const { headers } = await ownerOfLot4(0n);
    const id = (await submit(headers)).json().building.id as string;
    const t1 = await world.inject({ method: 'POST', url: '/v1/world/cities/teste/lots/4/property', headers, payload: { type: 't1' } });
    expect(t1.json().error.code).toBe('lot_has_building');
    expect((await submit(headers)).json().error.code).toBe('lot_has_building');

    await review(id, false, 'marca de terceiros');
    const house = await world.inject({ method: 'POST', url: '/v1/world/cities/teste/lots/4/property', headers, payload: { type: 't1' } });
    expect(house.statusCode).toBe(201);
    expect((await submit(headers)).json().error.code).toBe('lot_has_property');
  });

  it('só o dono do lote envia; alvará exige o token interno', async () => {
    const { headers } = await ownerOfLot4(0n);
    const stranger = {
      authorization: `Bearer ${await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(randomUUID())
        .setIssuer('scc-gateway')
        .setAudience('scc-api')
        .setExpirationTime('1h')
        .sign(new TextEncoder().encode(SECRET))}`,
    };
    expect((await submit(stranger)).json().error.code).toBe('not_lot_owner');
    const id = (await submit(headers)).json().building.id as string;
    const r = await world.inject({ method: 'POST', url: `/internal/v1/buildings/${id}/review`, payload: { approve: true } });
    expect(r.statusCode).toBe(403);
  });
});
