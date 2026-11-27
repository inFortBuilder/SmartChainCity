import { randomUUID } from 'node:crypto';

import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { type Avatar, decayed, newAvatar, status } from '../src/domain/avatar.js';
import type { HomeDirectory } from '../src/domain/housing.js';
import { applyHomeOffice, doChore, planCommute, startRest } from '../src/domain/routine.js';
import { settle, startShift } from '../src/domain/shift.js';
import { PostgresAvatarStore } from '../src/infra/db/postgres-store.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';

/** O dia do avatar fora do trabalho: descansar, higiene em casa e ir ao trabalho (GDD §2.3, §3.3). */
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

describe('descanso', () => {
  it('dorme 4 ou 8 h, não trabalha dormindo e acorda com a energia', () => {
    const a = startRest(make({ energy: 2 }), { hours: 8, housed: true, running: false }, t0);
    expect(status(a, at(1))).toMatchObject({ canWork: false, canLeisure: false, resting: true });
    expect(code(() => startShift(a, { id: randomUUID(), hours: 6, hoursToday: 0, running: false }, at(1)))).toBe('resting');
    const woke = decayed(a, at(8));
    expect(woke.attributes.energy).toBe(10);
    expect(woke.rest).toBeNull();
    expect(status(woke, at(8)).resting).toBe(false);
  });

  it('sem moradia regular ganha metade; regras de entrada', () => {
    expect(decayed(startRest(make({ energy: 1 }), { hours: 4, housed: false, running: false }, t0), at(4)).attributes.energy).toBe(3);
    expect(code(() => startRest(make({ energy: 1 }), { hours: 5, housed: true, running: false }, t0))).toBe('invalid_rest');
    expect(code(() => startRest(make(), { hours: 4, housed: true, running: false }, t0))).toBe('not_tired');
    expect(code(() => startRest(make({ energy: 1 }), { hours: 4, housed: true, running: true }, t0))).toBe('shift_running');
    const asleep = startRest(make({ energy: 1 }), { hours: 4, housed: true, running: false }, t0);
    expect(code(() => startRest(asleep, { hours: 4, housed: true, running: false }, at(1)))).toBe('resting');
  });
});

describe('descanso obrigatório após 16 h acordado', () => {
  it('com 16 h acordado não trabalha nem sai; dorme mesmo com a energia cheia e zera a conta', () => {
    const a = make();
    expect(status(a, at(15.9))).toMatchObject({ canWork: true, canLeisure: true, mustRest: false });
    expect(status(a, at(16))).toMatchObject({ canWork: false, canLeisure: false, mustRest: true });
    expect(code(() => startShift(a, { id: randomUUID(), hours: 6, hoursToday: 0, running: false }, at(16)))).toBe('must_rest');
    // Antes das 16 h, com a energia cheia, não dorme; depois, dorme.
    expect(code(() => startRest(a, { hours: 4, housed: true, running: false }, at(10)))).toBe('not_tired');
    const asleep = startRest(a, { hours: 4, housed: true, running: false }, at(17));
    expect(status(asleep, at(18))).toMatchObject({ resting: true, mustRest: false });
    const woke = decayed(asleep, at(21));
    expect(woke.awakeSince).toEqual(at(21));
    expect(woke.attributes.energy).toBe(10);
    expect(status(woke, at(21))).toMatchObject({ canWork: true, mustRest: false });
    expect(status(woke, at(37))).toMatchObject({ mustRest: true });
  });

  it('o turno que já começou termina; o próximo espera o descanso', () => {
    const working = startShift(make(), { id: randomUUID(), hours: 12, hoursToday: 0, running: false }, at(10));
    expect(working.avatar.attributes.energy).toBeLessThan(10);
    // Sem as doenças sorteadas no turno (a semente é aleatória aqui): o que conta é o descanso.
    const healthy = { ...working.avatar, conditions: [] };
    expect(code(() => startShift(healthy, { id: randomUUID(), hours: 6, hoursToday: 0, running: false }, at(22)))).toBe('must_rest');
  });
});

describe('higiene em casa', () => {
  it('banho sobe higiene e saúde, a cada 4 h, só com moradia', () => {
    const a = doChore(make({ hygiene: 2, health: 5 }), 'banho', true, t0);
    expect(a.attributes).toMatchObject({ hygiene: 5, health: 6 });
    expect(code(() => doChore(a, 'banho', true, at(3)))).toBe('chore_cooldown');
    expect(doChore(a, 'banho', true, at(4)).attributes.hygiene).toBe(8);
    expect(code(() => doChore(make(), 'banho', false, t0))).toBe('no_home');
    expect(code(() => doChore(make(), 'sauna', true, t0))).toBe('unknown_chore');
  });
});

