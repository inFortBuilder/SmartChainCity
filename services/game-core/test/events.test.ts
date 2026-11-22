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
  type EventGroup,
  type GamePassPayer,
  type GamePassStore,
  SEED_EVENT_GROUPS,
  SEED_SEASONS,
  PASS_LEVEL_CAP,
  type Season,
  checkPassUpgrade,
  eventAt,
  eventFactor,
  eventGroups,
  eventOfWeek,
  eventsOrigin,
  perks,
  replaceEventGroups,
  replaceSeasons,
  seasonAt,
  seasonList,
  validateEventGroups,
  validateSeasons,
  weekOf,
} from '../src/domain/events.js';
import { fetchCmsEventGroups, fetchCmsSeasons } from '../src/infra/cms-catalog.js';
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
    const all = eventGroups().flatMap((g) => [...g.jobs]);
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
    const vip = settle(startShift(baker, { id, hours: 6, hoursToday: 0, running: false, seed: s, damageCut: perks(seasonAt(t0), 5).damageCut }, t0).shift);
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
    expect(seasonAt(new Date(seasonList()[0]!.endsAt.getTime()))).toBeNull();
    expect(checkPassUpgrade(0, 3, seasonAt(t0)).wei).toBe(15n * WEI);
    expect(checkPassUpgrade(3, 5, seasonAt(t0)).wei).toBe(10n * WEI);
    expect(code(() => checkPassUpgrade(3, 3, seasonAt(t0)))).toBe('level_owned');
    expect(code(() => checkPassUpgrade(0, 6, seasonAt(t0)))).toBe('invalid_level');
    expect(code(() => checkPassUpgrade(0, 1, null))).toBe('no_season');
    // O troféu (nível 4) corta mais 5%; os itens de ganho somam 2% + 3% + 5%.
    const s1 = seasonAt(t0);
    expect([0, 1, 3, 4, 5, 9].map((l) => perks(s1, l).damageCut)).toEqual([0, 0.1, 0.3, 0.45, 0.55, 0.55]);
    expect([0, 1, 2, 3, 5].map((l) => perks(s1, l).earnBonus)).toEqual([0, 0, 0.02, 0.05, 0.1]);
    expect(perks(null, 5)).toMatchObject({ damageCut: 0, earnBonus: 0 });
  });

  it('itens sazonais: o bônus de ganho entra no turno e some fora da temporada', () => {
    const baker = newAvatar({ id: randomUUID(), accountId: randomUUID(), rarity: 'common', jobCode: 'padeiro' }, t0);
    const id = randomUUID();
    const seed = 'ab'.repeat(32);
    const plain = settle(startShift(baker, { id, hours: 6, hoursToday: 0, running: false, seed }, t0).shift);
    const bonus = settle(startShift(baker, { id, hours: 6, hoursToday: 0, running: false, seed, earnBonus: 0.1 }, t0).shift);
    expect(bonus.factors.items).toBe(1.1);
    expect(Number(bonus.thalerCents)).toBeCloseTo(Number(plain.thalerCents) * 1.1, -1);
    // Depois da temporada 1, nada de itens.
    expect(perks(seasonAt(new Date('2027-03-01T00:00:00Z')), 5).earnBonus).toBe(0);
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

  it.skipIf(!enabled)('temporada do Strapi com mais níveis: o banco aceita até o teto (PASS_LEVEL_CAP)', async () => {
    const s = make();
    const me = randomUUID();
    expect(await s.setLevel(me, 's-longa', 0, 8, t0)).toBe(true);
    expect(await s.setLevel(me, 's-longa', 8, PASS_LEVEL_CAP, t0)).toBe(true);
    expect(await s.level(me, 's-longa')).toBe(PASS_LEVEL_CAP);
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

  it('temporada de 8 níveis (CMS): compra o nível 8 e recusa o 9', async () => {
    try {
      replaceSeasons([{ ...SEED_SEASONS[0]!, maxLevel: 8, damageCutPerLevel: 0.05 }], 'cms', t0);
      const me = randomUUID();
      const h = await auth(me);
      payer.scity.set(me, 100n * WEI);
      const eight = await app.inject({ method: 'POST', url: '/v1/gamepass', headers: h, payload: { level: 8 } });
      expect(eight.json()).toMatchObject({ level: 8, wei: (40n * WEI).toString() });
      const nine = await app.inject({ method: 'POST', url: '/v1/gamepass', headers: h, payload: { level: 9 } });
      expect(nine.json().error.code).toBe('invalid_level');
      expect((await app.inject({ url: '/v1/gamepass', headers: h })).json()).toMatchObject({ level: 8, max_level: 8 });
    } finally {
      replaceSeasons(SEED_SEASONS, 'seed', t0);
    }
  });

  it.skipIf(!pool)('nível 8 no Postgres pela API', async () => {
    const pg = await buildApp(config, avatars, () => t0, null, null, null, () => 0.5, null, null, null, null, { store: new PostgresGamePassStore(pool!), payer });
    try {
      replaceSeasons([{ ...SEED_SEASONS[0]!, maxLevel: 8, damageCutPerLevel: 0.05 }], 'cms', t0);
      const me = randomUUID();
      payer.scity.set(me, 100n * WEI);
      const r = await pg.inject({ method: 'POST', url: '/v1/gamepass', headers: await auth(me), payload: { level: 8 } });
      expect(r.statusCode).toBe(200);
      expect(r.json().level).toBe(8);
    } finally {
      replaceSeasons(SEED_SEASONS, 'seed', t0);
    }
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
    expect(two.json()).toMatchObject({ level: 2, wei: (10n * WEI).toString(), damage_cut: 0.2, earn_bonus: 0.02 });
    const five = await app.inject({ method: 'POST', url: '/v1/gamepass', headers: h, payload: { level: 5 } });
    expect(five.json()).toMatchObject({ level: 5, wei: (15n * WEI).toString() });
    expect(payer.scity.get(me)).toBe(5n * WEI);
    const view = (await app.inject({ url: '/v1/gamepass', headers: h })).json();
    expect(view.items.every((i: { unlocked: boolean }) => i.unlocked)).toBe(true);
    expect(view).toMatchObject({ origin: 'seed', max_level: 5, damage_cut: 0.55, earn_bonus: 0.1 });
    expect(view.items.find((i: { code: string }) => i.code === 'placa-t1')).toMatchObject({ effect: 'earn', value: 0.05 });
    expect((await app.inject({ method: 'POST', url: '/v1/gamepass', headers: h, payload: { level: 5 } })).json().error.code).toBe('level_owned');

    const poor = randomUUID();
    const nope = await app.inject({ method: 'POST', url: '/v1/gamepass', headers: await auth(poor), payload: { level: 1 } });
    expect(nope.json().error.code).toBe('insufficient_scity');

    // O turno de quem tem o nível 5 leva o corte no retrato.
    const a = await avatars.create(newAvatar({ id: randomUUID(), accountId: me, rarity: 'common', jobCode: 'padeiro' }, t0));
    const work = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/work`, headers: h, payload: { shift: 6 } });
    expect(work.statusCode).toBe(201);
    const [shift] = await avatars.listShifts(a.id, 1);
    expect(shift!.snapshot).toMatchObject({ event: 1.2, damageCut: 0.55, items: 1.1 });
  });
});

describe('eventos e temporadas vindos do Strapi', () => {
  const group = (over: Partial<EventGroup> = {}): EventGroup => ({
    code: 'g',
    label: 'G',
    order: 0,
    factor: 1.2,
    jobs: ['padeiro'],
    events: ['Feira'],
    ...over,
  });
  const season = (over: Partial<Season> = {}): Season => ({
    ...SEED_SEASONS[0]!,
    ...over,
  });
  const restore = () => {
    replaceEventGroups(SEED_EVENT_GROUPS, 'seed');
    replaceSeasons(SEED_SEASONS, 'seed', t0);
  };

  it('dado quebrado não entra', () => {
    const msg = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return (error as Error).message;
      }
      return null;
    };
    expect(msg(() => validateEventGroups([group({ jobs: ['inexistente'] })]))).toMatch(/profissão desconhecida/);
    expect(msg(() => validateEventGroups([group(), group({ code: 'h', order: 1 })]))).toMatch(/padeiro está em g e em h/);
    expect(msg(() => validateEventGroups([group({ factor: 3 })]))).toMatch(/fator/);
    expect(msg(() => validateEventGroups([]))).toMatch(/nenhum grupo/);
    const s1 = season();
    const s2 = season({ code: 's2', startsAt: new Date(s1.endsAt.getTime() - 1000), endsAt: new Date(s1.endsAt.getTime() + 84 * 86_400_000) });
    expect(msg(() => validateSeasons([s1, s2]))).toMatch(/começa antes de s1 acabar/);
    const greedy = season({ items: [{ level: 1, code: 'x', label: 'X', effect: 'earn', value: 0.1 }, { level: 2, code: 'y', label: 'Y', effect: 'earn', value: 0.1 }] });
    expect(msg(() => validateSeasons([greedy]))).toMatch(/mais de 15%/);
    expect(msg(() => validateSeasons([season({ items: [{ level: 9, code: 'z', label: 'Z', effect: 'earn', value: 0.01 }] })]))).toMatch(/fora dos níveis/);
  });

  it('a temporada aberta não some nem muda de datas', () => {
    try {
      const later = season({ code: 's1', startsAt: new Date('2026-12-01T00:00:00Z'), endsAt: new Date('2027-03-01T00:00:00Z') });
      expect(() => replaceSeasons([later], 'cms', t0)).toThrow(/temporada aberta s1/);
      expect(() => replaceSeasons([season({ code: 'outra' })], 'cms', t0)).toThrow(/temporada aberta s1/);
      // Mudar preço e itens da temporada aberta pode (vale para quem subir de nível depois).
      replaceSeasons([season({ levelPriceScity: 7 })], 'cms', t0);
      expect(checkPassUpgrade(0, 1, seasonAt(t0)).wei).toBe(7n * WEI);
      expect(eventsOrigin().seasons).toBe('cms');
    } finally {
      restore();
    }
  });

  it('lê o que o Strapi publica e troca o calendário', async () => {
    const respond = (data: unknown) => (async () => new Response(JSON.stringify({ data }), { status: 200 })) as unknown as typeof fetch;
    const groups = await fetchCmsEventGroups(
      'http://cms.test/',
      respond(SEED_EVENT_GROUPS.map((g) => ({ ...g, factor: g.code === 'comida' ? '1.5' : String(g.factor) }))),
    );
    const seasons = await fetchCmsSeasons(
      'http://cms.test',
      respond(SEED_SEASONS.map((x) => ({ ...x, startsAt: x.startsAt.toISOString(), endsAt: x.endsAt.toISOString(), damageCutPerLevel: '0.08' }))),
    );
    try {
      replaceEventGroups(groups, 'cms');
      replaceSeasons(seasons, 'cms', t0);
      expect(eventFactor('padeiro', t0)).toBe(1.5);
      expect(perks(seasonAt(t0), 1).damageCut).toBe(0.08);
      expect(eventsOrigin()).toEqual({ groups: 'cms', seasons: 'cms' });
    } finally {
      restore();
    }
    await expect(fetchCmsSeasons('http://cms.test', (async () => new Response('', { status: 500 })) as unknown as typeof fetch)).rejects.toThrow(/500/);
  });
});
