import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { type AvatarStore, newAvatar } from '../src/domain/avatar.js';
import { type ShiftStore, startShift } from '../src/domain/shift.js';
import { PostgresAvatarStore } from '../src/infra/db/postgres-store.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';
import { completeShifts } from '../src/jobs/shift.js';

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 20 }) : null;
afterAll(() => pool?.end());

type Store = AvatarStore & ShiftStore;
const stores: [string, () => Store, boolean][] = [
  ['memória', () => new MemoryAvatarStore(), true],
  ['postgres', () => new PostgresAvatarStore(pool!), pool !== null],
];

const HOUR = 3_600_000;
// Futuro distante e aleatório: no Postgres compartilhado, o job do teste não mexe em turnos de outras rodadas.
const t0 = new Date(Date.UTC(2095, 0, 1, 8) + Math.floor(Math.random() * 1e6) * 86_400_000);
const at = (hours: number) => new Date(t0.getTime() + hours * HOUR);

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (error) {
    return (error as { code?: string }).code;
  }
};

const setup = async (store: Store) => {
  const a = newAvatar({ id: randomUUID(), accountId: randomUUID(), rarity: 'common', jobCode: 'padeiro' }, t0);
  await store.create(a);
  const work = (hours: number, when = t0) =>
    store.beginShift(a.id, a.accountId, when, (avatar, context) =>
      startShift(avatar, { id: randomUUID(), hours, ...context }, when),
    );
  return { a, work };
};

describe.each(stores)('ShiftStore: %s', (_name, make, enabled) => {
  it.runIf(enabled)('começa, gasta energia e conclui sozinho no fim', async () => {
    const store = make();
    const { a, work } = await setup(store);
    const shift = await work(6);
    expect((await store.get(a.id))!.attributes.energy).toBe(7);
    await completeShifts(store, at(5));
    expect((await store.listShifts(a.id, 5))[0]!.status).toBe('running');
    await completeShifts(store, at(6));
    const [done] = await store.listShifts(a.id, 5);
    expect(done!.id).toBe(shift.id);
    expect(done!.status).toBe('done');
    expect(done!.result!.thalerCents).toBeGreaterThan(0n);
  });

  it.runIf(enabled)('dois pedidos de turno em paralelo: um começa, o outro recusa', async () => {
    const store = make();
    const { a, work } = await setup(store);
    const outcomes = await Promise.all([codeOf(work(6)), codeOf(work(6))]);
    expect(outcomes.sort()).toEqual(['shift_running', null].sort());
    expect((await store.get(a.id))!.attributes.energy).toBe(7);
  });

  it.runIf(enabled)('no máximo 12 h no dia; turno de outra conta não existe', async () => {
    const store = make();
    const { a, work } = await setup(store);
    await work(6);
    await completeShifts(store, at(6));
    await work(6, at(6));
    await completeShifts(store, at(12));
    expect(await codeOf(work(6, at(12)))).toBe('daily_limit');
    const other = store.beginShift(a.id, randomUUID(), t0, (avatar, context) =>
      startShift(avatar, { id: randomUUID(), hours: 6, ...context }, t0),
    );
    expect(await codeOf(other)).toBe('not_found');
  });

  it.runIf(enabled)('coletar marca uma vez; repetir não muda nada', async () => {
    const store = make();
    const { a, work } = await setup(store);
    const shift = await work(6);
    await store.markClaimed(shift.id);
    expect((await store.listShifts(a.id, 1))[0]!.status).toBe('running');
    await completeShifts(store, at(6));
    await store.markClaimed(shift.id);
    await store.markClaimed(shift.id);
    expect((await store.listShifts(a.id, 1))[0]!.status).toBe('claimed');
  });
});
