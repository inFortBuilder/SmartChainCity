import { randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { type Avatar, newAvatar } from '../src/domain/avatar.js';
import {
  DAY_MS,
  type HomeDirectory,
  applyStay,
  checkStay,
  hotelMeal,
  housingFactor,
  leaveStay,
  rentSplit,
} from '../src/domain/housing.js';
import { type Meal, type MealPayer, planHousing } from '../src/domain/meal.js';
import { settle, startShift } from '../src/domain/shift.js';
import { PostgresAvatarStore } from '../src/infra/db/postgres-store.js';
import { EconomyPayer } from '../src/infra/economy-payer.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';
import { WorldHomes } from '../src/infra/world-homes.js';

/** Moradia do avatar (doc 04 §4): casa própria regular, aluguel ou hotel; sem nenhum, o turno rende 50%. */
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

describe('regras da moradia', () => {
  it('preços: aluguel 15/dia; hotel 25, 40 e 60/dia; de 1 a 30 dias', () => {
    const a = make();
    expect(checkStay(a, { kind: 'aluguel', level: 1, days: 7 }, t0).cents).toBe(105_00n);
    expect(checkStay(a, { kind: 'hotel', level: 3, days: 2 }, t0).cents).toBe(120_00n);
    expect(code(() => checkStay(a, { kind: 'hotel', level: 4, days: 1 }, t0))).toBe('invalid_stay');
    expect(code(() => checkStay(a, { kind: 'aluguel', level: 1, days: 31 }, t0))).toBe('invalid_stay');
    expect(code(() => checkStay(a, { kind: 'aluguel', level: 1, days: 0 }, t0))).toBe('invalid_stay');
    expect(code(() => checkStay(make({ hospitalUntil: at(2) }), { kind: 'aluguel', level: 1, days: 1 }, t0))).toBe('in_hospital');
  });

  it('a mesma estadia estende; outra exige sair antes; até 30 dias adiantados', () => {
    const rented = applyStay(make(), { kind: 'aluguel', level: 1, days: 10 }, t0);
    expect(rented.housing).toMatchObject({ kind: 'aluguel', level: 1, since: t0, until: new Date(t0.getTime() + 10 * DAY_MS) });
    const longer = applyStay(rented, { kind: 'aluguel', level: 1, days: 5 }, at(24));
    expect(longer.housing).toMatchObject({ since: t0, until: new Date(t0.getTime() + 15 * DAY_MS) });
    expect(code(() => checkStay(longer, { kind: 'hotel', level: 1, days: 1 }, at(24)))).toBe('housing_active');
    expect(code(() => checkStay(longer, { kind: 'aluguel', level: 1, days: 20 }, at(24)))).toBe('housing_prepaid');
    const left = leaveStay(longer, at(30));
    expect(left.housing!.until).toEqual(at(30));
    expect(code(() => leaveStay(left, at(31)))).toBe('not_staying');
    // Fora, pode trocar pelo hotel, que começa agora.
    expect(applyStay(left, { kind: 'hotel', level: 2, days: 1 }, at(31)).housing).toMatchObject({ kind: 'hotel', level: 2, since: at(31) });
  });

  it('fator do turno: 1 com casa própria regular ou estadia em curso; 0,5 sem', () => {
    const a = make();
    expect(housingFactor(a, false, t0)).toBe(0.5);
    expect(housingFactor(a, true, t0)).toBe(1);
    const rented = applyStay(a, { kind: 'aluguel', level: 1, days: 1 }, t0);
    expect(housingFactor(rented, false, at(23))).toBe(1);
    expect(housingFactor(rented, false, at(24))).toBe(0.5);
  });

  it('o turno sem moradia rende metade; turnos antigos (sem o campo) não mudam', () => {
    const a = make();
    const seed = 'ab'.repeat(32);
    const full = startShift(a, { id: randomUUID(), hours: 6, hoursToday: 0, running: false, seed, housing: 1 }, t0).shift;
    const half = { ...full, snapshot: { ...full.snapshot, housing: 0.5 } };
    const old = { ...full, snapshot: { ...full.snapshot, housing: undefined } };
    expect(settle(half).thalerCents * 2n).toBeLessThanOrEqual(settle(full).thalerCents + 1n);
    expect(settle(half).thalerCents * 2n).toBeGreaterThanOrEqual(settle(full).thalerCents - 1n);
    expect(settle(half).factors.housing).toBe(0.5);
    expect(settle(old).thalerCents).toBe(settle(full).thalerCents);
    expect(settle(old).factors.housing).toBeUndefined();
  });

  it('hotel inclui 1, 2 ou 3 refeições por dia, pelo nível', () => {
    let a = applyStay(make({ attributes: { ...make().attributes, food: 2 } }), { kind: 'hotel', level: 2, days: 3 }, t0);
    a = hotelMeal(a, at(1));
    expect(a.attributes.food).toBe(5);
    a = hotelMeal(a, at(2));
    expect(code(() => hotelMeal(a, at(3)))).toBe('hotel_meals_used');
    // No dia seguinte (UTC), de novo.
    expect(hotelMeal(a, at(17)).attributes.food).toBe(10);
    expect(code(() => hotelMeal(applyStay(make(), { kind: 'aluguel', level: 1, days: 1 }, t0), at(1)))).toBe('not_in_hotel');
  });

  it('ledger: aluguel 40% queima e 60% de volta ao pool P2E; hotel é queima', async () => {
    expect(rentSplit(1500n)).toEqual({ burn: 600n, pool: 900n });
    const bodies: { kind: string; legs: { owner_type: string; owner_id: string; amount: string }[] }[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response('{}', { status: 201 });
    }) as typeof fetch;
    const payer = new EconomyPayer('http://economy', 'token', fetchFn);
    const a = make();
    await payer.chargeMeal(planHousing(a, { id: randomUUID(), clientKey: null, effect: { kind: 'aluguel', level: 1, days: 1 }, cents: 15_00n }, t0));
    await payer.chargeMeal(planHousing(a, { id: randomUUID(), clientKey: null, effect: { kind: 'hotel', level: 2, days: 1 }, cents: 40_00n }, t0));
    expect(bodies[0]).toMatchObject({
      kind: 'rent_fee',
      legs: [{ amount: '-1500' }, { owner_type: 'burn', owner_id: 'rent', amount: '600' }, { owner_type: 'pool', owner_id: 'p2e', amount: '900' }],
    });
    expect(bodies[1]).toMatchObject({ kind: 'hotel_fee', legs: [{ amount: '-4000' }, { owner_type: 'burn', owner_id: 'hotel', amount: '4000' }] });
  });

  it('o cliente do world lê as casas e falha com world_unavailable', async () => {
    const ok = new WorldHomes('http://world', 'x'.repeat(32), (async () =>
      new Response(JSON.stringify({ homes: [{ id: 'c1', label: 'Casa T1', regular: true, regular_until: t0.toISOString() }] }), {
        status: 200,
      })) as typeof fetch);
    expect(await ok.homes(randomUUID())).toEqual([{ id: 'c1', label: 'Casa T1', regular: true, regularUntil: t0 }]);
    const down = new WorldHomes('http://world', 'x'.repeat(32), (async () => {
      throw new Error('fora');
    }) as typeof fetch);
    await expect(down.homes(randomUUID())).rejects.toMatchObject({ code: 'world_unavailable' });
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

class FakeHomes implements HomeDirectory {
  regular = new Set<string>();
  down = false;
  async homes(accountId: string) {
    if (this.down) throw new AppError('world_unavailable', 'O world não respondeu.', 503);
    return this.regular.has(accountId) ? [{ id: 'casa', label: 'Casa T1', regular: true, regularUntil: at(720) }] : [];
  }
}

describe('API da moradia', () => {
  let ledger: FakeLedger;
  let homes: FakeHomes;
  let store: MemoryAvatarStore;
  let clock: Date;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    ledger = new FakeLedger();
    homes = new FakeHomes();
    store = new MemoryAvatarStore();
    clock = t0;
    app = await buildApp(
      config,
      store,
      () => clock,
      null,
      ledger,
      null,
      () => 0.5,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      homes,
    );
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

  const work = async (a: Avatar, h: Record<string, string>) => {
    const r = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/work`, headers: h, payload: { shift: 6 } });
    expect(r.statusCode).toBe(201);
    return (await store.listShifts(a.id, 1))[0]!.snapshot.housing;
  };

  it('sem moradia o turno leva 0,5; com aluguel, 1; o hotel cobra e dá refeição', async () => {
    // Com cama: dois turnos de 6 h no mesmo dia (GDD §3.2).
    const a = await store.create(make({ gear: { clothes: 0, tool: null, bed: true } }));
    ledger.balances.set(a.accountId, 200_00n);
    const h = await auth(a.accountId);

    const view = (await app.inject({ url: `/v1/avatars/${a.id}/housing`, headers: h })).json();
    expect(view).toMatchObject({ factor: 0.5, stay: null, own_homes: [], world_on: true, prices: { aluguel: { cents_per_day: '1500' } } });
    expect(await work(a, h)).toBe(0.5);

    clock = at(7);
    const rent = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/housing`, headers: h, payload: { kind: 'aluguel', days: 2 } });
    expect(rent.statusCode).toBe(201);
    expect(rent.json().purchase).toMatchObject({ price: '3000', status: 'eaten' });
    expect(rent.json().housing).toMatchObject({ factor: 1, stay: { kind: 'aluguel', level: 1, until: at(55).toISOString() } });
    expect(rent.json().avatar.housing).toMatchObject({ kind: 'aluguel' });
    expect(ledger.balances.get(a.accountId)).toBe(170_00n);
    expect(await work(a, h)).toBe(1);

    const other = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/housing`, headers: h, payload: { kind: 'hotel', level: 1, days: 1 } });
    expect(other.json().error.code).toBe('housing_active');
    const out = await app.inject({ method: 'DELETE', url: `/v1/avatars/${a.id}/housing`, headers: h });
    expect(out.json().housing).toMatchObject({ factor: 0.5, stay: null });

    const hotel = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/housing`, headers: h, payload: { kind: 'hotel', level: 1, days: 1 } });
    expect(hotel.json().housing.stay).toMatchObject({ kind: 'hotel', level: 1, meals_left_today: 1 });
    // A alimentação já caiu desde t0: a refeição incluída entra, e a do nível 1 é uma por dia.
    const meal = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/housing/meal`, headers: h });
    expect(meal.statusCode).toBe(200);
    expect(meal.json().avatar.housing).toMatchObject({ meals_left_today: 0 });
    const second = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/housing/meal`, headers: h });
    expect(second.json().error.code).toBe('hotel_meals_used');

    const poor = await store.create(make());
    const no = await app.inject({ method: 'POST', url: `/v1/avatars/${poor.id}/housing`, headers: await auth(poor.accountId), payload: { kind: 'hotel', level: 3, days: 1 } });
    expect(no.statusCode).toBe(409);
    expect(no.json().error.code).toBe('insufficient_thaler');
  });

  it('casa própria regular vale 1; com o world fora, o turno não perde o fator', async () => {
    const a = await store.create(make());
    const h = await auth(a.accountId);
    homes.regular.add(a.accountId);
    const view = (await app.inject({ url: `/v1/avatars/${a.id}/housing`, headers: h })).json();
    expect(view).toMatchObject({ factor: 1, own_homes: [{ id: 'casa', regular: true }] });
    expect(await work(a, h)).toBe(1);

    const b = await store.create(make());
    homes.down = true;
    expect(await work(b, await auth(b.accountId))).toBe(1);
  });
});

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 5 }) : null;
afterAll(() => pool?.end());

