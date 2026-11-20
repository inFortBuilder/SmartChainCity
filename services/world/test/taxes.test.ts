import { randomUUID } from 'node:crypto';

import { buildApp as buildEconomy } from '@scc/economy/src/app.js';
import { loadConfig as economyConfig } from '@scc/economy/src/config.js';
import { MemoryLedgerStore } from '@scc/economy/src/infra/memory-store.js';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Lot } from '../src/domain/lots.js';
import { DAY_MS, type Property } from '../src/domain/properties.js';
import { type TaxBill, type TaxStore, billsDue, chargeTaxes } from '../src/domain/taxes.js';
import { PostgresTaxStore } from '../src/infra/db/postgres-tax-store.js';
import { LedgerLandPayments } from '../src/infra/ledger-payments.js';
import { LedgerPropertyPayments } from '../src/infra/ledger-property-payments.js';
import { LedgerTaxPayments } from '../src/infra/ledger-tax-payments.js';
import { MemoryPropertyStore } from '../src/infra/memory-property-store.js';
import { MemoryWorldStore } from '../src/infra/memory-store.js';
import { MemoryTaxStore } from '../src/infra/memory-tax-store.js';
import { testCity, testLots, uniqueCode } from './fixtures.js';

const T0 = new Date('2026-11-20T12:00:00Z');
const at = (days: number) => new Date(T0.getTime() + days * DAY_MS);

const soldLot = (over: Partial<Lot> = {}): Lot => ({
  city: 'teste',
  id: 4,
  district: 0,
  zone: 'mixed',
  areaM2: 100,
  status: 'sold',
  ownerAccountId: randomUUID(),
  reservedBy: null,
  reservedUntil: null,
  reservationId: null,
  soldAt: T0,
  ...over,
});

const house = (over: Partial<Property> = {}): Property => ({
  id: randomUUID(),
  city: 'teste',
  lotId: 4,
  ownerAccountId: randomUUID(),
  type: 't1',
  level: 1,
  status: 'active',
  priceCents: 4000_00,
  createdAt: at(40),
  readyAt: at(41),
  wearBase: 100,
  wearSince: at(41),
  lastClaimAt: at(41),
  ...over,
});

describe('contas de imposto (regras)', () => {
  it('lote vazio paga PT crescente a cada 30 dias', () => {
    const bills = billsDue(soldLot(), null, at(65));
    expect(bills.map((b) => [b.kind, b.period, b.amountCents])).toEqual([
      ['pt', 1, 1000],
      ['pt', 2, 2000],
    ]);
    expect(bills[1]!.dueAt).toEqual(at(60));
  });

  it('a obra para o PT; o IPTU começa 182 dias depois de pronta', () => {
    const bills = billsDue(soldLot(), house(), at(41 + 365));
    expect(bills.map((b) => [b.kind, b.period, b.amountCents])).toEqual([
      ['pt', 1, 1000], // só o mês antes da obra começar (dia 40)
      ['iptu', 1, 18000],
      ['iptu', 2, 18000],
    ]);
  });

  it('obra sem pagar não gera IPTU; lote não vendido não paga nada', () => {
    expect(billsDue(soldLot(), house({ status: 'pending' }), at(500)).filter((b) => b.kind === 'iptu')).toEqual([]);
    expect(billsDue(soldLot({ status: 'vacant', ownerAccountId: null, soldAt: null }), null, at(500))).toEqual([]);
  });
});

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 10 }) : null;
afterAll(async () => {
  await pool?.end();
});

const bill = (over: Partial<TaxBill> = {}): TaxBill => ({
  id: randomUUID(),
  city: uniqueCode(),
  lotId: 4,
  accountId: randomUUID(),
  kind: 'pt',
  period: 1,
  amountCents: 1000,
  fineCents: 0,
  dueAt: at(30),
  status: 'pending',
  paidAt: null,
  createdAt: at(30),
  ...over,
});

describe.each([
  ['memória', () => new MemoryTaxStore() as TaxStore, true],
  ['postgres', () => new PostgresTaxStore(pool!) as TaxStore, pool !== null],
] as const)('TaxStore (%s)', (_name, make, enabled) => {
  it.skipIf(!enabled)('uma conta por lote, tipo e período; multa uma vez; paga uma vez', async () => {
    const store = make();
    const b = bill();
    expect(await store.upsertBills([b])).toBe(1);
    expect(await store.upsertBills([{ ...b, id: randomUUID(), amountCents: 999 }])).toBe(0);

    await store.setFine(b.id, 100);
    await store.setFine(b.id, 500);
    const [pending] = await store.pendingBills(b.accountId);
    expect(pending).toMatchObject({ amountCents: 1000, fineCents: 100 });

    await store.markPaid(b.id, at(31));
    expect(await store.pendingBills(b.accountId)).toEqual([]);
    expect((await store.billsOf(b.accountId, 10))[0]).toMatchObject({ status: 'paid' });
  });

  it.skipIf(!enabled)('inadimplente só depois de 90 dias vencida', async () => {
    const store = make();
    const b = bill();
    await store.upsertBills([b]);
    expect(await store.inDefault(b.city, b.lotId, at(119))).toBe(false);
    expect(await store.inDefault(b.city, b.lotId, at(121))).toBe(true);
    await store.markPaid(b.id, at(121));
    expect(await store.inDefault(b.city, b.lotId, at(121))).toBe(false);
  });
});

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const LEDGER_TOKEN = 'chave-interna-do-economy-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)

