import { randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';

import type { BuildingStore } from './buildings.js';
import type { Lot, WorldStore } from './lots.js';
import { DAY_MS, type Property, type PropertyStore } from './properties.js';

/**
 * Impostos dos lotes (doc 03 §4, doc 04 §7, E2.6). Cobrados em THALER, do
 * jogador para a queima (`burn/tax`), por débito automático no job `tax.charge`.
 *
 * - IPTU: lote com imóvel pronto. Valor fixo por período.
 * - PT (Property Tax): lote vendido e sem imóvel. Cresce a cada mês sem uso,
 *   contra a especulação (doc 03 §4).
 * - Inadimplência: sem saldo, a conta recebe multa uma vez; com imposto vencido
 *   há mais de 90 dias, o lote fica bloqueado (obra, reparo, upgrade, cotação
 *   on-chain). O leilão do doc 03 §4 ainda não existe.
 *
 * PREMISSAS (doc 11, lacuna 5: "definir com o simulador"):
 * - IPTU de 180 THALER a cada 182 dias (o `iptuSemiannual` do simulador).
 * - PT a cada 30 dias, 10 THALER × o número do mês sem uso (sem fonte; o simulador não tem PT).
 * - Multa de 10%; bloqueio depois de 90 dias (o "proposto: 3 meses" do doc 03 §4).
 */

export const IPTU_PERIOD_DAYS = 182;
export const IPTU_CENTS = 180_00;
export const PT_PERIOD_DAYS = 30;
export const PT_STEP_CENTS = 10_00;
export const FINE_SHARE = 0.1;
export const DEFAULT_AFTER_DAYS = 90;

export type TaxKind = 'iptu' | 'pt';
export type TaxStatus = 'pending' | 'paid';

export interface TaxBill {
  id: string;
  city: string;
  lotId: number;
  accountId: string;
  kind: TaxKind;
  /** Número do período (1, 2, 3…), contado do início da cobrança daquele imposto. */
  period: number;
  amountCents: number;
  fineCents: number;
  dueAt: Date;
  status: TaxStatus;
  paidAt: Date | null;
  createdAt: Date;
}

export interface TaxStore {
  /** Cria as contas que faltam; as que já existem (mesmo lote, tipo e período) ficam como estão. */
  upsertBills(bills: TaxBill[]): Promise<number>;
  pendingBills(accountId?: string): Promise<TaxBill[]>;
  billsOf(accountId: string, limit: number): Promise<TaxBill[]>;
  /** Multa uma vez só (`fineCents` sai de 0). */
  setFine(id: string, fineCents: number): Promise<void>;
  markPaid(id: string, at: Date): Promise<void>;
  /** Conta vencida há mais de `DEFAULT_AFTER_DAYS` neste lote? */
  inDefault(city: string, lotId: number, now: Date): Promise<boolean>;
  /** Total pago em impostos, com as multas, em centavos de THALER (site). */
  paidTotalCents(): Promise<bigint>;
}

export interface TaxPayments {
  /** THALER do jogador para `burn/tax`. Idempotente pela conta e pelo total. */
  pay(bill: TaxBill, requestId?: string): Promise<void>;
}

const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY_MS);

/**
 * Contas devidas de um lote até `now`. IPTU a partir do fim da obra; PT a partir
 * da compra, enquanto o lote está sem imóvel (a obra começada já conta como uso).
 */
