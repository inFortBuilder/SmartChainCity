import { randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { type Avatar, newAvatar } from '../src/domain/avatar.js';
import type { Meal, MealPayer } from '../src/domain/meal.js';
import {
  PRIZES_CENTS,
  type Race,
  type RacePayer,
  type RaceStore,
  checkRace,
  dayOf,
  newRace,
  runRace,
  settleRace,
} from '../src/domain/race.js';
import { type Vehicle, type VehiclePayer, newVehicle, stateOf } from '../src/domain/vehicle.js';
import { PostgresRaceStore } from '../src/infra/db/postgres-race-store.js';
import { PostgresVehicleStore } from '../src/infra/db/postgres-vehicle-store.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';
import { MemoryRaceStore } from '../src/infra/memory-race-store.js';
import { MemoryVehicleStore } from '../src/infra/memory-vehicle-store.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const INTERNAL = 'chave-interna-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: INTERNAL });
const t0 = new Date('2026-11-21T08:00:00Z');
const DAY = 86_400_000;

const car = (over: Partial<Vehicle> = {}): Vehicle => ({ ...newVehicle({ id: randomUUID(), accountId: randomUUID(), model: 'super', rent: false }, t0), status: 'active', ...over });
const pilot = (accountId: string, over: Partial<Avatar> = {}): Avatar => ({
  ...newAvatar({ id: randomUUID(), accountId, rarity: 'common', jobCode: 'padeiro' }, t0),
  license: { readyAt: new Date(t0.getTime() - 1) },
  ...over,
});
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return null;
};
/** Primeira semente (de uma lista fixa) que dá o resultado pedido. */
const seedWhere = (id: string, v: Vehicle, pred: (r: ReturnType<typeof runRace>) => boolean, revised = false) => {
  for (let i = 0; i < 5000; i++) {
    const seed = i.toString(16).padStart(64, '0');
    if (pred(runRace({ id, seed, vehicle: v, education: 0, revised }, t0))) return seed;
  }
  throw new Error('sem semente');
};

describe('corrida', () => {
  it('a mesma semente dá o mesmo resultado; a posição conta os rivais acima', () => {
    const v = car();
    const a = runRace({ id: 'x', seed: 'ab'.repeat(32), vehicle: v, education: 50 , revised: false }, t0);
    expect(runRace({ id: 'x', seed: 'ab'.repeat(32), vehicle: v, education: 50, revised: false }, t0)).toEqual(a);
    expect(a.rivals).toHaveLength(7);
    expect(a.position).toBe(1 + a.rivals.filter((r) => r > a.score).length);
    expect(a.prizeCents).toBe((PRIZES_CENTS[a.position - 1] ?? 0n).toString());
    // Carro melhor, mesma sorte: nota maior.
    const slow = runRace({ id: 'x', seed: 'ab'.repeat(32), vehicle: car({ model: 'hatch' }), education: 50, revised: false }, t0);
    expect(slow.score).toBeLessThan(a.score);
  });

  it('pane em parte das corridas; com revisão, em menos', () => {
    const v = car();
    let plain = 0;
    let revised = 0;
    for (let i = 0; i < 1000; i++) {
      const seed = i.toString(16).padStart(64, '0');
      if (runRace({ id: 'r', seed, vehicle: v, education: 0, revised: false }, t0).breakdown) plain++;
      if (runRace({ id: 'r', seed, vehicle: v, education: 0, revised: true }, t0).breakdown) revised++;
    }
    expect(plain / 1000).toBeGreaterThan(0.025);
    expect(plain / 1000).toBeLessThan(0.08);
    expect(revised).toBeLessThan(plain);
  });

  it('confere carro, piloto habilitado, energia e o limite do dia', () => {
    const v = car();
    const p = pilot(v.accountId);
    expect(code(() => checkRace(v, p, 0, t0))).toBeNull();
    expect(code(() => checkRace(v, p, 3, t0))).toBe('race_limit');
    expect(code(() => checkRace(v, { ...p, license: null }, 0, t0))).toBe('not_licensed');
    expect(code(() => checkRace(v, { ...p, attributes: { ...p.attributes, energy: 1 } }, 0, t0))).toBe('too_tired');
    expect(code(() => checkRace(v, pilot(randomUUID()), 0, t0))).toBe('not_found');
    expect(code(() => checkRace({ ...v, breakdown: 'leve', brokenAt: t0 }, p, 0, t0))).toBe('vehicle_unavailable');
    expect(code(() => checkRace(v, p, 0, new Date(t0.getTime() + 183 * DAY)))).toBe('vehicle_unavailable');
  });
});

