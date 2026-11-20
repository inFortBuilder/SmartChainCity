import { AppError, forwardRequestId } from '@scc/shared';
import type { Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import {
  BUILDING_VOUCHER_TYPES,
  type BuildingVoucher,
  type BuildingVoucherSigner,
  buildingDomain,
} from '../domain/building-voucher.js';
import {
  LEVEL_VOUCHER_TYPES,
  type LevelVoucher,
  PROPERTY_VOUCHER_TYPES,
  type PropertyVoucher,
  type PropertyVoucherSigner,
  propertyDomain,
} from '../domain/property-voucher.js';
import { LOT_QUOTE_TYPES, type LotQuote, type QuoteSigner, type WalletDirectory, landDomain } from '../domain/land-quote.js';

/**
 * Assina as cotações com a chave do world (papel SIGNER do `LandNFT`). No MVP
 * local a chave vem do `.env`; na testnet e na mainnet, de um KMS (doc 07 §3).
 */
export class LocalKeyQuoteSigner implements QuoteSigner {
  private readonly account;
  readonly address: Address;

  constructor(
    privateKey: Hex,
    private readonly chainId: number,
    private readonly contract: Address,
  ) {
    this.account = privateKeyToAccount(privateKey);
    this.address = this.account.address;
  }

  sign(quote: LotQuote): Promise<Hex> {
    return this.account.signTypedData({
      domain: landDomain(this.chainId, this.contract),
      types: LOT_QUOTE_TYPES,
      primaryType: 'LotQuote',
      message: quote,
    });
  }
}

/** Assina os vouchers do `BuildingNFT` com a mesma chave do world (papel SIGNER do contrato). */
export class LocalKeyBuildingSigner implements BuildingVoucherSigner {
  private readonly account;
  readonly address: Address;

  constructor(
    privateKey: Hex,
    private readonly chainId: number,
    private readonly contract: Address,
  ) {
    this.account = privateKeyToAccount(privateKey);
    this.address = this.account.address;
  }

  signBuilding(voucher: BuildingVoucher): Promise<Hex> {
    return this.account.signTypedData({
      domain: buildingDomain(this.chainId, this.contract),
      types: BUILDING_VOUCHER_TYPES,
      primaryType: 'BuildingVoucher',
      message: voucher,
    });
  }
}

/** Assina os vouchers do `PropertyNFT` (mint e nível) com a mesma chave do world. */
export class LocalKeyPropertySigner implements PropertyVoucherSigner {
  private readonly account;
  readonly address: Address;

  constructor(
    privateKey: Hex,
    private readonly chainId: number,
    private readonly contract: Address,
  ) {
    this.account = privateKeyToAccount(privateKey);
    this.address = this.account.address;
  }

  signProperty(voucher: PropertyVoucher): Promise<Hex> {
    return this.account.signTypedData({
      domain: propertyDomain(this.chainId, this.contract),
      types: PROPERTY_VOUCHER_TYPES,
      primaryType: 'PropertyVoucher',
      message: voucher,
    });
  }

  signLevel(voucher: LevelVoucher): Promise<Hex> {
    return this.account.signTypedData({
      domain: propertyDomain(this.chainId, this.contract),
      types: LEVEL_VOUCHER_TYPES,
      primaryType: 'LevelVoucher',
      message: voucher,
    });
  }
}

/** Carteiras da conta pela rota interna do gateway. */
export class GatewayWalletDirectory implements WalletDirectory {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async walletsOf(accountId: string, requestId?: string): Promise<string[]> {
    let response: Response;
    try {
      response = await this.fetchFn(
        `${this.baseUrl.replace(/\/$/, '')}/internal/v1/accounts/${encodeURIComponent(accountId)}/wallets`,
        { headers: { 'x-service-token': this.token, ...forwardRequestId(requestId) } },
      );
    } catch {
      throw new AppError('gateway_unavailable', 'Não deu para conferir a carteira agora.', 503);
    }
    if (response.status === 401 || response.status === 404) return [];
    if (response.status === 403 && (await response.clone().json().catch(() => null))?.error?.code === 'account_blocked') {
      throw new AppError('account_blocked', 'Conta bloqueada.', 403);
    }
    if (!response.ok) throw new AppError('gateway_unavailable', 'Não deu para conferir a carteira agora.', 503);
    const body = (await response.json()) as { wallets: { address: string }[] };
    return body.wallets.map((w) => w.address);
  }
}
