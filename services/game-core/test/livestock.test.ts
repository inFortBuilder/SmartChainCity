import { randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { newAvatar } from '../src/domain/avatar.js';
import { type FarmPayer, type FarmStore, newFarm } from '../src/domain/farm.js';
import { PostgresFarmStore } from '../src/infra/db/postgres-farm-store.js';
import {
  type Animal,
  type Livestock,
  advance,
  applyBreed,
  applyFeed,
  applyStructure,
  checkAnimal,
  checkBreed,
  checkClean,
  checkFeed,
  collect,
  emptyLivestock,
  hatch,
  newAnimal,
  slaughter,
} from '../src/domain/livestock.js';
import { MemoryFarmStore } from '../src/infra/memory-farm-store.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const INTERNAL = 'chave-interna-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: INTERNAL });
const DAY = 86_400_000;
const t0 = new Date('2026-11-21T08:00:00Z');
const at = (d: number) => new Date(t0.getTime() + d * DAY);
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return null;
};
/** Rebanho com estruturas e semente sem riscos nos primeiros dias (a semente é procurada no teste dos riscos). */
const SAFE = '00'.repeat(32);
const base = (structures: Livestock['structures'] = ['galinheiro', 'chiqueiro', 'pasto', 'comedouro', 'chocadeira']): Livestock => {
  let l: Livestock = { ...emptyLivestock(t0), seed: SAFE };
  for (const s of structures) l = applyStructure(l, s, t0);
  return l;
};
const adult = (a: Animal, fedAt = t0): Animal => ({ ...a, feeds: 3, lastFedAt: fedAt });
const withAnimals = (l: Livestock, ...animals: Animal[]): Livestock => ({ ...l, animals });

