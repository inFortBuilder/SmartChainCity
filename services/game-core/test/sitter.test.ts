import { randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { type Avatar, newAvatar } from '../src/domain/avatar.js';
import { type Meal, type MealPayer, planSitter } from '../src/domain/meal.js';
import { applyPetEffect, checkAdoption } from '../src/domain/pet.js';
import { settle, startShift } from '../src/domain/shift.js';
import { type PetSitterStore, type Sitting, sitterFactor, sitterSplit } from '../src/domain/sitter.js';
import { PostgresPetSitterStore } from '../src/infra/db/postgres-sitter-store.js';
import { EconomyPayer } from '../src/infra/economy-payer.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';
import { MemoryPetSitterStore } from '../src/infra/memory-sitter-store.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const INTERNAL = 'chave-interna-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: INTERNAL });
const t0 = new Date('2026-11-22T08:00:00Z');
const HOUR = 3_600_000;
const at = (h: number) => new Date(t0.getTime() + h * HOUR);

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 10 }) : null;
afterAll(() => pool?.end());

const avatar = (jobCode: string, rarity: 'common' | 'rare' = 'common', accountId: string = randomUUID()): Avatar =>
  newAvatar({ id: randomUUID(), accountId, rarity, jobCode }, t0);
const withPet = (a: Avatar) => {
  const { cents: _c, ...effect } = checkAdoption(a, { species: 'cat', name: 'Mimi' }, t0);
  return applyPetEffect(a, effect, t0);
};
const sitting = (sitterAvatarId: string, over: Partial<Sitting> = {}): Sitting => ({
  id: randomUUID(),
  sitterAvatarId,
  sitterAccountId: randomUUID(),
  ownerAvatarId: randomUUID(),
  ownerAccountId: randomUUID(),
  priceCents: 2000n,
  startsAt: t0,
  endsAt: at(24),
  status: 'reserved',
  ...over,
});

describe('regras do Pet Sitter', () => {
  it('divisão 90/10 e bônus de 20% no turno do sitter com pet sob cuidado', () => {
    expect(sitterSplit(2000n)).toEqual({ sitter: 1800n, burn: 200n });
    expect(sitterSplit(1001n)).toEqual({ sitter: 900n, burn: 101n });
    const sitter = avatar('pet_sitter', 'rare');
    expect(sitterFactor(sitter, 1)).toBe(1.2);
    expect(sitterFactor(sitter, 0)).toBe(1);
    expect(sitterFactor(avatar('padeiro'), 2)).toBe(1);
    const seed = 'ab'.repeat(32);
    const id = randomUUID();
    const plain = settle(startShift(sitter, { id, hours: 6, hoursToday: 0, running: false, seed }, t0).shift);
    const caring = settle(startShift(sitter, { id, hours: 6, hoursToday: 0, running: false, seed, sitter: 1.2 }, t0).shift);
    expect(caring.factors.sitter).toBe(1.2);
    expect(Number(caring.thalerCents)).toBeCloseTo(Number(plain.thalerCents) * 1.2, -1);
    expect(plain.factors.sitter).toBeUndefined();
  });

  it('o ledger recebe a diária: 90% para o sitter, 10% para a queima', async () => {
    const bodies: { kind: string; legs: { owner_type: string; owner_id: string; amount: string }[] }[] = [];
    const fetchFn = (async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ transaction: { id: 'x' } }), { status: 201 });
    }) as unknown as typeof fetch;
    const owner = withPet(avatar('padeiro'));
    const meal = planSitter(owner, {
      id: randomUUID(),
      clientKey: null,
      effect: { kind: 'service', service: 'hotel' },
      cents: 2500n,
      sitter: { sittingId: randomUUID(), sitterAccountId: 'conta-sitter', sitterAvatarId: randomUUID() },
    }, t0);
    await new EconomyPayer('http://economy', 'token', fetchFn).chargeMeal(meal);
    expect(bodies[0]).toMatchObject({
      kind: 'petsitter_fee',
      legs: [
        { owner_type: 'player', owner_id: owner.accountId, amount: '-2500' },
        { owner_type: 'player', owner_id: 'conta-sitter', amount: '2250' },
        { owner_type: 'burn', owner_id: 'petsitter', amount: '250' },
      ],
    });
  });
});

