import { randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';

import type { BuildingStore } from './buildings.js';
import { AREA_CAP_SHARE, type Lot, type WorldStore } from './lots.js';
import { DAY_MS, type PropertyStore } from './properties.js';
import { type TaxBill, type TaxStore, totalOf } from './taxes.js';

/**
 * Leilão do lote inadimplente (doc 03 §4, E2.6): "inadimplência → multa →
 * leilão após N ciclos". O lote vai com o imóvel (venda em combo).
 *
 * Como funciona:
 * - O job `auctions.tick` abre o leilão quando o lote tem imposto vencido há
 *   mais de `AUCTION_AFTER_DAYS`. O lance mínimo é a dívida (impostos e multas).
 * - Lance aberto, em THALER, sem reserva de saldo: cada lance precisa passar o
 *   maior em pelo menos `MIN_STEP_SHARE`. Lance nos últimos 10 min estende o fim.
 * - No fim, cobra o maior lance. Sem saldo, passa para o próximo jogador. O
 *   preço sai do vencedor numa transação só do ledger: a dívida vai para a queima
 *   (`burn/tax`) e o resto para o antigo dono.
 * - Depois da cobrança, o lote e o imóvel passam para o vencedor e as contas do
 *   lote ficam pagas. Se o dono pagar antes do fim, o leilão é cancelado.
 *
 * PREMISSAS (doc 11, lacuna 5; sem fonte no GDD):
 * - Abre 120 dias depois do vencimento (30 dias depois do bloqueio de 90).
 * - Dura 72 h; passo mínimo de 5%; extensão de 10 min.
 * - A renda acumulada do imóvel vai com ele para o novo dono.
 * - Lote com prédio de construtor não vai a leilão (o prédio tem regras e NFT próprios).
 */
export const AUCTION_AFTER_DAYS = 120;
export const AUCTION_MS = 72 * 3_600_000;
export const MIN_STEP_SHARE = 0.05;
export const EXTEND_MS = 10 * 60_000;

/**
 * `open`: recebendo lances. `charged`: o vencedor pagou e falta passar o lote.
 * `settled`: lote passado. `cancelled`: o dono pagou. `unsold`: ninguém pagou.
 */
export type AuctionStatus = 'open' | 'charged' | 'settled' | 'cancelled' | 'unsold';

export interface Auction {
  id: string;
  city: string;
  lotId: number;
  sellerAccountId: string;
  /** Dívida na abertura (impostos e multas pendentes), em centavos de THALER: o lance mínimo. */
  debtCents: number;
  /** Contas que o leilão quita. */
  billIds: string[];
  status: AuctionStatus;
  startsAt: Date;
  endsAt: Date;
  winnerAccountId: string | null;
  priceCents: number | null;
  closedAt: Date | null;
}

export interface Bid {
  id: string;
  auctionId: string;
  accountId: string;
  amountCents: number;
  createdAt: Date;
}

export interface AuctionStore {
  /** Abre, se o lote não tem leilão `open` ou `charged`. false se já tem. */
  openAuction(a: Auction): Promise<boolean>;
  getAuction(id: string): Promise<Auction | null>;
  /** Leilão em andamento (`open` ou `charged`) no lote. */
  activeOnLot(city: string, lotId: number): Promise<Auction | null>;
  listOpen(limit: number): Promise<Auction[]>;
  /** `open` vencidos e `charged` (a passagem do lote ficou pela metade). */
  due(now: Date): Promise<Auction[]>;
  /** Lances, o maior primeiro. */
  bidsOf(auctionId: string): Promise<Bid[]>;
  /**
   * Grava o lance com o leilão travado: `check` recebe o leilão e o maior lance
   * de agora, e devolve o novo fim (ou recusa com AppError).
   */
  placeBid(bid: Bid, check: (a: Auction, top: Bid | null) => Date): Promise<Auction>;
  /** Muda a situação se ela ainda for `from`. false se outro já mudou. */
  transition(id: string, from: AuctionStatus, patch: Partial<Pick<Auction, 'status' | 'winnerAccountId' | 'priceCents' | 'closedAt'>>): Promise<boolean>;
}

export interface AuctionPayments {
  /** Lance do vencedor: a dívida de agora para `burn/tax`, o resto para o antigo dono. Idempotente pelo leilão e pelo jogador. */
  settle(a: Auction, winner: string, priceCents: number, debtCents: number, requestId?: string): Promise<void>;
}

/** Lance mínimo agora: a dívida, ou o maior lance mais o passo. */
export const minBid = (a: Auction, top: Bid | null) =>
  top ? Math.max(top.amountCents + 1, Math.ceil(top.amountCents * (1 + MIN_STEP_SHARE))) : a.debtCents;

/** Lotes com conta vencida há mais de `AUCTION_AFTER_DAYS`, com as contas pendentes de cada um. */
export function lotsForAuction(pending: TaxBill[], now: Date) {
  const limit = now.getTime() - AUCTION_AFTER_DAYS * DAY_MS;
  const byLot = new Map<string, TaxBill[]>();
  for (const b of pending) {
    const k = `${b.city}:${b.lotId}`;
    byLot.set(k, [...(byLot.get(k) ?? []), b]);
  }
  return [...byLot.values()].filter((bills) => bills.some((b) => b.dueAt.getTime() <= limit));
}

/** Regras de compra que valem também no leilão (doc 03 §5): um bairro por jogador e o teto de área. */
export async function checkBidder(lots: WorldStore, lot: Lot, accountId: string) {
  const owned = (await lots.lotsOf(accountId)).filter((l) => l.city === lot.city);
  const other = owned.find((o) => o.district !== lot.district);
  if (other) throw new AppError('other_district', `Seus lotes ficam no bairro ${other.district + 1}: dê lances lá.`, 409);
  const district = (await lots.districts(lot.city)).find((d) => d.order === lot.district);
  const area = owned.reduce((s, o) => s + o.areaM2, 0) + lot.areaM2;
  if (district && area > district.areaM2 * AREA_CAP_SHARE) {
    throw new AppError('area_cap', `Um jogador pode ter até ${AREA_CAP_SHARE * 100}% da área do bairro.`, 409);
  }
}

export async function placeBid(
  store: AuctionStore,
  lots: WorldStore,
  input: { auctionId: string; accountId: string; amountCents: number },
  now: Date,
) {
  const a = await store.getAuction(input.auctionId);
  if (!a) throw new AppError('not_found', 'Leilão não encontrado.', 404);
  if (a.sellerAccountId === input.accountId) throw new AppError('own_auction', 'O dono não dá lance no próprio lote.', 409);
  const lot = await lots.getLot(a.city, a.lotId);
  if (!lot) throw new AppError('not_found', 'Lote não encontrado.', 404);
  await checkBidder(lots, lot, input.accountId);
  const bid: Bid = { id: randomUUID(), auctionId: a.id, accountId: input.accountId, amountCents: input.amountCents, createdAt: now };
  const updated = await store.placeBid(bid, (cur, top) => {
    if (cur.status !== 'open' || cur.endsAt.getTime() <= now.getTime()) {
      throw new AppError('auction_closed', 'O leilão já terminou.', 409);
    }
    const min = minBid(cur, top);
    if (input.amountCents < min) throw new AppError('bid_too_low', `O lance mínimo agora é ${min} centavos de THALER.`, 409);
    // Lance no fim estende o leilão: ninguém ganha no último segundo.
    return new Date(Math.max(cur.endsAt.getTime(), now.getTime() + EXTEND_MS));
  });
  return { bid, auction: updated };
}

/**
 * Job `auctions.tick`: abre os leilões devidos e fecha os que venceram. Repetir
 * não cobra em dobro: a cobrança é idempotente e a passagem do lote também.
 */
export async function tickAuctions(
  deps: {
    auctions: AuctionStore;
    taxes: TaxStore;
    lots: WorldStore;
    properties: PropertyStore;
    payments: AuctionPayments;
    buildings?: Pick<BuildingStore, 'buildingOnLot'> | null;
  },
  now: Date,
): Promise<{ opened: number; settled: number; cancelled: number; unsold: number }> {
  const r = { opened: 0, settled: 0, cancelled: 0, unsold: 0 };
  const pending = await deps.taxes.pendingBills();

  for (const bills of lotsForAuction(pending, now)) {
    const { city, lotId } = bills[0]!;
    if (await deps.auctions.activeOnLot(city, lotId)) continue;
    const lot = await deps.lots.getLot(city, lotId);
    if (!lot || lot.status !== 'sold' || !lot.ownerAccountId) continue;
    if (deps.buildings && (await deps.buildings.buildingOnLot(city, lotId))) continue;
    const opened = await deps.auctions.openAuction({
      id: randomUUID(),
      city,
      lotId,
      sellerAccountId: lot.ownerAccountId,
      debtCents: bills.reduce((s, b) => s + totalOf(b), 0),
      billIds: bills.map((b) => b.id),
      status: 'open',
      startsAt: now,
      endsAt: new Date(now.getTime() + AUCTION_MS),
      winnerAccountId: null,
      priceCents: null,
      closedAt: null,
    });
    if (opened) r.opened++;
  }

  const stillPending = new Map((await deps.taxes.pendingBills()).map((b) => [b.id, b]));
  for (const a of await deps.auctions.due(now)) {
    if (a.status === 'open') {
      // O dono pagou: as contas do leilão não estão mais pendentes.
      if (!a.billIds.some((id) => stillPending.has(id))) {
        if (await deps.auctions.transition(a.id, 'open', { status: 'cancelled', closedAt: now })) r.cancelled++;
        continue;
      }
      // Só o que ainda está pendente vai para a queima: o dono pode ter pago parte.
      const debt = a.billIds.reduce((s, id) => s + (stillPending.has(id) ? totalOf(stillPending.get(id)!) : 0), 0);
      const charged = await chargeWinner(deps, a, debt, now);
      if (!charged) {
        if (await deps.auctions.transition(a.id, 'open', { status: 'unsold', closedAt: now })) r.unsold++;
        continue;
      }
    }
    const current = (await deps.auctions.getAuction(a.id))!;
    if (current.status === 'charged') {
      await handOver(deps, current, now);
      if (await deps.auctions.transition(a.id, 'charged', { status: 'settled', closedAt: now })) r.settled++;
    }
  }
  return r;
}

/** Cobra o maior lance; sem saldo, o próximo jogador. true se alguém pagou. */
async function chargeWinner(deps: { auctions: AuctionStore; payments: AuctionPayments }, a: Auction, debtCents: number, now: Date) {
  const tried = new Set<string>();
  for (const bid of await deps.auctions.bidsOf(a.id)) {
    if (tried.has(bid.accountId)) continue;
    tried.add(bid.accountId);
    try {
      await deps.payments.settle(a, bid.accountId, bid.amountCents, debtCents);
    } catch (error) {
      if (error instanceof AppError && error.code === 'insufficient_thaler') continue;
      throw error; // ledger fora: tenta de novo na próxima rodada
    }
    await deps.auctions.transition(a.id, 'open', { status: 'charged', winnerAccountId: bid.accountId, priceCents: bid.amountCents, closedAt: now });
    return true;
  }
  return false;
}

/** Passa o lote e o imóvel ao vencedor e quita as contas. Cada passo pode repetir. */
async function handOver(deps: { taxes: TaxStore; lots: WorldStore; properties: PropertyStore }, a: Auction, now: Date) {
  const winner = a.winnerAccountId!;
  await deps.lots.transferLot(a.city, a.lotId, a.sellerAccountId, winner);
  const p = await deps.properties.propertyOnLot(a.city, a.lotId);
  if (p) await deps.properties.transferProperty(p.id, a.sellerAccountId, winner);
  for (const id of a.billIds) await deps.taxes.markPaid(id, now);
}
