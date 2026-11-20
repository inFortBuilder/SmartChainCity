import { randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';
import { SignJWT } from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { newAvatar } from '../src/domain/avatar.js';
import { SEED_FOODS, food } from '../src/domain/foods.js';
import { DEFAULT_UNIT_PRICE_CENTS, type Meal, type MealPayer, eat, planMeal, unitPriceCents } from '../src/domain/meal.js';
import { EconomyPayer } from '../src/infra/economy-payer.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const INTERNAL = 'chave-interna-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: INTERNAL });
const HOUR = 3_600_000;

/** Ledger falso: saldo por conta, idempotente pela refeição, e pode cair. */
class FakeLedger implements MealPayer {
  balances = new Map<string, bigint>();
  charged = new Map<string, bigint>();
  down = false;
  async chargeMeal(meal: Meal) {
    if (this.down) throw new AppError('ledger_unavailable', 'O ledger não respondeu.', 502);
    if (this.charged.has(meal.id)) return;
    const balance = this.balances.get(meal.accountId) ?? 0n;
    if (balance < meal.priceCents) throw new AppError('insufficient_thaler', 'THALER insuficiente.', 409);
    this.balances.set(meal.accountId, balance - meal.priceCents);
    this.charged.set(meal.id, meal.priceCents);
  }
}

describe('regras da refeição', () => {
  const avatar = newAvatar({ id: randomUUID(), accountId: randomUUID(), rarity: 'common', jobCode: 'padeiro' }, new Date());

  it('o seed tem os 17 alimentos do GDD, sem preço ainda', () => {
    expect(SEED_FOODS).toHaveLength(17);
    expect(food('maca')).toMatchObject({ energy: 3, health: 1, pack: 5, price: null });
  });

  it('sem preço no catálogo, a unidade custa 4 THALER; com preço, o pacote dividido', () => {
    expect(unitPriceCents(food('maca')!)).toBe(DEFAULT_UNIT_PRICE_CENTS);
    expect(unitPriceCents({ ...food('maca')!, price: 10 })).toBe(200n);
    expect(unitPriceCents({ ...food('ovos')!, price: 10 })).toBe(333n);
  });

  it('avatar satisfeito não come; alimento inexistente é 404', () => {
    const now = new Date();
    expect(() => planMeal(avatar, { id: randomUUID(), foodCode: 'maca', clientKey: null }, now)).toThrow(/satisfeito/);
    const hungry = { ...avatar, attributes: { ...avatar.attributes, food: 4 } };
    expect(() => planMeal(hungry, { id: randomUUID(), foodCode: 'pizza', clientKey: null }, now)).toThrow(/não existe/);
  });

  it('os efeitos somam e ficam entre 0 e 10', () => {
    const tired = { ...avatar, attributes: { ...avatar.attributes, food: 9, energy: 8, health: 0 } };
    const after = eat(tired, { food: 3, energy: 3, health: -1 }, new Date());
    expect(after.attributes).toMatchObject({ food: 10, energy: 10, health: 0 });
  });
});

describe('cobrança no ledger', () => {
  it('manda o THALER do jogador para a queima, com a chave da refeição', async () => {
    const calls: { headers: Record<string, string>; body: { kind: string; legs: unknown[] } }[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      calls.push({ headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
      return new Response('{}', { status: 201 });
    }) as typeof fetch;
    const meal = { id: randomUUID(), accountId: randomUUID(), priceCents: 400n } as Meal;
    await new EconomyPayer('http://economy', 'token', fetchFn).chargeMeal(meal, 'req-1');
    expect(calls[0]!.headers['idempotency-key']).toBe(`meal:${meal.id}`);
    expect(calls[0]!.headers['x-request-id']).toBe('req-1');
    expect(calls[0]!.body.kind).toBe('meal_buy');
    expect(calls[0]!.body.legs).toEqual([
      { owner_type: 'player', owner_id: meal.accountId, currency: 'THALER', amount: '-400' },
      { owner_type: 'burn', owner_id: 'food', currency: 'THALER', amount: '400' },
    ]);
  });

  it('saldo insuficiente no ledger vira 409 insufficient_thaler', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ error: { code: 'insufficient_funds' } }), { status: 409 })) as unknown as typeof fetch;
    const payer = new EconomyPayer('http://economy', 'token', fetchFn);
    await expect(payer.chargeMeal({ id: randomUUID(), accountId: randomUUID(), priceCents: 400n } as Meal)).rejects.toMatchObject({
      code: 'insufficient_thaler',
      status: 409,
    });
  });
});

