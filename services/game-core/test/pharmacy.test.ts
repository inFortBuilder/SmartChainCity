import { randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { type Avatar, type AvatarStore, newAvatar, status } from '../src/domain/avatar.js';
import { type Condition, activeConditions, catchCondition } from '../src/domain/conditions.js';
import { type Meal, type MealPayer, type MealStore, eat, planMeal, planMedicine } from '../src/domain/meal.js';
import { draw, settle, startShift } from '../src/domain/shift.js';
import { PostgresAvatarStore } from '../src/infra/db/postgres-store.js';
import { EconomyPayer } from '../src/infra/economy-payer.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const INTERNAL = 'chave-interna-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: INTERNAL });
const HOUR = 3_600_000;
const t0 = new Date('2026-11-13T08:00:00Z');
const at = (hours: number) => new Date(t0.getTime() + hours * HOUR);

const make = (conditions: Condition[] = [], attrs: Partial<Avatar['attributes']> = {}): Avatar => {
  const a = newAvatar({ id: randomUUID(), accountId: randomUUID(), rarity: 'common', jobCode: 'padeiro' }, t0);
  return { ...a, attributes: { ...a.attributes, ...attrs }, conditions };
};
const sickWith = (code: Condition['code'], from = t0) => catchCondition([], code, from);

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return null;
};
const shiftOf = (a: Avatar, now = t0) => startShift(a, { id: randomUUID(), hours: 6, hoursToday: 0, running: false }, now);

describe('doenças', () => {
  it('uma de cada tipo por vez, com fim pelo relógio; as passadas saem da lista', () => {
    let list = catchCondition([], 'gripe', t0);
    list = catchCondition(list, 'gripe', at(2));
    expect(list).toHaveLength(1);
    expect(list[0]!.endsAt).toEqual(at(24));
    list = catchCondition(list, 'dor_de_cabeca', at(30));
    expect(list.map((c) => c.code)).toEqual(['dor_de_cabeca']);
    expect(activeConditions(list, at(29))).toHaveLength(0);
    expect(activeConditions(list, at(30))).toHaveLength(1);
  });

  it('gripe e dor de barriga deixam de cama: sem turno até passar', () => {
    for (const c of ['gripe', 'dor_de_barriga'] as const) {
      const a = make(sickWith(c));
      expect(status(a, at(1))).toMatchObject({ canWork: false, canLeisure: false, inHospital: false });
      expect(code(() => shiftOf(a, at(1)))).toBe('sick');
      expect(code(() => shiftOf(a, at(24)))).toBeNull();
    }
  });

  it('dor de cabeça deixa trabalhar com 10% a menos de rendimento', () => {
    const healthy = shiftOf(make()).shift;
    const aching = shiftOf(make(sickWith('dor_de_cabeca'))).shift;
    expect(aching.snapshot.illness).toBe(0.9);
    const seed = { seed: healthy.seed, id: healthy.id };
    const full = settle({ ...healthy, ...seed });
    const less = settle({ ...aching, ...seed });
    expect(less.factors.illness).toBe(0.9);
    expect(Number(less.thalerCents)).toBeCloseTo(Number(full.thalerCents) * 0.9, -1);
  });

  it('turno antigo, sem o fator no snapshot, paga como antes', () => {
    const { shift } = shiftOf(make());
    const { illness: _, ...old } = shift.snapshot;
    expect(settle({ ...shift, snapshot: old }).factors.illness).toBe(1);
  });

  it('gripe e dor de cabeça saem da semente do turno e começam quando ele acaba', () => {
    for (let i = 0; i < 200; i++) {
      const { shift, avatar } = shiftOf(make());
      for (const c of ['gripe', 'dor_de_cabeca'] as const) {
        const caught = avatar.conditions.find((x) => x.code === c);
        expect(Boolean(caught)).toBe(draw(shift.seed, shift.id, c) < (c === 'gripe' ? 0.01 : 0.05));
        if (caught) expect(caught.startsAt).toEqual(shift.endsAt);
      }
    }
  });

  it('dor de barriga em 3% das refeições, aplicada quando o avatar come', () => {
    const hungry = make([], { food: 4 });
    const plan = (roll: number) => planMeal(hungry, { id: randomUUID(), foodCode: 'maca', clientKey: null, roll }, t0);
    expect(plan(0.0299).effects.condition).toBe('dor_de_barriga');
    expect(plan(0.03).effects.condition).toBeUndefined();
    const after = eat(hungry, plan(0).effects, t0);
    expect(after.conditions.map((c) => c.code)).toEqual(['dor_de_barriga']);
  });
});

