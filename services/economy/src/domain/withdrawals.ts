import { randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';
import { type Address, type Hex, getAddress, isAddress } from 'viem';

import type { LedgerStore, PostingRequest } from './ledger.js';

/**
 * Saque SCITY → carteira pelo `GameVault` (doc 05 §4, doc 07 §2.4, E3.7).
 *
 * 1. O jogador pede `{wallet, amount}`. O economy confere que a carteira é dele
 *    (gateway), a carência da conta nova e o teto de 24 h.
 * 2. Grava o saque (`created`), tira o SCITY do jogador para o escrow
 *    (`escrow/withdrawals`) e assina o voucher EIP-712 (`pending`).
 * 3. A carteira resgata no `GameVault.claim`. O job confere o `nonceUsed` do
 *    contrato: resgatado vira `claimed` (o escrow vai para `system/vault`, o
 *    SCITY que saiu do cofre); vencido sem resgate vira `refunded` (o escrow
 *    volta ao jogador).
 *
 * Cada passo tem a sua chave no ledger, então o job pode repetir qualquer um.
 * Um saque `created` que ficou para trás (queda no meio) é retomado pelo job.
 *
 * PREMISSAS (doc 04 §5, valores a calibrar no simulador):
 * - Mínimo de 1 SCITY por saque; teto de 1.000 SCITY por conta em 24 h.
 * - Carência de 7 dias para conta nova (doc 04 §5).
 * - Voucher vale 48 h (passa da virada do teto diário do contrato).
 * - Sem spread: SCITY sai como SCITY. O spread do doc 04 vale na troca THALER → SCITY.
 * - O saldo grátis do período inicial (ADR-0014) ainda não é marcado: entra com o câmbio.
 */
export const WEI = 10n ** 18n;
export const MIN_WITHDRAWAL_WEI = 1n * WEI;
export const DAILY_LIMIT_WEI = 1000n * WEI;
export const NEW_ACCOUNT_DAYS = 7;
export const VOUCHER_TTL_MS = 48 * 3_600_000;
const DAY_MS = 86_400_000;

export type WithdrawalStatus = 'created' | 'pending' | 'claimed' | 'refunded' | 'failed';

export interface Withdrawal {
  id: string;
  accountId: string;
  wallet: Address;
  amountWei: bigint;
  /** Nonce do voucher: os 128 bits do id. */
  nonce: bigint;
  deadline: Date;
  signature: Hex | null;
  status: WithdrawalStatus;
  createdAt: Date;
  closedAt: Date | null;
}

export interface WithdrawalStore {
  /**
   * Grava o saque se a conta ainda cabe no teto: soma o que ela pediu desde
   * `since` (menos os devolvidos e os que falharam). Atômico por conta. false se passou do teto.
   */
  createWithinLimit(w: Withdrawal, since: Date, limitWei: bigint): Promise<boolean>;
  get(id: string): Promise<Withdrawal | null>;
  listOf(accountId: string, limit: number): Promise<Withdrawal[]>;
  /** `created` parados há mais de `olderThan` e todos os `pending`, para o job. */
  open(olderThan: Date, limit: number): Promise<Withdrawal[]>;
  /** Muda a situação se ela ainda for `from`. */
  transition(id: string, from: WithdrawalStatus, patch: Partial<Pick<Withdrawal, 'status' | 'signature' | 'closedAt'>>): Promise<boolean>;
}

export interface VoucherSigner {
  readonly address: Address;
  sign(v: { to: Address; amount: bigint; nonce: bigint; deadline: bigint }): Promise<Hex>;
}

export interface VaultReader {
  /** O `GameVault` já pagou este nonce? */
  nonceUsed(nonce: bigint): Promise<boolean>;
}

export interface AccountDirectory {
  /** Carteiras ligadas e quando a conta nasceu. */
  account(accountId: string): Promise<{ wallets: string[]; createdAt: Date }>;
}

export const withdrawalNonce = (id: string) => BigInt(`0x${id.replace(/-/g, '')}`);
export const deadlineSeconds = (w: Withdrawal) => BigInt(Math.floor(w.deadline.getTime() / 1000));

const ESCROW = { ownerType: 'escrow', ownerId: 'withdrawals', currency: 'SCITY' } as const;
const player = (id: string) => ({ ownerType: 'player', ownerId: id, currency: 'SCITY' }) as const;

const debitTx = (w: Withdrawal): PostingRequest => ({
  kind: 'scity_withdrawal',
  refType: 'withdrawal',
  refId: w.id,
  idempotencyKey: `withdrawal:${w.id}`,
  legs: [
    { account: player(w.accountId), amount: -w.amountWei },
    { account: ESCROW, amount: w.amountWei },
  ],
});

interface Deps {
  ledger: LedgerStore;
  store: WithdrawalStore;
  signer: VoucherSigner;
}

/** Tira o SCITY para o escrow e assina. Pode repetir: a chave do ledger segura a cobrança. */
async function debitAndSign(deps: Deps, w: Withdrawal, now: Date): Promise<Withdrawal> {
  try {
    await deps.ledger.post(debitTx(w), now);
  } catch (error) {
    if (error instanceof AppError && error.code === 'insufficient_funds') {
      await deps.store.transition(w.id, 'created', { status: 'failed', closedAt: now });
      throw new AppError('insufficient_scity', 'SCITY insuficiente no jogo para este saque.', 409);
    }
    throw error;
  }
  const signature = await deps.signer.sign({ to: w.wallet, amount: w.amountWei, nonce: w.nonce, deadline: deadlineSeconds(w) });
  await deps.store.transition(w.id, 'created', { status: 'pending', signature });
  return { ...w, status: 'pending', signature };
}

export async function requestWithdrawal(
  deps: Deps & { accounts: AccountDirectory },
  input: { accountId: string; wallet: string; amountWei: bigint },
  now: Date,
): Promise<Withdrawal> {
  if (!isAddress(input.wallet)) throw new AppError('invalid_request', 'Carteira inválida.', 400);
  if (input.amountWei < MIN_WITHDRAWAL_WEI) throw new AppError('below_minimum', 'O saque mínimo é 1 SCITY.', 409);
  const wallet = getAddress(input.wallet);
  const acc = await deps.accounts.account(input.accountId);
  if (!acc.wallets.some((w) => w.toLowerCase() === wallet.toLowerCase())) {
    throw new AppError('wallet_not_linked', 'A carteira não está ligada à sua conta.', 403);
  }
  if (now.getTime() - acc.createdAt.getTime() < NEW_ACCOUNT_DAYS * DAY_MS) {
    throw new AppError('account_too_new', `Conta nova: o saque abre ${NEW_ACCOUNT_DAYS} dias depois do cadastro.`, 409);
  }
  const id = randomUUID();
  const w: Withdrawal = {
    id,
    accountId: input.accountId,
    wallet,
    amountWei: input.amountWei,
    nonce: withdrawalNonce(id),
    deadline: new Date(now.getTime() + VOUCHER_TTL_MS),
    signature: null,
    status: 'created',
    createdAt: now,
    closedAt: null,
  };
  if (!(await deps.store.createWithinLimit(w, new Date(now.getTime() - DAY_MS), DAILY_LIMIT_WEI))) {
    throw new AppError('daily_limit', 'Passou do teto de saque de 24 h (1.000 SCITY).', 409);
  }
  return debitAndSign(deps, w, now);
}

/**
 * Job `withdrawals.settle`: retoma os `created` parados, marca os resgatados e
 * devolve os vencidos sem resgate. Sem a rede (RPC fora), não devolve nada.
 */
export async function settleWithdrawals(deps: Deps & { vault: VaultReader }, now: Date) {
  const r = { resumed: 0, claimed: 0, refunded: 0 };
  for (const w of await deps.store.open(new Date(now.getTime() - 60_000), 200)) {
    if (w.status === 'created') {
      await debitAndSign(deps, w, now).then(
        () => r.resumed++,
        () => undefined,
      );
      continue;
    }
    if (await deps.vault.nonceUsed(w.nonce)) {
      await deps.ledger.post(
        {
          kind: 'scity_withdrawal_claimed',
          refType: 'withdrawal',
          refId: w.id,
          idempotencyKey: `withdrawal-claimed:${w.id}`,
          legs: [
            { account: ESCROW, amount: -w.amountWei },
            { account: { ownerType: 'system', ownerId: 'vault', currency: 'SCITY' }, amount: w.amountWei },
          ],
        },
        now,
      );
      if (await deps.store.transition(w.id, 'pending', { status: 'claimed', closedAt: now })) r.claimed++;
      continue;
    }
    // Vencido e não resgatado: o contrato recusa o voucher daqui em diante, então devolve.
    if (w.deadline.getTime() < now.getTime()) {
      await deps.ledger.post(
        {
          kind: 'scity_withdrawal_refund',
          refType: 'withdrawal',
          refId: w.id,
          idempotencyKey: `withdrawal-refund:${w.id}`,
          legs: [
            { account: ESCROW, amount: -w.amountWei },
            { account: player(w.accountId), amount: w.amountWei },
          ],
        },
        now,
      );
      if (await deps.store.transition(w.id, 'pending', { status: 'refunded', closedAt: now })) r.refunded++;
    }
  }
  return r;
}