describe.each([
  ['memória', () => new MemoryPetSitterStore() as PetSitterStore, true],
  ['postgres', () => new PostgresPetSitterStore(pool!) as PetSitterStore, pool !== null],
] as const)('store do Pet Sitter (%s)', (_n, make, enabled) => {
  it.runIf(enabled)('até 3 pets ao mesmo tempo, mesmo com 6 pedidos juntos; cancelada e vencida liberam a vaga', async () => {
    const s = make();
    const sitterId = randomUUID();
    const outcomes = await Promise.allSettled(Array.from({ length: 6 }, () => s.reserve(sitting(sitterId), 3, t0)));
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(3);
    expect(outcomes.filter((o) => o.status === 'rejected' && (o.reason as AppError).code === 'sitter_full')).toHaveLength(3);
    const live = await s.current(sitterId, t0);
    expect(live).toHaveLength(3);
    await s.setStatus(live[0]!.id, 'cancelled');
    await s.reserve(sitting(sitterId), 3, t0);
    // Depois de 24 h, as estadias acabam e as vagas voltam.
    expect(await s.current(sitterId, at(24))).toHaveLength(0);
  });

  it.runIf(enabled)('oferta e a estadia mais recente do dono', async () => {
    const s = make();
    const a = randomUUID();
    await s.setOffer({ avatarId: a, accountId: randomUUID(), priceCents: 1500n, open: true, updatedAt: t0 });
    expect((await s.offer(a))!.priceCents).toBe(1500n);
    expect((await s.openOffers()).some((o) => o.avatarId === a)).toBe(true);
    await s.setOffer({ avatarId: a, accountId: randomUUID(), priceCents: 1500n, open: false, updatedAt: t0 });
    expect((await s.openOffers()).some((o) => o.avatarId === a)).toBe(false);
    const owner = randomUUID();
    await s.reserve(sitting(randomUUID(), { ownerAvatarId: owner, startsAt: t0 }), 3, t0);
    const second = await s.reserve(sitting(randomUUID(), { ownerAvatarId: owner, startsAt: at(1) }), 3, at(1));
    expect((await s.latestOf(owner))!.id).toBe(second.id);
  });
});

/** Ledger falso que guarda o saldo e paga o sitter como o de verdade (90%). */
class FakeLedger implements MealPayer {
  balances = new Map<string, bigint>();
  async chargeMeal(meal: Meal) {
    const balance = this.balances.get(meal.accountId) ?? 0n;
    if (balance < meal.priceCents) throw new AppError('insufficient_thaler', 'THALER insuficiente.', 409);
    this.balances.set(meal.accountId, balance - meal.priceCents);
    const sitter = meal.effects.sitter;
    if (sitter) this.balances.set(sitter.sitterAccountId, (this.balances.get(sitter.sitterAccountId) ?? 0n) + sitterSplit(meal.priceCents).sitter);
  }
}