export function billsDue(
  lot: Lot,
  property: Property | null,
  now: Date,
  /** Início do prédio de construtor no lote, se houver: também conta como uso. */
  buildingSince: Date | null = null,
): Omit<TaxBill, 'id' | 'createdAt'>[] {
  if (lot.status !== 'sold' || !lot.ownerAccountId || !lot.soldAt) return [];
  const out: Omit<TaxBill, 'id' | 'createdAt'>[] = [];
  const base = { city: lot.city, lotId: lot.id, accountId: lot.ownerAccountId, fineCents: 0, status: 'pending' as const, paidAt: null };

  // PT: períodos de 30 dias desde a compra, até a obra (imóvel ou prédio) começar.
  const starts = [property?.createdAt, buildingSince].filter((d): d is Date => d instanceof Date);
  const ptEnd = starts.length ? new Date(Math.min(...starts.map((d) => d.getTime()))) : now;
  for (let n = 1; ; n++) {
    const dueAt = addDays(lot.soldAt, n * PT_PERIOD_DAYS);
    if (dueAt > now || dueAt > ptEnd) break;
    out.push({ ...base, kind: 'pt', period: n, amountCents: PT_STEP_CENTS * n, dueAt });
  }
  // IPTU: períodos de 182 dias desde o fim da obra (imóvel pago).
  if (property && property.status === 'active') {
    for (let n = 1; ; n++) {
      const dueAt = addDays(property.readyAt, n * IPTU_PERIOD_DAYS);
      if (dueAt > now) break;
      out.push({ ...base, kind: 'iptu', period: n, amountCents: IPTU_CENTS, dueAt });
    }
  }
  return out;
}

export const totalOf = (b: TaxBill) => b.amountCents + b.fineCents;

/** Tenta pagar uma conta; sem saldo, aplica a multa (uma vez) e deixa pendente. */
async function tryPay(store: TaxStore, payments: TaxPayments, bill: TaxBill, now: Date, requestId?: string) {
  try {
    await payments.pay(bill, requestId);
    await store.markPaid(bill.id, now);
    return true;
  } catch (error) {
    if (error instanceof AppError && error.code === 'insufficient_thaler') {
      // A multa só entra depois de uma recusa definitiva: nada foi lançado com o total antigo.
      if (bill.fineCents === 0) await store.setFine(bill.id, Math.ceil(bill.amountCents * FINE_SHARE));
      return false;
    }
    throw error;
  }
}

/**
 * Job `tax.charge`: gera as contas vencidas de todos os lotes vendidos e tenta
 * pagar as pendentes por débito automático. Repetir não cria nem cobra em dobro.
 */
export async function chargeTaxes(
  lots: WorldStore,
  properties: PropertyStore,
  store: TaxStore,
  payments: TaxPayments,
  now: Date,
  buildings: Pick<BuildingStore, 'buildingOnLot'> | null = null,
): Promise<{ created: number; paid: number; unpaid: number }> {
  const bills: TaxBill[] = [];
  for (const lot of await lots.soldLots()) {
    const property = await properties.propertyOnLot(lot.city, lot.id);
    const building = buildings ? await buildings.buildingOnLot(lot.city, lot.id) : null;
    for (const b of billsDue(lot, property, now, building?.createdAt ?? null)) bills.push({ ...b, id: randomUUID(), createdAt: now });
  }
  const created = bills.length ? await store.upsertBills(bills) : 0;
  let paid = 0;
  let unpaid = 0;
  for (const bill of await store.pendingBills()) {
    try {
      if (await tryPay(store, payments, bill, now)) paid++;
      else unpaid++;
    } catch {
      unpaid++; // ledger fora: tenta de novo na próxima rodada
    }
  }
  return { created, paid, unpaid };
}

/** O jogador paga agora o que deve (depois de pôr THALER na conta). */
export async function payMyTaxes(store: TaxStore, payments: TaxPayments, accountId: string, now: Date, requestId?: string) {
  const pending = await store.pendingBills(accountId);
  let paid = 0;
  for (const bill of pending) {
    if (await tryPay(store, payments, bill, now, requestId)) paid++;
  }
  return { paid, unpaid: pending.length - paid };
}

/** Lote com imposto vencido há mais de 90 dias não aceita obra nem cotação on-chain. */
export async function assertNotInDefault(store: TaxStore | null, city: string, lotId: number, now: Date) {
  if (store && (await store.inDefault(city, lotId, now))) {
    throw new AppError('tax_default', 'Este lote tem imposto vencido há mais de 90 dias. Pague para liberar.', 409);
  }
}
