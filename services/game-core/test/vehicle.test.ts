import { randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { type Avatar, newAvatar, status } from '../src/domain/avatar.js';
import type { Meal, MealPayer } from '../src/domain/meal.js';
import { startShift } from '../src/domain/shift.js';
import {
  type Vehicle,
  type VehiclePayer,
  type VehicleStore,
  applyLicense,
  attributesAt,
  buybackCents,
  checkIpva,
  checkLicense,
  checkSale,
  depreciatedCents,
  licensed,
  newVehicle,
  stateOf,
} from '../src/domain/vehicle.js';
import { PostgresVehicleStore } from '../src/infra/db/postgres-vehicle-store.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';
import { MemoryVehicleStore } from '../src/infra/memory-vehicle-store.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const INTERNAL = 'chave-interna-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: INTERNAL });
const t0 = new Date('2026-11-21T08:00:00Z');
const DAY = 86_400_000;
const day = (n: number) => new Date(t0.getTime() + n * DAY);

const car = (over: Partial<Vehicle> = {}): Vehicle => ({ ...newVehicle({ id: randomUUID(), accountId: randomUUID(), model: 'sedan', rent: false }, t0), status: 'active', ...over });
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return null;
};

describe('regras dos veículos', () => {
  it('atributos no máximo até 90 dias, caem até 50% em 180; o valor deprecia em 180 dias', () => {
    const c = car();
    expect(attributesAt(c, day(90))).toEqual({ speed: 70, power: 60, factor: 1 });
    expect(attributesAt(c, day(135))).toEqual({ speed: 53, power: 45, factor: 0.75 });
    expect(attributesAt(c, day(400))).toEqual({ speed: 35, power: 30, factor: 0.5 });
    expect(depreciatedCents(c, t0)).toBe(800_000n);
    expect(depreciatedCents(c, day(90))).toBe(400_000n);
    expect(depreciatedCents(c, day(200))).toBe(0n);
    expect(buybackCents(c, day(90))).toBe(320_000n);
  });

  it('situação: suspenso com IPVA vencido, gasto aos 180 dias, aluguel vence em 3 dias', () => {
    const c = car();
    expect(stateOf(c, day(100))).toBe('ok');
    expect(stateOf(c, day(183))).toBe('suspended');
    expect(stateOf({ ...c, ipvaPaidUntil: day(364) }, day(181))).toBe('worn_out');
    const rent = { ...newVehicle({ id: randomUUID(), accountId: 'x', model: 'hatch', rent: true }, t0), status: 'active' as const };
    expect(rent).toMatchObject({ kind: 'rental', paidCents: 15_000n, ipvaPaidUntil: null, rentalUntil: day(3) });
    expect(stateOf(rent, day(2))).toBe('ok');
    expect(stateOf(rent, day(3))).toBe('expired');
    expect(code(() => newVehicle({ id: 'x', accountId: 'x', model: 'tanque', rent: false }, t0))).toBe('invalid_model');
  });

  it('IPVA: 2% a cada 182 dias, adiantado até 30 dias, um semestre por chave; venda pede IPVA em dia', () => {
    const c = car();
    expect(code(() => checkIpva(c, day(100)))).toBe('ipva_not_due');
    expect(checkIpva(c, day(160))).toEqual({ cents: 16_000n, period: 1, until: day(364) });
    expect(checkIpva({ ...c, ipvaPaidUntil: day(364) }, day(340))).toMatchObject({ period: 2, until: day(546) });
    expect(code(() => checkSale(c, day(190)))).toBe('ipva_overdue');
    expect(checkSale(c, day(90)).cents).toBe(320_000n);
    const rent = { ...newVehicle({ id: randomUUID(), accountId: 'x', model: 'hatch', rent: true }, t0), status: 'active' as const };
    expect(code(() => checkSale(rent, t0))).toBe('rental_not_for_sale');
    expect(code(() => checkIpva(rent, t0))).toBe('no_ipva');
  });

  it('autoescola: 3 h parado (sem turno), depois habilitado; uma vez só', () => {
    const a = newAvatar({ id: randomUUID(), accountId: randomUUID(), rarity: 'common', jobCode: 'padeiro' }, t0);
    expect(checkLicense(a, t0).cents).toBe(5000n);
    const studying = applyLicense(a, t0);
    expect(status(studying, new Date(t0.getTime() + 3_600_000)).canWork).toBe(false);
    expect(code(() => startShift(studying, { id: randomUUID(), hours: 6, hoursToday: 0, running: false }, new Date(t0.getTime() + 3_600_000)))).toBe(
      'in_driving_school',
    );
    expect(code(() => checkLicense(studying, t0))).toBe('in_driving_school');
    const after = new Date(t0.getTime() + 3 * 3_600_000);
    expect(licensed(studying, after)).toBe(true);
    expect(status(studying, after).canWork).toBe(true);
    expect(code(() => checkLicense(studying, after))).toBe('already_licensed');
  });
});

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 5 }) : null;
afterAll(() => pool?.end());

