import { randomUUID } from 'node:crypto';

import type { Account, AuthStore, WalletLink } from '../domain/ports.js';

/**
 * Development and test store. Everything is lost on restart, and main.ts refuses
 * to start with it in production. The Postgres adapter implements the same port.
 */
export class MemoryAuthStore implements AuthStore {
  private readonly nonces = new Map<string, Date>();
  private readonly accounts = new Map<string, Account>();
  private readonly wallets = new Map<string, WalletLink>();

  async saveNonce(nonce: string, expiresAt: Date) {
    this.nonces.set(nonce, expiresAt);
  }

  async consumeNonce(nonce: string, now: Date) {
    const expiresAt = this.nonces.get(nonce);
    this.nonces.delete(nonce);
    return expiresAt !== undefined && expiresAt > now;
  }

  async findOrCreateAccountByWallet(address: string, chainId: number, now: Date) {
    const link = this.wallets.get(address);
    if (link) return this.accounts.get(link.accountId)!;

    const account: Account = {
      id: randomUUID(),
      email: null,
      status: 'active',
      kycLevel: 0,
      createdAt: now,
    };
    this.accounts.set(account.id, account);
    this.wallets.set(address, { accountId: account.id, address, chainId, verifiedAt: now });
    return account;
  }

  async findAccount(id: string) {
    return this.accounts.get(id) ?? null;
  }

  async listWallets(accountId: string) {
    return [...this.wallets.values()].filter((wallet) => wallet.accountId === accountId);
  }

  /** Test helper. */
  setStatus(id: string, status: Account['status']) {
    const account = this.accounts.get(id);
    if (account) account.status = status;
  }
}
