import { AppError } from '@scc/shared';
import { getAddress, isAddress, verifyMessage, type Hex } from 'viem';
import { generateSiweNonce, parseSiweMessage, validateSiweMessage } from 'viem/siwe';

import type { AuthStore } from './ports.js';
import { issueToken, type TokenOptions } from './token.js';

export interface AuthOptions {
  domains: string[];
  chainIds: number[];
  nonceTtlSeconds: number;
  token: TokenOptions;
}

export class AuthService {
  constructor(
    private readonly store: AuthStore,
    private readonly options: AuthOptions,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createNonce() {
    const nonce = generateSiweNonce();
    const expiresAt = new Date(this.now().getTime() + this.options.nonceTtlSeconds * 1000);
    await this.store.saveNonce(nonce, expiresAt);
    return { nonce, expiresAt };
  }

  /**
   * Sign-In with Ethereum (EIP-4361). Free checks come first; the nonce is burned
   * before the signature check, so a failed attempt cannot be retried with it.
   */
  async verifySiwe(message: string, signature: Hex) {
    const now = this.now();
    const siwe = parseSiweMessage(message);

    if (!siwe.address || !isAddress(siwe.address) || !siwe.nonce || !siwe.domain || !siwe.chainId) {
      throw new AppError('invalid_siwe_message', 'Mensagem SIWE incompleta.', 400);
    }
    if (!this.options.domains.includes(siwe.domain)) {
      throw new AppError('invalid_siwe_domain', 'Domínio não aceito.', 401);
    }
    if (!this.options.chainIds.includes(siwe.chainId)) {
      throw new AppError('invalid_siwe_chain', 'Rede não aceita.', 401);
    }
    if (!validateSiweMessage({ message: siwe, domain: siwe.domain, time: now })) {
      throw new AppError('invalid_siwe_message', 'Mensagem SIWE expirada ou inválida.', 401);
    }
    if (!(await this.store.consumeNonce(siwe.nonce, now))) {
      throw new AppError('invalid_nonce', 'Nonce inválido, expirado ou já usado.', 401);
    }

    const address = getAddress(siwe.address);
    const valid = await verifyMessage({ address, message, signature }).catch(() => false);
    if (!valid) throw new AppError('invalid_signature', 'Assinatura inválida.', 401);

    const account = await this.store.findOrCreateAccountByWallet(address, siwe.chainId, now);
    if (account.status !== 'active') {
      throw new AppError('account_blocked', 'Conta bloqueada.', 403);
    }

    return { account, ...(await issueToken(account.id, this.options.token, now)) };
  }

  async me(accountId: string) {
    const account = await this.store.findAccount(accountId);
    if (!account) throw new AppError('invalid_token', 'Conta não encontrada.', 401);
    if (account.status !== 'active') {
      throw new AppError('account_blocked', 'Conta bloqueada.', 403);
    }
    return { account, wallets: await this.store.listWallets(accountId) };
  }
}