describe('API do mercado', () => {
  let clock: Date;
  let ledger: FakeLedger;
  let store: MemoryAvatarStore;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    clock = new Date('2026-11-12T12:00:00Z');
    ledger = new FakeLedger();
    store = new MemoryAvatarStore();
    app = await buildApp(config, store, () => clock, null, ledger);
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

  /** Avatar com fome: 24 h depois de nascer, alimentação em 5. */
  const hungryAvatar = async (account: string) => {
    const r = await app.inject({
      method: 'POST',
      url: '/internal/v1/avatars',
      headers: { 'x-service-token': INTERNAL },
      payload: { account_id: account, rarity: 'common', job_code: 'padeiro' },
    });
    clock = new Date(clock.getTime() + 24 * HOUR);
    return r.json().avatar.id as string;
  };

  const eatIt = async (account: string, id: string, foodCode: string, key?: string) =>
    app.inject({
      method: 'POST',
      url: `/v1/avatars/${id}/meals`,
      headers: { ...(await auth(account)), ...(key ? { 'idempotency-key': key } : {}) },
      payload: { food: foodCode },
    });

  it('lista os alimentos com o preço provisório', async () => {
    const r = await app.inject({ url: '/v1/catalog/foods' });
    const maca = r.json().foods.find((f: { code: string }) => f.code === 'maca');
    expect(maca).toMatchObject({ price: '400', decimals: 2, energy: 3, health: 1, food: 3, provisional_price: true });
  });

  it('come: cobra 4 THALER e sobe alimentação, energia e saúde', async () => {
    const account = randomUUID();
    ledger.balances.set(account, 1000n);
    const id = await hungryAvatar(account);
    const r = await eatIt(account, id, 'maca');
    expect(r.statusCode).toBe(201);
    expect(r.json().meal).toMatchObject({ food: 'maca', status: 'eaten', price: '400' });
    expect(r.json().avatar.attributes).toMatchObject({ food: 8, energy: 10, health: 10 });
    expect(ledger.balances.get(account)).toBe(600n);
  });

  it('sem THALER é 409 e nada muda; a refeição fica como failed', async () => {
    const account = randomUUID();
    const id = await hungryAvatar(account);
    const r = await eatIt(account, id, 'maca');
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('insufficient_thaler');
    const avatar = await app.inject({ url: `/v1/avatars/${id}`, headers: await auth(account) });
    expect(avatar.json().avatar.attributes.food).toBe(5);
    const meals = await app.inject({ url: `/v1/avatars/${id}/meals`, headers: await auth(account) });
    expect(meals.json().meals.map((m: { status: string }) => m.status)).toEqual(['failed']);
  });

  it('satisfeito é 409 not_hungry, sem cobrar', async () => {
    const account = randomUUID();
    ledger.balances.set(account, 1000n);
    const r = await app.inject({
      method: 'POST',
      url: '/internal/v1/avatars',
      headers: { 'x-service-token': INTERNAL },
      payload: { account_id: account, rarity: 'common', job_code: 'padeiro' },
    });
    const full = await eatIt(account, r.json().avatar.id, 'maca');
    expect(full.statusCode).toBe(409);
    expect(full.json().error.code).toBe('not_hungry');
    expect(ledger.balances.get(account)).toBe(1000n);
  });

  it('a mesma Idempotency-Key devolve a mesma refeição e cobra uma vez', async () => {
    const account = randomUUID();
    ledger.balances.set(account, 1000n);
    const id = await hungryAvatar(account);
    const first = await eatIt(account, id, 'maca', 'chave-refeicao-1');
    const again = await eatIt(account, id, 'maca', 'chave-refeicao-1');
    expect(again.json().meal.id).toBe(first.json().meal.id);
    expect(ledger.balances.get(account)).toBe(600n);
    expect(again.json().avatar.attributes.food).toBe(8);
  });

  it('ledger fora: a refeição espera e a próxima chamada termina, cobrando uma vez', async () => {
    const account = randomUUID();
    ledger.balances.set(account, 1000n);
    const id = await hungryAvatar(account);
    ledger.down = true;
    expect((await eatIt(account, id, 'maca')).statusCode).toBe(502);
    ledger.down = false;
    const meals = await app.inject({ url: `/v1/avatars/${id}/meals`, headers: await auth(account) });
    expect(meals.json().meals.map((m: { status: string }) => m.status)).toEqual(['eaten']);
    expect(ledger.balances.get(account)).toBe(600n);
    const avatar = await app.inject({ url: `/v1/avatars/${id}`, headers: await auth(account) });
    expect(avatar.json().avatar.attributes.food).toBe(8);
  });

  it('avatar de outra conta é 404; sem ledger é 503', async () => {
    const account = randomUUID();
    const id = await hungryAvatar(account);
    expect((await eatIt(randomUUID(), id, 'maca')).statusCode).toBe(404);
    const closed = await buildApp(config, store, () => clock);
    const r = await closed.inject({
      method: 'POST',
      url: `/v1/avatars/${id}/meals`,
      headers: await auth(account),
      payload: { food: 'maca' },
    });
    expect(r.statusCode).toBe(503);
  });
});
