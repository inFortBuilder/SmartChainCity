import { randomUUID } from 'node:crypto';

import { buildApp as buildEconomy } from '@scc/economy/src/app.js';
import { loadConfig as economyConfig } from '@scc/economy/src/config.js';
import { MemoryLedgerStore } from '@scc/economy/src/infra/memory-store.js';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { AUCTION_AFTER_DAYS, AUCTION_MS, type Auction, type AuctionStore, EXTEND_MS, minBid, tickAuctions } from '../src/domain/auctions.js';
import { DAY_MS } from '../src/domain/properties.js';
import { chargeTaxes } from '../src/domain/taxes.js';
import { PostgresAuctionStore } from '../src/infra/db/postgres-auction-store.js';
import { LedgerAuctionPayments } from '../src/infra/ledger-auction-payments.js';
import { LedgerLandPayments } from '../src/infra/ledger-payments.js';
import { LedgerPropertyPayments } from '../src/infra/ledger-property-payments.js';
import { LedgerTaxPayments } from '../src/infra/ledger-tax-payments.js';
import { MemoryAuctionStore } from '../src/infra/memory-auction-store.js';
import { MemoryPropertyStore } from '../src/infra/memory-property-store.js';
import { MemoryWorldStore } from '../src/infra/memory-store.js';
import { MemoryTaxStore } from '../src/infra/memory-tax-store.js';
import { testCity, testLots, uniqueCode } from './fixtures.js';

const T0 = new Date('2026-11-20T12:00:00Z');
const at = (days: number) => new Date(T0.getTime() + days * DAY_MS);
const HOUR = 3_600_000;

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 10 }) : null;
afterAll(async () => {
  await pool?.end();
});

const auction = (over: Partial<Auction> = {}): Auction => ({
  id: randomUUID(),
  city: uniqueCode(),
  lotId: 4,
  sellerAccountId: randomUUID(),
  debtCents: 5000,
  billIds: [randomUUID()],
  status: 'open',
  startsAt: T0,
  endsAt: new Date(T0.getTime() + AUCTION_MS),
  winnerAccountId: null,
  priceCents: null,
  closedAt: null,
  ...over,
});

describe('lance mínimo', () => {
  it('a dívida no primeiro lance; depois, 5% acima do maior', () => {
    const a = auction({ debtCents: 5000 });
    expect(minBid(a, null)).toBe(5000);
    expect(minBid(a, { id: 'x', auctionId: a.id, accountId: 'y', amountCents: 10_000, createdAt: T0 })).toBe(10_500);
    expect(minBid(a, { id: 'x', auctionId: a.id, accountId: 'y', amountCents: 10, createdAt: T0 })).toBe(11);
  });
});

describe.each([
  ['memória', () => new MemoryAuctionStore() as AuctionStore, true],
  ['postgres', () => new PostgresAuctionStore(pool!) as AuctionStore, pool !== null],
] as const)('AuctionStore (%s)', (_name, make, enabled) => {
  it.skipIf(!enabled)('um leilão ativo por lote; lances em ordem; vencidos e transições', async () => {
    const store = make();
    const a = auction();
    expect(await store.openAuction(a)).toBe(true);
    expect(await store.openAuction({ ...a, id: randomUUID() })).toBe(false);
    expect((await store.activeOnLot(a.city, a.lotId))?.id).toBe(a.id);

    const bid = (amountCents: number, accountId = randomUUID()) => ({ id: randomUUID(), auctionId: a.id, accountId, amountCents, createdAt: T0 });
    const later = new Date(a.endsAt.getTime() + 1000);
    const updated = await store.placeBid(bid(6000), (cur, top) => {
      expect(top).toBeNull();
      expect(cur.id).toBe(a.id);
      return later;
    });
    expect(updated.endsAt).toEqual(later);
    await store.placeBid(bid(7000), (_cur, top) => {
      expect(top?.amountCents).toBe(6000);
      return later;
    });
    expect((await store.bidsOf(a.id)).map((b) => b.amountCents)).toEqual([7000, 6000]);

    expect((await store.due(T0)).some((x) => x.id === a.id)).toBe(false);
    expect((await store.due(later)).some((x) => x.id === a.id)).toBe(true);
    const winner = randomUUID();
    expect(await store.transition(a.id, 'open', { status: 'charged', winnerAccountId: winner, priceCents: 7000, closedAt: later })).toBe(true);
    expect(await store.transition(a.id, 'open', { status: 'unsold' })).toBe(false);
    expect(await store.getAuction(a.id)).toMatchObject({ status: 'charged', winnerAccountId: winner, priceCents: 7000 });
    expect(await store.transition(a.id, 'charged', { status: 'settled' })).toBe(true);
    // Fechado, o lote pode ter outro leilão.
    expect(await store.openAuction({ ...a, id: randomUUID() })).toBe(true);
  });
});

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const LEDGER_TOKEN = 'chave-interna-do-economy-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)

