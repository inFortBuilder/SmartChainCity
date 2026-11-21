import { randomUUID } from 'node:crypto';

import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { type Avatar, type AvatarStore, decayDue, decayed, newAvatar } from '../src/domain/avatar.js';
import { type Condition, SERIOUS_CODES, catchCondition, drainHealth } from '../src/domain/conditions.js';
import { HOSPITAL_FEE_CENTS, type HospitalStore, TREATMENT_STAY_MS, admit, treat } from '../src/domain/hospital.js';
import { planMedicine } from '../src/domain/meal.js';
import { PostgresAvatarStore } from '../src/infra/db/postgres-store.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';
import { runDecay } from '../src/jobs/decay.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const t0 = new Date('2026-11-20T08:00:00Z');
const at = (min: number) => new Date(t0.getTime() + min * MIN);

const make = (conditions: Condition[] = [], attrs: Partial<Avatar['attributes']> = {}, from = t0): Avatar => {
  const a = newAvatar({ id: randomUUID(), accountId: randomUUID(), rarity: 'common', jobCode: 'padeiro' }, from);
  return { ...a, attributes: { ...a.attributes, ...attrs }, conditions };
};
const errorCode = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return null;
};

describe('doenças graves (E2.3)', () => {
  it('febre, enxaqueca e virose são as graves', () => {
    expect([...SERIOUS_CODES].sort()).toEqual(['enxaqueca', 'febre', 'virose']);
  });

  it('tira 1 de saúde a cada 15 min, sem contar duas vezes', () => {
    const febre = catchCondition([], 'febre', t0);
    expect(drainHealth(febre, 10, at(14)).health).toBe(10);
    const first = drainHealth(febre, 10, at(30));
    expect(first.health).toBe(8);
    // O que já foi tirado fica gravado: a próxima conta só tira o que falta.
    expect(drainHealth(first.conditions, first.health, at(45)).health).toBe(7);
    expect(drainHealth(first.conditions, first.health, at(30)).health).toBe(8);
    // Não passa de 0.
    expect(drainHealth(febre, 10, at(24 * 60)).health).toBe(0);
  });

  it('gripe não tira saúde; o avatar com febre chega a 0 e é internado', () => {
    expect(drainHealth(catchCondition([], 'gripe', t0), 10, at(600)).health).toBe(10);
    const a = make(catchCondition([], 'virose', t0));
    expect(decayDue(a, at(20))).toBe(true);
    const later = decayed(a, at(150));
    expect(later.attributes.health).toBe(0);
    const admitted = admit(later, randomUUID(), at(150))!;
    expect(admitted.stay.reason).toBe('health');
    // A internação compulsória também cura a doença grave.
    expect(admitted.avatar.conditions).toEqual([]);
  });

  it('a farmácia recusa; o hospital trata em 4 h pela taxa', () => {
    const a = make(catchCondition([], 'enxaqueca', t0));
    expect(
      errorCode(() => planMedicine(a, { id: randomUUID(), condition: 'enxaqueca', clientKey: 'k', roll: 0 }, at(10))),
    ).toBe('hospital_only');

    const { stay, avatar } = treat(decayed(a, at(40)), randomUUID(), at(40));
    expect(stay).toMatchObject({ reason: 'treatment', feeCents: HOSPITAL_FEE_CENTS, feeStatus: 'pending' });
    expect(stay.dischargeAt.getTime() - at(40).getTime()).toBe(TREATMENT_STAY_MS);
    expect(avatar.attributes.health).toBe(10);
    expect(avatar.conditions).toEqual([]);

    expect(errorCode(() => treat(make(), randomUUID(), t0))).toBe('nothing_to_treat');
    expect(errorCode(() => treat(make(catchCondition([], 'gripe', t0)), randomUUID(), t0))).toBe('nothing_to_treat');
    expect(errorCode(() => treat(avatar, randomUUID(), at(60)))).toBe('in_hospital');
  });
});

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 10 }) : null;
afterAll(() => pool?.end());

type Store = AvatarStore & HospitalStore;
const stores: [string, () => Store, boolean][] = [
  ['memória', () => new MemoryAvatarStore(), true],
  ['postgres', () => new PostgresAvatarStore(pool!), pool !== null],
];
// Futuro distante: no Postgres compartilhado, os jobs de outros testes não pegam estes avatares.
const base = new Date(Date.UTC(2094, 0, 1) + Math.floor(Math.random() * 1e9));
const from = (min: number) => new Date(base.getTime() + min * MIN);