class Ledger implements RacePayer {
  balances = new Map<string, bigint>();
  pool = 1_000_000n;
  prizes = new Set<string>();
  async chargeFuel(r: Race) {
    const b = this.balances.get(r.accountId) ?? 0n;
    if (b < r.fuelCents) throw new AppError('insufficient_thaler', 'THALER insuficiente.', 409);
    this.balances.set(r.accountId, b - r.fuelCents);
  }
  async payPrize(r: Race) {
    if (this.prizes.has(r.id)) return;
    const c = BigInt(r.result.prizeCents);
    if (this.pool < c) throw new AppError('pool_empty', 'Pool vazio.', 503);
    this.pool -= c;
    this.balances.set(r.accountId, (this.balances.get(r.accountId) ?? 0n) + c);
    this.prizes.add(r.id);
  }
}

describe('settleRace', () => {
  it('gasolina, efeito no piloto e pane uma vez; pool vazio deixa charged e paga depois; sem THALER falha', async () => {
    const races = new MemoryRaceStore();
    const vehicles = new MemoryVehicleStore();
    const ledger = new Ledger();
    const v = car();
    await vehicles.create(v);
    const p = pilot(v.accountId, { attributes: { ...pilot(v.accountId).attributes, energy: 8, happiness: 5 } });
    let applied = 0;
    let current = p;
    const deps = {
      races,
      payer: ledger,
      vehicles,
      updateAvatar: async (_r: Race, apply: (a: Avatar) => Avatar) => {
        applied++;
        current = apply(current);
      },
    };
    const id = randomUUID();
    const seed = seedWhere(id, v, (r) => r.position === 1 && r.breakdown !== null);
    const race = newRace({ id, vehicle: v, avatar: p }, t0, seed);
    ledger.balances.set(v.accountId, 300n);
    ledger.pool = 0n;
    await races.createWithinLimit(race, 3);
    await expect(settleRace(deps, race, t0)).rejects.toMatchObject({ code: 'pool_empty' });
    expect((await races.get(id))!.status).toBe('charged');
    expect(current.attributes).toMatchObject({ energy: 7, happiness: 6 });
    expect(stateOf((await vehicles.get(v.id))!, t0)).toBe('broken');
    // O job tenta de novo: não cobra gasolina nem aplica o efeito de novo.
    ledger.pool = 1_000_000n;
    const done = await settleRace(deps, (await races.get(id))!, t0);
    expect(done.status).toBe('done');
    expect(applied).toBe(1);
    expect(ledger.balances.get(v.accountId)).toBe(2000n);

    const broke = newRace({ id: randomUUID(), vehicle: car(), avatar: pilot(randomUUID()) }, t0);
    await races.createWithinLimit(broke, 3);
    await expect(settleRace(deps, broke, t0)).rejects.toMatchObject({ code: 'insufficient_thaler' });
    expect((await races.get(broke.id))!.status).toBe('failed');
  });
});

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 10 }) : null;
afterAll(() => pool?.end());