describe('leilão de ponta a ponta (world + economy)', () => {
  let economy: Awaited<ReturnType<typeof buildEconomy>>;
  let world: Awaited<ReturnType<typeof buildApp>>;
  let lots: MemoryWorldStore;
  let properties: MemoryPropertyStore;
  let taxStore: MemoryTaxStore;
  let auctions: MemoryAuctionStore;
  let taxPayments: LedgerTaxPayments;
  let auctionPayments: LedgerAuctionPayments;
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
    auctions = new MemoryAuctionStore();
    taxPayments = new LedgerTaxPayments(ledgerUrl, LEDGER_TOKEN);
    auctionPayments = new LedgerAuctionPayments(ledgerUrl, LEDGER_TOKEN);
    clock = T0;
    world = await buildApp(
      loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET }),
      lots,
      () => clock,
      new LedgerLandPayments(ledgerUrl, LEDGER_TOKEN),
      null,
      { store: properties, payments: new LedgerPropertyPayments(ledgerUrl, LEDGER_TOKEN) },
      { store: taxStore, payments: taxPayments, auctions },
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

  const playerWith = async (thalerCents: bigint) => {
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
    if (thalerCents > 0n) await credit(me, 'THALER', thalerCents);
    return { me, headers };
  };

  /** Dono do lote 4 sem THALER: o PT vence, recebe multa e o lote chega ao leilão. */
  const defaultedLot = async () => {
    const seller = await playerWith(0n);
    await credit(seller.me, 'SCITY', 1000n * 10n ** 18n);
    expect((await world.inject({ method: 'POST', url: '/v1/world/cities/teste/lots/4/buy', headers: seller.headers })).statusCode).toBe(201);
    clock = at(30 + AUCTION_AFTER_DAYS + 1);
    await chargeTaxes(lots, properties, taxStore, taxPayments, clock);
    return seller;
  };

  const tick = () => tickAuctions({ auctions, taxes: taxStore, lots, properties, payments: auctionPayments }, clock);

  const bid = (headers: Record<string, string>, id: string, amount_cents: number) =>
    world.inject({ method: 'POST', url: `/v1/world/auctions/${id}/bids`, headers, payload: { amount_cents } });

  it('abre com a dívida, o maior lance sem saldo passa a vez, o lote vai para quem paga', async () => {
    const seller = await defaultedLot();
    const debt = (await taxStore.pendingBills(seller.me)).reduce((s, b) => s + b.amountCents + b.fineCents, 0);
    expect(debt).toBeGreaterThan(0);

    expect(await tick()).toMatchObject({ opened: 1 });
    expect(await tick()).toMatchObject({ opened: 0 });
    const [listed] = (await world.inject({ method: 'GET', url: '/v1/world/auctions' })).json().auctions;
    expect(listed).toMatchObject({ lot_id: 4, debt_cents: debt, min_bid_cents: debt, bids: 0 });

    const rich = await playerWith(100_000_00n);
    const broke = await playerWith(10_00n);
    expect((await bid(seller.headers, listed.id, debt)).json().error.code).toBe('own_auction');
    expect((await bid(rich.headers, listed.id, debt - 1)).json().error.code).toBe('bid_too_low');
    expect((await bid(rich.headers, listed.id, debt + 1000)).statusCode).toBe(201);
    // Sem saldo para o lance: o lance entra, mas no fim a cobrança passa para o próximo.
    const high = Math.ceil((debt + 1000) * 1.05);
    const r = await bid(broke.headers, listed.id, high);
    expect(r.statusCode).toBe(201);
    expect(r.json().auction).toMatchObject({ you_lead: true, top_bid_cents: high });

    clock = new Date(clock.getTime() + AUCTION_MS + 1);
    expect(await tick()).toMatchObject({ settled: 1 });

    expect((await lots.getLot('teste', 4))!.ownerAccountId).toBe(rich.me);
    expect(await taxStore.pendingBills(seller.me)).toEqual([]);
    expect(await taxStore.inDefault('teste', 4, clock)).toBe(false);
    // O vencedor paga o lance dele; o antigo dono recebe o que passou da dívida.
    expect(await thalerOf(rich.headers)).toBe(String(100_000_00 - (debt + 1000)));
    expect(await thalerOf(seller.headers)).toBe('1000');
    expect(await thalerOf(broke.headers)).toBe('1000');
    const closed = (await world.inject({ method: 'GET', url: `/v1/world/auctions/${listed.id}`, headers: rich.headers })).json().auction;
    expect(closed).toMatchObject({ status: 'settled', you_won: true, price_cents: debt + 1000 });
    expect(await tick()).toEqual({ opened: 0, settled: 0, cancelled: 0, unsold: 0 });
  });

  it('o dono paga durante o leilão: cancelado e o lote fica com ele', async () => {
    const seller = await defaultedLot();
    await tick();
    const [a] = await auctions.listOpen(10);
    const other = await playerWith(100_000_00n);
    expect((await bid(other.headers, a!.id, a!.debtCents)).statusCode).toBe(201);

    await credit(seller.me, 'THALER', 100_000_00n);
    expect((await world.inject({ method: 'POST', url: '/v1/world/me/taxes/pay', headers: seller.headers })).json()).toMatchObject({ unpaid: 0 });
    clock = new Date(clock.getTime() + AUCTION_MS + 1);
    expect(await tick()).toMatchObject({ cancelled: 1, settled: 0 });
    expect((await lots.getLot('teste', 4))!.ownerAccountId).toBe(seller.me);
    expect(await thalerOf(other.headers)).toBe(String(100_000_00));
  });

  it('lance no fim estende; terminado não aceita; sem ninguém que pague, fica sem comprador', async () => {
    const seller = await defaultedLot();
    await tick();
    const [a] = await auctions.listOpen(10);
    const broke = await playerWith(0n);
    clock = new Date(a!.endsAt.getTime() - 60_000);
    const r = await bid(broke.headers, a!.id, a!.debtCents);
    expect(new Date(r.json().auction.ends_at).getTime()).toBe(clock.getTime() + EXTEND_MS);

    clock = new Date(clock.getTime() + EXTEND_MS + 1);
    expect((await bid(broke.headers, a!.id, a!.debtCents * 2)).json().error.code).toBe('auction_closed');
    expect(await tick()).toMatchObject({ unsold: 1 });
    expect((await lots.getLot('teste', 4))!.ownerAccountId).toBe(seller.me);
    // Continua inadimplente: o próximo job abre outro leilão.
    expect(await tick()).toMatchObject({ opened: 1 });
  });

  it('o imóvel vai com o lote', async () => {
    const seller = await defaultedLot();
    const house = {
      id: randomUUID(),
      city: 'teste',
      lotId: 4,
      ownerAccountId: seller.me,
      type: 't1',
      level: 1,
      status: 'active' as const,
      priceCents: 4000_00,
      createdAt: at(200),
      readyAt: at(201),
      wearBase: 100,
      wearSince: at(201),
      lastClaimAt: at(201),
    };
    await properties.createProperty(house);
    await tick();
    const [a] = await auctions.listOpen(10);
    const buyer = await playerWith(100_000_00n);
    await bid(buyer.headers, a!.id, a!.debtCents);
    clock = new Date(clock.getTime() + AUCTION_MS + HOUR);
    await tick();
    expect((await properties.getProperty(house.id))!.ownerAccountId).toBe(buyer.me);
  });
});