describe('API do Pet Sitter', () => {
  let ledger: FakeLedger;
  let store: MemoryAvatarStore;
  let clock: Date;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    ledger = new FakeLedger();
    store = new MemoryAvatarStore();
    clock = t0;
    app = await buildApp(config, store, () => clock, null, ledger, null, () => 0.5);
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

  it('o sitter abre a oferta, o dono deixa o pet 24 h, o sitter recebe e ganha +20% no turno', async () => {
    const sitter = await store.create(avatar('pet_sitter', 'rare'));
    const owner = await store.create(withPet(avatar('padeiro')));
    const baker = await store.create(avatar('padeiro'));
    ledger.balances.set(owner.accountId, 5000n);
    const hs = await auth(sitter.accountId);
    const ho = await auth(owner.accountId);

    // Só quem tem a profissão, e com a diária na faixa.
    const notSitter = await app.inject({ method: 'PUT', url: `/v1/avatars/${baker.id}/pet-sitter`, headers: await auth(baker.accountId), payload: { open: true, price: '2000' } });
    expect(notSitter.json().error.code).toBe('not_pet_sitter');
    expect((await app.inject({ method: 'PUT', url: `/v1/avatars/${sitter.id}/pet-sitter`, headers: hs, payload: { open: true, price: '500' } })).json().error.code).toBe('invalid_price');
    const open = await app.inject({ method: 'PUT', url: `/v1/avatars/${sitter.id}/pet-sitter`, headers: hs, payload: { open: true, price: '2000' } });
    expect(open.json()).toMatchObject({ offer: { price: '2000', open: true, slots: 3 }, caring: [], shift_bonus: 0 });

    // A lista não mostra o sitter para a própria conta.
    expect((await app.inject({ url: '/v1/pet-sitters', headers: hs })).json().sitters).toHaveLength(0);
    const list = (await app.inject({ url: '/v1/pet-sitters', headers: ho })).json();
    expect(list.sitters).toEqual([{ avatar_id: sitter.id, price: '2000', open: true, slots: 3, capacity: 3 }]);

    const book = await app.inject({ method: 'POST', url: `/v1/avatars/${owner.id}/pet/sitter`, headers: ho, payload: { sitter_avatar_id: sitter.id } });
    expect(book.statusCode).toBe(201);
    expect(book.json().purchase).toMatchObject({ price: '2000', status: 'eaten' });
    expect(book.json().avatar.pet).toMatchObject({ attributes: { food: 5, water: 5 }, hotel_until: at(24).toISOString() });
    expect(ledger.balances.get(owner.accountId)).toBe(3000n);
    expect(ledger.balances.get(sitter.accountId)).toBe(1800n);
    expect((await app.inject({ url: `/v1/pet-sitters?avatar_id=${owner.id}`, headers: ho })).json().stay).toMatchObject({ sitter_avatar_id: sitter.id, status: 'active' });

    // Pet já está com alguém: não dá para deixar de novo.
    const again = await app.inject({ method: 'POST', url: `/v1/avatars/${owner.id}/pet/sitter`, headers: ho, payload: { sitter_avatar_id: sitter.id } });
    expect(again.json().error.code).toBe('pet_in_hotel');
    expect((await app.inject({ url: `/v1/avatars/${sitter.id}/pet-sitter`, headers: hs })).json()).toMatchObject({ offer: { slots: 2 }, shift_bonus: 0.2 });

    // O turno do sitter com pet sob cuidado leva +20%.
    const work = await app.inject({ method: 'POST', url: `/v1/avatars/${sitter.id}/work`, headers: hs, payload: { shift: 6 } });
    expect(work.statusCode).toBe(201);
    const [shift] = await store.listShifts(sitter.id, 1);
    expect(shift!.snapshot.sitter).toBe(1.2);
  });

  it('sem THALER, a vaga volta; o sitter não atende a própria conta; fechado não atende', async () => {
    const sitter = await store.create(avatar('pet_sitter', 'rare'));
    const hs = await auth(sitter.accountId);
    await app.inject({ method: 'PUT', url: `/v1/avatars/${sitter.id}/pet-sitter`, headers: hs, payload: { open: true, price: '2000' } });

    const poor = await store.create(withPet(avatar('padeiro')));
    const hp = await auth(poor.accountId);
    const r = await app.inject({ method: 'POST', url: `/v1/avatars/${poor.id}/pet/sitter`, headers: hp, payload: { sitter_avatar_id: sitter.id } });
    expect(r.json().error.code).toBe('insufficient_thaler');
    expect((await app.inject({ url: `/v1/avatars/${sitter.id}/pet-sitter`, headers: hs })).json().offer.slots).toBe(3);

    const mine = await store.create(withPet(avatar('padeiro', 'common', sitter.accountId)));
    ledger.balances.set(sitter.accountId, 5000n);
    const own = await app.inject({ method: 'POST', url: `/v1/avatars/${mine.id}/pet/sitter`, headers: hs, payload: { sitter_avatar_id: sitter.id } });
    expect(own.json().error.code).toBe('own_sitter');

    await app.inject({ method: 'PUT', url: `/v1/avatars/${sitter.id}/pet-sitter`, headers: hs, payload: { open: false, price: '2000' } });
    ledger.balances.set(poor.accountId, 5000n);
    const closed = await app.inject({ method: 'POST', url: `/v1/avatars/${poor.id}/pet/sitter`, headers: hp, payload: { sitter_avatar_id: sitter.id } });
    expect(closed.json().error.code).toBe('sitter_closed');
  });
});
