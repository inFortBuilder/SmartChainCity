import { AppError } from '@scc/shared';
import { type Address, type Hex, getAddress, isAddress, stringToHex } from 'viem';

import { type WalletDirectory, lotTokenId } from './land-quote.js';
import { type Property, type PropertyStore, phaseOf } from './properties.js';

/**
 * Vouchers EIP-712 do `PropertyNFT` (contracts/src/PropertyNFT.sol, doc 07 §2.2, E2.5).
 *
 * - Mint: o imóvel pronto (obra paga e terminada) vai para a carteira do dono,
 *   que precisa ser dona do lote no `LandNFT` (o contrato confere).
 * - Nível: depois de um upgrade no jogo, leva o nível novo ao contrato.
 *
 * O id do token é o id do imóvel (os 128 bits do UUID): o mesmo imóvel não
 * vira dois tokens, e o mesmo voucher não minta duas vezes. Desgaste e renda
 * ficam aqui no world.
 */
export const PROPERTY_VOUCHER_TYPES = {
  PropertyVoucher: [
    { name: 'tokenId', type: 'uint256' },
    { name: 'owner', type: 'address' },
    { name: 'lotId', type: 'uint256' },
    { name: 'typeCode', type: 'bytes32' },
    { name: 'level', type: 'uint16' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export const LEVEL_VOUCHER_TYPES = {
  LevelVoucher: [
    { name: 'tokenId', type: 'uint256' },
    { name: 'level', type: 'uint16' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export const propertyDomain = (chainId: number, verifyingContract: Address) =>
  ({ name: 'SCC PropertyNFT', version: '1', chainId, verifyingContract }) as const;

export interface PropertyVoucher {
  tokenId: bigint;
  owner: Address;
  lotId: bigint;
  typeCode: Hex;
  level: number;
  deadline: bigint;
}

export interface LevelVoucher {
  tokenId: bigint;
  level: number;
  deadline: bigint;
}

export interface PropertyVoucherSigner {
  readonly address: Address;
  signProperty(v: PropertyVoucher): Promise<Hex>;
  signLevel(v: LevelVoucher): Promise<Hex>;
}

/** Id do token: os 128 bits do UUID do imóvel. */
export const propertyTokenId = (propertyId: string) => BigInt(`0x${propertyId.replace(/-/g, '')}`);

/** Código do tipo (`t1`) em bytes32, como o contrato guarda. */
export const typeCodeHex = (code: string) => stringToHex(code, { size: 32 });

interface Common {
  propertyId: string;
  accountId: string;
  ttlSeconds: number;
}

async function readyProperty(store: PropertyStore, input: Common, now: Date): Promise<Property> {
  const p = await store.getProperty(input.propertyId);
  if (!p || p.ownerAccountId !== input.accountId) throw new AppError('not_found', 'Imóvel não encontrado.', 404);
  if (phaseOf(p, now) !== 'ready') {
    throw new AppError('property_not_ready', 'Só o imóvel pronto (obra paga e terminada) vai para a blockchain.', 409);
  }
  return p;
}

const deadline = (now: Date, ttl: number) => BigInt(Math.floor(now.getTime() / 1000) + ttl);

export async function issuePropertyVoucher(
  store: PropertyStore,
  wallets: WalletDirectory,
  signer: PropertyVoucherSigner,
  input: Common & {
    wallet: string;
    /** Id numérico da cidade no contrato (`LAND_CITY_IDS`). */
    cityNftId: (city: string) => number | undefined;
    requestId?: string;
  },
  now: () => Date = () => new Date(),
) {
  const t = now();
  const p = await readyProperty(store, input, t);
  const city = input.cityNftId(p.city);
  if (city === undefined) throw new AppError('city_not_onchain', 'Esta cidade ainda não tem lotes na blockchain.', 409);
  if (!isAddress(input.wallet)) throw new AppError('invalid_request', 'Carteira inválida.', 400);

  const owner = getAddress(input.wallet);
  const linked = await wallets.walletsOf(input.accountId, input.requestId);
  if (!linked.some((w) => w.toLowerCase() === owner.toLowerCase())) {
    throw new AppError('wallet_not_linked', 'A carteira não está ligada à sua conta.', 403);
  }

  const voucher: PropertyVoucher = {
    tokenId: propertyTokenId(p.id),
    owner,
    lotId: lotTokenId(city, p.lotId),
    typeCode: typeCodeHex(p.type),
    level: p.level,
    deadline: deadline(t, input.ttlSeconds),
  };
  return { voucher, signature: await signer.signProperty(voucher), property: p };
}

/**
 * Voucher do nível atual. Qualquer carteira pode levar ao contrato, mas o
 * contrato só aceita do dono do token e só se o nível subir.
 */
export async function issueLevelVoucher(
  store: PropertyStore,
  signer: PropertyVoucherSigner,
  input: Common,
  now: () => Date = () => new Date(),
) {
  const t = now();
  const p = await readyProperty(store, input, t);
  if (p.level < 2) throw new AppError('nothing_to_upgrade', 'O imóvel ainda está no nível 1: o mint já leva esse nível.', 409);
  const voucher: LevelVoucher = { tokenId: propertyTokenId(p.id), level: p.level, deadline: deadline(t, input.ttlSeconds) };
  return { voucher, signature: await signer.signLevel(voucher), property: p };
}