describe('deslocamento', () => {
  it('o atraso tira a fração do turno e a tarifa sai do pagamento', () => {
    expect(planCommute(undefined, 6, false)).toMatchObject({ mode: 'a_pe', costCents: 0n });
    expect(planCommute('a_pe', 6, false).factor).toBeCloseTo(1 - 15 / 360);
    expect(planCommute('home_office', 12, false)).toMatchObject({ factor: 1, costCents: 200n });
    expect(code(() => planCommute('carro', 6, false))).toBe('no_car');
    expect(planCommute('carro', 6, true).factor).toBeCloseTo(1 - 4 / 360);
    expect(code(() => planCommute('foguete', 6, false))).toBe('invalid_commute');

    const a = make();
    const seed = 'cd'.repeat(32);
    const base = startShift(a, { id: randomUUID(), hours: 6, hoursToday: 0, running: false, seed }, t0).shift;
    const bus = startShift(a, { id: base.id, hours: 6, hoursToday: 0, running: false, seed, commute: planCommute('onibus', 6, false) }, t0).shift;
    const gross = Number(settle(base).thalerCents);
    const got = settle(bus);
    expect(got.factors).toMatchObject({ commute: 1 - 6 / 360, commuteCost: 300 });
    expect(Number(got.thalerCents)).toBeCloseTo(gross * (1 - 6 / 360) - 300, -1);
    // Turnos antigos, sem o campo, não mudam.
    expect(settle(base).factors.commute).toBeUndefined();
  });

  it('home office: perde 1 de felicidade e de saúde depois da foto do turno', () => {
    const a = make({ happiness: 8, health: 8 });
    const { shift, avatar } = startShift(a, { id: randomUUID(), hours: 6, hoursToday: 0, running: false, commute: planCommute('home_office', 6, false) }, t0);
    expect(shift.snapshot).toMatchObject({ happiness: 8, health: 8, commuteMode: 'home_office' });
    expect(avatar.attributes).toMatchObject({ happiness: 7, health: 7 });
    expect(applyHomeOffice(a, planCommute('a_pe', 6, false))).toBe(a);
  });
});

class Homes implements HomeDirectory {
  async homes() {
    return [];
  }
}

describe('API da rotina', () => {
  let store: MemoryAvatarStore;
  let clock: Date;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    store = new MemoryAvatarStore();
    clock = t0;
    app = await buildApp(config, store, () => clock, null, null, null, () => 0.5, null, null, null, null, null, null, null, new Homes());
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

  it('descansa sem moradia (metade), higiene pede moradia e o turno grava o deslocamento', async () => {
    const a = await store.create(make({ energy: 2 }));
    const h = await auth(a.accountId);
    const cat = (await app.inject({ url: '/v1/catalog/routine' })).json();
    expect(cat).toMatchObject({ rest: { hours: [4, 8] }, default_commute: 'a_pe' });
    expect(cat.commutes.map((c: { mode: string }) => c.mode)).toEqual(['a_pe', 'skate', 'onibus', 'carro', 'home_office']);

    const rest = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/rest`, headers: h, payload: { hours: 8 } });
    expect(rest.statusCode).toBe(201);
    expect(rest.json()).toMatchObject({ housed: false, avatar: { rest: { energy: 4 }, status: { resting: true, canWork: false } } });
    const busy = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/work`, headers: h, payload: { shift: 6 } });
    expect(busy.json().error.code).toBe('resting');

    clock = at(8);
    const seen = (await app.inject({ url: `/v1/avatars/${a.id}`, headers: h })).json().avatar;
    expect(seen).toMatchObject({ attributes: { energy: 6 }, rest: null, status: { resting: false } });

    const chore = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/chores`, headers: h, payload: { code: 'banho' } });
    expect(chore.json().error.code).toBe('no_home');

    const car = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/work`, headers: h, payload: { shift: 6, commute: 'carro' } });
    expect(car.json().error.code).toBe('no_car');
    const bus = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/work`, headers: h, payload: { shift: 6, commute: 'onibus' } });
    expect(bus.statusCode).toBe(201);
    expect((await store.listShifts(a.id, 1))[0]!.snapshot).toMatchObject({ commuteMode: 'onibus', commuteCostCents: 300 });
  });

  it('mostra a hora-limite e pede o descanso depois de 16 h acordado', async () => {
    const a = await store.create(make());
    const h = await auth(a.accountId);
    expect((await app.inject({ url: '/v1/catalog/routine' })).json().rest.awake_limit_hours).toBe(16);
    expect((await app.inject({ url: `/v1/avatars/${a.id}`, headers: h })).json().avatar.must_rest_at).toBe(at(16).toISOString());
    clock = at(16);
    const late = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/work`, headers: h, payload: { shift: 6 } });
    expect(late.json().error.code).toBe('must_rest');
    const rest = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/rest`, headers: h, payload: { hours: 8 } });
    expect(rest.statusCode).toBe(201);
    clock = at(24);
    const seen = (await app.inject({ url: `/v1/avatars/${a.id}`, headers: h })).json().avatar;
    expect(seen).toMatchObject({ must_rest_at: at(40).toISOString(), status: { mustRest: false, canWork: true } });
  });
});

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 5 }) : null;
afterAll(() => pool?.end());

describe.skipIf(!pool)('rotina no Postgres', () => {
  it('grava o descanso e a higiene', async () => {
    const store = new PostgresAvatarStore(pool!);
    const a = await store.create(make({ energy: 3, hygiene: 1 }));
    const slept = await store.updateAvatar(a.id, a.accountId, t0, (x) => startRest(x, { hours: 4, housed: true, running: false }, t0));
    expect(slept.rest).toMatchObject({ energy: 4, endsAt: at(4) });
    expect((await store.get(a.id))!.rest).toMatchObject({ energy: 4, endsAt: at(4) });
    const later = await store.updateAvatar(a.id, a.accountId, at(5), (x) => doChore(x, 'maos', true, at(5)));
    expect(later.rest).toBeNull();
    expect((await store.get(a.id))!.awakeSince).toEqual(at(4));
    expect(later.attributes.energy).toBeGreaterThanOrEqual(6);
    expect((await store.get(a.id))!.chores?.maos).toEqual(at(5));
  });
});