describe.skipIf(!pool)('moradia no Postgres', () => {
  it('grava a estadia com as datas e as refeições do hotel', async () => {
    const store = new PostgresAvatarStore(pool!);
    const a = await store.create(make());
    const meal = await store.beginMeal(a.id, a.accountId, null, t0, (current) => {
      const effect = { kind: 'hotel' as const, level: 2, days: 3 };
      const { cents } = checkStay(current, effect, t0);
      return planHousing(current, { id: randomUUID(), clientKey: null, effect, cents }, t0);
    });
    await store.finishMeal(meal.id, t0);
    const back = (await store.get(a.id))!;
    expect(back.housing).toMatchObject({ kind: 'hotel', level: 2, since: t0, until: new Date(t0.getTime() + 3 * DAY_MS) });
    const fed = await store.updateAvatar(a.id, a.accountId, at(30), (x) => hotelMeal({ ...x, attributes: { ...x.attributes, food: 1 } }, at(30)));
    expect(fed.housing).toMatchObject({ mealsUsed: 1 });
    expect((await store.get(a.id))!.housing).toMatchObject({ mealsDay: at(30).toISOString().slice(0, 10), mealsUsed: 1 });
  });
});

describe('unidade alugada de prédio (world, E3.11)', () => {
  it('vale só para o avatar inquilino; os outros da conta seguem sem moradia', async () => {
    const store = new MemoryAvatarStore();
    const owner = randomUUID();
    const tenant = await store.create({ ...make(), accountId: owner });
    const other = await store.create({ ...make(), accountId: owner });
    const homes: HomeDirectory = {
      homes: async () => [{ id: 'unidade', label: 'Apartamento 0301', regular: true, regularUntil: at(48), avatarId: tenant.id, lease: true }],
    };
    const app = await buildApp(config, store, () => t0, null, null, null, () => 0.5, null, null, null, null, null, null, null, homes);
    const h = {
      authorization: `Bearer ${await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(owner)
        .setIssuer('scc-gateway')
        .setAudience('scc-api')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(new TextEncoder().encode(SECRET))}`,
    };
    const mine = (await app.inject({ url: `/v1/avatars/${tenant.id}/housing`, headers: h })).json();
    expect(mine).toMatchObject({ factor: 1, own_homes: [{ id: 'unidade', lease: true }] });
    const theirs = (await app.inject({ url: `/v1/avatars/${other.id}/housing`, headers: h })).json();
    expect(theirs).toMatchObject({ factor: 0.5, own_homes: [] });
  });
});