describe('pecuária', () => {
  it('estruturas e lotação: galinheiro até 12, um galo a cada 12, chiqueiro até 6, gado precisa de pasto e comedouro', () => {
    expect(code(() => checkAnimal(base([]), 'galinha'))).toBe('needs_structure');
    expect(code(() => checkAnimal(base(['pasto']), 'vaca'))).toBe('needs_structure');
    expect(checkAnimal(base(), 'boi').cents).toBe(15_000n);
    const full = withAnimals(base(), ...Array.from({ length: 12 }, () => newAnimal('galinha', t0)));
    expect(code(() => checkAnimal(full, 'galinha'))).toBe('coop_full');
    const oneRooster = withAnimals(base(), newAnimal('galo', t0), newAnimal('galinha', t0));
    expect(code(() => checkAnimal(oneRooster, 'galo'))).toBe('too_many_roosters');
    expect(code(() => checkAnimal(withAnimals(base(), ...Array.from({ length: 6 }, () => newAnimal('porco', t0))), 'porco'))).toBe('pigsty_full');
    expect(code(() => checkAnimal(base(), 'girafa'))).toBe('invalid_breed');
  });

  it('alimenta 1 vez por dia com milho ou trigo da despensa; adulto com 3; nível 2 com 10', () => {
    const hen = newAnimal('galinha', t0);
    let l = withAnimals(base(), hen);
    expect(code(() => checkFeed(l, hen.id, 'uva', { uva: 5 }, t0))).toBe('invalid_feed');
    expect(code(() => checkFeed(l, hen.id, 'milho', {}, t0))).toBe('not_in_pantry');
    l = applyFeed(l, hen.id, t0);
    expect(code(() => checkFeed(l, hen.id, 'milho', { milho: 1 }, at(0.5)))).toBe('already_fed');
    for (let d = 1; d < 10; d++) l = applyFeed(l, hen.id, at(d));
    const fed = l.animals[0]!;
    expect(fed.feeds).toBe(10);
    // Ovos guardados com o nível 2 (+10%).
    const c = collect({ ...l, animals: [{ ...fed, stock: 10 }] });
    expect(c.eggs).toBe(11);
  });

  it('galinha alimentada e galinheiro limpo põe 1 ovo por dia (até 3 guardados); suja ou com fome, não', () => {
    const hen = adult(newAnimal('galinha', t0));
    const l = withAnimals(base(), hen);
    expect(advance(l, false, at(2)).animals[0]!.stock).toBe(1);
    // Sem comer desde t0: depois do 1º dia para de pôr.
    expect(advance(l, false, at(6)).animals[0]!.stock).toBe(1);
    // Alimentada todo dia: guarda até 3.
    let daily = l;
    for (let d = 1; d <= 6; d++) daily = advance(applyFeed(daily, hen.id, at(d - 0.5)), false, at(d));
    expect(daily.animals[0]!.stock).toBe(3);
    // Galinheiro sujo (limpeza de 5 dias vencida): nada.
    const dirty = { ...l, coopCleanedAt: at(-10) };
    expect(advance(dirty, false, at(2)).animals[0]!.stock).toBe(0);
    // Galinha dos ovos de ouro: 2 por dia.
    expect(advance(withAnimals(base(), { ...hen, golden: true }), false, at(1)).animals[0]!.stock).toBe(2);
  });

  it('vaca dá leite a cada 3 dias; porco morre com 3 dias sem comida; gado morre aos 45 dias', () => {
    const cow = adult(newAnimal('vaca', t0));
    expect(advance(withAnimals(base(), cow), false, at(2.9)).animals[0]!.stock).toBe(0);
    expect(advance(withAnimals(base(), { ...cow, lastFedAt: at(2.5) }), false, at(3)).animals[0]!.stock).toBe(1);
    const pig = newAnimal('porco', t0);
    const starved = advance(withAnimals(base(), pig), false, at(3));
    expect(starved.animals).toHaveLength(0);
    expect(starved.log.at(-1)!.text).toContain('fome');
    expect(advance(withAnimals(base(), { ...pig, lastFedAt: at(2) }), false, at(3)).animals).toHaveLength(1);
    expect(advance(withAnimals(base(), { ...cow, lastFedAt: at(44.9) }), false, at(45)).animals).toHaveLength(0);
  });

  it('riscos do dia: aftosa mata 25% do gado; raposas matam 50% das galinhas (o cão protege)', () => {
    const cattle = Array.from({ length: 8 }, () => ({ ...adult(newAnimal('boi', t0)), lastFedAt: t0 }));
    let aftosaSeed = '';
    for (let i = 0; i < 5000 && !aftosaSeed; i++) {
      const seed = i.toString(16).padStart(64, '0');
      if (advance({ ...withAnimals(base(), ...cattle), seed }, false, at(1)).animals.length === 6) aftosaSeed = seed;
    }
    expect(aftosaSeed).not.toBe('');
    const hens = Array.from({ length: 8 }, () => adult(newAnimal('galinha', t0)));
    let foxSeed = '';
    for (let i = 0; i < 5000 && !foxSeed; i++) {
      const seed = i.toString(16).padStart(64, '0');
      if (advance({ ...withAnimals(base(), ...hens), seed }, false, at(1)).animals.length === 4) foxSeed = seed;
    }
    expect(foxSeed).not.toBe('');
    const dog = advance({ ...withAnimals(base(), ...hens), seed: foxSeed }, true, at(1));
    expect(dog.animals).toHaveLength(8);
    expect(dog.log.at(-1)!.text).toContain('cão');
  }, 20_000);

  it('abate: adulto dá carne crua com o bônus do nível; filhote, nada', () => {
    const pig = newAnimal('porco', t0);
    expect(slaughter(withAnimals(base(), pig), pig.id).meat).toBe(0);
    expect(slaughter(withAnimals(base(), adult(pig)), pig.id).meat).toBe(3);
    expect(slaughter(withAnimals(base(), { ...adult(pig), feeds: 20 }), pig.id).meat).toBe(3);
    const ox = { ...adult(newAnimal('boi', t0)), feeds: 20 };
    expect(slaughter(withAnimals(base(), ox), ox.id).meat).toBe(7);
  });

  it('reprodução: casal adulto da espécie (galo com galinha), grão da despensa e 3 dias de espera; chocadeira', () => {
    const hen = adult(newAnimal('galinha', t0));
    const hen2 = adult(newAnimal('galinha', t0));
    const rooster = adult(newAnimal('galo', t0));
    const l = withAnimals(base(), hen, hen2, rooster);
    expect(code(() => checkBreed(l, [hen.id, hen2.id], 'milho', { milho: 1 }, t0))).toBe('invalid_pair');
    expect(code(() => checkBreed(l, [hen.id, rooster.id], 'milho', {}, t0))).toBe('not_in_pantry');
    const { a, b, baby } = checkBreed(l, [hen.id, rooster.id], 'trigo', { trigo: 1 }, t0);
    expect(baby).toBe('galinha');
    const bred = applyBreed(l, a, b, baby, t0);
    expect(bred.animals).toHaveLength(4);
    expect(code(() => checkBreed(bred, [hen.id, rooster.id], 'trigo', { trigo: 1 }, at(2)))).toBe('breed_wait');
    expect(code(() => checkBreed(l, [newAnimal('porco', t0).id, rooster.id], 'trigo', { trigo: 1 }, t0))).toBe('animal_not_found');
    const young = newAnimal('vaca', t0);
    const bull = adult(newAnimal('boi', t0));
    expect(code(() => checkBreed(withAnimals(base(), young, bull), [young.id, bull.id], 'milho', { milho: 1 }, t0))).toBe('not_adult');

    expect(code(() => hatch(base(['galinheiro']), { ovos: 1 }, t0))).toBe('needs_structure');
    expect(code(() => hatch(base(), {}, t0))).toBe('not_in_pantry');
    expect(hatch(base(), { ovos: 1 }, t0, 0.01).golden).toBe(true);
    expect(hatch(base(), { ovos: 1 }, t0, 0.5).golden).toBe(false);
  });

  it('limpeza do galinheiro: só perto de vencer', () => {
    expect(code(() => checkClean(base([]), t0))).toBe('needs_structure');
    expect(code(() => checkClean(base(), t0))).toBe('coop_clean');
    expect(checkClean(base(), at(4.5)).cents).toBe(3_000n);
  });
});