describe.each(stores)('store: %s', (_name, mk, enabled) => {
  it.runIf(enabled)('a queda da saúde é gravada pelo job e o tratamento cura', async () => {
    const store = mk();
    const a = await store.create(make(catchCondition([], 'febre', base), {}, base));
    await store.applyDecay(from(60), 1000);
    const stored = (await store.get(a.id))!;
    expect(stored.attributes.health).toBe(6);
    expect(stored.conditions[0]!.drained).toBe(4);
    // Mais tarde, a conta continua de onde parou.
    expect(decayed(stored, from(90)).attributes.health).toBe(4);

    const stay = await store.treat(a.id, from(90), randomUUID());
    expect(stay).toMatchObject({ reason: 'treatment', feeStatus: 'pending' });
    const after = (await store.get(a.id))!;
    expect(after.attributes.health).toBe(10);
    expect(after.conditions).toEqual([]);
    expect(after.hospitalUntil).toEqual(new Date(from(90).getTime() + TREATMENT_STAY_MS));
    await expect(store.treat(a.id, from(100), randomUUID())).rejects.toMatchObject({ code: 'in_hospital' });
  });

  it.runIf(enabled)('quem chega a 0 pela doença é internado pelo admitDue', async () => {
    const store = mk();
    const a = await store.create(make(catchCondition([], 'virose', base), {}, base));
    expect(await store.admitDue(from(60), 5, a.id)).toHaveLength(0);
    expect(await store.admitDue(from(160), 5, a.id)).toMatchObject([{ reason: 'health' }]);
    expect((await store.get(a.id))!.conditions).toEqual([]);
  });

  it.runIf(enabled)('doentes sem queda devida não seguram a fila do job nem a da internação', async () => {
    const store = mk();
    // Doença que só começa no fim de um turno futuro: nada a tirar ainda, mas o avatar tem a doença gravada.
    // Recém-alimentados (âncoras de agora): só a doença os põe na fila.
    for (let k = 0; k < 6; k++) await store.create(make(catchCondition([], 'febre', from(14 * 60)), {}, from(13 * 60)));
    const hungry = await store.create(make([], {}, base));
    const tired = await store.create(make([], { energy: 0 }, base));
    // Lotes de 2: antes do conserto, os 6 doentes enchiam o lote e o job parava sem chegar no faminto.
    await runDecay(store, from(13 * 60), 2);
    expect((await store.get(hungry.id))!.attributes.food).toBeLessThan(10);
    const admitted = [];
    for (let i = 0; i < 10; i++) admitted.push(...(await store.admitDue(from(13 * 60), 2)));
    expect(admitted.map((s) => s.avatarId)).toContain(tired.id);
  });
});

describe('API', () => {
  const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
  const INTERNAL = 'chave-interna-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)

  it('POST /hospital/treat cura e cobra; o catálogo marca as graves', async () => {
    let clock = t0;
    const store = new MemoryAvatarStore();
    const charged: string[] = [];
    const app = await buildApp(
      loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: INTERNAL, DEV_FREE_AVATAR: 'true' }),
      store,
      () => clock,
      undefined,
      undefined,
      { chargeHospital: async (stay) => void charged.push(stay.id) },
    );
    const accountId = randomUUID();
    const headers = {
      authorization: `Bearer ${await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(accountId)
        .setIssuer('scc-gateway')
        .setAudience('scc-api')
        .setExpirationTime('1h')
        .sign(new TextEncoder().encode(SECRET))}`,
    };
    const own = (conditions: Condition[]) => store.create({ ...make(conditions), accountId });
    const healthy = await own([]);
    const none = await app.inject({ method: 'POST', url: `/v1/avatars/${healthy.id}/hospital/treat`, headers });
    expect(none.json().error.code).toBe('nothing_to_treat');

    const created = await own(catchCondition([], 'febre', t0));
    const treatUrl = `/v1/avatars/${created.id}/hospital/treat`;
    clock = at(30);
    const sick = (await app.inject({ method: 'GET', url: `/v1/avatars/${created.id}`, headers })).json().avatar;
    expect(sick.attributes.health).toBe(8);
    expect(sick.conditions[0]).toMatchObject({ code: 'febre', hospital_only: true });

    const res = await app.inject({ method: 'POST', url: treatUrl, headers });
    expect(res.statusCode).toBe(201);
    expect(res.json().stay).toMatchObject({ reason: 'treatment' });
    expect(res.json().avatar.attributes.health).toBe(10);
    expect(res.json().avatar.conditions).toEqual([]);
    expect(charged).toHaveLength(1);

    const pharmacy = (await app.inject({ method: 'GET', url: '/v1/catalog/pharmacy' })).json().conditions;
    expect(pharmacy.filter((c: { hospital_only: boolean }) => c.hospital_only).map((c: { code: string }) => c.code).sort()).toEqual([
      'enxaqueca',
      'febre',
      'virose',
    ]);
  });
});
