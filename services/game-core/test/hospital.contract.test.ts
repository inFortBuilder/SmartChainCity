import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { type Avatar, type AvatarStore, newAvatar } from '../src/domain/avatar.js';
import { HOSPITAL_STAY_MS, type HospitalStore } from '../src/domain/hospital.js';
import { type ShiftStore, startShift } from '../src/domain/shift.js';
import { PostgresAvatarStore } from '../src/infra/db/postgres-store.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 20 }) : null;
afterAll(() => pool?.end());

type Store = AvatarStore & ShiftStore & HospitalStore;
const stores: [string, () => Store, boolean][] = [
  ['memória', () => new MemoryAvatarStore(), true],
  ['postgres', () => new PostgresAvatarStore(pool!), pool !== null],
];

const HOUR = 3_600_000;
// Futuro distante: no Postgres compartilhado, os jobs de outros testes não pegam estes avatares.
const base = new Date(Date.UTC(2093, 0, 1) + Math.floor(Math.random() * 1e9));
const at = (hours: number) => new Date(base.getTime() + hours * HOUR);

const create = (store: Store, attrs: Partial<Avatar['attributes']>) => {
  const a = newAvatar({ id: randomUUID(), accountId: randomUUID(), rarity: 'common', jobCode: 'padeiro' }, base);
  return store.create({ ...a, attributes: { ...a.attributes, ...attrs } });
};

describe.each(stores)('HospitalStore: %s', (_name, make, enabled) => {
  it.runIf(enabled)('interna uma vez só, mesmo com pedidos em paralelo', async () => {
    const store = make();
    const a = await create(store, { energy: 0, health: 4 });
    const results = await Promise.all([1, 2, 3].map(() => store.admitDue(at(1), 5, a.id)));
    expect(results.flat()).toHaveLength(1);
    const after = (await store.get(a.id))!;
    expect(after.attributes).toMatchObject({ energy: 10, health: 10 });
    expect(after.hospitalUntil).toEqual(new Date(at(1).getTime() + HOSPITAL_STAY_MS));
    expect(await store.listStays(a.id, 5)).toMatchObject([{ reason: 'energy', feeCents: 3000n, feeStatus: 'pending' }]);
  });

  it.runIf(enabled)('quem está bem ou com turno rodando não é internado', async () => {
    const store = make();
    const ok = await create(store, {});
    expect(await store.admitDue(at(1), 5, ok.id)).toHaveLength(0);

    const worker = await create(store, { energy: 3 });
    await store.beginShift(worker.id, worker.accountId, at(1), (avatar, context) =>
      startShift(avatar, { id: randomUUID(), hours: 6, ...context }, at(1)),
    );
    expect((await store.get(worker.id))!.attributes.energy).toBe(0);
    expect(await store.admitDue(at(2), 5, worker.id)).toHaveLength(0);
    // Passou da hora do fim do turno: interna, mesmo antes do job concluir o turno.
    expect(await store.admitDue(at(7), 5, worker.id)).toHaveLength(1);
  });

  it.runIf(enabled)('a taxa passa de pending para paid uma vez; internado não interna de novo', async () => {
    const store = make();
    const a = await create(store, { health: 0 });
    const [stay] = await store.admitDue(at(1), 5, a.id);
    expect((await store.pendingFees(1000)).some((s) => s.id === stay!.id)).toBe(true);
    await store.settleFee(stay!.id, 'paid');
    await store.settleFee(stay!.id, 'waived');
    expect((await store.listStays(a.id, 5))[0]!.feeStatus).toBe('paid');
    expect((await store.pendingFees(1000)).some((s) => s.id === stay!.id)).toBe(false);

    // A alta já deu saúde 10: nem agora nem depois da alta há nova internação.
    expect(await store.admitDue(at(2), 5, a.id)).toHaveLength(0);
  });
});
