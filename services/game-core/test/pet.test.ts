import { randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { type Avatar, decayed, newAvatar } from '../src/domain/avatar.js';
import { type Meal, type MealPayer, planPetShop } from '../src/domain/meal.js';
import {
  type Pet,
  applyPetEffect,
  checkAdoption,
  checkService,
  happinessWithPet,
  petAction,
  petFactors,
  petLevel,
  petMultiplier,
} from '../src/domain/pet.js';
import { settle, startShift } from '../src/domain/shift.js';
import { PostgresAvatarStore } from '../src/infra/db/postgres-store.js';
import { EconomyPayer } from '../src/infra/economy-payer.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';

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
const adopt = (a: Avatar, species = 'dog', name = 'Rex') => {
  const { cents: _c, ...effect } = checkAdoption(a, { species, name }, t0);
  return applyPetEffect(a, effect, t0);
};
const serve = (a: Avatar, service: string, when: Date) => {
  const { cents: _c, ...effect } = checkService(a, service, when);
  return applyPetEffect(a, effect, when);
};
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return null;
};

describe('regras do pet', () => {
  it('nível e multiplicador da tabela do GDD §2.4', () => {
    expect([3, 7, 8, 12, 13, 14, 15].map(petMultiplier)).toEqual([1, 1.08, 1.1, 1.18, 1.2, 1.22, 1.25]);
    expect(petLevel({ xp: 0 })).toBe(3);
    expect(petLevel({ xp: 9 })).toBe(4);
    expect(petLevel({ xp: 500 })).toBe(15);
  });

  it('adoção: um pet por avatar, nome válido, gato ou cachorro', () => {
    const a = adopt(make());
    expect(a.pet).toMatchObject({ species: 'dog', name: 'Rex', xp: 0, attributes: { food: 5, water: 5, happiness: 5 }, diedAt: null });
    expect(code(() => checkAdoption(a, { species: 'cat', name: 'Mia' }, t0))).toBe('has_pet');
    expect(code(() => checkAdoption(make(), { species: 'peixe', name: 'Nemo' }, t0))).toBe('invalid_species');
    expect(code(() => checkAdoption(make(), { species: 'cat', name: '  ' }, t0))).toBe('invalid_name');
  });

  it('a alimentação cai 1 a cada 6 h e, em 0, o pet morre no instante em que zerou', () => {
    const a = adopt(make());
    expect(decayed(a, at(12)).pet!.attributes).toMatchObject({ food: 3, happiness: 4 });
    const dead = decayed(a, at(40)).pet!;
    expect(dead.diedAt).toEqual(at(30));
    expect(dead.deathCause).toBe('food');
    // Morto não cai mais nem aceita serviço; enterrar libera para outra adoção.
    expect(decayed({ ...a, pet: dead }, at(100)).pet!.diedAt).toEqual(at(30));
    expect(code(() => checkService({ ...a, pet: dead }, 'banho', at(41)))).toBe('pet_dead');
    const buried = petAction({ ...a, pet: dead }, 'enterrar', at(41));
    expect(buried.pet).toBeNull();
    expect(code(() => petAction(a, 'enterrar', t0))).toBe('pet_alive');
  });

  it('ração sobe a alimentação; banho e tosa dão felicidade e experiência', () => {
    let a = decayed(adopt(make()), at(18)); // alimentação 2, felicidade 4
    a = serve(a, 'racao', at(18));
    expect(a.pet!.attributes.food).toBe(5);
    expect(code(() => checkService(a, 'racao', at(18)))).toBe('pet_not_hungry');
    a = serve(a, 'banho', at(18));
    a = serve(a, 'tosa', at(18));
    expect(a.pet!.attributes.happiness).toBe(5);
    expect(a.pet!.xp).toBe(2);
  });

  it('no hotel o pet não perde alimentação nem felicidade; o relógio volta quando ele sai', () => {
    let a = decayed(adopt(make()), at(6)); // alimentação 4
    a = serve(a, 'hotel', at(6));
    expect(a.pet).toMatchObject({ attributes: { food: 5, water: 5 }, hotelUntil: at(30) });
    expect(code(() => checkService(a, 'banho', at(10)))).toBe('pet_in_hotel');
    expect(code(() => petAction(a, 'passeio', at(10)))).toBe('pet_in_hotel');
    expect(decayed(a, at(29)).pet!.attributes.food).toBe(5);
    // Saiu às 30 h: 6 h depois cai 1.
    expect(decayed(a, at(36)).pet!.attributes.food).toBe(4);
  });

  it('passeio: −5 de energia, +3 de felicidade e saúde no avatar; −1 de água e +2 de felicidade no pet', () => {
    let a = adopt(make({ energy: 8, happiness: 5, health: 6 }));
    a = { ...a, pet: { ...a.pet!, attributes: { food: 5, water: 5, happiness: 2 } } };
    const walked = petAction(a, 'passeio', t0);
    expect(walked.attributes).toMatchObject({ energy: 3, happiness: 8, health: 9 });
    expect(walked.pet).toMatchObject({ xp: 1, attributes: { water: 4, happiness: 4 } });
    // Cansado não passeia; com 1 de água, primeiro a água (o pet só bebe em casa).
    expect(code(() => petAction(walked, 'passeio', t0))).toBe('too_tired');
    const thirsty = { ...a, pet: { ...a.pet!, attributes: { ...a.pet!.attributes, water: 1 } } };
    expect(code(() => petAction(thirsty, 'passeio', t0))).toBe('pet_thirsty');
    expect(petAction(thirsty, 'agua', t0).pet!.attributes.water).toBe(5);
    expect(code(() => petAction(a, 'agua', t0))).toBe('pet_not_thirsty');
    expect(code(() => petAction(make(), 'agua', t0))).toBe('no_pet');
  });

  it('no turno: pet triste corta a felicidade pela metade; o nível multiplica a experiência até 2,5×', () => {
    const base = make({ happiness: 9, education: 100 });
    const pet: Pet = { ...adopt(base).pet!, xp: 60 }; // nível 15, 1,25×
    expect(petFactors({ pet })).toEqual({ multiplier: 1.25, sad: false });
    const sad = { ...base, pet: { ...pet, attributes: { ...pet.attributes, happiness: 0 } } };
    expect(happinessWithPet(sad)).toBe(4);
    expect(happinessWithPet({ ...sad, pet: { ...sad.pet, diedAt: t0 } })).toBe(9);

    const { shift } = startShift(sad, { id: randomUUID(), hours: 6, hoursToday: 0, running: false, seed: 'ab'.repeat(32) }, t0);
    expect(shift.snapshot).toMatchObject({ happiness: 4, pet: 1.25 });
    // Educação 100 (3×) × pet 1,25 passa do teto: fica 2,5×.
    expect(settle(shift).factors.expPet).toBe(2.5);
    const low = { ...base, attributes: { ...base.attributes, education: 0 }, pet };
    const { shift: s2 } = startShift(low, { id: randomUUID(), hours: 6, hoursToday: 0, running: false, seed: 'cd'.repeat(32) }, t0);
    expect(settle(s2).factors.expPet).toBe(1.25);
    // Turno antigo, sem o pet no retrato: 1×.
    expect(settle({ ...s2, snapshot: { ...s2.snapshot, pet: undefined } }).factors.expPet).toBe(1);
  });

  it('o ledger lança o Pet Shop como petshop_buy, para a queima do Pet Shop', async () => {
    const bodies: { kind: string; legs: { owner_id: string; amount: string }[] }[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response('{}', { status: 201 });
    }) as typeof fetch;
    const a = make();
    const { cents, ...effect } = checkAdoption(a, { species: 'cat', name: 'Mia' }, t0);
    await new EconomyPayer('http://economy', 'token', fetchFn).chargeMeal(planPetShop(a, { id: randomUUID(), clientKey: null, effect, cents }, t0));
    expect(bodies[0]).toMatchObject({ kind: 'petshop_buy', legs: [{ amount: '-5000' }, { owner_id: 'petshop', amount: '5000' }] });
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

describe('API do Pet Shop', () => {
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

  it('adota pagando uma vez, cuida, vê morrer de fome e enterra', async () => {
    const a = await store.create(make());
    ledger.balances.set(a.accountId, 10_000n);
    const headers = { ...(await auth(a.accountId)), 'idempotency-key': 'adocao-1' };
    const buy = () => app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/pet`, headers, payload: { species: 'dog', name: 'Rex' } });
    const first = await buy();
    expect(first.statusCode).toBe(201);
    expect(first.json().purchase).toMatchObject({ price: '8000', status: 'eaten' });
    expect(first.json().avatar.pet).toMatchObject({ name: 'Rex', species: 'dog', species_label: 'Cachorro', alive: true, level: 3, multiplier: 1 });
    expect((await buy()).json().purchase.id).toBe(first.json().purchase.id);
    expect(ledger.balances.get(a.accountId)).toBe(2000n);

    const h = await auth(a.accountId);
    const bath = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/pet/services`, headers: h, payload: { service: 'banho' } });
    expect(bath.statusCode).toBe(201);
    expect(bath.json().avatar.pet.xp).toBe(1);
    const walk = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/pet/actions`, headers: h, payload: { action: 'passeio' } });
    expect(walk.json().avatar).toMatchObject({ attributes: { energy: 5 }, pet: { attributes: { water: 4 }, xp: 2 } });

    // Sem THALER, o hotel é 409 e nada muda.
    const hotel = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/pet/services`, headers: h, payload: { service: 'hotel' } });
    expect(hotel.json().error.code).toBe('insufficient_thaler');

    clock = at(31);
    const seen = (await app.inject({ url: `/v1/avatars/${a.id}`, headers: h })).json();
    expect(seen.pet ?? seen.avatar?.pet).toMatchObject({ alive: false, death_cause: 'food', multiplier: 1 });
    const bury = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/pet/actions`, headers: h, payload: { action: 'enterrar' } });
    expect(bury.json().avatar.pet).toBeNull();
  });

  it('catálogo do Pet Shop e ação inválida', async () => {
    const c = (await app.inject({ url: '/v1/catalog/petshop' })).json();
    expect(c.species).toEqual([
      { code: 'cat', label: 'Gato', price: '5000' },
      { code: 'dog', label: 'Cachorro', price: '8000' },
    ]);
    expect(c.services.map((s: { code: string }) => s.code)).toEqual(['racao', 'banho', 'tosa', 'hotel']);
    expect(c.levels.at(-1)).toEqual({ level: 15, multiplier: 1.25 });
    const a = await store.create(make());
    const r = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/pet/actions`, headers: await auth(a.accountId), payload: { action: 'voar' } });
    expect(r.statusCode).toBe(400);
  });
});

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 5 }) : null;
afterAll(() => pool?.end());

describe.skipIf(!pool)('pet no Postgres', () => {
  it('grava e lê o pet com as datas, e a adoção paga passa pelo avatar travado', async () => {
    const store = new PostgresAvatarStore(pool!);
    const a = await store.create(make());
    const meal = await store.beginMeal(a.id, a.accountId, null, t0, (current) => {
      const { cents, ...effect } = checkAdoption(current, { species: 'cat', name: 'Mia' }, t0);
      return planPetShop(current, { id: randomUUID(), clientKey: null, effect, cents }, t0);
    });
    await store.finishMeal(meal.id, t0);
    const withHotel = await store.updateAvatar(a.id, a.accountId, at(1), (current) => serve(current, 'hotel', at(1)));
    const back = (await store.get(a.id))!;
    expect(back.pet).toEqual(withHotel.pet);
    expect(back.pet).toMatchObject({ species: 'cat', name: 'Mia', hotelUntil: at(25), adoptedAt: t0 });
  });
});
