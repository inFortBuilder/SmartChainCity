import { randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { newAvatar } from '../src/domain/avatar.js';
import { professions } from '../src/domain/catalog.js';
import {
  EVENT_GROUPS,
  type GamePassPayer,
  type GamePassStore,
  SEASONS,
  checkPassUpgrade,
  damageCut,
  eventAt,
  eventFactor,
  eventOfWeek,
  seasonAt,
  weekOf,
} from '../src/domain/events.js';
import { DAMAGE_CHANCE, draw, settle, startShift } from '../src/domain/shift.js';
import { PostgresGamePassStore } from '../src/infra/db/postgres-gamepass-store.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';
import { MemoryGamePassStore } from '../src/infra/memory-gamepass-store.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const INTERNAL = 'chave-interna-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: INTERNAL });
const WEEK = 7 * 86_400_000;
/** Sábado da semana 0 (16 a 22/11/2026): evento do grupo Comida. */
const t0 = new Date('2026-11-21T08:00:00Z');
const WEI = 10n ** 18n;
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return null;
};

describe('eventos semanais', () => {
  it('as 44 profissões estão num grupo só', () => {
    const all = EVENT_GROUPS.flatMap((g) => [...g.jobs]);
    expect(all.sort()).toEqual(professions().map((p) => p.code).sort());
  });

  it('semana ISO desde 16/11/2026; os grupos se revezam e o nome gira', () => {
    expect(weekOf(t0)).toBe(0);
    expect(weekOf(new Date('2026-11-23T00:00:00Z'))).toBe(1);
    expect(weekOf(new Date('2026-11-15T23:59:59Z'))).toBe(-1);
    expect([0, 1, 2, 3, 4].map((w) => eventOfWeek(w).group)).toEqual(['comida', 'saude', 'lazer', 'cidade', 'comida']);
    expect(eventOfWeek(0).name).toBe('Evento gastronômico');
    expect(eventOfWeek(4).name).toBe('Agroweek');
    expect(eventOfWeek(-1).group).toBe('cidade');
    expect(eventAt(t0)).toMatchObject({ startsAt: new Date('2026-11-16T00:00:00Z'), endsAt: new Date('2026-11-23T00:00:00Z') });
    expect(eventFactor('padeiro', t0)).toBe(1.2);
    expect(eventFactor('medico', t0)).toBe(1);
    expect(eventFactor('medico', new Date(t0.getTime() + WEEK))).toBe(1.2);
  });

  it('o turno que começa na semana do evento ganha 1,2×; o GamePass corta a chance de dano', () => {
    const baker = newAvatar({ id: randomUUID(), accountId: randomUUID(), rarity: 'common', jobCode: 'padeiro' }, t0);
    const nurse = { ...baker, jobCode: 'enfermeira' };
    const seed = 'cd'.repeat(32);
    const id = randomUUID();
    const a = settle(startShift(baker, { id, hours: 6, hoursToday: 0, running: false, seed }, t0).shift);
    const b = settle(startShift(nurse, { id, hours: 6, hoursToday: 0, running: false, seed }, t0).shift);
    expect(a.factors.event).toBe(1.2);
    expect(b.factors.event).toBe(1);

    // Uma semente com sorteio de dano entre 2,5% e 5%: sem GamePass dá dano; com nível 5 (corte de 50%), não.
    let s = '';
    for (let i = 0; i < 20_000 && !s; i++) {
      const candidate = i.toString(16).padStart(64, '0');
      const d = draw(candidate, id, 'damage');
      if (d >= DAMAGE_CHANCE / 2 && d < DAMAGE_CHANCE) s = candidate;
    }
    const plain = settle(startShift(baker, { id, hours: 6, hoursToday: 0, running: false, seed: s }, t0).shift);
    const vip = settle(startShift(baker, { id, hours: 6, hoursToday: 0, running: false, seed: s, damageCut: damageCut(5) }, t0).shift);
    expect(plain.damaged).toBe(true);
    expect(vip.damaged).toBe(false);
    // Turno de antes dos eventos (sem o campo no retrato): fator 1.
    const old = startShift(baker, { id, hours: 6, hoursToday: 0, running: false, seed }, t0).shift;
    expect(settle({ ...old, snapshot: { ...old.snapshot, event: undefined } }).factors.event).toBe(1);
  });
});

