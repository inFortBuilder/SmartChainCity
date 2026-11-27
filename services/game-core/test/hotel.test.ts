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
  type HotelDirectory,
  type PlayerHotel,
  applyStay,
  checkPlayerHotel,
  checkStay,
  hotelSplit,
} from '../src/domain/housing.js';
import { type Meal, type MealPayer, planHousing } from '../src/domain/meal.js';
import { PostgresAvatarStore } from '../src/infra/db/postgres-store.js';
import { EconomyPayer } from '../src/infra/economy-payer.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';
import { WorldHotels } from '../src/infra/world-hotels.js';

/** Hotel de jogador (GDD §6 "Hotel"): a diária do nível vai para o dono (90%), com quartos por nível. */
const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const INTERNAL = 'chave-interna-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: INTERNAL });
const t0 = new Date('2026-11-21T08:00:00Z');
const HOUR = 3_600_000;
const at = (h: number) => new Date(t0.getTime() + h * HOUR);
const OWNER = randomUUID();

const make = (over: Partial<Avatar> = {}): Avatar => ({
  ...newAvatar({ id: randomUUID(), accountId: randomUUID(), rarity: 'common', jobCode: 'padeiro' }, t0),
  ...over,
});
const hotelOf = (over: Partial<PlayerHotel> = {}): PlayerHotel => ({
  id: randomUUID(),
  city: 'pittsburg',
  label: 'Hotel',
  level: 2,
  rooms: 2,
  lotCode: 'PIT-000123',
  open: true,
  ownerAccountId: OWNER,
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

describe('regras do hotel de jogador', () => {
  it('aberto, não é do próprio e com quarto livre; quem já está estende', () => {
    const h = hotelOf();
    expect(code(() => checkPlayerHotel(null, 'x', 0, false))).toBe('hotel_not_found');
    expect(code(() => checkPlayerHotel(hotelOf({ open: false }), 'x', 0, false))).toBe('hotel_closed');
    expect(code(() => checkPlayerHotel(h, OWNER, 0, false))).toBe('own_hotel');
    expect(code(() => checkPlayerHotel(h, 'x', 2, false))).toBe('hotel_full');
    expect(checkPlayerHotel(h, 'x', 2, true)).toBe(h);
    expect(checkPlayerHotel(h, 'x', 1, false)).toBe(h);
  });

  it('a estadia guarda o hotel; o mesmo hotel estende, outro hotel exige sair', () => {
    const h = hotelOf();
    const effect = { kind: 'hotel' as const, level: 2, days: 2, hotel: { id: h.id, ownerAccountId: OWNER } };
    const a = applyStay(make(), effect, t0);
    expect(a.housing).toMatchObject({ kind: 'hotel', level: 2, hotelId: h.id });
    expect(applyStay(a, effect, at(1)).housing!.until).toEqual(new Date(t0.getTime() + 4 * DAY_MS));
    // O hotel do jogo no mesmo nível é outra estadia.
    expect(code(() => checkStay(a, { kind: 'hotel', level: 2, days: 1 }, at(1)))).toBe('housing_active');
    expect(code(() => checkStay(a, { ...effect, hotel: { id: randomUUID(), ownerAccountId: OWNER } }, at(1)))).toBe('housing_active');
    expect(checkStay(a, effect, at(1)).cents).toBe(80_00n);
  });

  it('ledger: 90% ao dono e 10% de taxa (queima)', async () => {
    expect(hotelSplit(40_00n)).toEqual({ owner: 36_00n, burn: 4_00n });
    const bodies: { kind: string; legs: { owner_type: string; owner_id: string; amount: string }[] }[] = [];
    const payer = new EconomyPayer('http://economy', 'token', (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response('{}', { status: 201 });
    }) as typeof fetch);
    const a = make();
    const effect = { kind: 'hotel' as const, level: 2, days: 1, hotel: { id: randomUUID(), ownerAccountId: OWNER } };
    await payer.chargeMeal(planHousing(a, { id: randomUUID(), clientKey: null, effect, cents: 40_00n }, t0));
    expect(bodies[0]).toMatchObject({
      kind: 'hotel_fee',
      legs: [
        { owner_type: 'player', owner_id: a.accountId, amount: '-4000' },
        { owner_type: 'player', owner_id: OWNER, amount: '3600' },
        { owner_type: 'burn', owner_id: 'hotel', amount: '400' },
      ],
    });
  });

  it('o cliente do world lê o hotel e a lista; 404 vira null', async () => {
    const h = hotelOf();
    const json = { id: h.id, city: h.city, label: h.label, level: 2, rooms: 2, lot_code: h.lotCode, open: true, owner_account_id: OWNER };
    const urls: string[] = [];
    const world = new WorldHotels('http://world/', 'x'.repeat(32), (async (url: string) => {
      urls.push(url);
      if (url.endsWith('/nada')) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify(url.includes('/cities/') ? { hotels: [json] } : { hotel: json }), { status: 200 });
    }) as typeof fetch);
    expect(await world.hotel(h.id)).toEqual(h);
    expect(await world.hotels('pittsburg')).toEqual([h]);
    expect(await world.hotel('nada')).toBeNull();
    expect(urls[0]).toBe(`http://world/internal/v1/hotels/${h.id}`);
  });
});

class FakeLedger implements MealPayer {
  balances = new Map<string, bigint>();
  charged: Meal[] = [];
  async chargeMeal(meal: Meal) {
    const balance = this.balances.get(meal.accountId) ?? 0n;
    if (balance < meal.priceCents) throw new AppError('insufficient_thaler', 'THALER insuficiente.', 409);
    this.balances.set(meal.accountId, balance - meal.priceCents);
    this.charged.push(meal);
  }
}

