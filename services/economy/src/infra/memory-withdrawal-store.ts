import type { Withdrawal, WithdrawalStatus, WithdrawalStore } from '../domain/withdrawals.js';

const COUNTED: WithdrawalStatus[] = ['created', 'pending', 'claimed'];

/** Para testes e desenvolvimento. Uma thread só: cada operação é atômica. */
export class MemoryWithdrawalStore implements WithdrawalStore {
  private readonly rows = new Map<string, Withdrawal>();

  async createWithinLimit(w: Withdrawal, since: Date, limitWei: bigint) {
    const used = [...this.rows.values()]
      .filter((x) => x.accountId === w.accountId && COUNTED.includes(x.status) && x.createdAt.getTime() >= since.getTime())
      .reduce((s, x) => s + x.amountWei, 0n);
    if (used + w.amountWei > limitWei) return false;
    this.rows.set(w.id, { ...w });
    return true;
  }

  async get(id: string) {
    const w = this.rows.get(id);
    return w ? { ...w } : null;
  }

  async listOf(accountId: string, limit: number) {
    return [...this.rows.values()]
      .filter((w) => w.accountId === accountId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((w) => ({ ...w }));
  }

  async open(olderThan: Date, limit: number) {
    return [...this.rows.values()]
      .filter((w) => w.status === 'pending' || (w.status === 'created' && w.createdAt.getTime() < olderThan.getTime()))
      .slice(0, limit)
      .map((w) => ({ ...w }));
  }

  async transition(id: string, from: WithdrawalStatus, patch: Partial<Pick<Withdrawal, 'status' | 'signature' | 'closedAt'>>) {
    const w = this.rows.get(id);
    if (!w || w.status !== from) return false;
    Object.assign(w, patch);
    return true;
  }
}
