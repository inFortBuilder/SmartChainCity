import { AppError } from '@scc/shared';

import type { AuthStore } from './ports.js';

/**
 * KYC progressivo (doc 10: "KYC progressivo para saques acima de um limite").
 *
 * O gateway guarda só a situação da verificação, nunca documento nem foto
 * (LGPD: os dados ficam com o provedor de KYC). No MVP local não há provedor
 * (sem custo): o pedido fica pendente e a revisão decide pela rota interna,
 * que é a mesma que o webhook do provedor vai chamar.
 *
 * Nível 0: conta comum. Nível 1: identidade verificada, libera o saque acima
 * do limite sem KYC (o limite fica no economy).
 */
export type KycStatus = 'pending' | 'approved' | 'rejected';

export interface KycRequest {
  id: string;
  accountId: string;
  level: number;
  status: KycStatus;
  /** Quem verificou: 'manual' no MVP; o nome do provedor depois. */
  provider: string;
  note: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}

export interface KycStore {
  /** Abre o pedido de nível `level`, ou devolve o pendente que já existe. Atômico por conta. */
  openKyc(accountId: string, level: number, now: Date): Promise<KycRequest>;
  latestKyc(accountId: string): Promise<KycRequest | null>;
  listKyc(status: KycStatus, limit: number): Promise<KycRequest[]>;
  /**
   * Decide um pedido ainda pendente. Aprovado, sobe o `kyc_level` da conta
   * (nunca desce). null se o pedido não existe ou já foi decidido.
   */
  decideKyc(id: string, decision: 'approved' | 'rejected', note: string | null, now: Date): Promise<KycRequest | null>;
}

export const KYC_LEVEL = 1;

export async function startKyc(store: AuthStore & KycStore, accountId: string, now: Date) {
  const account = await store.findAccount(accountId);
  if (!account) throw new AppError('not_found', 'Conta não encontrada.', 404);
  if (account.kycLevel >= KYC_LEVEL) throw new AppError('already_verified', 'A identidade desta conta já foi verificada.', 409);
  return store.openKyc(accountId, KYC_LEVEL, now);
}

export async function decideKyc(store: KycStore, id: string, decision: 'approved' | 'rejected', note: string | null, now: Date) {
  const decided = await store.decideKyc(id, decision, note, now);
  if (!decided) throw new AppError('not_pending', 'Pedido de KYC inexistente ou já decidido.', 409);
  return decided;
}

export const kycDto = (r: KycRequest) => ({
  id: r.id,
  level: r.level,
  status: r.status,
  provider: r.provider,
  note: r.note,
  created_at: r.createdAt.toISOString(),
  decided_at: r.decidedAt?.toISOString() ?? null,
});
