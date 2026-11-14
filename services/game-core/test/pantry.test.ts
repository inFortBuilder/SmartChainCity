import { randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { type Avatar, type AvatarStore, newAvatar } from '../src/domain/avatar.js';
import { food } from '../src/domain/foods.js';
import { type Meal, type MealPayer, type MealStore, eat, eatFromPantry, packPriceCents, planPack } from '../src/domain/meal.js';
import { PostgresAvatarStore } from '../src/infra/db/postgres-store.js';
import { EconomyPayer } from '../src/infra/economy-payer.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const INTERNAL = 'chave-interna-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: INTERNAL });
const t0 = new Date('2026-11-13T08:00:00Z');

const make = (attrs: Partial<Avatar['attributes']> = {}, pantry: Record<string, number> = {}): Avatar => {
  const a = newAvatar({ id: randomUUID(), accountId: randomUUID(), rarity: 'common', jobCode: 'padeiro' }, t0);
  return { ...a, attributes: { ...a.attributes, ...attrs }, pantry };
};

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return null;
};

describe('regras da despensa', () => {
  it('o pacote custa as unidades pelo preço provisório, ou o preço do catálogo', () => {
    expect(packPriceCents(food('maca')!)).toBe(2000n);
    expect(packPriceCents({ ...food('maca')!, price: 15 })).toBe(1500n);
  });

  it('comprar o pacote guarda as unidades, mesmo satisfeito, e soma com o que já tinha', () => {
    const full = make({}, { maca: 2 });
    const pack = planPack(full, { id: randomUUID(), foodCode: 'maca', clientKey: null }, t0);
    expect(pack).toMatchObject({ foodCode: 'maca', priceCents: 2000n, effects: { pantry: { code: 'maca', units: 5 } } });
    const after = eat(full, pack.effects, t0);
    expect(after.pantry).toEqual({ maca: 7 });
    expect(after.attributes).toEqual(full.attributes);
  });

  it('comer da despensa gasta uma unidade e aplica a refeição; a última some da lista', () => {
    const hungry = make({ food: 4, energy: 5 }, { maca: 2, ovos: 1 });
    const once = eatFromPantry(hungry, { foodCode: 'maca', roll: 0.5 }, t0);
    expect(once.pantry).toEqual({ maca: 1, ovos: 1 });
    expect(once.attributes).toMatchObject({ food: 7, energy: 8 });
    expect(eatFromPantry(once, { foodCode: 'ovos', roll: 0.5 }, t0).pantry).toEqual({ maca: 1 });
  });

  it('sem o alimento é 409; satisfeito não come; a dor de barriga vale aqui também', () => {
    expect(code(() => eatFromPantry(make({ food: 4 }), { foodCode: 'maca' }, t0))).toBe('not_in_pantry');
    expect(code(() => eatFromPantry(make({}, { maca: 1 }), { foodCode: 'maca' }, t0))).toBe('not_hungry');
    const sick = eatFromPantry(make({ food: 4 }, { maca: 1 }), { foodCode: 'maca', roll: 0 }, t0);
    expect(sick.conditions.map((c) => c.code)).toEqual(['dor_de_barriga']);
  });

  it('o ledger lança o pacote como pack_buy, para a queima da comida', async () => {
    const bodies: { kind: string; legs: { owner_id: string; amount: string }[] }[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response('{}', { status: 201 });
    }) as typeof fetch;
    await new EconomyPayer('http://economy', 'token', fetchFn).chargeMeal(
      planPack(make(), { id: randomUUID(), foodCode: 'maca', clientKey: null }, t0),
    );
    expect(bodies[0]).toMatchObject({ kind: 'pack_buy', legs: [{ amount: '-2000' }, { owner_id: 'food', amount: '2000' }] });
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

describe('API da despensa', () => {
  let ledger: FakeLedger;
  let store: MemoryAvatarStore;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    ledger = new FakeLedger();
    store = new MemoryAvatarStore();
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

  it('compra o pacote uma vez (mesma Idempotency-Key), come da despensa sem cobrar de novo', async () => {
    const a = await store.create(make({ food: 4 }));
    ledger.balances.set(a.accountId, 5000n);
    const headers = { ...(await auth(a.accountId)), 'idempotency-key': 'pacote-de-maca-1' };
    const buy = () => app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/pantry`, headers, payload: { food: 'maca' } });
    const first = await buy();
    expect(first.statusCode).toBe(201);
    expect(first.json().purchase).toMatchObject({ food: 'maca', price: '2000', status: 'eaten' });
    expect(first.json().avatar.pantry).toEqual([{ food: 'maca', units: 5 }]);
    expect((await buy()).json().purchase.id).toBe(first.json().purchase.id);
    expect(ledger.balances.get(a.accountId)).toBe(3000n);

    const eaten = await app.inject({
      method: 'POST',
      url: `/v1/avatars/${a.id}/consume`,
      headers: await auth(a.accountId),
      payload: { food: 'maca' },
    });
    expect(eaten.statusCode).toBe(200);
    expect(eaten.json().avatar).toMatchObject({ pantry: [{ food: 'maca', units: 4 }], attributes: { food: 7 } });
    expect(ledger.balances.get(a.accountId)).toBe(3000n);
  });

  it('sem THALER o pacote é 409 e a despensa fica vazia; o catálogo mostra o pacote', async () => {
    const a = await store.create(make());
    const r = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/pantry`, headers: await auth(a.accountId), payload: { food: 'maca' } });
    expect(r.json().error.code).toBe('insufficient_thaler');
    expect((await store.get(a.id))!.pantry).toEqual({});
    const foods = (await app.inject({ url: '/v1/catalog/foods' })).json().foods;
    expect(foods.find((f: { code: string }) => f.code === 'maca')).toMatchObject({ pack: 5, pack_price: '2000' });
  });

  it('de outra conta é 404', async () => {
    const a = await store.create(make({ food: 4 }, { maca: 1 }));
    const r = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/consume`, headers: await auth(randomUUID()), payload: { food: 'maca' } });
    expect(r.statusCode).toBe(404);
  });
});

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 10 }) : null;
afterAll(() => pool?.end());

describe.each([
  ['memória', () => new MemoryAvatarStore(), true],
  ['postgres', () => new PostgresAvatarStore(pool!), pool !== null],
] as [string, () => AvatarStore & MealStore, boolean][])('despensa no store: %s', (_name, makeStore, enabled) => {
  it.runIf(enabled)('grava o pacote e consome uma unidade por vez, mesmo em paralelo', async () => {
    const store = makeStore();
    // Futuro distante: os jobs de outros testes no Postgres compartilhado não pegam este avatar.
    const when = new Date(Date.UTC(2097, 0, 1) + Math.floor(Math.random() * 1e9));
    const base = newAvatar({ id: randomUUID(), accountId: randomUUID(), rarity: 'common', jobCode: 'padeiro' }, when);
    const a = await store.create({ ...base, attributes: { ...base.attributes, food: 0 } });
    const pack = await store.beginMeal(a.id, a.accountId, null, when, (current) =>
      planPack(current, { id: randomUUID(), foodCode: 'ovos', clientKey: null }, when),
    );
    await store.finishMeal(pack.id, when);
    expect((await store.get(a.id))!.pantry).toEqual({ ovos: 3 });

    const results = await Promise.allSettled(
      [1, 2, 3, 4].map(() => store.updateAvatar(a.id, a.accountId, when, (cur) => eatFromPantry(cur, { foodCode: 'ovos', roll: 0.5 }, when))),
    );
    // 3 unidades: 3 comem (alimentação 0 → 9) e a quarta acha a despensa vazia.
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    const after = (await store.get(a.id))!;
    expect(after.pantry).toEqual({});
    expect(after.attributes.food).toBe(9);
  });
});