class FakeHotels implements HotelDirectory {
  list: PlayerHotel[] = [];
  async hotel(id: string) {
    return this.list.find((h) => h.id === id) ?? null;
  }
  async hotels(city: string) {
    return this.list.filter((h) => h.city === city);
  }
}

describe('API do hotel de jogador', () => {
  let ledger: FakeLedger;
  let hotels: FakeHotels;
  let store: MemoryAvatarStore;
  let clock: Date;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    ledger = new FakeLedger();
    hotels = new FakeHotels();
    store = new MemoryAvatarStore();
    clock = t0;
    app = await buildApp(config, store, () => clock, null, ledger, null, () => 0.5, null, null, null, null, null, null, null, null, hotels);
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
  const checkIn = async (a: Avatar, hotelId: string, days = 1) =>
    app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/housing`, headers: await auth(a.accountId), payload: { kind: 'hotel', days, hotel_id: hotelId } });

  it('hospeda pelo nível do hotel, enche os quartos e mostra a lotação', async () => {
    const h = hotelOf({ rooms: 2, level: 2 });
    hotels.list.push(h);
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => store.create(make())));
    for (const x of [a!, b!, c!]) ledger.balances.set(x.accountId, 500_00n);

    const first = await checkIn(a!, h.id, 2);
    expect(first.statusCode).toBe(201);
    // O nível vem do hotel (2: 40/dia, 2 refeições), não do corpo.
    expect(first.json().purchase).toMatchObject({ price: '8000', status: 'eaten' });
    expect(first.json().housing).toMatchObject({ factor: 1, stay: { kind: 'hotel', level: 2, hotel_id: h.id, meals_left_today: 2 } });
    expect(ledger.charged[0]!.effects.housing).toMatchObject({ hotel: { id: h.id, ownerAccountId: OWNER } });

    expect((await checkIn(b!, h.id)).statusCode).toBe(201);
    expect((await checkIn(c!, h.id)).json().error.code).toBe('hotel_full');
    // Quem já está estende, mesmo com o hotel cheio.
    expect((await checkIn(a!, h.id)).statusCode).toBe(201);

    const list = (await app.inject({ url: '/v1/housing/hotels?city=pittsburg' })).json();
    expect(list).toMatchObject({ world_on: true, hotels: [{ id: h.id, level: 2, rooms: 2, guests: 2, cents_per_day: '4000', meals_per_day: 2, mine: false }] });
    const mine = (await app.inject({ url: '/v1/housing/hotels?city=pittsburg', headers: await auth(OWNER) })).json();
    expect(mine.hotels[0].mine).toBe(true);

    // Saiu: o quarto libera.
    await app.inject({ method: 'DELETE', url: `/v1/avatars/${b!.id}/housing`, headers: await auth(b!.accountId) });
    expect((await checkIn(c!, h.id)).statusCode).toBe(201);
  });

  it('não se hospeda no próprio hotel nem no fechado; hotel de jogador é estadia de hotel', async () => {
    const h = hotelOf();
    const closed = hotelOf({ open: false });
    hotels.list.push(h, closed);
    const own = await store.create({ ...make(), accountId: OWNER });
    ledger.balances.set(OWNER, 500_00n);
    expect((await checkIn(own, h.id)).json().error.code).toBe('own_hotel');
    const guest = await store.create(make());
    ledger.balances.set(guest.accountId, 500_00n);
    expect((await checkIn(guest, closed.id)).json().error.code).toBe('hotel_closed');
    expect((await checkIn(guest, randomUUID())).json().error.code).toBe('hotel_not_found');
    const rent = await app.inject({
      method: 'POST',
      url: `/v1/avatars/${guest.id}/housing`,
      headers: await auth(guest.accountId),
      payload: { kind: 'aluguel', days: 1, hotel_id: h.id },
    });
    expect(rent.json().error.code).toBe('invalid_stay');
    expect(ledger.charged).toEqual([]);
  });

  it('sem o world, a lista vem vazia e a estadia no hotel de jogador responde 503', async () => {
    const off = await buildApp(config, store, () => clock, null, ledger, null, () => 0.5);
    expect((await off.inject({ url: '/v1/housing/hotels?city=pittsburg' })).json()).toEqual({ hotels: [], world_on: false });
    const a = await store.create(make());
    const r = await off.inject({
      method: 'POST',
      url: `/v1/avatars/${a.id}/housing`,
      headers: await auth(a.accountId),
      payload: { kind: 'hotel', days: 1, hotel_id: randomUUID() },
    });
    expect(r.json().error.code).toBe('hotels_unavailable');
  });
});

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 3 }) : null;
afterAll(() => pool?.end());

describe.skipIf(!pool)('hotel de jogador no Postgres', () => {
  it('grava o hotel na estadia e conta os hóspedes em curso', async () => {
    const store = new PostgresAvatarStore(pool!);
    const hotelId = randomUUID();
    const effect = { kind: 'hotel' as const, level: 1, days: 1, hotel: { id: hotelId, ownerAccountId: OWNER } };
    for (let k = 0; k < 2; k++) {
      const a = await store.create(make());
      const meal = await store.beginMeal(a.id, a.accountId, null, t0, (current) => {
        const { cents } = checkStay(current, effect, t0);
        return planHousing(current, { id: randomUUID(), clientKey: null, effect, cents }, t0);
      });
      await store.finishMeal(meal.id, t0);
      expect((await store.get(a.id))!.housing).toMatchObject({ hotelId });
    }
    expect(await store.hotelGuests(hotelId, at(1))).toBe(2);
    expect(await store.hotelGuests(hotelId, at(25))).toBe(0);
    expect(await store.hotelGuests(randomUUID(), at(1))).toBe(0);
  });
});
