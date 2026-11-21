import { randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { newAvatar } from '../src/domain/avatar.js';
import {
  type Farm,
  type FarmPayer,
  type FarmStore,
  applyHarvest,
  applyMachine,
  applyPlant,
  applyPlow,
  checkHarvest,
  checkLevelUp,
  checkPlant,
  checkPlow,
  newFarm,
  plan,
  seasonAt,
  unitsNow,
} from '../src/domain/farm.js';
import { PostgresFarmStore } from '../src/infra/db/postgres-farm-store.js';
import { MemoryFarmStore } from '../src/infra/memory-farm-store.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const INTERNAL = 'chave-interna-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: INTERNAL });
const DAY = 86_400_000;
/** Semana 0 (verão). */
const t0 = new Date('2026-11-21T08:00:00Z');
const at = (days: number) => new Date(t0.getTime() + days * DAY);
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return null;
};
const seeds = (n: number) => Array.from({ length: n }, (_, i) => i.toString(16).padStart(64, '0'));

describe('estações e plantio', () => {
  it('estação muda a cada 7 dias: verão, outono, inverno, primavera', () => {
    expect([0, 7, 14, 21, 28].map((d) => seasonAt(at(d)).code)).toEqual(['verao', 'outono', 'inverno', 'primavera', 'verao']);
    expect(seasonAt(at(14)).factor).toBe(0.5);
  });

  it('unidades pela estação e pelo separador; crescimento pelo nível e pelo irrigador', () => {
    const f = newFarm('x', t0);
    const clean = seeds(400).find((s) => plan(f, 'uva', t0, s).damage === null)!;
    expect(plan(f, 'uva', t0, clean)).toMatchObject({ units: 10, readyAt: at(1) });
    expect(plan(f, 'uva', at(14), clean).units).toBe(5);
    const tooled = applyMachine(applyMachine(f, 'separador'), 'irrigador');
    expect(plan(tooled, 'uva', t0, clean)).toMatchObject({ units: 12, readyAt: at(0.75) });
    expect(plan({ ...tooled, level: 3 }, 'maca', t0, clean).readyAt).toEqual(at(2.25));
  });

  it('riscos: apodrece perde tudo; pássaros nas frutas e corvos nos grãos levam metade; as proteções reduzem', () => {
    const f = newFarm('x', t0);
    const all = seeds(3000);
    const rate = (farm: Farm, crop: 'uva' | 'tomate', dmg: string) => all.filter((s) => plan(farm, crop, t0, s).damage === dmg).length / all.length;
    expect(rate(f, 'uva', 'apodreceu')).toBeGreaterThan(0.03);
    expect(rate(f, 'uva', 'apodreceu')).toBeLessThan(0.07);
    expect(rate(f, 'tomate', 'passaros')).toBe(0);
    expect(rate(f, 'uva', 'corvos')).toBe(0);
    expect(rate(applyMachine(f, 'agrotoxico'), 'uva', 'passaros')).toBeLessThan(rate(f, 'uva', 'passaros'));
    expect(rate(applyMachine(f, 'espantalho'), 'tomate', 'corvos')).toBeLessThan(rate(f, 'tomate', 'corvos'));
    const rot = all.find((s) => plan(f, 'uva', t0, s).damage === 'apodreceu')!;
    expect(plan(f, 'uva', t0, rot).units).toBe(0);
    const rabbit = all.find((s) => plan(f, 'uva', t0, s).damage === 'coelhos')!;
    expect(plan(f, 'uva', t0, rabbit).units).toBe(7);
    expect(plan(applyMachine(f, 'cao'), 'uva', t0, rabbit).units).toBe(8);
  });

  it('colheita atrasada perde 5% por dia depois do 1º dia; o drone corta pela metade', () => {
    const f = newFarm('x', t0);
    const p = { crop: 'uva' as const, plantedAt: t0, readyAt: at(1), seed: '00', units: 10, damage: null };
    expect(unitsNow(f, p, at(0.5))).toBe(0);
    expect(unitsNow(f, p, at(2.5))).toBe(10);
    expect(unitsNow(f, p, at(5))).toBe(8);
    expect(unitsNow(applyMachine(f, 'drone'), p, at(5))).toBe(9);
    expect(unitsNow(f, p, at(100))).toBe(0);
  });

  it('arar pede enxada; plantar pede canteiro arado e cultura do nível; colher pede pronto; subir pede 3 colheitas', () => {
    let f = newFarm('x', t0);
    expect(code(() => checkPlow(f, 0))).toBe('needs_hoe');
    f = applyMachine(f, 'enxada');
    expect(code(() => checkPlant(f, 0, 'uva'))).toBe('not_plowed');
    f = applyPlow(f, 0);
    expect(code(() => checkPlow(f, 0))).toBe('already_plowed');
    expect(code(() => checkPlant(f, 0, 'maca'))).toBe('crop_locked');
    expect(code(() => checkPlant(f, 0, 'abacaxi'))).toBe('invalid_crop');
    expect(code(() => checkPlant(f, 9, 'uva'))).toBe('invalid_plot');
    f = applyPlant(f, 0, plan(f, 'uva', t0));
    expect(code(() => checkPlow(f, 0))).toBe('plot_busy');
    expect(code(() => checkHarvest(f, 0, t0))).toBe('not_ready');
    expect(code(() => checkHarvest(f, 1, t0))).toBe('nothing_planted');
    f = applyHarvest(f, 0);
    expect(f.plots[0]).toEqual({ cycle: 1, plowed: false, planting: null });
    expect(code(() => checkLevelUp(f))).toBe('needs_harvests');
    expect(checkLevelUp({ ...f, harvestsAtLevel: 3 })).toEqual({ cents: 500_000n, to: 2 });
    expect(code(() => checkLevelUp({ ...f, level: 3, harvestsAtLevel: 9 }))).toBe('max_level');
  });
});

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 5 }) : null;
afterAll(() => pool?.end());