class FakePayer implements FarmPayer {
  balances = new Map<string, bigint>();
  keys = new Set<string>();
  async chargeFarm(i: { key: string; accountId: string; cents: bigint }) {
    if (this.keys.has(i.key)) return;
    const b = this.balances.get(i.accountId) ?? 0n;
    if (b < i.cents) throw new AppError('insufficient_thaler', 'THALER insuficiente.', 409);
    this.balances.set(i.accountId, b - i.cents);
    this.keys.add(i.key);
  }
}

describe('API da pecuária', () => {
  let payer: FakePayer;
  let avatars: MemoryAvatarStore;
  let clock: Date;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    payer = new FakePayer();
    avatars = new MemoryAvatarStore();
    clock = t0;
    app = await buildApp(config, avatars, () => clock, null, null, null, () => 0.5, null, null, null, null, null, { store: new MemoryFarmStore(), payer });
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

  it('galinheiro, galinha, alimenta com o milho da despensa, coleta ovos, abate e limpa', async () => {
    const me = randomUUID();
    const h = await auth(me);
    payer.balances.set(me, 2_000_000n);
    const av = await avatars.create({
      ...newAvatar({ id: randomUUID(), accountId: me, rarity: 'common', jobCode: 'padeiro' }, t0),
      pantry: { milho: 10 },
    });
    await app.inject({ method: 'POST', url: '/v1/farm', headers: h });
    const noCoop = await app.inject({ method: 'POST', url: '/v1/farm/animals', headers: h, payload: { breed: 'galinha' } });
    expect(noCoop.json().error.code).toBe('needs_structure');
    const coop = await app.inject({ method: 'POST', url: '/v1/farm/structures', headers: h, payload: { structure: 'galinheiro' } });
    expect(coop.json().livestock).toMatchObject({ structures: ['galinheiro'], coop_clean: true });
    const bought = await app.inject({ method: 'POST', url: '/v1/farm/animals', headers: h, payload: { breed: 'galinha' } });
    const hen = bought.json().livestock.animals[0];
    expect(hen).toMatchObject({ label: 'Galinha', adult: false, feeds: 0 });

    for (let d = 0; d < 4; d++) {
      clock = at(d);
      const fed = await app.inject({ method: 'POST', url: `/v1/farm/animals/${hen.id}/feed`, headers: h, payload: { avatar_id: av.id, food: 'milho' } });
      expect(fed.statusCode).toBe(200);
    }
    expect((await avatars.get(av.id))!.pantry.milho).toBe(6);
    clock = at(4);
    const view = (await app.inject({ url: '/v1/farm', headers: h })).json().livestock.animals[0];
    expect(view).toMatchObject({ adult: true, feeds: 4 });
    const got = await app.inject({ method: 'POST', url: '/v1/farm/collect', headers: h, payload: { avatar_id: av.id } });
    expect(got.json().collected.ovos).toBeGreaterThan(0);
    expect((await avatars.get(av.id))!.pantry.ovos).toBe(got.json().collected.ovos);

    const meat = await app.inject({ method: 'POST', url: `/v1/farm/animals/${hen.id}/slaughter`, headers: h, payload: { avatar_id: av.id } });
    expect(meat.json()).toMatchObject({ meat: 1, livestock: { animals: [] } });
    expect((await avatars.get(av.id))!.pantry.carne_crua).toBe(1);

    clock = at(4.5);
    const clean = await app.inject({ method: 'POST', url: '/v1/farm/coop/clean', headers: h });
    expect(clean.json().livestock.coop_clean).toBe(true);
    // 2.000.000 − 1.000.000 (slot) − 30.000 (galinheiro) − 2.000 (galinha) − 3.000 (limpeza).
    expect(payer.balances.get(me)).toBe(965_000n);
  });
});

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 5 }) : null;
afterAll(() => pool?.end());

describe.each([
  ['memória', () => new MemoryFarmStore(), true],
  ['postgres', () => new PostgresFarmStore(pool!), pool !== null],
] as [string, () => FarmStore, boolean][])('rebanho no store da fazenda (%s)', (_n, make, enabled) => {
  it.skipIf(!enabled)('estruturas, animais com as datas e o registro voltam iguais', async () => {
    const s = make();
    const f = newFarm(randomUUID(), t0);
    await s.create(f);
    const hen = { ...adult(newAnimal('galinha', t0)), golden: true, lastBredAt: at(1), stock: 2 };
    const herd = { ...withAnimals(base(), hen, newAnimal('porco', t0)), bought: 2, log: [{ at: t0, text: 'teste' }] };
    expect(await s.save({ ...f, livestock: herd })).toBe(true);
    const back = (await s.get(f.accountId))!;
    expect(back.livestock).toEqual(herd);
  });
});