describe('farmácia', () => {
  const buy = (a: Avatar, condition: string, roll = 0.5, now = at(1)) =>
    planMedicine(a, { id: randomUUID(), condition, clientKey: null, roll }, now);

  it('cura com 70%: abaixo de 0,7 cura, a partir dele não; o remédio custa 10 THALER', () => {
    const a = make(sickWith('gripe'));
    const cured = buy(a, 'gripe', 0.69);
    expect(cured).toMatchObject({ foodCode: 'remedio', priceCents: 1000n, effects: { cure: { code: 'gripe', success: true } } });
    expect(eat(a, cured.effects, at(1)).conditions).toHaveLength(0);
    const failed = buy(a, 'gripe', 0.7);
    expect(failed.effects.cure!.success).toBe(false);
    expect(eat(a, failed.effects, at(1)).conditions).toHaveLength(1);
  });

  it('doença desconhecida é 400; sem a doença é 409; internado não compra', () => {
    expect(code(() => buy(make(), 'peste'))).toBe('invalid_condition');
    expect(code(() => buy(make(), 'gripe'))).toBe('not_sick');
    const interned = { ...make(sickWith('gripe')), hospitalUntil: at(5) };
    expect(code(() => buy(interned, 'gripe'))).toBe('in_hospital');
  });

  it('o ledger manda o THALER para a queima da farmácia', async () => {
    const bodies: { kind: string; legs: { owner_id: string }[] }[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response('{}', { status: 201 });
    }) as typeof fetch;
    await new EconomyPayer('http://economy', 'token', fetchFn).chargeMeal(buy(make(sickWith('gripe')), 'gripe'));
    expect(bodies[0]!.kind).toBe('medicine_buy');
    expect(bodies[0]!.legs[1]!.owner_id).toBe('pharmacy');
  });
});

/** Ledger falso com saldo por conta. */
class FakeLedger implements MealPayer {
  balances = new Map<string, bigint>();
  async chargeMeal(meal: Meal) {
    const balance = this.balances.get(meal.accountId) ?? 0n;
    if (balance < meal.priceCents) throw new AppError('insufficient_thaler', 'THALER insuficiente.', 409);
    this.balances.set(meal.accountId, balance - meal.priceCents);
  }
}

describe('API da farmácia', () => {
  let clock: Date;
  let rolls: number[];
  let ledger: FakeLedger;
  let store: MemoryAvatarStore;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    clock = new Date(t0);
    rolls = [];
    ledger = new FakeLedger();
    store = new MemoryAvatarStore();
    app = await buildApp(config, store, () => clock, null, ledger, null, () => rolls.shift() ?? 0.5);
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

  it('a refeição dá dor de barriga, o avatar não trabalha, o remédio falha e depois cura', async () => {
    const a = await store.create(make([], { food: 4 }));
    ledger.balances.set(a.accountId, 5000n);
    const headers = await auth(a.accountId);

    rolls = [0];
    const meal = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/meals`, headers, payload: { food: 'maca' } });
    expect(meal.json().meal.effects.condition).toBe('dor_de_barriga');
    expect(meal.json().avatar.conditions).toMatchObject([{ code: 'dor_de_barriga', label: 'Dor de barriga', blocks_work: true }]);

    const work = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/work`, headers, payload: { shift: 6 } });
    expect(work.json().error.code).toBe('sick');

    rolls = [0.9];
    let med = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/medicine`, headers, payload: { condition: 'dor_de_barriga' } });
    expect(med.statusCode).toBe(201);
    expect(med.json()).toMatchObject({ cured: false, medicine: { food: 'remedio', price: '1000', status: 'eaten' } });

    rolls = [0.1];
    med = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/medicine`, headers, payload: { condition: 'dor_de_barriga' } });
    expect(med.json().cured).toBe(true);
    expect(med.json().avatar.conditions).toEqual([]);
    expect(ledger.balances.get(a.accountId)).toBe(5000n - 400n - 2000n);

    const again = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/work`, headers, payload: { shift: 6 } });
    expect(again.statusCode).toBe(201);
  });

  it('sem THALER o remédio é 409 e a doença fica', async () => {
    const a = await store.create(make(sickWith('gripe')));
    const headers = await auth(a.accountId);
    const r = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/medicine`, headers, payload: { condition: 'gripe' } });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('insufficient_thaler');
    expect((await store.get(a.id))!.conditions).toHaveLength(1);
  });

  it('a tabela da farmácia é pública', async () => {
    const r = await app.inject({ url: '/v1/catalog/pharmacy' });
    expect(r.json()).toMatchObject({ price: '1000', cure_chance: 0.7, provisional_price: true });
    expect(r.json().conditions.map((c: { code: string }) => c.code)).toEqual(['dor_de_barriga', 'gripe', 'dor_de_cabeca']);
  });
});

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 5 }) : null;
afterAll(() => pool?.end());

describe.each([
  ['memória', () => new MemoryAvatarStore(), true],
  ['postgres', () => new PostgresAvatarStore(pool!), pool !== null],
] as [string, () => AvatarStore & MealStore, boolean][])('doenças no store: %s', (_name, makeStore, enabled) => {
  it.runIf(enabled)('a doença da refeição é gravada no avatar e volta com as datas', async () => {
    const store = makeStore();
    // Futuro distante: os jobs de outros testes no Postgres compartilhado não pegam este avatar.
    const when = new Date(Date.UTC(2095, 0, 1) + Math.floor(Math.random() * 1e9));
    const base = newAvatar({ id: randomUUID(), accountId: randomUUID(), rarity: 'common', jobCode: 'padeiro' }, when);
    const a = await store.create({ ...base, attributes: { ...base.attributes, food: 4 } });
    const meal = await store.beginMeal(a.id, a.accountId, null, when, (current) =>
      planMeal(current, { id: randomUUID(), foodCode: 'maca', clientKey: null, roll: 0 }, when),
    );
    await store.finishMeal(meal.id, when);
    const [c] = (await store.get(a.id))!.conditions;
    expect(c).toEqual({ code: 'dor_de_barriga', startsAt: when, endsAt: new Date(when.getTime() + 24 * HOUR) });
  });
});
