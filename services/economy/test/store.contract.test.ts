import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import type { AccountRef, LedgerStore, PostingRequest } from '../src/domain/ledger.js';
import { pool, stores } from './stores.js';

afterAll(() => pool?.end());

const player = (): AccountRef => ({ ownerType: 'player', ownerId: randomUUID(), currency: 'THALER' });
const mint: AccountRef = { ownerType: 'system', ownerId: 'mint', currency: 'THALER' };
const sink: AccountRef = { ownerType: 'burn', ownerId: 'sink', currency: 'THALER' };
const key = () => `teste-${randomUUID()}`;

const pay = (to: AccountRef, amount: bigint, idempotencyKey = key()): PostingRequest => ({
  kind: 'shift_pay',
  idempotencyKey,
  legs: [
    { account: mint, amount: -amount },
    { account: to, amount },
  ],
});
const spend = (from: AccountRef, amount: bigint, idempotencyKey = key()): PostingRequest => ({
  kind: 'food',
  idempotencyKey,
  legs: [
    { account: from, amount: -amount },
    { account: sink, amount },
  ],
});

const balanceOf = async (store: LedgerStore, a: AccountRef) =>
  (await store.balances(a.ownerType, a.ownerId)).find((b) => b.currency === a.currency)?.amount ?? 0n;

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (error) {
    return (error as { code?: string }).code;
  }
};

describe.each(stores)('LedgerStore: %s', (_name, make, enabled) => {
  it.runIf(enabled)('paga, gasta e mantém o saldo igual à soma', async () => {
    const store = make();
    const p = player();
    await store.post(pay(p, 1_000n), new Date());
    await store.post(spend(p, 300n), new Date());
    expect(await balanceOf(store, p)).toBe(700n);
  });

  it.runIf(enabled)('recusa gasto acima do saldo e não muda nada', async () => {
    const store = make();
    const p = player();
    await store.post(pay(p, 100n), new Date());
    expect(await codeOf(store.post(spend(p, 101n), new Date()))).toBe('insufficient_funds');
    expect(await balanceOf(store, p)).toBe(100n);
  });

  it.runIf(enabled)('mesma chave e mesmo pedido: lança uma vez só', async () => {
    const store = make();
    const p = player();
    const k = key();
    const first = await store.post(pay(p, 50n, k), new Date());
    const again = await store.post(pay(p, 50n, k), new Date());
    expect(again.replayed).toBe(true);
    expect(again.tx.id).toBe(first.tx.id);
    expect(await balanceOf(store, p)).toBe(50n);
  });

  it.runIf(enabled)('mesma chave com outro pedido é conflito', async () => {
    const store = make();
    const p = player();
    const k = key();
    await store.post(pay(p, 50n, k), new Date());
    expect(await codeOf(store.post(pay(p, 51n, k), new Date()))).toBe('idempotency_conflict');
  });

  it.runIf(enabled)('10 pedidos iguais em paralelo viram 1 lançamento', async () => {
    const store = make();
    const p = player();
    const k = key();
    const results = await Promise.all(Array.from({ length: 10 }, () => store.post(pay(p, 70n, k), new Date())));
    expect(new Set(results.map((r) => r.tx.id)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await balanceOf(store, p)).toBe(70n);
  });

  it.runIf(enabled)('gastos em paralelo nunca deixam o saldo negativo', async () => {
    const store = make();
    const p = player();
    await store.post(pay(p, 500n), new Date());
    // 10 gastos de 100 com saldo de 500: exatamente 5 passam.
    const outcomes = await Promise.all(Array.from({ length: 10 }, () => codeOf(store.post(spend(p, 100n), new Date()))));
    expect(outcomes.filter((c) => c === null)).toHaveLength(5);
    expect(outcomes.filter((c) => c === 'insufficient_funds')).toHaveLength(5);
    expect(await balanceOf(store, p)).toBe(0n);
  });

  it.runIf(enabled)('extrato vem do mais recente e pagina pelo cursor', async () => {
    const store = make();
    const p = player();
    for (const amount of [10n, 20n, 30n]) await store.post(pay(p, amount), new Date());
    const first = await store.statement('player', p.ownerId, { limit: 2 });
    expect(first.lines.map((l) => l.amount)).toEqual([30n, 20n]);
    expect(first.next).not.toBeNull();
    const second = await store.statement('player', p.ownerId, { limit: 2, before: first.next! });
    expect(second.lines.map((l) => l.amount)).toEqual([10n]);
    expect(second.next).toBeNull();
  });
});
