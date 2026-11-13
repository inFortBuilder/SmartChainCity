import { randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { type LandPayments, type Purchase, RESERVATION_MS, type WorldStore } from '../src/domain/lots.js';
import { buyLot, settleStale } from '../src/domain/purchase.js';
import { PostgresWorldStore } from '../src/infra/db/postgres-store.js';
import { LedgerLandPayments } from '../src/infra/ledger-payments.js';
import { MemoryWorldStore } from '../src/infra/memory-store.js';
import { testCity, testLots, uniqueCode } from './fixtures.js';

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 20 }) : null;
afterAll(() => pool?.end());

const stores: [string, () => WorldStore, boolean][] = [
  ['memória', () => new MemoryWorldStore(), true],
  ['postgres', () => new PostgresWorldStore(pool!), pool !== null],
];

/** Ledger falso: saldo por conta em micro-SCITY, cobranças idempotentes por compra. */
class FakePayments implements LandPayments {
  balances = new Map<string, bigint>();
  charged = new Set<string>();
  refunded = new Set<string>();
  async charge(p: Purchase) {
    if (this.charged.has(p.id)) return;
    const b = this.balances.get(p.accountId) ?? 0n;
    if (b < p.priceWei) throw new AppError('insufficient_scity', 'sem saldo', 409);
    this.balances.set(p.accountId, b - p.priceWei);
    this.charged.add(p.id);
  }
  async refund(p: Purchase) {
    if (this.refunded.has(p.id)) return;
    this.balances.set(p.accountId, (this.balances.get(p.accountId) ?? 0n) + p.priceWei);
    this.refunded.add(p.id);
  }
}

const WEI = 10n ** 18n;
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (error) {
    return (error as { code?: string }).code;
  }
};

describe.each(stores)('compra de lote: %s', (_name, make, enabled) => {
  const setup = async () => {
    const store = make();
    const code = uniqueCode();
    await store.importCity(testCity(code), testLots());
    const pay = new FakePayments();
    let clock = new Date('2026-11-12T12:00:00Z');
    const buy = (accountId: string, lotId: number) =>
      buyLot(store, pay, { city: code, lotId, accountId, scityUsd: 1 }, () => clock);
    const rich = () => {
      const id = randomUUID();
      pay.balances.set(id, 10_000n * WEI);
      return id;
    };
    return { store, code, pay, buy, rich, advance: (ms: number) => (clock = new Date(clock.getTime() + ms)), now: () => clock };
  };

  it.runIf(enabled)('compra: cobra 156 SCITY, o lote passa ao comprador', async () => {
    const { store, code, pay, buy, rich } = await setup();
    const a = rich();
    await buy(a, 0);
    const lot = await store.getLot(code, 0);
    expect(lot).toMatchObject({ status: 'sold', ownerAccountId: a });
    expect(pay.balances.get(a)).toBe(10_000n * WEI - 156n * WEI);
    expect((await store.lotsOf(a)).map((l) => l.id)).toEqual([0]);
  });

  it.runIf(enabled)('sem SCITY: recusa e o lote volta à venda', async () => {
    const { store, code, buy } = await setup();
    expect(await codeOf(buy(randomUUID(), 1))).toBe('insufficient_scity');
    expect((await store.getLot(code, 1))!.status).toBe('vacant');
  });

  it.runIf(enabled)('dois compradores no mesmo lote ao mesmo tempo: um leva, o outro não é cobrado', async () => {
    const { store, code, pay, buy, rich } = await setup();
    const [a, b] = [rich(), rich()];
    const outcomes = await Promise.all([codeOf(buy(a, 2)), codeOf(buy(b, 2))]);
    expect(outcomes.filter((c) => c === null)).toHaveLength(1);
    const owner = (await store.getLot(code, 2))!.ownerAccountId;
    const loser = owner === a ? b : a;
    expect(pay.balances.get(loser)).toBe(10_000n * WEI);
  });

  it.runIf(enabled)('Prefeitura e bairro fechado não vendem; um bairro por jogador', async () => {
    const { buy, rich } = await setup();
    const a = rich();
    expect(await codeOf(buy(a, 9))).toBe('lot_not_for_sale');
    expect(await codeOf(buy(a, 15))).toBe('district_closed');
  });

  it.runIf(enabled)('vender 70% do bairro aberto abre o próximo', async () => {
    const { store, code, buy, rich } = await setup();
    // 9 lotes à venda no bairro 1 (o 9 é da Prefeitura); 3 lotes por jogador (teto de 30% da área).
    for (let k = 0; k < 7; k++) await buy(rich(), k);
    expect((await store.getCity(code))!.openCount).toBe(2);
    expect(await codeOf(buy(rich(), 12))).toBeNull();
  });

  it.runIf(enabled)('reserva perdida depois de pago: devolve o valor', async () => {
    const { store, code, pay, rich, advance, now } = await setup();
    const a = rich();
    // A reserva e não paga a tempo (ledger fora, por exemplo).
    const pa = await store.reserve(code, 3, a, now(), () => ({ priceWei: 156n * WEI, priceUsd: 156 }));
    advance(RESERVATION_MS + 1000);
    // B compra o mesmo lote depois que a reserva venceu.
    const b = rich();
    await buyLot(store, pay, { city: code, lotId: 3, accountId: b, scityUsd: 1 }, now);
    // O job resolve a compra de A: cobra (idempotente), não consegue a posse, devolve.
    advance(RESERVATION_MS);
    await settleStale(store, pay, now());
    expect((await store.getLot(code, 3))!.ownerAccountId).toBe(b);
    expect(pay.balances.get(a)).toBe(10_000n * WEI);
    expect(pay.refunded.has(pa.id)).toBe(true);
  });
});

describe('LedgerLandPayments', () => {
  it('repassa o x-request-id ao ledger', async () => {
    const headers: Headers[] = [];
    const fake = (async (_url: string, init?: RequestInit) => {
      headers.push(new Headers(init?.headers));
      return new Response('{}', { status: 201 });
    }) as typeof fetch;
    const pay = new LedgerLandPayments('http://economy', 'x'.repeat(32), fake);
    const purchase = { id: 'p-1', accountId: 'a-1', priceWei: 10n } as Purchase;
    await pay.charge(purchase, 'req-9');
    await pay.refund(purchase);
    expect(headers[0]!.get('x-request-id')).toBe('req-9');
    expect(headers[0]!.get('idempotency-key')).toBe('lot-buy:p-1');
    expect(headers[1]!.has('x-request-id')).toBe(false);
  });
});
