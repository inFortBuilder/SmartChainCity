import { AppError } from '@scc/shared';
import { type Address, type Hex, getAddress, isAddress, zeroAddress } from 'viem';

import type { WorldStore } from './lots.js';

/**
 * Cotação EIP-712 do `LandNFT` (contracts/src/LandNFT.sol, doc 07 §2.1).
 *
 * Aqui o lote já foi pago em SCITY no ledger (compra em três passos). A cotação
 * só leva a posse para a blockchain: preço 0, comprador = uma carteira ligada à
 * conta do dono. O nonce é o próprio `tokenId`, então cada lote vira NFT uma vez
 * só, mesmo que o world emita outra cotação depois de uma vencer sem uso.
 */
export const LOT_QUOTE_TYPES = {
  LotQuote: [
    { name: 'city', type: 'uint32' },
    { name: 'lot', type: 'uint32' },
    { name: 'buyer', type: 'address' },
    { name: 'currency', type: 'address' },
    { name: 'price', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export const landDomain = (chainId: number, verifyingContract: Address) =>
  ({ name: 'SCC LandNFT', version: '1', chainId, verifyingContract }) as const;

export interface LotQuote {
  city: number;
  lot: number;
  buyer: Address;
  currency: Address;
  price: bigint;
  nonce: bigint;
  deadline: bigint;
}

/** Mesmo cálculo do `lotId` do contrato: cidade nos 32 bits altos, lote nos baixos. */
export const lotTokenId = (city: number, lot: number) => (BigInt(city) << 32n) | BigInt(lot);

/** Carteiras ligadas a uma conta (o gateway é a fonte). */
export interface WalletDirectory {
  walletsOf(accountId: string, requestId?: string): Promise<string[]>;
}

export interface QuoteSigner {
  readonly address: Address;
  sign(quote: LotQuote): Promise<Hex>;
}

export interface OnchainQuoteInput {
  city: string;
  lotId: number;
  accountId: string;
  wallet: string;
  /** Id numérico da cidade no contrato (`LAND_CITY_IDS`). */
  cityNftId: number | undefined;
  ttlSeconds: number;
  requestId?: string;
}

const UINT32_MAX = 2 ** 32 - 1;

export async function issueOnchainQuote(
  store: WorldStore,
  wallets: WalletDirectory,
  signer: QuoteSigner,
  input: OnchainQuoteInput,
  now: () => Date = () => new Date(),
) {
  if (input.cityNftId === undefined) {
    throw new AppError('city_not_onchain', 'Esta cidade ainda não tem lotes na blockchain.', 409);
  }
  if (!isAddress(input.wallet)) throw new AppError('invalid_request', 'Carteira inválida.', 400);
  if (input.lotId > UINT32_MAX) throw new AppError('invalid_request', 'Lote fora da faixa do contrato.', 400);

  const lot = await store.getLot(input.city, input.lotId);
  if (!lot) throw new AppError('not_found', 'Lote não encontrado.', 404);
  if (lot.status !== 'sold' || lot.ownerAccountId !== input.accountId) {
    throw new AppError('not_lot_owner', 'Só o dono do lote pode levá-lo para a blockchain.', 403);
  }

  const buyer = getAddress(input.wallet);
  const linked = await wallets.walletsOf(input.accountId, input.requestId);
  if (!linked.some((w) => w.toLowerCase() === buyer.toLowerCase())) {
    throw new AppError('wallet_not_linked', 'A carteira não está ligada à sua conta.', 403);
  }

  const quote: LotQuote = {
    city: input.cityNftId,
    lot: input.lotId,
    buyer,
    currency: zeroAddress,
    price: 0n,
    nonce: lotTokenId(input.cityNftId, input.lotId),
    deadline: BigInt(Math.floor(now().getTime() / 1000) + input.ttlSeconds),
  };
  return { quote, signature: await signer.sign(quote), tokenId: quote.nonce };
}
