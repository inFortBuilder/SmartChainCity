import { randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { type Avatar, newAvatar } from '../src/domain/avatar.js';
import { type Venue, applyLeisure, checkActivity, feeSplit } from '../src/domain/leisure.js';
import { type Meal, type MealPayer, planLeisure } from '../src/domain/meal.js';
import { PostgresAvatarStore } from '../src/infra/db/postgres-store.js';
import { EconomyPayer } from '../src/infra/economy-payer.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';
import { WorldVenues } from '../src/infra/world-venues.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const INTERNAL = 'chave-interna-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: INTERNAL });
const t0 = new Date('2026-11-21T08:00:00Z');
const HOUR = 3_600_000;
const at = (h: number) => new Date(t0.getTime() + h * HOUR);

const make = (attrs: Partial<Avatar['attributes']> = {}): Avatar => {
  const a = newAvatar({ id: randomUUID(), accountId: randomUUID(), rarity: 'common', jobCode: 'padeiro' }, t0);
  return { ...a, attributes: { ...a.attributes, ...attrs } };
};
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return null;
};
const gym = (over: Partial<Venue> = {}): Venue => ({ id: randomUUID(), activity: 'academia', feeCents: 500n, ownerAccountId: randomUUID(), open: true, ...over });

describe('regras do lazer', () => {
  it('parque de graça: skate e basquete sobem a felicidade; de novo só depois de 4 h', () => {
    const a = make({ happiness: 5, energy: 6, health: 7 });
    const { effect, cents } = checkActivity(a, { activity: 'basquete', venue: null }, t0);
    expect(cents).toBe(0n);
    const played = applyLeisure(a, effect, t0);
    expect(played.attributes).toMatchObject({ happiness: 7, energy: 5, health: 8 });
    expect(code(() => checkActivity(played, { activity: 'basquete', venue: null }, at(3)))).toBe('leisure_cooldown');
    // Outra atividade não espera; a mesma libera em 4 h.
    expect(checkActivity(played, { activity: 'skate', venue: null }, at(3)).cents).toBe(0n);
    expect(checkActivity(played, { activity: 'basquete', venue: null }, at(4)).cents).toBe(0n);
  });

  it('precisa de 2 de energia, fora do hospital; atividade desconhecida é 400', () => {
    expect(code(() => checkActivity(make({ energy: 1 }), { activity: 'skate', venue: null }, t0))).toBe('too_tired');
    expect(code(() => checkActivity(make(), { activity: 'surfe', venue: null }, t0))).toBe('invalid_activity');
  });

  it('academia e galeria: negócio aberto do tipo certo; a entrada vai para o dono e o próprio não paga', () => {
    const a = make({ energy: 8, health: 5, education: 10 });
    expect(code(() => checkActivity(a, { activity: 'academia', venue: null }, t0))).toBe('venue_required');
    expect(code(() => checkActivity(a, { activity: 'academia', venue: null, venueId: randomUUID() }, t0))).toBe('venue_not_found');
    expect(code(() => checkActivity(a, { activity: 'galeria', venue: gym(), venueId: 'x' }, t0))).toBe('venue_not_found');
    expect(code(() => checkActivity(a, { activity: 'academia', venue: gym({ open: false }), venueId: 'x' }, t0))).toBe('venue_closed');
    const v = gym();
    const paid = checkActivity(a, { activity: 'academia', venue: v, venueId: v.id }, t0);
    expect(paid).toMatchObject({ cents: 500n, effect: { venueId: v.id, ownerAccountId: v.ownerAccountId, feeCents: '500' } });
    expect(applyLeisure(a, paid.effect, t0).attributes).toMatchObject({ energy: 6, health: 7, happiness: 10 });
    expect(checkActivity(a, { activity: 'academia', venue: gym({ ownerAccountId: a.accountId }), venueId: 'x' }, t0).cents).toBe(0n);
    const art = checkActivity(a, { activity: 'galeria', venue: gym({ activity: 'galeria', feeCents: 400n }), venueId: 'x' }, t0);
    expect(applyLeisure(a, art.effect, t0).attributes.education).toBe(11);
  });

  it('o ledger divide a entrada: 90% para o dono, 10% para a queima; entrada 0 não lança nada', async () => {
    expect(feeSplit(500n)).toEqual({ owner: 450n, burn: 50n });
    const bodies: { kind: string; legs: { owner_type: string; owner_id: string; amount: string }[] }[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response('{}', { status: 201 });
    }) as typeof fetch;
    const payer = new EconomyPayer('http://economy', 'token', fetchFn);
    const a = make();
    const v = gym();
    const { effect, cents } = checkActivity(a, { activity: 'academia', venue: v, venueId: v.id }, t0);
    await payer.chargeMeal(planLeisure(a, { id: randomUUID(), clientKey: null, effect, cents }, t0));
    expect(bodies[0]).toMatchObject({
      kind: 'leisure_fee',
      legs: [
        { owner_type: 'player', owner_id: a.accountId, amount: '-500' },
        { owner_type: 'player', owner_id: v.ownerAccountId, amount: '450' },
        { owner_type: 'burn', owner_id: 'leisure', amount: '50' },
      ],
    });
    const mine = checkActivity(a, { activity: 'academia', venue: gym({ ownerAccountId: a.accountId }), venueId: 'x' }, t0);
    await payer.chargeMeal(planLeisure(a, { id: randomUUID(), clientKey: null, effect: mine.effect, cents: mine.cents }, t0));
    expect(bodies).toHaveLength(1);
  });

  it('o cliente do world lê o negócio pela rota interna; 404 vira null', async () => {
    const id = randomUUID();
    const calls: { url: string; token: string | null }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, token: new Headers(init.headers).get('x-service-token') });
      if (url.endsWith(id)) {
        return Response.json({ venue: { id, activity: 'galeria', fee_cents: 400, owner_account_id: 'dono', open: true } });
      }
      return Response.json({ error: { code: 'not_found' } }, { status: 404 });
    }) as typeof fetch;
    const world = new WorldVenues('http://world/', 'token-do-world', fetchFn);
    expect(await world.venue(id)).toEqual({ id, activity: 'galeria', feeCents: 400n, ownerAccountId: 'dono', open: true });
    expect(await world.venue(randomUUID())).toBeNull();
    expect(calls[0]).toEqual({ url: `http://world/internal/v1/venues/${id}`, token: 'token-do-world' });
  });
});

