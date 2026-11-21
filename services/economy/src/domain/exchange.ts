import { randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';

import type { LedgerStore, PostingRequest } from './ledger.js';

/**
 * Câmbio THALER ↔ SCITY, o "banco central" do doc 04 §5 (passo 11 da trilha).
 *
 * - Cotação: THALER por SCITY = 20 × preço do SCITY em dólar, para o THALER
 *   valer sempre US$ 0,05 e o payback em dólar ficar estável. Hoje o preço vem
 *   de quem opera (`POST /internal/v1/economy/fx`); o TWAP 24 h da DEX entra com
 *   o token na rede (E4.2).
 * - Entrada (SCITY → THALER): sem taxa e sem limite.
 * - Saída (THALER → SCITY): spread queimado (`burn/fx_spread`), mínimo e teto
 *   por conta em 24 h. Freio do pool: a partir de 70% do SCITY liberado do pool
 *   P2E já pago em saídas, o teto cai e o spread sobe, até +10 pontos.
 * - Período grátis (ADR-0014): o THALER ganho no trabalho antes de
 *   `FREE_PERIOD_UNTIL` não vira SCITY. Gastar consome primeiro o grátis.
 *
 * PREMISSAS (as do simulador, tools/econ-sim/params/base.json): 20 THALER/SCITY a
 * US$ 1, spread de 7,5%, mínimo de 500 THALER, teto de 2.000 THALER por dia,
 * freio a partir de 70% com +10 pontos no máximo, liberação do pool do doc 04 §3.
 */
export const THALER_PER_SCITY_AT_ONE_USD = 20;
export const EXIT_SPREAD_BPS = 750;
export const MAX_EXTRA_SPREAD_BPS = 1000;
export const BRAKE_START = 0.7;
export const MIN_EXIT_CENTS = 500_00n;
export const DAILY_EXIT_CENTS = 2000_00n;
/** Liberação do pool P2E por ano, em SCITY (doc 04 §3). */
export const YEARLY_RELEASE_SCITY = [123_000_000, 102_500_000, 82_000_000, 61_500_000, 41_000_000];
/** Tipos de lançamento que contam como ganho do trabalho (o que o período grátis prende). */
export const EARNING_KINDS = ['shift_pay'];

const WEI = 10n ** 18n;
const MICRO = 1_000_000n;
const DAY_MS = 86_400_000;

export type Direction = 'scity_to_thaler' | 'thaler_to_scity';

export interface FxRate {
  /** THALER por SCITY em milionésimos (20 → 20_000_000). */
  thalerPerScityMicro: bigint;
  scityUsd: number;
  validFrom: Date;
  source: string;
}

export interface Conversion {
  id: string;
  accountId: string;
  direction: Direction;
  thalerCents: bigint;
  scityWei: bigint;
  feeCents: bigint;
  thalerPerScityMicro: bigint;
  spreadBps: number;
  status: 'created' | 'done' | 'failed';
  createdAt: Date;
}

export interface ExchangeStore {
  latestRate(at: Date): Promise<FxRate | null>;
  get(id: string): Promise<Conversion | null>;
  setRate(rate: FxRate): Promise<void>;
  /**
   * Grava a saída se a conta cabe no teto (soma das saídas desde `since`, sem as
   * que falharam). Entrada não tem teto. Atômico por conta. false se passou.
   */
  createWithinLimit(c: Conversion, since: Date, limitCents: bigint): Promise<boolean>;
  setStatus(id: string, status: 'done' | 'failed'): Promise<void>;
  /** SCITY já pago em saídas (para o freio do pool). */
  scityPaidOut(): Promise<bigint>;
  listOf(accountId: string, limit: number): Promise<Conversion[]>;
}

/** O que o ledger precisa dizer para o período grátis. */
export interface EarningsReader {
  /** THALER ganho em `kinds` antes de `before`, e tudo o que a conta já gastou de THALER. */
  earnedAndSpent(accountId: string, kinds: string[], before: Date): Promise<{ earned: bigint; spent: bigint }>;
}

export const rateFromUsd = (scityUsd: number, validFrom: Date, source: string): FxRate => ({
  thalerPerScityMicro: BigInt(Math.round(THALER_PER_SCITY_AT_ONE_USD * scityUsd * 1_000_000)),
  scityUsd,
  validFrom,
  source,
});

/** SCITY liberado do pool P2E até `now`, linear dentro de cada ano, a partir do início `start`. */
export function releasedScity(start: Date, now: Date): bigint {
  const days = Math.floor((now.getTime() - start.getTime()) / DAY_MS);
  if (days < 0) return 0n;
  const year = Math.floor(days / 365);
  let total = 0;
  for (let y = 0; y < Math.min(year, YEARLY_RELEASE_SCITY.length); y++) total += YEARLY_RELEASE_SCITY[y]!;
  if (year < YEARLY_RELEASE_SCITY.length) total += (YEARLY_RELEASE_SCITY[year]! * ((days % 365) + 1)) / 365;
  return BigInt(Math.floor(total)) * WEI;
}

/** Freio: 0 até 70% de uso do liberado, 1 no limite. */
export function brakeLevel(paidWei: bigint, releasedWei: bigint): number {
  if (releasedWei <= 0n) return 0;
  const used = Number((paidWei * 1_000_000n) / releasedWei) / 1_000_000;
  return Math.max(0, Math.min(1, (used - BRAKE_START) / (1 - BRAKE_START)));
}

export interface Quote {
  direction: Direction;
  thalerCents: bigint;
  scityWei: bigint;
  feeCents: bigint;
  spreadBps: number;
}

/** Cotação de uma conversão. Arredonda sempre a favor do jogo. */
export function quote(direction: Direction, amount: bigint, rate: FxRate, brake = 0): Quote {
  if (direction === 'scity_to_thaler') {
    const thalerCents = (amount * rate.thalerPerScityMicro * 100n) / (WEI * MICRO);
    return { direction, thalerCents, scityWei: amount, feeCents: 0n, spreadBps: 0 };
  }
  const spreadBps = EXIT_SPREAD_BPS + Math.round(MAX_EXTRA_SPREAD_BPS * brake);
  const feeCents = (amount * BigInt(spreadBps) + 9_999n) / 10_000n;
  const scityWei = ((amount - feeCents) * WEI * MICRO) / (rate.thalerPerScityMicro * 100n);
  return { direction, thalerCents: amount, scityWei, feeCents, spreadBps };
}

const P = (id: string, currency: 'THALER' | 'SCITY') => ({ ownerType: 'player', ownerId: id, currency }) as const;
const FX = (currency: 'THALER' | 'SCITY') => ({ ownerType: 'system', ownerId: 'fx', currency }) as const;

function postingOf(c: Conversion): PostingRequest {
  const base = { refType: 'fx_conversion', refId: c.id, idempotencyKey: `fx:${c.id}` };
  if (c.direction === 'scity_to_thaler') {
    return {
      ...base,
      kind: 'fx_scity_to_thaler',
      legs: [
        { account: P(c.accountId, 'SCITY'), amount: -c.scityWei },
        { account: FX('SCITY'), amount: c.scityWei },
        { account: FX('THALER'), amount: -c.thalerCents },
        { account: P(c.accountId, 'THALER'), amount: c.thalerCents },
      ],
    };
  }
  return {
    ...base,
    kind: 'fx_thaler_to_scity',
    legs: [
      { account: P(c.accountId, 'THALER'), amount: -c.thalerCents },
      ...(c.feeCents > 0n ? [{ account: { ownerType: 'burn', ownerId: 'fx_spread', currency: 'THALER' } as const, amount: c.feeCents }] : []),
      { account: FX('THALER'), amount: c.thalerCents - c.feeCents },
      { account: FX('SCITY'), amount: -c.scityWei },
      { account: P(c.accountId, 'SCITY'), amount: c.scityWei },
    ],
  };
}

export interface ExchangeDeps {
  ledger: LedgerStore;
  store: ExchangeStore;
  earnings: EarningsReader | null;
  /** Início da liberação do pool P2E (TGE). Sem ele, o freio fica desligado. */
  poolStart: Date | null;
  /** Fim do período grátis. Sem ele, todo THALER é conversível. */
  freeUntil: Date | null;
}

/** Cotação de agora: taxa, spread e freio. */
export async function currentTerms(deps: Pick<ExchangeDeps, 'store' | 'poolStart'>, now: Date) {
  const rate = await deps.store.latestRate(now);
  if (!rate) throw new AppError('fx_unavailable', 'O câmbio ainda não tem cotação.', 503);
  const brake = deps.poolStart ? brakeLevel(await deps.store.scityPaidOut(), releasedScity(deps.poolStart, now)) : 0;
  return {
    rate,
    brake,
    exitSpreadBps: EXIT_SPREAD_BPS + Math.round(MAX_EXTRA_SPREAD_BPS * brake),
    dailyExitCents: (DAILY_EXIT_CENTS * BigInt(Math.round((1 - brake) * 10_000))) / 10_000n,
  };
}

export async function convert(
  deps: ExchangeDeps,
  input: { accountId: string; direction: Direction; amount: bigint; /** Id fixo (da Idempotency-Key): repetir o pedido devolve a mesma conversão. */ id?: string },
  now: Date,
) {
  if (input.amount <= 0n) throw new AppError('invalid_request', 'Valor inválido.', 400);
  if (input.id) {
    const seen = await deps.store.get(input.id);
    if (seen) {
      if (seen.accountId !== input.accountId) throw new AppError('idempotency_conflict', 'Esta chave já foi usada.', 409);
      if (seen.status === 'failed') throw new AppError('conversion_failed', 'Esta conversão falhou; peça de novo com outra chave.', 409);
      return seen;
    }
  }
  const terms = await currentTerms(deps, now);
  const q = quote(input.direction, input.amount, terms.rate, terms.brake);
  if (q.thalerCents <= 0n || q.scityWei <= 0n) throw new AppError('amount_too_small', 'Valor pequeno demais para converter.', 409);

  if (input.direction === 'thaler_to_scity') {
    if (input.amount < MIN_EXIT_CENTS) throw new AppError('below_minimum', 'A conversão mínima para SCITY é de 500 THALER.', 409);
    if (terms.dailyExitCents <= 0n) throw new AppError('pool_brake', 'O pool de recompensas está no limite: a conversão para SCITY está pausada.', 409);
    if (deps.freeUntil && deps.earnings) {
      // Gasta-se primeiro o grátis: preso é o que sobra dele depois de tudo o que a conta já gastou.
      const { earned, spent } = await deps.earnings.earnedAndSpent(input.accountId, EARNING_KINDS, deps.freeUntil);
      const locked = earned > spent ? earned - spent : 0n;
      const balance = (await deps.ledger.balances('player', input.accountId)).find((b) => b.currency === 'THALER')?.amount ?? 0n;
      if (balance - locked < input.amount) {
        throw new AppError('free_period_locked', `${locked} centavos de THALER vieram do período grátis e não viram SCITY (ADR-0014).`, 409);
      }
    }
  }

  const c: Conversion = {
    id: input.id ?? randomUUID(),
    accountId: input.accountId,
    direction: input.direction,
    thalerCents: q.thalerCents,
    scityWei: q.scityWei,
    feeCents: q.feeCents,
    thalerPerScityMicro: terms.rate.thalerPerScityMicro,
    spreadBps: q.spreadBps,
    status: 'created',
    createdAt: now,
  };
  if (!(await deps.store.createWithinLimit(c, new Date(now.getTime() - DAY_MS), terms.dailyExitCents))) {
    throw new AppError('daily_limit', 'Passou do teto de conversão para SCITY em 24 h.', 409);
  }
  try {
    await deps.ledger.post(postingOf(c), now);
  } catch (error) {
    await deps.store.setStatus(c.id, 'failed');
    if (error instanceof AppError && error.code === 'insufficient_funds') {
      throw new AppError(input.direction === 'thaler_to_scity' ? 'insufficient_thaler' : 'insufficient_scity', 'Saldo insuficiente para converter.', 409);
    }
    throw error;
  }
  await deps.store.setStatus(c.id, 'done');
  return { ...c, status: 'done' as const };
}