describe.each([
  ['memória', () => new MemoryFarmStore(), true],
  ['postgres', () => new PostgresFarmStore(pool!), pool !== null],
] as [string, () => FarmStore, boolean][])('store da fazenda (%s)', (_n, make, enabled) => {
  it.skipIf(!enabled)('uma por conta; grava com a trava otimista; ida e volta do plantio', async () => {
    const s = make();
    const f = applyMachine(newFarm(randomUUID(), t0), 'enxada');
    expect(await s.create(f)).toBe(true);
    expect(await s.create(f)).toBe(false);
    const planted = applyPlant(applyPlow(f, 2), 2, plan(f, 'cenoura', t0, 'ab'.repeat(32)));
    const both = await Promise.all([s.save(planted), s.save(applyPlow(f, 1))]);
    expect(both.filter(Boolean)).toHaveLength(1);
    const back = (await s.get(f.accountId))!;
    expect(back.version).toBe(1);
    if (both[0]) expect(back.plots[2]!.planting).toEqual(planted.plots[2]!.planting);
    expect(back.machines).toEqual(['enxada']);
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

describe('API da fazenda', () => {
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

  it('compra, enxada, ara (contratado e com o agricultor), planta, colhe para a despensa e sobe de nível', async () => {
    const me = randomUUID();
    const h = await auth(me);
    payer.balances.set(me, 2_000_000n);
    const farmer = await avatars.create(newAvatar({ id: randomUUID(), accountId: me, rarity: 'common', jobCode: 'agricultor' }, t0));
    const baker = await avatars.create(newAvatar({ id: randomUUID(), accountId: me, rarity: 'common', jobCode: 'padeiro' }, t0));

    expect((await app.inject({ url: '/v1/farm', headers: h })).json().farm).toBeNull();
    const bought = await app.inject({ method: 'POST', url: '/v1/farm', headers: h });
    expect(bought.statusCode).toBe(201);
    expect(bought.json().farm).toMatchObject({ level: 1, season: { code: 'verao' }, plots: [{ index: 0, plowed: false }, {}, {}, {}] });
    expect((await app.inject({ method: 'POST', url: '/v1/farm', headers: h })).json().error.code).toBe('farm_owned');

    const noHoe = await app.inject({ method: 'POST', url: '/v1/farm/plots/1/plow', headers: h, payload: {} });
    expect(noHoe.json().error.code).toBe('needs_hoe');
    await app.inject({ method: 'POST', url: '/v1/farm/machines', headers: h, payload: { machine: 'enxada' } });

    const own = await app.inject({ method: 'POST', url: '/v1/farm/plots/1/plow', headers: h, payload: { avatar_id: farmer.id } });
    expect(own.json()).toMatchObject({ hired: false, farm: { plots: [{ plowed: true }, {}, {}, {}] } });
    expect((await avatars.get(farmer.id))!.attributes.energy).toBe(9);
    const notFarmer = await app.inject({ method: 'POST', url: '/v1/farm/plots/2/plow', headers: h, payload: { avatar_id: baker.id } });
    expect(notFarmer.json().error.code).toBe('not_a_farmer');
    const hired = await app.inject({ method: 'POST', url: '/v1/farm/plots/2/plow', headers: h, payload: {} });
    expect(hired.json().hired).toBe(true);

    const locked = await app.inject({ method: 'POST', url: '/v1/farm/plots/1/plant', headers: h, payload: { crop: 'maca' } });
    expect(locked.json().error.code).toBe('crop_locked');
    const planted = await app.inject({ method: 'POST', url: '/v1/farm/plots/1/plant', headers: h, payload: { crop: 'uva' } });
    expect(planted.json().farm.plots[0]).toMatchObject({ crop: 'uva', ready: false, units_now: null, ready_at: at(1).toISOString() });

    clock = at(1.5);
    const harvested = await app.inject({ method: 'POST', url: '/v1/farm/plots/1/harvest', headers: h, payload: { avatar_id: baker.id } });
    const { units } = harvested.json().harvest;
    expect(harvested.json().harvest).toMatchObject({ crop: 'uva', seed: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect((await avatars.get(baker.id))!.pantry.uva ?? 0).toBe(units);
    expect(harvested.json().farm).toMatchObject({ harvests_at_level: 1, plots: [{ plowed: false, crop: null }, {}, {}, {}] });

    // Mais 2 colheitas no canteiro 2 e o nível 2 abre a laranja.
    for (let n = 0; n < 2; n++) {
      if (n > 0) await app.inject({ method: 'POST', url: '/v1/farm/plots/2/plow', headers: h, payload: {} });
      await app.inject({ method: 'POST', url: '/v1/farm/plots/2/plant', headers: h, payload: { crop: 'tomate' } });
      clock = new Date(clock.getTime() + 1.5 * DAY);
      await app.inject({ method: 'POST', url: '/v1/farm/plots/2/harvest', headers: h, payload: { avatar_id: baker.id } });
    }
    const up = await app.inject({ method: 'POST', url: '/v1/farm/level', headers: h });
    expect(up.json().farm).toMatchObject({ level: 2, harvests_at_level: 0 });
    expect(up.json().farm.crops.map((c: { code: string }) => c.code)).toContain('laranja');
    // 2.000.000 − 1.000.000 (slot) − 5.000 (enxada) − 1.000 × 2 (aragens contratadas) − 500 × 3 (sementes) − 500.000 (nível 2).
    expect(payer.balances.get(me)).toBe(491_500n);
  });

  it('sem fazenda é 404; sem THALER não compra', async () => {
    const me = randomUUID();
    const h = await auth(me);
    expect((await app.inject({ method: 'POST', url: '/v1/farm/plots/1/plant', headers: h, payload: { crop: 'uva' } })).json().error.code).toBe('no_farm');
    expect((await app.inject({ method: 'POST', url: '/v1/farm', headers: h })).json().error.code).toBe('insufficient_thaler');
  });
});
