import { randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';
import { SignJWT } from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { type Avatar, newAvatar } from '../src/domain/avatar.js';
import { type Meal, type MealPayer } from '../src/domain/meal.js';
import { applyCommute, planCommute } from '../src/domain/routine.js';
import { SKATE, applyShop, checkShop, gearFromJson, gearToJson, skateTrips } from '../src/domain/shop.js';
import { startShift } from '../src/domain/shift.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';

/** Skate ou bicicleta (GDD §3.3: 10 min, "depreciação"): item da loja que gasta uma viagem por turno. */
const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const INTERNAL = 'chave-interna-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: INTERNAL });
const t0 = new Date('2026-11-21T08:00:00Z');

const make = (over: Partial<Avatar> = {}): Avatar => ({
  ...newAvatar({ id: randomUUID(), accountId: randomUUID(), rarity: 'common', jobCode: 'padeiro' }, t0),
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
const buySkate = (a: Avatar) => applyShop(a, checkShop(a, { item: 'skate' }, t0).effect, t0);

describe('skate', () => {
  it('sem skate não vai de skate; com ele, 10 min e uma viagem a menos por turno', () => {
    expect(code(() => planCommute('skate', 6, false))).toBe('no_skate');
    expect(code(() => planCommute('skate', 6, false, false))).toBe('no_skate');
    expect(planCommute('skate', 6, false, true).factor).toBeCloseTo(1 - 10 / 360);
    const a = buySkate(make());
    expect(skateTrips(a)).toBe(SKATE.trips);
    expect(checkShop(make(), { item: 'skate' }, t0).cents).toBe(120_00n);
    expect(code(() => checkShop(a, { item: 'skate' }, t0))).toBe('already_owned');
    const { avatar } = startShift(a, { id: randomUUID(), hours: 6, hoursToday: 0, running: false, commute: planCommute('skate', 6, false, true) }, t0);
    expect(skateTrips(avatar)).toBe(SKATE.trips - 1);
    // A pé não gasta o skate.
    expect(applyCommute(a, planCommute('a_pe', 6, false))).toBe(a);
  });

  it('quebra na última viagem e pode comprar outro; grava e lê o número de viagens', () => {
    const last = { ...make(), gear: { clothes: 0, tool: null, bed: false, skateTrips: 1 } };
    const broken = applyCommute(last, planCommute('skate', 6, false, true));
    expect(skateTrips(broken)).toBe(0);
    expect(checkShop(broken, { item: 'skate' }, t0).cents).toBe(SKATE.cents);
    expect(gearFromJson(JSON.parse(JSON.stringify(gearToJson(last.gear))))).toEqual(last.gear);
    expect(gearToJson(broken.gear)).not.toHaveProperty('skateTrips');
  });
});

class FakeLedger implements MealPayer {
  balances = new Map<string, bigint>();
  async chargeMeal(meal: Meal) {
    const balance = this.balances.get(meal.accountId) ?? 0n;
    if (balance < meal.priceCents) throw new AppError('insufficient_thaler', 'THALER insuficiente.', 409);
    this.balances.set(meal.accountId, balance - meal.priceCents);
  }
}

describe('API do skate', () => {
  let store: MemoryAvatarStore;
  let ledger: FakeLedger;
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeEach(async () => {
    store = new MemoryAvatarStore();
    ledger = new FakeLedger();
    app = await buildApp(config, store, () => t0, null, ledger, null, () => 0.5);
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

  it('pede o skate para ir de skate; depois da compra, o turno gasta uma viagem', async () => {
    const a = await store.create(make());
    ledger.balances.set(a.accountId, 500_00n);
    const h = await auth(a.accountId);
    const cat = (await app.inject({ url: '/v1/catalog/routine' })).json();
    expect(cat.commutes.find((c: { mode: string }) => c.mode === 'skate')).toMatchObject({ needs_skate: true, delay_min: 10 });
    expect((await app.inject({ url: '/v1/catalog/shop' })).json().skate).toEqual({ price: '12000', trips: 60 });

    const no = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/work`, headers: h, payload: { shift: 6, commute: 'skate' } });
    expect(no.json().error.code).toBe('no_skate');
    const buy = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/shop`, headers: h, payload: { item: 'skate' } });
    expect(buy.statusCode).toBe(201);
    expect(buy.json().avatar.gear.skate_trips).toBe(60);
    const go = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/work`, headers: h, payload: { shift: 6, commute: 'skate' } });
    expect(go.statusCode).toBe(201);
    expect((await store.listShifts(a.id, 1))[0]!.snapshot).toMatchObject({ commuteMode: 'skate' });
    expect((await app.inject({ url: `/v1/avatars/${a.id}`, headers: h })).json().avatar.gear.skate_trips).toBe(59);
  });
});
