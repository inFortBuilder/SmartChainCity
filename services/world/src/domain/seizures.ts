import { randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';
import { type Address, type Hex, getAddress, isAddress } from 'viem';

import type { WalletDirectory } from './land-quote.js';

/**
 * Apreensão do NFT no leilão por imposto (doc 03 §4, ADR-0016).
 *
 * O leilão passa o lote (e o imóvel) ao vencedor dentro do jogo. Se o token já
 * está numa carteira, o vencedor pede a apreensão: um voucher EIP-712 do world
 * que o `LandNFT.seize` / `PropertyNFT.seize` aceita para levar o token de quem
 * o tiver até a carteira do vencedor.
 *
 * Enquanto a apreensão está aberta, o `chain.sync` ignora as transferências do
 * token (o dono antigo não tira o lote do vencedor vendendo na blockchain) e
 * fecha a apreensão quando o token chega a uma carteira do vencedor.
 */
export type SeizureKind = 'lot' | 'property';
export type SeizureStatus = 'open' | 'done' | 'cancelled';

export interface Seizure {
  id: string;
  kind: SeizureKind;
  /** tokenId do contrato (texto, uint256). */
  tokenId: string;
  city: string;
  lotId: number;
  propertyId: string | null;
  toAccountId: string;
  /** Nonce do voucher: os 128 bits do id. */
  nonce: bigint;
  status: SeizureStatus;
  createdAt: Date;
  closedAt: Date | null;
}

export interface SeizureStore {
  /** Abre a apreensão do token; uma aberta antes para o mesmo token é cancelada (vale a última). */
  openSeizure(s: Seizure): Promise<Seizure>;
  get(id: string): Promise<Seizure | null>;
  openFor(kind: SeizureKind, tokenId: string): Promise<Seizure | null>;
  openOf(accountId: string): Promise<Seizure[]>;
  /** Fecha se ainda estiver aberta. */
  close(id: string, status: Exclude<SeizureStatus, 'open'>, now: Date): Promise<boolean>;
}

export const SEIZURE_TYPES = {
  Seizure: [
    { name: 'tokenId', type: 'uint256' },
    { name: 'to', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export interface SeizureVoucher {
  tokenId: bigint;
  to: Address;
  nonce: bigint;
  deadline: bigint;
}

export interface SeizureSigner {
  readonly address: Address;
  /** Contrato que aceita a apreensão (LandNFT ou PropertyNFT). */
  readonly contract: Address;
  sign(v: SeizureVoucher): Promise<Hex>;
}

/** O token existe na blockchain? (chain-indexer). null: não deu para saber agora. */
export interface ChainTokens {
  exists(kind: SeizureKind, tokenId: string): Promise<boolean | null>;
}

/** Prazo do voucher de apreensão: um dia para o vencedor enviar. */
export const SEIZURE_TTL_SECONDS = 86_400;

export const seizureNonce = (id: string) => BigInt(`0x${id.replace(/-/g, '')}`);

export function newSeizure(input: { kind: SeizureKind; tokenId: bigint; city: string; lotId: number; propertyId?: string | null; toAccountId: string }, now: Date): Seizure {
  const id = randomUUID();
  return {
    id,
    kind: input.kind,
    tokenId: input.tokenId.toString(),
    city: input.city,
    lotId: input.lotId,
    propertyId: input.propertyId ?? null,
    toAccountId: input.toAccountId,
    nonce: seizureNonce(id),
    status: 'open',
    createdAt: now,
    closedAt: null,
  };
}

/**
 * Voucher de apreensão para uma carteira ligada do vencedor. Token que nunca foi
 * para a blockchain não tem o que apreender: a apreensão é cancelada e o
 * vencedor leva o lote para a carteira pelo caminho normal.
 */
export async function issueSeizureVoucher(
  deps: { store: SeizureStore; wallets: WalletDirectory; signers: Partial<Record<SeizureKind, SeizureSigner>>; chain?: ChainTokens | null },
  input: { seizureId: string; accountId: string; wallet: string; requestId?: string },
  now: Date,
) {
  const s = await deps.store.get(input.seizureId);
  if (!s || s.toAccountId !== input.accountId) throw new AppError('not_found', 'Apreensão não encontrada.', 404);
  if (s.status !== 'open') throw new AppError('seizure_closed', 'Esta apreensão já foi concluída ou cancelada.', 409);
  const signer = deps.signers[s.kind];
  if (!signer) throw new AppError('onchain_disabled', 'O contrato deste token não está configurado.', 503);
  if (!isAddress(input.wallet)) throw new AppError('invalid_request', 'Carteira inválida.', 400);
  const wallet = getAddress(input.wallet);
  const linked = await deps.wallets.walletsOf(input.accountId, input.requestId);
  if (!linked.some((w) => w.toLowerCase() === wallet.toLowerCase())) {
    throw new AppError('wallet_not_linked', 'A carteira não está ligada à sua conta.', 403);
  }
  if (deps.chain && (await deps.chain.exists(s.kind, s.tokenId)) === false) {
    await deps.store.close(s.id, 'cancelled', now);
    throw new AppError('not_onchain', 'Este token não está na blockchain: leve o lote para a carteira pelo caminho normal.', 409);
  }
  const voucher: SeizureVoucher = {
    tokenId: BigInt(s.tokenId),
    to: wallet,
    nonce: s.nonce,
    deadline: BigInt(Math.floor(now.getTime() / 1000) + SEIZURE_TTL_SECONDS),
  };
  return { seizure: s, voucher, signature: await signer.sign(voucher), contract: signer.contract };
}

export const seizureDto = (s: Seizure) => ({
  id: s.id,
  kind: s.kind,
  token_id: s.tokenId,
  city: s.city,
  lot_id: s.lotId,
  property_id: s.propertyId,
  status: s.status,
  created_at: s.createdAt.toISOString(),
  closed_at: s.closedAt?.toISOString() ?? null,
});
