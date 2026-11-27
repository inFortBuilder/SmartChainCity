import { randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { type Avatar, decayed, newAvatar } from '../src/domain/avatar.js';
import type { HomeDirectory } from '../src/domain/housing.js';
import { type Meal, type MealPayer, cookFromPantry, eatFromPantry } from '../src/domain/meal.js';
import { startRest } from '../src/domain/routine.js';
import { applyShop, checkShop, completeHome, cooker, gearFromJson, gearToJson } from '../src/domain/shop.js';
import { PostgresAvatarStore } from '../src/infra/db/postgres-store.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';

/** Móveis e eletrodomésticos (GDD §6 "Lojas"): casa completa +1 de felicidade; fogão e micro-ondas cozinham. */
const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const INTERNAL = 'chave-interna-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: INTERNAL });
const t0 = new Date('2026-11-21T08:00:00Z');
const HOUR = 3_600_000;
const at = (h: number) => new Date(t0.getTime() + h * HOUR);

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
const buy = (a: Avatar, item: string) => applyShop(a, checkShop(a, { item }, t0).effect, t0);
const withAttrs = (a: Avatar, attrs: Partial<Avatar['attributes']>) => ({ ...a, attributes: { ...a.attributes, ...attrs } });

describe('móveis e casa completa', () => {
  it('cada móvel uma vez; cama, sofá, mesa e guarda-roupa fazem a casa completa', () => {
    let a = make();
    expect(checkShop(a, { item: 'sofa' }, t0).cents).toBe(200_00n);
    for (const item of ['sofa', 'mesa', 'guarda_roupa']) a = buy(a, item);
    expect(code(() => checkShop(a, { item: 'sofa' }, t0))).toBe('already_owned');
    expect(completeHome(a)).toBe(false);
    a = buy(a, 'cama');
    expect(completeHome(a)).toBe(true);
    expect(gearFromJson(JSON.parse(JSON.stringify(gearToJson(a.gear))))).toEqual(a.gear);
    // Gravações antigas (sem \`home\`) continuam lendo.
    expect(gearFromJson({ clothes: 1, tool: null, bed: true })).toEqual({ clothes: 1, tool: null, bed: true });
  });

  it('ao acordar numa moradia regular com a casa completa, +1 de felicidade; sem moradia, não', () => {
    let a = make();
    for (const item of ['cama', 'sofa', 'mesa', 'guarda_roupa']) a = buy(a, item);
    a = withAttrs(a, { energy: 2, happiness: 5 });
    const home = decayed(startRest(a, { hours: 4, housed: true, running: false }, t0), at(4));
    expect(home.attributes.happiness).toBeGreaterThanOrEqual(5);
    const out = decayed(startRest(a, { hours: 4, housed: false, running: false }, t0), at(4));
    expect(home.attributes.happiness - out.attributes.happiness).toBe(1);
    // Sem a casa completa, nada a mais.
    const plain = decayed(startRest(withAttrs(make(), { energy: 2, happiness: 5 }), { hours: 4, housed: true, running: false }, t0), at(4));
    expect(plain.attributes.happiness).toBe(out.attributes.happiness);
  });
});

describe('cozinhar', () => {
  const pantry = { milho: 2 };

  it('precisa de fogão ou micro-ondas e de moradia; rende mais que comer cru, sem dor de barriga', () => {
    const hungry = withAttrs(make({ pantry }), { food: 2 });
    expect(code(() => cookFromPantry(hungry, { foodCode: 'milho', housed: true }, t0))).toBe('no_stove');
    const micro = buy(hungry, 'micro_ondas');
    expect(cooker(micro)).toBe('micro_ondas');
    expect(code(() => cookFromPantry(micro, { foodCode: 'milho', housed: false }, t0))).toBe('no_home');
    expect(code(() => cookFromPantry(micro, { foodCode: 'arroz', housed: true }, t0))).toBe('not_in_pantry');
    const raw = eatFromPantry(hungry, { foodCode: 'milho', roll: 1 }, t0);
    const cooked = cookFromPantry(micro, { foodCode: 'milho', housed: true }, t0);
    expect(raw.attributes.food).toBe(5);
    expect(cooked.attributes.food).toBe(6);
    expect(cooked.pantry).toEqual({ milho: 1 });
    expect(cooked.conditions).toEqual([]);
    // Fogão rende mais; com geladeira, +1 de saúde.
    const stove = buy(buy(micro, 'fogao'), 'geladeira');
    expect(cooker(stove)).toBe('fogao');
    const sick = withAttrs(stove, { health: 5 });
    const best = cookFromPantry(sick, { foodCode: 'milho', housed: true }, t0);
    expect(best.attributes.food).toBe(7);
    expect(best.attributes.health - cookFromPantry(withAttrs(buy(micro, 'fogao'), { health: 5 }), { foodCode: 'milho', housed: true }, t0).attributes.health).toBe(1);
    expect(code(() => cookFromPantry(withAttrs(stove, { food: 10 }), { foodCode: 'milho', housed: true }, t0))).toBe('not_hungry');
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
    return this.regular.has(accountId) ? [{ id: 'casa', label: 'Casa T1', regular: true, regularUntil: at(720) }] : [];
  }
}

describe('API dos móveis e da cozinha', () => {
  let store: MemoryAvatarStore;
  let ledger: FakeLedger;
  let homes: Homes;
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeEach(async () => {
    store = new MemoryAvatarStore();
    ledger = new FakeLedger();
    homes = new Homes();
    app = await buildApp(config, store, () => t0, null, ledger, null, () => 0.5, null, null, null, null, null, null, null, homes);
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

  it('compra o fogão, cozinha com casa e mostra no catálogo e no avatar', async () => {
    const a = await store.create(withAttrs(make({ pantry: { milho: 1 } }), { food: 2 }));
    ledger.balances.set(a.accountId, 1000_00n);
    const h = await auth(a.accountId);
    const cat = (await app.inject({ url: '/v1/catalog/shop' })).json();
    expect(cat.home.map((x: { code: string }) => x.code)).toEqual(['sofa', 'mesa', 'guarda_roupa', 'fogao', 'geladeira', 'micro_ondas']);
    expect(cat).toMatchObject({ complete_home: { items: ['cama', 'sofa', 'mesa', 'guarda_roupa'] }, cooking: { food: { fogao: 5, micro_ondas: 4 } } });

    const noStove = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/cook`, headers: h, payload: { food: 'milho' } });
    expect(noStove.json().error.code).toBe('no_stove');
    const stove = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/shop`, headers: h, payload: { item: 'fogao' } });
    expect(stove.statusCode).toBe(201);
    expect(stove.json().avatar.gear).toMatchObject({ home: ['fogao'], cooks_with: 'fogao', complete_home: false });
    expect(ledger.balances.get(a.accountId)).toBe(700_00n);

    const homeless = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/cook`, headers: h, payload: { food: 'milho' } });
    expect(homeless.json().error.code).toBe('no_home');
    homes.regular.add(a.accountId);
    const cooked = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/cook`, headers: h, payload: { food: 'milho' } });
    expect(cooked.statusCode).toBe(200);
    expect(cooked.json().avatar).toMatchObject({ attributes: { food: 7 }, pantry: [] });
    expect((await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/shop`, headers: h, payload: { item: 'tapete' } })).statusCode).toBe(400);
  });
});

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 3 }) : null;
afterAll(() => pool?.end());

describe.skipIf(!pool)('móveis no Postgres', () => {
  it('grava os móveis e a felicidade do descanso', async () => {
    const store = new PostgresAvatarStore(pool!);
    let a = make();
    for (const item of ['cama', 'sofa', 'mesa', 'guarda_roupa', 'fogao']) a = buy(a, item);
    a = await store.create(withAttrs(a, { energy: 2 }));
    expect((await store.get(a.id))!.gear).toMatchObject({ bed: true, home: ['sofa', 'mesa', 'guarda_roupa', 'fogao'] });
    await store.updateAvatar(a.id, a.accountId, t0, (x) => startRest(x, { hours: 4, housed: true, running: false }, t0));
    expect((await store.get(a.id))!.rest).toMatchObject({ energy: 4, happiness: 1 });
  });
});
