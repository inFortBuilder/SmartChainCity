import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { type AvatarStore, MAX_AVATARS_PER_ACCOUNT, decayed, newAvatar } from '../src/domain/avatar.js';
import { PostgresAvatarStore } from '../src/infra/db/postgres-store.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';
import { runDecay } from '../src/jobs/decay.js';

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 20 }) : null;
afterAll(() => pool?.end());

const stores: [string, () => AvatarStore, boolean][] = [
  ['memória', () => new MemoryAvatarStore(), true],
  ['postgres', () => new PostgresAvatarStore(pool!), pool !== null],
];

const HOUR = 3_600_000;
// Datas no futuro distante: no Postgres compartilhado, o job do teste não pega avatares de outras rodadas.
const base = new Date(Date.UTC(2090, 0, 1) + Math.floor(Math.random() * 1e9));
const at = (hours: number) => new Date(base.getTime() + hours * HOUR);
const avatarFor = (accountId: string, now = base) =>
  newAvatar({ id: randomUUID(), accountId, rarity: 'common', jobCode: 'padeiro' }, now);

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (error) {
    return (error as { code?: string }).code;
  }
};

describe.each(stores)('AvatarStore: %s', (_name, make, enabled) => {
  it.runIf(enabled)('guarda e devolve o avatar igual', async () => {
    const store = make();
    const a = avatarFor(randomUUID());
    await store.create(a);
    const got = await store.get(a.id);
    expect(got?.attributes).toEqual(a.attributes);
    expect(got?.anchors.food.getTime()).toBe(a.anchors.food.getTime());
    expect(await store.get(randomUUID())).toBeNull();
  });

  it.runIf(enabled)(`no máximo ${MAX_AVATARS_PER_ACCOUNT} por conta, mesmo com 8 pedidos em paralelo`, async () => {
    const store = make();
    const account = randomUUID();
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => codeOf(store.create(avatarFor(account)))));
    expect(outcomes.filter((c) => c === null)).toHaveLength(MAX_AVATARS_PER_ACCOUNT);
    expect(outcomes.filter((c) => c === 'avatar_limit')).toHaveLength(8 - MAX_AVATARS_PER_ACCOUNT);
    expect(await store.listByAccount(account)).toHaveLength(MAX_AVATARS_PER_ACCOUNT);
  });

  it.runIf(enabled)('o job grava a mesma queda que a leitura calcula, e rodar de novo não derruba mais', async () => {
    const store = make();
    const a = avatarFor(randomUUID());
    await store.create(a);
    const when = at(30);
    expect(await runDecay(store, when, 50)).toBeGreaterThanOrEqual(1);
    const saved = (await store.get(a.id))!;
    expect(saved.attributes).toEqual(decayed(a, when).attributes);
    // Mesma hora, de novo: nada cai.
    await runDecay(store, when, 50);
    expect((await store.get(a.id))!.attributes).toEqual(saved.attributes);
    // 6 h depois: a fração guardada no instante de referência conta.
    await runDecay(store, at(36), 50);
    expect((await store.get(a.id))!.attributes).toEqual(decayed(a, at(36)).attributes);
  });

  it.runIf(enabled)('o job trabalha em lotes até acabar', async () => {
    const store = make();
    const ids = [];
    for (let k = 0; k < 7; k++) {
      const a = avatarFor(randomUUID());
      ids.push(a.id);
      await store.create(a);
    }
    await runDecay(store, at(10), 3);
    for (const id of ids) expect((await store.get(id))!.attributes.food).toBe(8);
  });
});
