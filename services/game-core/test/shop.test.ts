import { randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { type Avatar, newAvatar } from '../src/domain/avatar.js';
import { type Meal, type MealPayer, planShop } from '../src/domain/meal.js';
import { applyShop, checkShop, gearFactor } from '../src/domain/shop.js';
import { settle, startShift } from '../src/domain/shift.js';
import { PostgresAvatarStore } from '../src/infra/db/postgres-store.js';
import { EconomyPayer } from '../src/infra/economy-payer.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';

/** Loja do jogo (GDD §6 "Lojas" e §3.2): roupas, ferramenta de trabalho e cama. */
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
const buy = (a: Avatar, item: string, level?: number, when = t0) => applyShop(a, checkShop(a, { item, level }, when).effect, when);

describe('regras da loja', () => {
  it('roupas: +10/15/20%, vale a melhor, sem comprar igual ou pior', () => {
    expect(checkShop(make(), { item: 'roupa', level: 2 }, t0).cents).toBe(800_00n);
    const a = buy(make(), 'roupa', 2);
    expect(gearFactor(a, t0)).toBe(1.15);
    expect(code(() => checkShop(a, { item: 'roupa', level: 1 }, t0))).toBe('already_owned');
    expect(gearFactor(buy(a, 'roupa', 3), t0)).toBe(1.2);
    expect(code(() => checkShop(a, { item: 'roupa', level: 4 }, t0))).toBe('invalid_item');
    expect(code(() => checkShop(a, { item: 'chapeu' }, t0))).toBe('invalid_item');
  });

  it('ferramenta: +30% por 3 dias, da profissão da compra; estende até 6 dias', () => {
    const a = buy(make(), 'ferramenta');
    expect(gearFactor(a, at(1))).toBe(1.3);
    expect(gearFactor(a, at(72))).toBe(1);
    expect(gearFactor({ ...a, jobCode: 'pedreiro' }, at(1))).toBe(1);
    const twice = buy(a, 'ferramenta', undefined, at(1));
    expect(twice.gear!.tool!.until).toEqual(at(144));
    expect(code(() => checkShop(twice, { item: 'ferramenta' }, at(2)))).toBe('already_owned');
    expect(gearFactor(buy(buy(make(), 'roupa', 1), 'ferramenta'), t0)).toBe(1.43);
  });

  it('cama: uma só; sem ela, o segundo turno de 6 h no dia é recusado', () => {
    const a = make();
    const begin = (av: Avatar, bed: boolean) => startShift(av, { id: randomUUID(), hours: 6, hoursToday: 6, running: false, bed }, at(7));
    expect(code(() => begin(a, false))).toBe('bed_required');
    expect(code(() => begin(a, true))).toBeNull();
    const withBed = buy(a, 'cama');
    expect(withBed.gear!.bed).toBe(true);
    expect(code(() => checkShop(withBed, { item: 'cama' }, t0))).toBe('already_owned');
    // Turno de 12 h e o primeiro de 6 h não pedem cama.
    expect(code(() => startShift(a, { id: randomUUID(), hours: 6, hoursToday: 0, running: false, bed: false }, t0))).toBeNull();
  });

  it('o bônus da loja multiplica os itens sazonais no ganho', () => {
    const a = make();
    const seed = 'ef'.repeat(32);
    const id = randomUUID();
    const plain = startShift(a, { id, hours: 6, hoursToday: 0, running: false, seed, earnBonus: 0.05 }, t0).shift;
    const dressed = startShift(a, { id, hours: 6, hoursToday: 0, running: false, seed, earnBonus: 0.05, gear: 1.2 }, t0).shift;
    expect(dressed.snapshot.items).toBe(1.26);
    expect(Number(settle(dressed).thalerCents)).toBeCloseTo((Number(settle(plain).thalerCents) * 1.26) / 1.05, -1);
  });

  it('o ledger lança como shop_buy, para a queima da loja', async () => {
    const bodies: { kind: string; legs: { owner_id: string; amount: string }[] }[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response('{}', { status: 201 });
    }) as typeof fetch;
    const a = make();
    const { cents, effect } = checkShop(a, { item: 'cama' }, t0);
    await new EconomyPayer('http://economy', 'token', fetchFn).chargeMeal(planShop(a, { id: randomUUID(), clientKey: null, effect, cents }, t0));
    expect(bodies[0]).toMatchObject({ kind: 'shop_buy', legs: [{ amount: '-25000' }, { owner_id: 'shop', amount: '25000' }] });
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

describe('API da loja', () => {
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

  it('compra roupa e ferramenta, e o turno leva o bônus; sem saldo, nada muda', async () => {
    const a = await store.create(make());
    ledger.balances.set(a.accountId, 400_00n);
    const h = await auth(a.accountId);
    expect((await app.inject({ url: '/v1/catalog/shop' })).json()).toMatchObject({ bed: { price: '25000' }, tool: { bonus: 0.3, days: 3 } });

    const roupa = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/shop`, headers: h, payload: { item: 'roupa', level: 1 } });
    expect(roupa.statusCode).toBe(201);
    expect(roupa.json().purchase).toMatchObject({ price: '30000', status: 'eaten' });
    const tool = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/shop`, headers: h, payload: { item: 'ferramenta' } });
    expect(tool.json().avatar.gear).toMatchObject({ clothes: 1, tool: { job: 'padeiro', active: true }, bed: false, factor: 1.43 });
    expect(ledger.balances.get(a.accountId)).toBe(50_00n);

    const work = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/work`, headers: h, payload: { shift: 6 } });
    expect(work.statusCode).toBe(201);
    expect((await store.listShifts(a.id, 1))[0]!.snapshot.items).toBe(1.43);

    const bed = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/shop`, headers: h, payload: { item: 'cama' } });
    expect(bed.json().error.code).toBe('insufficient_thaler');
    expect((await store.get(a.id))!.gear!.bed).toBe(false);
  });
});

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 5 }) : null;
afterAll(() => pool?.end());

describe.skipIf(!pool)('loja no Postgres', () => {
  it('grava os itens com a data da ferramenta', async () => {
    const store = new PostgresAvatarStore(pool!);
    const a = await store.create(make());
    for (const item of ['roupa', 'ferramenta', 'cama'] as const) {
      const meal = await store.beginMeal(a.id, a.accountId, null, t0, (current) => {
        const { cents, effect } = checkShop(current, { item, level: item === 'roupa' ? 3 : undefined }, t0);
        return planShop(current, { id: randomUUID(), clientKey: null, effect, cents }, t0);
      });
      await store.finishMeal(meal.id, t0);
    }
    expect((await store.get(a.id))!.gear).toEqual({ clothes: 3, tool: { job: 'padeiro', until: at(72) }, bed: true });
  });
});
