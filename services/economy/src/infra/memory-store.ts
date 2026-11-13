import { randomUUID } from 'node:crypto';

import {
  type AccountRef,
  type AuditReport,
  type Balance,
  type Currency,
  type LedgerStore,
  type OwnerType,
  type PostedTx,
  type PostingRequest,
  type StatementLine,
  accountKey,
  applyLegs,
  canGoNegative,
  fingerprint,
  idempotencyConflict,
  validatePosting,
} from '../domain/ledger.js';

interface Row {
  ref: AccountRef;
  balance: bigint;
}

/** Para testes e desenvolvimento. O JavaScript é de uma thread só: cada post é atômico. */
export class MemoryLedgerStore implements LedgerStore {
  private readonly accounts = new Map<string, Row>();
  private readonly txs: PostedTx[] = [];
  private readonly byKey = new Map<string, { tx: PostedTx; hash: string }>();
  private seq = 0n;

  async post(req: PostingRequest, now: Date) {
    validatePosting(req);
    const hash = fingerprint(req);
    const existing = this.byKey.get(req.idempotencyKey);
    if (existing) {
      if (existing.hash !== hash) throw idempotencyConflict();
      return { tx: existing.tx, replayed: true };
    }

    const current = new Map(
      req.legs.map((l) => [accountKey(l.account), this.accounts.get(accountKey(l.account))?.balance ?? 0n]),
    );
    const next = applyLegs(current, req.legs);
    for (const { account } of req.legs) {
      const key = accountKey(account);
      this.accounts.set(key, { ref: account, balance: next.get(key)! });
    }

    this.seq += 1n;
    const tx: PostedTx = {
      id: randomUUID(),
      seq: this.seq,
      kind: req.kind,
      refType: req.refType ?? null,
      refId: req.refId ?? null,
      createdAt: now,
      legs: req.legs.map((l) => ({ account: { ...l.account }, amount: l.amount })),
    };
    this.txs.push(tx);
    this.byKey.set(req.idempotencyKey, { tx, hash });
    return { tx, replayed: false };
  }

  async balances(ownerType: OwnerType, ownerId: string): Promise<Balance[]> {
    return [...this.accounts.values()]
      .filter((r) => r.ref.ownerType === ownerType && r.ref.ownerId === ownerId)
      .map((r) => ({ currency: r.ref.currency, amount: r.balance }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
  }

  async statement(
    ownerType: OwnerType,
    ownerId: string,
    options: { currency?: Currency; before?: bigint; limit: number },
  ) {
    const lines: StatementLine[] = [];
    for (let k = this.txs.length - 1; k >= 0; k--) {
      const tx = this.txs[k]!;
      if (options.before !== undefined && tx.seq >= options.before) continue;
      for (const leg of tx.legs) {
        const a = leg.account;
        if (a.ownerType !== ownerType || a.ownerId !== ownerId) continue;
        if (options.currency && a.currency !== options.currency) continue;
        lines.push({
          txId: tx.id,
          seq: tx.seq,
          kind: tx.kind,
          refType: tx.refType,
          refId: tx.refId,
          currency: a.currency,
          amount: leg.amount,
          createdAt: tx.createdAt,
        });
      }
      if (lines.length > options.limit) break;
    }
    const page = lines.slice(0, options.limit);
    return { lines: page, next: lines.length > options.limit ? page.at(-1)!.seq : null };
  }

  async audit(): Promise<AuditReport> {
    const sums = new Map<Currency, bigint>();
    const perAccount = new Map<string, bigint>();
    let unbalancedTx = 0;
    for (const tx of this.txs) {
      const own = new Map<Currency, bigint>();
      for (const { account, amount } of tx.legs) {
        sums.set(account.currency, (sums.get(account.currency) ?? 0n) + amount);
        own.set(account.currency, (own.get(account.currency) ?? 0n) + amount);
        const key = accountKey(account);
        perAccount.set(key, (perAccount.get(key) ?? 0n) + amount);
      }
      if ([...own.values()].some((v) => v !== 0n)) unbalancedTx++;
    }
    let mismatches = 0;
    let negatives = 0;
    for (const [key, row] of this.accounts) {
      if ((perAccount.get(key) ?? 0n) !== row.balance) mismatches++;
      if (row.balance < 0n && !canGoNegative(row.ref.ownerType)) negatives++;
    }
    return { sums, mismatches, negatives, unbalancedTx };
  }
}
