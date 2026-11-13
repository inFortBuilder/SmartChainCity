import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { type AvatarStore, newAvatar } from '../src/domain/avatar.js';
import { type MealStore, planMeal } from '../src/domain/meal.js';
import { PostgresAvatarStore } from '../src/infra/db/postgres-store.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 20 }) : null;
afterAll(() => pool?.end());

type Store = AvatarStore & MealStore;
const stores: [string, () => Store, boolean][] = [
  ['memória', () => new MemoryAvatarStore(), true],
  ['postgres', () => new PostgresAvatarStore(pool!), pool !== null],
];

const HOUR = 3_600_000;
// Futuro distante: no Postgres compartilhado, o job de queda de outros testes não pega estes avatares.
const base = new Date(Date.UTC(2091, 0, 1) + Math.floor(Math.random() * 1e9));
const at = (hours: number) => new Date(base.getTime() + hours * HOUR);

/** Avatar criado em `base`; 24 h depois a alimentação está em 5. */
const hungry = async (store: Store) => {
  const accountId = randomUUID();
  const a = await store.create(newAvatar({ id: randomUUID(), accountId, rarity: 'common', jobCode: 'padeiro' }, base));
  return a;
};

const plan = (clientKey: string | null = null, now = at(24)) => (avatar: Parameters<typeof planMeal>[0]) =>
  planMeal(avatar, { id: randomUUID(), foodCode: 'maca', clientKey }, now);

describe.each(stores)('MealStore: %s', (_name, make, enabled) => {
  it.runIf(enabled)('pending → eaten aplica os efeitos uma vez só', async () => {
    const store = make();
    const a = await hungry(store);
    const meal = await store.beginMeal(a.id, a.accountId, null, at(24), plan());
    expect(meal).toMatchObject({ status: 'pending', priceCents: 400n, effects: { food: 3, energy: 3, health: 1 } });
    expect((await store.get(a.id))!.attributes.food).toBe(10);

    const done = await Promise.all([store.finishMeal(meal.id, at(24)), store.finishMeal(meal.id, at(24))]);
    expect(done.every((m) => m.status === 'eaten')).toBe(true);
    // A queda de 24 h é gravada junto: 10 → 5, mais 3 da refeição.
    expect((await store.get(a.id))!.attributes.food).toBe(8);
  });

  it.runIf(enabled)('a mesma chave do cliente devolve a mesma refeição', async () => {
    const store = make();
    const a = await hungry(store);
    const first = await store.beginMeal(a.id, a.accountId, 'chave-1', at(24), plan('chave-1'));
    const again = await store.beginMeal(a.id, a.accountId, 'chave-1', at(24), plan('chave-1'));
    expect(again.id).toBe(first.id);
    expect(await store.listMeals(a.id, 10)).toHaveLength(1);
  });

  it.runIf(enabled)('failed não aplica nada, e não volta para eaten', async () => {
    const store = make();
    const a = await hungry(store);
    const meal = await store.beginMeal(a.id, a.accountId, null, at(24), plan());
    expect((await store.failMeal(meal.id)).status).toBe('failed');
    expect((await store.finishMeal(meal.id, at(24))).status).toBe('failed');
    expect((await store.get(a.id))!.attributes.food).toBe(10);
  });

  it.runIf(enabled)('avatar de outra conta é 404', async () => {
    const store = make();
    const a = await hungry(store);
    await expect(store.beginMeal(a.id, randomUUID(), null, at(24), plan())).rejects.toMatchObject({ code: 'not_found' });
  });
});