class FakeLedger implements MealPayer {
  balances = new Map<string, bigint>();
  async chargeMeal(meal: Meal) {
    const owner = meal.effects.leisure?.ownerAccountId;
    if (meal.priceCents === 0n) return;
    const balance = this.balances.get(meal.accountId) ?? 0n;
    if (balance < meal.priceCents) throw new AppError('insufficient_thaler', 'THALER insuficiente.', 409);
    this.balances.set(meal.accountId, balance - meal.priceCents);
    if (owner) this.balances.set(owner, (this.balances.get(owner) ?? 0n) + (meal.priceCents * 9n) / 10n);
  }
}

describe('API do lazer', () => {
  let ledger: FakeLedger;
  let store: MemoryAvatarStore;
  let venues: Map<string, Venue>;
  let clock: Date;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    ledger = new FakeLedger();
    store = new MemoryAvatarStore();
    venues = new Map();
    clock = t0;
    app = await buildApp(config, store, () => clock, null, ledger, null, () => 0.5, null, { venue: async (id) => venues.get(id) ?? null });
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

  it('parque e academia: efeito, entrada para o dono, intervalo de 4 h e o catálogo', async () => {
    const a = await store.create(make({ happiness: 4, energy: 8 }));
    ledger.balances.set(a.accountId, 1000n);
    const h = await auth(a.accountId);
    const park = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/leisure`, headers: h, payload: { activity: 'skate' } });
    expect(park.statusCode).toBe(201);
    expect(park.json()).toMatchObject({ purchase: null, avatar: { attributes: { happiness: 6, energy: 7 }, leisure: { skate: at(4).toISOString() } } });

    const v = gym();
    venues.set(v.id, v);
    const train = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/leisure`, headers: h, payload: { activity: 'academia', venue_id: v.id } });
    expect(train.statusCode).toBe(201);
    expect(train.json().purchase).toMatchObject({ price: '500', status: 'eaten' });
    expect(ledger.balances.get(a.accountId)).toBe(500n);
    expect(ledger.balances.get(v.ownerAccountId)).toBe(450n);
    const again = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/leisure`, headers: h, payload: { activity: 'academia', venue_id: v.id } });
    expect(again.json().error.code).toBe('leisure_cooldown');
    expect(ledger.balances.get(a.accountId)).toBe(500n);

    const cat = (await app.inject({ url: '/v1/catalog/leisure' })).json();
    expect(cat).toMatchObject({ cooldown_hours: 4, owner_share: 0.9, venues_on: true });
    expect(cat.activities.map((x: { code: string }) => x.code)).toEqual(['skate', 'basquete', 'academia', 'galeria']);
  });

  it('sem THALER, a entrada é 409 e o efeito não entra; sem world, academia é 503', async () => {
    const a = await store.create(make({ health: 5 }));
    const v = gym();
    venues.set(v.id, v);
    const r = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/leisure`, headers: await auth(a.accountId), payload: { activity: 'academia', venue_id: v.id } });
    expect(r.json().error.code).toBe('insufficient_thaler');
    expect((await store.get(a.id))!.attributes.health).toBe(5);
    const off = await buildApp(config, store, () => clock, null, ledger, null, () => 0.5);
    const r2 = await off.inject({ method: 'POST', url: `/v1/avatars/${a.id}/leisure`, headers: await auth(a.accountId), payload: { activity: 'academia', venue_id: v.id } });
    expect(r2.statusCode).toBe(503);
  });
});

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 5 }) : null;
afterAll(() => pool?.end());

describe.skipIf(!pool)('lazer no Postgres', () => {
  it('grava a última vez de cada atividade', async () => {
    const store = new PostgresAvatarStore(pool!);
    const a = await store.create(make());
    await store.updateAvatar(a.id, a.accountId, t0, (current) => applyLeisure(current, { activity: 'skate' }, t0));
    const back = (await store.get(a.id))!;
    expect(back.leisure).toEqual({ lastAt: { skate: t0 } });
  });
});
