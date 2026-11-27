import { randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { type Avatar, newAvatar, status } from '../src/domain/avatar.js';
import type { HomeDirectory } from '../src/domain/housing.js';
import {
  type Meal,
  type MealPayer,
  PANTRY_LIMITS,
  cookFromPantry,
  eat,
  eatFromPantry,
  marketMs,
  pantryCapacity,
  planMeal,
  planPack,
} from '../src/domain/meal.js';
import { applyShop, checkShop } from '../src/domain/shop.js';
import { startShift } from '../src/domain/shift.js';
import { PostgresAvatarStore } from '../src/infra/db/postgres-store.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';

/** Mercado (GDD §6: "compra leva 4 min + volume") e o limite da despensa pela casa. */
const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const INTERNAL = 'chave-interna-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: INTERNAL });
const t0 = new Date('2026-11-21T08:00:00Z');
const MIN = 60_000;
const at = (min: number) => new Date(t0.getTime() + min * MIN);

const make = (over: Partial<Avatar> = {}): Avatar => ({
  ...newAvatar({ id: randomUUID(), accountId: randomUUID(), rarity: 'common', jobCode: 'padeiro' }, t0),
  ...over,
});
const hungry = (over: Partial<Avatar> = {}) => {
  const a = make(over);
  return { ...a, attributes: { ...a.attributes, food: 2 } };
};
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return null;
};

describe('tempo de compra no mercado', () => {
  it('a refeição leva 4,5 min e o pacote 4 min + 30 s por unidade; no mercado, não trabalha nem compra de novo', () => {
    expect(marketMs(1)).toBe(4.5 * MIN);
    const meal = planMeal(hungry(), { id: 'm', foodCode: 'maca', clientKey: null, roll: 1 }, t0);
    expect(meal.effects.marketMs).toBe(4.5 * MIN);
    const fed = eat(hungry(), meal.effects, t0);
    expect(fed.marketUntil).toEqual(new Date(t0.getTime() + 4.5 * MIN));
    expect(status(fed, at(1))).toMatchObject({ atMarket: true, canWork: false, canLeisure: false });
    expect(code(() => startShift(fed, { id: randomUUID(), hours: 6, hoursToday: 0, running: false }, at(1)))).toBe('at_market');
    expect(code(() => planMeal(fed, { id: 'x', foodCode: 'maca', clientKey: null }, at(1)))).toBe('at_market');
    expect(code(() => planPack(fed, { id: 'x', foodCode: 'maca', clientKey: null }, at(1)))).toBe('at_market');
    // Comer da despensa e cozinhar são em casa: não contam e não prendem no mercado.
    const home = { ...fed, attributes: { ...fed.attributes, food: 2 }, pantry: { maca: 2 } };
    expect(eatFromPantry(home, { foodCode: 'maca', roll: 1 }, at(1)).marketUntil).toEqual(fed.marketUntil);
    expect(status(fed, at(5))).toMatchObject({ atMarket: false, canWork: true });
    const pack = planPack(make(), { id: 'p', foodCode: 'maca', clientKey: null }, t0);
    expect(pack.effects.marketMs).toBe(4 * MIN + pack.effects.pantry!.units * 30_000);
  });
});

describe('limite da despensa pela casa', () => {
  it('10 sem moradia, 30 com moradia e 60 com geladeira; o pacote que passa dá pantry_full', () => {
    const a = make();
    expect(pantryCapacity(a, false)).toBe(PANTRY_LIMITS.unhoused);
    expect(pantryCapacity(a, true)).toBe(30);
    const fridge = applyShop(a, checkShop(a, { item: 'geladeira' }, t0).effect, t0);
    expect(pantryCapacity(fridge, true)).toBe(60);
    expect(pantryCapacity(fridge, false)).toBe(10);
    const full = make({ pantry: { milho: 8 } });
    expect(code(() => planPack(full, { id: 'p', foodCode: 'maca', clientKey: null, capacity: 10 }, t0))).toBe('pantry_full');
    expect(planPack(full, { id: 'p', foodCode: 'maca', clientKey: null, capacity: 30 }, t0).effects.pantry).toMatchObject({ code: 'maca' });
    // Sem a capacidade (fazenda, testes antigos), não limita.
    expect(planPack(full, { id: 'p', foodCode: 'maca', clientKey: null }, t0).effects.pantry).toBeDefined();
  });

  it('cozinhar não prende no mercado', () => {
    let a = hungry({ pantry: { milho: 1 } });
    a = applyShop(a, checkShop(a, { item: 'fogao' }, t0).effect, t0);
    expect(cookFromPantry(a, { foodCode: 'milho', housed: true }, t0).marketUntil ?? null).toBeNull();
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
class Homes implements HomeDirectory {
  regular = new Set<string>();
  async homes(accountId: string) {
    return this.regular.has(accountId) ? [{ id: 'casa', label: 'Casa T1', regular: true, regularUntil: at(60 * 24 * 30) }] : [];
  }
}

describe('API do mercado e da despensa', () => {
  let store: MemoryAvatarStore;
  let ledger: FakeLedger;
  let homes: Homes;
  let clock: Date;
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeEach(async () => {
    store = new MemoryAvatarStore();
    ledger = new FakeLedger();
    homes = new Homes();
    clock = t0;
    app = await buildApp(config, store, () => clock, null, ledger, null, () => 0.5, null, null, null, null, null, null, null, homes);
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

  it('a compra prende no mercado; sem moradia, a despensa enche com 10; com casa, cabe mais', async () => {
    const a = await store.create(make({ pantry: { milho: 6 } }));
    ledger.balances.set(a.accountId, 1000_00n);
    const h = await auth(a.accountId);
    const cat = (await app.inject({ url: '/v1/catalog/foods' })).json();
    expect(cat).toMatchObject({ market: { base_ms: 240000, per_unit_ms: 30000 }, pantry_limits: { unhoused: 10, housed: 30, fridge: 60 } });

    const full = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/pantry`, headers: h, payload: { food: 'maca' } });
    expect(full.json().error.code).toBe('pantry_full');
    homes.regular.add(a.accountId);
    const pack = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/pantry`, headers: h, payload: { food: 'maca' } });
    expect(pack.statusCode).toBe(201);
    expect(pack.json().avatar).toMatchObject({ market_until: expect.any(String), status: { atMarket: true, canWork: false } });
    const busy = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/work`, headers: h, payload: { shift: 6 } });
    expect(busy.json().error.code).toBe('at_market');

    clock = at(10);
    const seen = (await app.inject({ url: `/v1/avatars/${a.id}`, headers: h })).json().avatar;
    expect(seen).toMatchObject({ market_until: null, status: { atMarket: false } });
    expect((await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/work`, headers: h, payload: { shift: 6 } })).statusCode).toBe(201);
  });
});

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 3 }) : null;
afterAll(() => pool?.end());

describe.skipIf(!pool)('mercado no Postgres', () => {
  it('grava até quando o avatar fica no mercado', async () => {
    const store = new PostgresAvatarStore(pool!);
    const a = await store.create(hungry());
    const meal = await store.beginMeal(a.id, a.accountId, null, t0, (current) =>
      planMeal(current, { id: randomUUID(), foodCode: 'maca', clientKey: null, roll: 1 }, t0),
    );
    await store.finishMeal(meal.id, t0);
    expect((await store.get(a.id))!.marketUntil).toEqual(new Date(t0.getTime() + 4.5 * MIN));
  });
});