describe.each([
  ['memória', () => ({ races: new MemoryRaceStore(), vehicles: new MemoryVehicleStore() }), true],
  ['postgres', () => ({ races: new PostgresRaceStore(pool!), vehicles: new PostgresVehicleStore(pool!) }), pool !== null],
] as [string, () => { races: RaceStore; vehicles: MemoryVehicleStore | PostgresVehicleStore }, boolean][])('stores de corrida e oficina (%s)', (_n, make, enabled) => {
  it.skipIf(!enabled)('limite do dia atômico, falha não conta; pane, oficina e revisão uma vez', async () => {
    const { races, vehicles } = make();
    const v = car();
    await vehicles.create(v);
    const p = pilot(v.accountId);
    const many = Array.from({ length: 5 }, () => newRace({ id: randomUUID(), vehicle: v, avatar: p }, t0));
    const ok = await Promise.all(many.map((r) => races.createWithinLimit(r, 3)));
    expect(ok.filter(Boolean)).toHaveLength(3);
    const inserted = many.filter((_, i) => ok[i]);
    expect(await races.transition(inserted[0]!.id, 'pending', 'failed')).toBe(true);
    expect(await races.transition(inserted[0]!.id, 'pending', 'failed')).toBe(false);
    expect(await races.countToday(p.id, dayOf(t0))).toBe(2);
    expect((await races.stuck(new Date(t0.getTime() + 1))).filter((r) => r.avatarId === p.id)).toHaveLength(2);
    const back = (await races.get(inserted[1]!.id))!;
    expect(back.result).toEqual(inserted[1]!.result);
    expect(back.fuelCents).toBe(300n);

    expect(await vehicles.setBreakdown(v.id, 'moderado', t0)).toBe(true);
    expect(await vehicles.setBreakdown(v.id, 'grave', t0)).toBe(false);
    expect(await vehicles.startRepair(v.id, t0, new Date(t0.getTime() + 3 * DAY))).toBe(true);
    expect(await vehicles.startRepair(v.id, t0, new Date(t0.getTime() + 3 * DAY))).toBe(false);
    const later = new Date(t0.getTime() + 4 * DAY);
    expect(stateOf((await vehicles.get(v.id))!, later)).toBe('ok');
    // Consertado: uma pane nova entra.
    expect(await vehicles.setBreakdown(v.id, 'leve', later)).toBe(true);
    expect(await vehicles.setRevision(v.id, null, later)).toBe(true);
    expect(await vehicles.setRevision(v.id, null, later)).toBe(false);
    expect((await vehicles.get(v.id))!).toMatchObject({ breakdown: 'leve', brokenAt: later, repairUntil: null, revisionUntil: later });
  });
});

class FakeLedger extends Ledger implements MealPayer, VehiclePayer {
  keys = new Set<string>();
  async chargeMeal(meal: Meal) {
    this.balances.set(meal.accountId, (this.balances.get(meal.accountId) ?? 0n) - meal.priceCents);
  }
  async chargeVehicle(i: { key: string; accountId: string; cents: bigint }) {
    if (this.keys.has(i.key)) return;
    const b = this.balances.get(i.accountId) ?? 0n;
    if (b < i.cents) throw new AppError('insufficient_thaler', 'THALER insuficiente.', 409);
    this.balances.set(i.accountId, b - i.cents);
    this.keys.add(i.key);
  }
  async payBuyback() {}
}

