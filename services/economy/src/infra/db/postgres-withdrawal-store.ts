import { and, desc, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import type { Address, Hex } from 'viem';

import type { Withdrawal, WithdrawalLimit, WithdrawalStatus, WithdrawalStore } from '../../domain/withdrawals.js';
import { withdrawal as wT } from './schema.js';

type Db = ReturnType<typeof drizzle>;

const COUNTED: WithdrawalStatus[] = ['created', 'pending', 'claimed'];

const toWithdrawal = (r: typeof wT.$inferSelect): Withdrawal => ({
  ...r,
  wallet: r.wallet as Address,
  amountWei: BigInt(r.amountWei),
  nonce: BigInt(r.nonce),
  signature: r.signature as Hex | null,
  status: r.status as WithdrawalStatus,
});

export class PostgresWithdrawalStore implements WithdrawalStore {
  private readonly db: Db;

  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  async createWithinLimit(w: Withdrawal, limits: WithdrawalLimit[]) {
    return this.db.transaction(async (tx) => {
      // Um pedido de saque por conta de cada vez: dois ao mesmo tempo não passam juntos do teto.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`withdrawal:${w.accountId}`}))`);
      for (const [i, l] of limits.entries()) {
        const [row] = await tx
          .select({ used: sql<string>`coalesce(sum(${wT.amountWei}), 0)` })
          .from(wT)
          .where(and(eq(wT.accountId, w.accountId), inArray(wT.status, COUNTED), gte(wT.createdAt, l.since)));
        if (BigInt(row?.used ?? '0') + w.amountWei > l.limitWei) return i;
      }
      await tx.insert(wT).values({ ...w, amountWei: w.amountWei.toString(), nonce: w.nonce.toString() });
      return -1;
    });
  }

  async get(id: string) {
    const [r] = await this.db.select().from(wT).where(eq(wT.id, id));
    return r ? toWithdrawal(r) : null;
  }

  async listOf(accountId: string, limit: number) {
    const rows = await this.db.select().from(wT).where(eq(wT.accountId, accountId)).orderBy(desc(wT.createdAt)).limit(limit);
    return rows.map(toWithdrawal);
  }

  async open(olderThan: Date, limit: number) {
    const rows = await this.db
      .select()
      .from(wT)
      .where(or(eq(wT.status, 'pending'), and(eq(wT.status, 'created'), lt(wT.createdAt, olderThan))))
      .orderBy(wT.createdAt)
      .limit(limit);
    return rows.map(toWithdrawal);
  }

  async transition(id: string, from: WithdrawalStatus, patch: Partial<Pick<Withdrawal, 'status' | 'signature' | 'closedAt'>>) {
    const updated = await this.db
      .update(wT)
      .set(patch)
      .where(and(eq(wT.id, id), eq(wT.status, from)))
      .returning({ id: wT.id });
    return updated.length > 0;
  }
}
