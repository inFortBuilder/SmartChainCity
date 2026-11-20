import { AppError } from '@scc/shared';
import { type Address, type Hex, getAddress, isAddress } from 'viem';

import type { BuildingStore } from './buildings.js';
import { type WalletDirectory, lotTokenId } from './land-quote.js';

/**
 * Voucher EIP-712 do `BuildingNFT` (contracts/src/BuildingNFT.sol, doc 13 §7, E2.11).
 *
 * O world só assina para prédio com alvará (`approved`), do próprio jogador, para
 * uma carteira ligada à conta. O `modelHash` é o SHA-256 do GLB aprovado, que o
 * SCC Builder devolve na validação. O contrato confere o resto on-chain: que a
 * carteira é dona do lote no `LandNFT` e que o lote não tem outro prédio.
 */
export const BUILDING_VOUCHER_TYPES = {
  BuildingVoucher: [
    { name: 'lotId', type: 'uint256' },
    { name: 'developer', type: 'address' },
    { name: 'modelHash', type: 'bytes32' },
    { name: 'floors', type: 'uint16' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export const buildingDomain = (chainId: number, verifyingContract: Address) =>
  ({ name: 'SCC BuildingNFT', version: '1', chainId, verifyingContract }) as const;

export interface BuildingVoucher {
  lotId: bigint;
  developer: Address;
  modelHash: Hex;
  floors: number;
  nonce: bigint;
  deadline: bigint;
}

export interface BuildingVoucherSigner {
  readonly address: Address;
  signBuilding(v: BuildingVoucher): Promise<Hex>;
}

/** Nonce único por prédio: os 128 bits do id (UUID). Um voucher por prédio, mesmo reemitido. */
export const buildingNonce = (buildingId: string) => BigInt(`0x${buildingId.replace(/-/g, '')}`);

export async function issueBuildingVoucher(
  store: BuildingStore,
  wallets: WalletDirectory,
  signer: BuildingVoucherSigner,
  input: {
    buildingId: string;
    accountId: string;
    wallet: string;
    /** Id numérico da cidade no contrato (`LAND_CITY_IDS`). */
    cityNftId: (city: string) => number | undefined;
    ttlSeconds: number;
    requestId?: string;
  },
  now: () => Date = () => new Date(),
) {
  const b = await store.getBuilding(input.buildingId);
  if (!b || b.ownerAccountId !== input.accountId) throw new AppError('not_found', 'Prédio não encontrado.', 404);
  if (b.status !== 'approved') {
    throw new AppError('building_not_approved', 'Só prédio com alvará vai para a blockchain.', 409);
  }
  if (!b.modelSha256) {
    throw new AppError('model_hash_missing', 'O Builder não devolveu o hash do modelo; valide o prédio de novo.', 409);
  }
  const city = input.cityNftId(b.city);
  if (city === undefined) throw new AppError('city_not_onchain', 'Esta cidade ainda não tem lotes na blockchain.', 409);
  if (!isAddress(input.wallet)) throw new AppError('invalid_request', 'Carteira inválida.', 400);

  const developer = getAddress(input.wallet);
  const linked = await wallets.walletsOf(input.accountId, input.requestId);
  if (!linked.some((w) => w.toLowerCase() === developer.toLowerCase())) {
    throw new AppError('wallet_not_linked', 'A carteira não está ligada à sua conta.', 403);
  }

  const voucher: BuildingVoucher = {
    lotId: lotTokenId(city, b.lotId),
    developer,
    modelHash: `0x${b.modelSha256}`,
    floors: Math.min(65_535, Math.max(1, b.floors)),
    nonce: buildingNonce(b.id),
    deadline: BigInt(Math.floor(now().getTime() / 1000) + input.ttlSeconds),
  };
  return { voucher, signature: await signer.signBuilding(voucher), building: b };
}
