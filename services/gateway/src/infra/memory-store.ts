import { randomUUID } from 'node:crypto';

import type { KycRequest, KycStatus, KycStore } from '../domain/kyc.js';
import type { Account, AuthStore, LinkWalletResult, SetEmailResult, WalletLink } from '../domain/ports.js';

/**
 * Development and test store. Everything is lost on restart, and main.ts refuses
 * to start with it in production. The Postgres adapter implements the same port.
 */
export class MemoryAuthStore implements AuthStore, KycStore {
  private readonly kyc = new Map<string, KycRequest>();

  async openKyc(accountId: string, level: number, now: Date) {
    const pending = [...this.kyc.values()].find((r) => r.accountId === accountId && r.status === 'pending');
    if (pending) return { ...pending };
    const r: KycRequest = { id: randomUUID(), accountId, level, status: 'pending', provider: 'manual', note: null, createdAt: now, decidedAt: null };
    this.kyc.set(r.id, r);
    return { ...r };
  }

  async latestKyc(accountId: string) {
    const mine = [...this.kyc.values()].filter((r) => r.accountId === accountId);
    const last = mine.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return last ? { ...last } : null;
  }

  async listKyc(status: KycStatus, limit: number) {
    return [...this.kyc.values()]
      .filter((r) => r.status === status)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  async decideKyc(id: string, decision: 'approved' | 'rejected', note: string | null, now: Date) {
    const r = this.kyc.get(id);
    if (!r || r.status !== 'pending') return null;
    const decided = { ...r, status: decision, note, decidedAt: now };
    this.kyc.set(id, decided);
    const acc = this.accounts.get(r.accountId);
    if (decision === 'approved' && acc) this.accounts.set(acc.id, { ...acc, kycLevel: Math.max(acc.kycLevel, r.level) });
    return { ...decided };
  }

  private readonly nonces = new Map<string, Date>();
  private readonly accounts = new Map<string, Account>();
  private readonly wallets = new Map<string, WalletLink>();
  private readonly codes = new Map<string, { codeHash: string; expiresAt: Date; attempts: number; createdAt: Date }>();

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

  async findOrCreateAccountByEmail(email: string, now: Date) {
    const existing = [...this.accounts.values()].find((a) => a.email === email);
    if (existing) return existing;
    const account: Account = { id: randomUUID(), email, status: 'active', kycLevel: 0, createdAt: now };
    this.accounts.set(account.id, account);
    return account;
  }

  async saveEmailCode(email: string, codeHash: string, expiresAt: Date, now: Date, minIntervalSeconds: number) {
    const current = this.codes.get(email);
    if (current && now.getTime() - current.createdAt.getTime() < minIntervalSeconds * 1000) return false;
    this.codes.set(email, { codeHash, expiresAt, attempts: 0, createdAt: now });
    return true;
  }

  async consumeEmailCode(email: string, codeHash: string, now: Date, maxAttempts: number) {
    const current = this.codes.get(email);
    if (!current) return false;
    if (current.codeHash === codeHash && current.expiresAt > now && current.attempts < maxAttempts) {
      this.codes.delete(email);
      return true;
    }
    current.attempts++;
    return false;
  }

  async linkWallet(accountId: string, address: string, chainId: number, now: Date): Promise<LinkWalletResult> {
    const link = this.wallets.get(address);
    if (link) return link.accountId === accountId ? 'already_linked' : 'taken';
    this.wallets.set(address, { accountId, address, chainId, verifiedAt: now });
    return 'linked';
  }

  async setAccountEmail(accountId: string, email: string): Promise<SetEmailResult> {
    const target = this.accounts.get(accountId);
    if (!target) throw new Error(`conta ${accountId} não existe`);
    if (target.email === email) return 'already_set';
    if (target.email !== null) return 'has_other';
    if ([...this.accounts.values()].some((a) => a.email === email)) return 'taken';
    target.email = email;
    return 'set';
  }

  async findAccount(id: string) {
    return this.accounts.get(id) ?? null;
  }

  async walletOwner(address: string) {
    return this.wallets.get(address)?.accountId ?? null;
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