describe('GamePass', () => {
  it('temporada 1 aberta por 12 semanas; subir paga só a diferença; cada nível corta 10%', () => {
    expect(seasonAt(t0)!.code).toBe('s1');
    expect(seasonAt(new Date(SEASONS[0]!.endsAt.getTime()))).toBeNull();
    expect(checkPassUpgrade(0, 3, seasonAt(t0)).wei).toBe(15n * WEI);
    expect(checkPassUpgrade(3, 5, seasonAt(t0)).wei).toBe(10n * WEI);
    expect(code(() => checkPassUpgrade(3, 3, seasonAt(t0)))).toBe('level_owned');
    expect(code(() => checkPassUpgrade(0, 6, seasonAt(t0)))).toBe('invalid_level');
    expect(code(() => checkPassUpgrade(0, 1, null))).toBe('no_season');
    expect([0, 1, 5, 9].map(damageCut)).toEqual([0, 0.1, 0.5, 0.5]);
  });
});

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 5 }) : null;
afterAll(() => pool?.end());

describe.each([
  ['memória', () => new MemoryGamePassStore(), true],
  ['postgres', () => new PostgresGamePassStore(pool!), pool !== null],
] as [string, () => GamePassStore, boolean][])('store do GamePass (%s)', (_n, make, enabled) => {
  it.skipIf(!enabled)('o nível sobe uma vez a partir do esperado', async () => {
    const s = make();
    const me = randomUUID();
    expect(await s.level(me, 's1')).toBe(0);
    const first = await Promise.all([s.setLevel(me, 's1', 0, 2, t0), s.setLevel(me, 's1', 0, 3, t0)]);
    expect(first.filter(Boolean)).toHaveLength(1);
    const now = await s.level(me, 's1');
    expect(await s.setLevel(me, 's1', now, 5, t0)).toBe(true);
    expect(await s.setLevel(me, 's1', now, 4, t0)).toBe(false);
    expect(await s.level(me, 's1')).toBe(5);
    expect(await s.level(me, 's2')).toBe(0);
  });
});

class FakePayer implements GamePassPayer {
  scity = new Map<string, bigint>();
  keys = new Set<string>();
  async chargePass(i: { key: string; accountId: string; wei: bigint }) {
    if (this.keys.has(i.key)) return;
    const b = this.scity.get(i.accountId) ?? 0n;
    if (b < i.wei) throw new AppError('insufficient_scity', 'SCITY insuficiente.', 409);
    this.scity.set(i.accountId, b - i.wei);
    this.keys.add(i.key);
  }
}

describe('API dos eventos e do GamePass', () => {
  let payer: FakePayer;
  let avatars: MemoryAvatarStore;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    payer = new FakePayer();
    avatars = new MemoryAvatarStore();
    app = await buildApp(config, avatars, () => t0, null, null, null, () => 0.5, null, null, null, null, { store: new MemoryGamePassStore(), payer });
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

  it('calendário dos eventos, compra do GamePass em degraus e o corte de dano no turno', async () => {
    const ev = (await app.inject({ url: '/v1/events' })).json();
    expect(ev.current).toMatchObject({ group: 'comida', name: 'Evento gastronômico', factor: 1.2 });
    expect(ev.next.map((e: { group: string }) => e.group)).toEqual(['saude', 'lazer', 'cidade']);

    const me = randomUUID();
    const h = await auth(me);
    payer.scity.set(me, 30n * WEI);
    expect((await app.inject({ url: '/v1/gamepass', headers: h })).json()).toMatchObject({ season: { code: 's1' }, level: 0, damage_cut: 0 });
    const two = await app.inject({ method: 'POST', url: '/v1/gamepass', headers: h, payload: { level: 2 } });
    expect(two.json()).toMatchObject({ level: 2, wei: (10n * WEI).toString(), damage_cut: 0.2 });
    const five = await app.inject({ method: 'POST', url: '/v1/gamepass', headers: h, payload: { level: 5 } });
    expect(five.json()).toMatchObject({ level: 5, wei: (15n * WEI).toString() });
    expect(payer.scity.get(me)).toBe(5n * WEI);
    const view = (await app.inject({ url: '/v1/gamepass', headers: h })).json();
    expect(view.items.every((i: { unlocked: boolean }) => i.unlocked)).toBe(true);
    expect((await app.inject({ method: 'POST', url: '/v1/gamepass', headers: h, payload: { level: 5 } })).json().error.code).toBe('level_owned');

    const poor = randomUUID();
    const nope = await app.inject({ method: 'POST', url: '/v1/gamepass', headers: await auth(poor), payload: { level: 1 } });
    expect(nope.json().error.code).toBe('insufficient_scity');

    // O turno de quem tem o nível 5 leva o corte no retrato.
    const a = await avatars.create(newAvatar({ id: randomUUID(), accountId: me, rarity: 'common', jobCode: 'padeiro' }, t0));
    const work = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/work`, headers: h, payload: { shift: 6 } });
    expect(work.statusCode).toBe(201);
    const [shift] = await avatars.listShifts(a.id, 1);
    expect(shift!.snapshot).toMatchObject({ event: 1.2, damageCut: 0.5 });
  });
});
