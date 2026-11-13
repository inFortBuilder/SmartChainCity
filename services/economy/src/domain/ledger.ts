import { createHash } from 'node:crypto';

import { AppError } from '@scc/shared';

/**
 * Ledger de dupla entrada (doc 06 §2, ADR-0002, ADR-0004). Valores sempre em
 * unidade mínima e `bigint`: THALER com 2 casas (centavos), SCITY com 18 (wei).
 * Nunca `float`.
 */
export const CURRENCIES = { THALER: 2, SCITY: 18 } as const;
export type Currency = keyof typeof CURRENCIES;

/**
 * - player: conta do jogador (owner_id = account.id do gateway).
 * - system: emissora; é a única que pode ficar negativa (o saldo negativo é o
 *   THALER que o jogo já pôs em circulação).
 * - pool: fundos finitos, como o pool P2E; nunca negativo.
 * - burn: destino de sinks; só recebe.
 * - escrow: valor retido (marketplace, aluguel); nunca negativo.
 */
export const OWNER_TYPES = ['player', 'system', 'pool', 'burn', 'escrow'] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];

export interface AccountRef {
  ownerType: OwnerType;
  ownerId: string;
  currency: Currency;
}

export interface Leg {
  account: AccountRef;
  /** + crédito / − débito, em unidade mínima. */
  amount: bigint;
}

export interface PostingRequest {
  /** Motivo da transação: shift_pay, food, tax, lot_buy… */
  kind: string;
  refType?: string | null;
  refId?: string | null;
  /** A mesma chave com o mesmo pedido devolve a mesma transação. */
  idempotencyKey: string;
  legs: Leg[];
}

export interface PostedTx {
  id: string;
  /** Ordem global de lançamento; serve de cursor do extrato. */
  seq: bigint;
  kind: string;
  refType: string | null;
  refId: string | null;
  createdAt: Date;
  legs: Leg[];
}

export interface PostResult {
  tx: PostedTx;
  /** true quando a chave já existia: nada foi lançado de novo. */
  replayed: boolean;
}

export const MAX_LEGS = 20;
const KIND = /^[a-z][a-z0-9_]{1,39}$/;
const SYSTEM_ID = /^[a-z][a-z0-9_]{1,39}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[\w.:-]{8,128}$/;
const REF = /^[\w.:-]{1,128}$/;

export const accountKey = (a: AccountRef) => `${a.ownerType}:${a.ownerId}:${a.currency}`;
export const canGoNegative = (ownerType: OwnerType) => ownerType === 'system';

const invalid = (message: string) => new AppError('invalid_posting', message, 400);

/** Confere a forma do pedido antes de tocar no banco. */
export function validatePosting(req: PostingRequest): void {
  if (!KEY.test(req.idempotencyKey)) throw invalid('Chave de idempotência inválida (8 a 128 caracteres).');
  if (!KIND.test(req.kind)) throw invalid('Tipo de transação inválido.');
  if (req.refType != null && !REF.test(req.refType)) throw invalid('ref_type inválido.');
  if (req.refId != null && !REF.test(req.refId)) throw invalid('ref_id inválido.');
  if (req.legs.length < 2 || req.legs.length > MAX_LEGS) {
    throw invalid(`A transação precisa de 2 a ${MAX_LEGS} lançamentos.`);
  }

  const seen = new Set<string>();
  const sums = new Map<Currency, bigint>();
  for (const { account, amount } of req.legs) {
    if (!OWNER_TYPES.includes(account.ownerType)) throw invalid('Tipo de conta inválido.');
    if (!(account.currency in CURRENCIES)) throw invalid('Moeda inválida.');
    const idOk = account.ownerType === 'player' ? UUID.test(account.ownerId) : SYSTEM_ID.test(account.ownerId);
    if (!idOk) throw invalid('Dono da conta inválido.');
    if (amount === 0n) throw invalid('Lançamento com valor zero.');
    if (account.ownerType === 'burn' && amount < 0n) throw invalid('A conta de queima só recebe.');
    const key = accountKey(account);
    if (seen.has(key)) throw invalid('A mesma conta aparece duas vezes.');
    seen.add(key);
    sums.set(account.currency, (sums.get(account.currency) ?? 0n) + amount);
  }
  for (const [currency, sum] of sums) {
    if (sum !== 0n) throw invalid(`Os lançamentos em ${currency} não somam zero.`);
  }
}

/**
 * Aplica os lançamentos aos saldos atuais e devolve os novos. Recusa se alguma
 * conta que não pode ficar negativa ficaria. Os dois armazenamentos usam esta
 * mesma regra, já com as contas travadas.
 */
export function applyLegs(current: Map<string, bigint>, legs: Leg[]): Map<string, bigint> {
  const next = new Map<string, bigint>();
  for (const { account, amount } of legs) {
    const key = accountKey(account);
    const balance = (current.get(key) ?? 0n) + amount;
    if (balance < 0n && !canGoNegative(account.ownerType)) {
      throw new AppError('insufficient_funds', `Saldo insuficiente em ${account.currency}.`, 409);
    }
    next.set(key, balance);
  }
  return next;
}

/** Impressão digital do pedido: a mesma chave com outro pedido é um erro, não uma repetição. */
export function fingerprint(req: PostingRequest): string {
  const legs = [...req.legs]
    .map((l) => [accountKey(l.account), l.amount.toString()])
    .sort((a, b) => (a[0]! < b[0]! ? -1 : 1));
  return createHash('sha256')
    .update(JSON.stringify([req.kind, req.refType ?? null, req.refId ?? null, legs]))
    .digest('hex');
}

export const idempotencyConflict = () =>
  new AppError('idempotency_conflict', 'Esta chave já foi usada com outro pedido.', 409);

export interface Balance {
  currency: Currency;
  amount: bigint;
}

export interface StatementLine {
  txId: string;
  seq: bigint;
  kind: string;
  refType: string | null;
  refId: string | null;
  currency: Currency;
  amount: bigint;
  createdAt: Date;
}

/** Invariantes do livro inteiro, para o teste de propriedade e para auditoria. */
export interface AuditReport {
  /** Soma de todas as entradas por moeda: tem de ser zero. */
  sums: Map<Currency, bigint>;
  /** Contas cujo saldo guardado difere da soma das suas entradas. */
  mismatches: number;
  /** Contas que não podem ficar negativas e estão. */
  negatives: number;
  /** Transações cujas entradas não somam zero por moeda. */
  unbalancedTx: number;
}

/** Persistência do ledger. Memória e Postgres passam pelo mesmo teste de contrato. */
export interface LedgerStore {
  post(req: PostingRequest, now: Date): Promise<PostResult>;
  balances(ownerType: OwnerType, ownerId: string): Promise<Balance[]>;
  statement(
    ownerType: OwnerType,
    ownerId: string,
    options: { currency?: Currency; before?: bigint; limit: number },
  ): Promise<{ lines: StatementLine[]; next: bigint | null }>;
  audit(): Promise<AuditReport>;
}