describe('impostos de ponta a ponta (world + economy)', () => {
  let economy: Awaited<ReturnType<typeof buildEconomy>>;
  let world: Awaited<ReturnType<typeof buildApp>>;
  let lots: MemoryWorldStore;
  let properties: MemoryPropertyStore;
  let taxStore: MemoryTaxStore;
  let taxPayments: LedgerTaxPayments;
  let clock: Date;

  beforeEach(async () => {
    economy = await buildEconomy(
      economyConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: LEDGER_TOKEN }),
      new MemoryLedgerStore(),
    );
    const ledgerUrl = await economy.listen({ port: 0, host: '127.0.0.1' });
    lots = new MemoryWorldStore();
    await lots.importCity(testCity('teste'), testLots());
    properties = new MemoryPropertyStore();
    taxStore = new MemoryTaxStore();
    taxPayments = new LedgerTaxPayments(ledgerUrl, LEDGER_TOKEN);
    clock = T0;
    world = await buildApp(
      loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET }),
      lots,
      () => clock,
      new LedgerLandPayments(ledgerUrl, LEDGER_TOKEN),
      null,
      { store: properties, payments: new LedgerPropertyPayments(ledgerUrl, LEDGER_TOKEN) },
      { store: taxStore, payments: taxPayments },
    );
  });
  afterEach(async () => {
    await economy.close();
  });

  const credit = (accountId: string, currency: 'SCITY' | 'THALER', amount: bigint) =>
    economy.inject({
      method: 'POST',
      url: '/internal/v1/ledger/transactions',
      headers: { 'x-service-token': LEDGER_TOKEN, 'idempotency-key': `credito-${randomUUID()}` },
      payload: {
        kind: 'test_credit',
        legs: [
          { owner_type: 'system', owner_id: 'bridge', currency, amount: `-${amount}` },
          { owner_type: 'player', owner_id: accountId, currency, amount: `${amount}` },
        ],
      },
    });

  const thalerOf = async (headers: Record<string, string>) =>
    (await economy.inject({ method: 'GET', url: '/v1/economy/balances', headers })).json().balances.find(
      (b: { currency: string }) => b.currency === 'THALER',
    )?.amount ?? '0';

  const ownerOfLot4 = async (thalerCents: bigint) => {
    const me = randomUUID();
    const headers = {
      authorization: `Bearer ${await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(me)
        .setIssuer('scc-gateway')
        .setAudience('scc-api')
        .setExpirationTime('1h')
        .sign(new TextEncoder().encode(SECRET))}`,
    };
    await credit(me, 'SCITY', 1000n * 10n ** 18n);
    if (thalerCents > 0n) await credit(me, 'THALER', thalerCents);
    expect((await world.inject({ method: 'POST', url: '/v1/world/cities/teste/lots/4/buy', headers })).statusCode).toBe(201);
    return { me, headers };
  };

  const run = () => chargeTaxes(lots, properties, taxStore, taxPayments, clock);

  it('débito automático do PT; repetir o job não cobra em dobro', async () => {
    const { headers } = await ownerOfLot4(50_00n);
    clock = at(31);
    expect(await run()).toEqual({ created: 1, paid: 1, unpaid: 0 });
    expect(await run()).toEqual({ created: 0, paid: 0, unpaid: 0 });
    expect(await thalerOf(headers)).toBe('4000');

    const taxes = (await world.inject({ method: 'GET', url: '/v1/world/me/taxes', headers })).json();
    expect(taxes.due_cents).toBe(0);
    expect(taxes.bills[0]).toMatchObject({ kind: 'pt', period: 1, total_cents: 1000, status: 'paid' });
  });

  it('sem saldo: multa de 10%, o jogador paga depois e o lote não chega a travar', async () => {
    const { me, headers } = await ownerOfLot4(0n);
    clock = at(31);
    expect(await run()).toEqual({ created: 1, paid: 0, unpaid: 1 });
    const owed = (await world.inject({ method: 'GET', url: '/v1/world/me/taxes', headers })).json();
    expect(owed.due_cents).toBe(1100);
    expect(owed.bills[0]).toMatchObject({ fine_cents: 100, status: 'pending', overdue_days: 1 });

    await credit(me, 'THALER', 20_00n);
    const paid = await world.inject({ method: 'POST', url: '/v1/world/me/taxes/pay', headers });
    expect(paid.json()).toEqual({ paid: 1, unpaid: 0 });
    expect(await thalerOf(headers)).toBe('900');
  });

  it('vencido há mais de 90 dias: o lote não aceita obra até pagar', async () => {
    const { me, headers } = await ownerOfLot4(0n);
    clock = at(31);
    await run();
    clock = at(125);
    await run(); // gera os meses 2, 3 e 4, também sem saldo
    const blocked = await world.inject({ method: 'POST', url: '/v1/world/cities/teste/lots/4/property', headers, payload: { type: 't1' } });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('tax_default');

    await credit(me, 'THALER', 5000_00n);
    const pay = (await world.inject({ method: 'POST', url: '/v1/world/me/taxes/pay', headers })).json();
    expect(pay).toEqual({ paid: 4, unpaid: 0 });
    // 10 + 20 + 30 + 40 THALER, cada um com 10% de multa
    expect(await thalerOf(headers)).toBe(String(5000_00 - 110_00));
    const built = await world.inject({ method: 'POST', url: '/v1/world/cities/teste/lots/4/property', headers, payload: { type: 't1' } });
    expect(built.statusCode).toBe(201);
  });
});