describe.each([
  ['memória', () => new MemoryVehicleStore(), true],
  ['postgres', () => new PostgresVehicleStore(pool!), pool !== null],
] as [string, () => VehicleStore, boolean][])('store de veículos (%s)', (_n, make, enabled) => {
  it.skipIf(!enabled)('pendente → ativo, IPVA anda uma vez, vende uma vez, pendente sem pagar some', async () => {
    const s = make();
    const c = { ...car(), status: 'pending' as const };
    await s.create(c);
    expect((await s.pendingOlderThan(day(1))).some((x) => x.id === c.id)).toBe(true);
    await s.activate(c.id);
    const back = (await s.get(c.id))!;
    expect(back).toEqual({ ...c, status: 'active' });
    expect(await s.extendIpva(c.id, c.ipvaPaidUntil!, day(364))).toBe(true);
    expect(await s.extendIpva(c.id, c.ipvaPaidUntil!, day(364))).toBe(false);
    expect(await s.markSold(c.id, day(10))).toBe(true);
    expect(await s.markSold(c.id, day(10))).toBe(false);
    expect((await s.listByAccount(c.accountId))[0]).toMatchObject({ status: 'sold', soldAt: day(10), ipvaPaidUntil: day(364) });

    const drop = { ...car(), status: 'pending' as const };
    await s.create(drop);
    await s.dropPending(drop.id);
    expect(await s.get(drop.id)).toBeNull();
  });
});

class FakeLedger implements MealPayer, VehiclePayer {
  balances = new Map<string, bigint>();
  keys = new Set<string>();
  private take(accountId: string, cents: bigint) {
    const b = this.balances.get(accountId) ?? 0n;
    if (b < cents) throw new AppError('insufficient_thaler', 'THALER insuficiente.', 409);
    this.balances.set(accountId, b - cents);
  }
  async chargeMeal(meal: Meal) {
    this.take(meal.accountId, meal.priceCents);
  }
  async chargeVehicle(i: { key: string; accountId: string; cents: bigint }) {
    if (this.keys.has(i.key)) return;
    this.take(i.accountId, i.cents);
    this.keys.add(i.key);
  }
  async payBuyback(i: { key: string; accountId: string; cents: bigint }) {
    if (this.keys.has(i.key)) return;
    this.balances.set(i.accountId, (this.balances.get(i.accountId) ?? 0n) + i.cents);
    this.keys.add(i.key);
  }
}

