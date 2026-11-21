import { AppError } from '@scc/shared';
import { type Address, type Hex, createPublicClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import type { AccountDirectory, VaultReader, VoucherSigner } from '../domain/withdrawals.js';

export const WITHDRAWAL_TYPES = {
  Withdrawal: [
    { name: 'to', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export const vaultDomain = (chainId: number, verifyingContract: Address) =>
  ({ name: 'SCC GameVault', version: '1', chainId, verifyingContract }) as const;

/** Assina com a chave do `.env`: só no MVP local. Na testnet e na mainnet, KMS (doc 07 §3). */
export class LocalKeyVoucherSigner implements VoucherSigner {
  private readonly account;
  readonly address: Address;

  constructor(
    privateKey: Hex,
    private readonly chainId: number,
    private readonly vault: Address,
  ) {
    this.account = privateKeyToAccount(privateKey);
    this.address = this.account.address;
  }

  sign(v: { to: Address; amount: bigint; nonce: bigint; deadline: bigint }) {
    return this.account.signTypedData({ domain: vaultDomain(this.chainId, this.vault), types: WITHDRAWAL_TYPES, primaryType: 'Withdrawal', message: v });
  }
}

const vaultAbi = parseAbi(['function nonceUsed(uint256) view returns (bool)']);

/** Lê o `nonceUsed` do cofre pela RPC. */
export class RpcVaultReader implements VaultReader {
  private readonly client;

  constructor(
    rpcUrl: string,
    private readonly vault: Address,
  ) {
    this.client = createPublicClient({ transport: http(rpcUrl, { timeout: 15_000, retryCount: 2 }) });
  }

  nonceUsed(nonce: bigint) {
    return this.client.readContract({ address: this.vault, abi: vaultAbi, functionName: 'nonceUsed', args: [nonce] });
  }
}

/** Carteiras e idade da conta pela rota interna do gateway. */
export class GatewayAccountDirectory implements AccountDirectory {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async account(accountId: string) {
    let r: Response;
    try {
      r = await this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}/internal/v1/accounts/${encodeURIComponent(accountId)}/wallets`, {
        headers: { 'x-service-token': this.token },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AppError('gateway_unavailable', 'Não deu para conferir a carteira agora.', 503);
    }
    if (r.status === 403) throw new AppError('account_blocked', 'Conta bloqueada.', 403);
    if (!r.ok) throw new AppError('gateway_unavailable', 'Não deu para conferir a carteira agora.', 503);
    const body = (await r.json()) as { wallets: { address: string }[]; account_created_at?: string; kyc_level?: number };
    // Sem a data (gateway antigo), trata como conta nova: o saque espera. Sem o nível, sem KYC.
    return {
      wallets: body.wallets.map((w) => w.address),
      createdAt: body.account_created_at ? new Date(body.account_created_at) : new Date(),
      kycLevel: body.kyc_level ?? 0,
    };
  }
}