describe('API das corridas e da oficina', () => {
  let ledger: FakeLedger;
  let avatars: MemoryAvatarStore;
  let vehicles: MemoryVehicleStore;
  let clock: Date;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    ledger = new FakeLedger();
    avatars = new MemoryAvatarStore();
    vehicles = new MemoryVehicleStore();
    clock = t0;
    app = await buildApp(config, avatars, () => clock, null, ledger, null, () => 0.5, null, null, null, {
      store: vehicles,
      payer: ledger,
      races: new MemoryRaceStore(),
    });
  });

  const auth = async (accountId: string) => ({
    authorization: `Bearer ${await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(accountId)
      .setIssuer('scc-gateway')
      .setAudience('scc-api')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(SECRET))}`,
  });

  it('corre até o limite do dia; pane leva à oficina; revisão; sem habilitação não corre', async () => {
    const me = randomUUID();
    const h = await auth(me);
    ledger.balances.set(me, 1_000_000n);
    const p = await avatars.create(pilot(me));
    const v = car({ accountId: me });
    await vehicles.create(v);

    const results = [];
    for (let i = 0; i < 3; i++) {
      const r = await app.inject({ method: 'POST', url: `/v1/vehicles/${v.id}/races`, headers: h, payload: { avatar_id: p.id } });
      if (r.json().error?.code === 'vehicle_unavailable') break; // pane no meio: o carro parou
      expect(r.statusCode).toBe(201);
      expect(r.json().race).toMatchObject({ status: 'done', of: 8, fuel: '300', seed: expect.stringMatching(/^[0-9a-f]{64}$/) });
      results.push(r.json());
    }
    expect(results.length).toBeGreaterThan(0);
    expect(results.at(-1).avatar.attributes.energy).toBe(10 - results.length);
    // Se a 3ª corrida quebrou o carro, a 4ª esbarra na pane antes do limite (sorteio da semente).
    if (results.length === 3 && !results.at(-1).race.breakdown) {
      const fourth = await app.inject({ method: 'POST', url: `/v1/vehicles/${v.id}/races`, headers: h, payload: { avatar_id: p.id } });
      expect(fourth.json().error.code).toBe('race_limit');
    }
    const listed = (await app.inject({ url: '/v1/races', headers: h })).json().races;
    expect(listed).toHaveLength(results.length);

    // Pane forçada num carro novo: oficina de 7 dias e 10% do preço.
    const v2 = car({ accountId: me });
    await vehicles.create(v2);
    await vehicles.setBreakdown(v2.id, 'grave', clock);
    const blocked = await app.inject({ method: 'POST', url: `/v1/vehicles/${v2.id}/races`, headers: h, payload: { avatar_id: p.id } });
    expect(blocked.json().error.code).toBe('vehicle_unavailable');
    const before = ledger.balances.get(me)!;
    const fix = await app.inject({ method: 'POST', url: `/v1/vehicles/${v2.id}/repair`, headers: h });
    expect(fix.json()).toMatchObject({ cents: '200000', vehicle: { state: 'repairing', repair_until: new Date(t0.getTime() + 7 * DAY).toISOString() } });
    expect(ledger.balances.get(me)).toBe(before - 200_000n);
    const again = await app.inject({ method: 'POST', url: `/v1/vehicles/${v2.id}/repair`, headers: h });
    expect(again.json().error.code).toBe('in_repair');

    clock = new Date(t0.getTime() + 8 * DAY);
    const rev = await app.inject({ method: 'POST', url: `/v1/vehicles/${v2.id}/revision`, headers: h });
    expect(rev.json().vehicle).toMatchObject({ state: 'ok', revision_until: new Date(clock.getTime() + 30 * DAY).toISOString(), breakdown: null });
    expect((await app.inject({ method: 'POST', url: `/v1/vehicles/${v2.id}/revision`, headers: h })).json().error.code).toBe('revision_valid');

    const rookie = await avatars.create({ ...pilot(me), license: null });
    const nope = await app.inject({ method: 'POST', url: `/v1/vehicles/${v.id}/races`, headers: h, payload: { avatar_id: rookie.id } });
    expect(nope.json().error.code).toBe('not_licensed');
  });
});

describe.skipIf(!pool)('oficina no Postgres', () => {
  it('a pane gravada com microssegundos ainda entra na oficina', async () => {
    const vehicles = new PostgresVehicleStore(pool!);
    const v = car();
    await vehicles.create(v);
    await pool!.query(`update game.vehicle set breakdown = 'leve', broken_at = '2026-11-21T08:00:00.123456Z' where id = $1`, [v.id]);
    const broken = (await vehicles.get(v.id))!;
    expect(broken.brokenAt).toEqual(new Date('2026-11-21T08:00:00.123Z'));
    expect(await vehicles.startRepair(v.id, broken.brokenAt!, new Date(t0.getTime() + DAY))).toBe(true);
  });
});