describe('API dos veículos', () => {
  let ledger: FakeLedger;
  let avatars: MemoryAvatarStore;
  let clock: Date;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    ledger = new FakeLedger();
    avatars = new MemoryAvatarStore();
    clock = t0;
    app = await buildApp(config, avatars, () => clock, null, ledger, null, () => 0.5, null, null, null, { store: new MemoryVehicleStore(), payer: ledger });
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

  it('autoescola, compra, aluguel, IPVA atrasado e pago, e venda pela depreciação', async () => {
    const me = randomUUID();
    const h = await auth(me);
    ledger.balances.set(me, 1_000_000n);
    const a: Avatar = await avatars.create(newAvatar({ id: randomUUID(), accountId: me, rarity: 'common', jobCode: 'padeiro' }, t0));

    const lic = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/license`, headers: h });
    expect(lic.statusCode).toBe(201);
    expect(lic.json().avatar.license).toEqual({ ready_at: new Date(t0.getTime() + 3 * 3_600_000).toISOString(), licensed: false });

    const bought = await app.inject({ method: 'POST', url: '/v1/vehicles', headers: h, payload: { model: 'sedan' } });
    expect(bought.statusCode).toBe(201);
    const id = bought.json().vehicle.id;
    expect(bought.json().vehicle).toMatchObject({ label: 'Sedã esportivo', kind: 'owned', state: 'ok', attributes: { speed: 70 }, buyback_cents: '640000' });
    const rented = await app.inject({ method: 'POST', url: '/v1/vehicles', headers: h, payload: { model: 'super', rent: true } });
    expect(rented.json().vehicle).toMatchObject({ kind: 'rental', rental_until: day(3).toISOString(), value_cents: null });
    // 1.000.000 − 5.000 (autoescola) − 800.000 (sedã) − 100.000 (aluguel de 5% do superesportivo).
    expect(ledger.balances.get(me)).toBe(95_000n);

    const early = await app.inject({ method: 'POST', url: `/v1/vehicles/${id}/ipva`, headers: h });
    expect(early.json().error.code).toBe('ipva_not_due');

    clock = day(190);
    const list = (await app.inject({ url: '/v1/vehicles', headers: h })).json().vehicles;
    expect(list.map((v: { state: string }) => v.state).sort()).toEqual(['expired', 'suspended']);
    const sellLate = await app.inject({ method: 'POST', url: `/v1/vehicles/${id}/sell`, headers: h });
    expect(sellLate.json().error.code).toBe('ipva_overdue');
    const paid = await app.inject({ method: 'POST', url: `/v1/vehicles/${id}/ipva`, headers: h });
    expect(paid.json().vehicle).toMatchObject({ state: 'worn_out', ipva_paid_until: day(364).toISOString() });
    expect(ledger.balances.get(me)).toBe(79_000n);

    // Vida útil acabou: valor 0, a venda paga 0 e o carro sai da lista.
    const sold = await app.inject({ method: 'POST', url: `/v1/vehicles/${id}/sell`, headers: h });
    expect(sold.json().sold).toEqual({ id, cents: '0' });
    expect((await app.inject({ url: '/v1/vehicles', headers: h })).json().vehicles.map((v: { kind: string }) => v.kind)).toEqual(['rental']);
    const other = await app.inject({ method: 'POST', url: `/v1/vehicles/${id}/ipva`, headers: await auth(randomUUID()) });
    expect(other.statusCode).toBe(404);
  });

  it('sem THALER, a compra é 409 e nada fica; o catálogo traz modelos e regras', async () => {
    const me = randomUUID();
    const h = await auth(me);
    const r = await app.inject({ method: 'POST', url: '/v1/vehicles', headers: h, payload: { model: 'hatch' } });
    expect(r.json().error.code).toBe('insufficient_thaler');
    expect((await app.inject({ url: '/v1/vehicles', headers: h })).json().vehicles).toEqual([]);
    const cat = (await app.inject({ url: '/v1/catalog/vehicles' })).json();
    expect(cat.models.map((m: { code: string; price: string }) => [m.code, m.price])).toEqual([
      ['hatch', '300000'],
      ['sedan', '800000'],
      ['super', '2000000'],
    ]);
    expect(cat.rules).toMatchObject({ life_days: 180, ipva_days: 182, rent_days: 3, license_hours: 3 });
  });
});
