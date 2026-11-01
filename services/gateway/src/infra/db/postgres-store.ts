import { and, eq, gt, lt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { TransactionRollbackError } from 'drizzle-orm';
import type { Pool } from 'pg';

import type { Account, AccountStatus, AuthStore, WalletLink } from '../../domain/ports.js';
import { account, authNonce, walletLink } from './schema.js';

const toAccount = (row: typeof account.$inferSelect): Account => ({
  ...row,
  status: row.status as AccountStatus,
});

export class PostgresAuthStore implements AuthStore {
  private readonly db;

  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  async saveNonce(nonce: string, expiresAt: Date) {
    await this.db.insert(authNonce).values({ nonce, expiresAt });
    // Unused nonces would pile up forever; this keeps the table small with no job.
    await this.db.delete(authNonce).where(lt(authNonce.expiresAt, new Date()));
  }

  /** A single DELETE is what makes this atomic: only one caller gets the row back. */
  async consumeNonce(nonce: string, now: Date) {
    const rows = await this.db
      .delete(authNonce)
      .where(and(eq(authNonce.nonce, nonce), gt(authNonce.expiresAt, now)))
      .returning({ nonce: authNonce.nonce });
    return rows.length === 1;
  }

  private async findByWallet(address: string) {
    const rows = await this.db
      .select({ account })
      .from(walletLink)
      .innerJoin(account, eq(account.id, walletLink.accountId))
      .where(eq(walletLink.address, address));
    return rows[0] ? toAccount(rows[0].account) : null;
  }

  async findOrCreateAccountByWallet(address: string, chainId: number, now: Date) {
    const existing = await this.findByWallet(address);
    if (existing) return existing;

    try {
      return await this.db.transaction(async (tx) => {
        const [created] = await tx.insert(account).values({ createdAt: now }).returning();
        const linked = await tx
          .insert(walletLink)
          .values({ accountId: created!.id, address, chainId, verifiedAt: now })
          .onConflictDoNothing()
          .returning();
        // A concurrent first login won the address: undo the account created here.
        if (linked.length === 0) tx.rollback();
        return toAccount(created!);
      });
    } catch (error) {
      if (!(error instanceof TransactionRollbackError)) throw error;
      const winner = await this.findByWallet(address);
      if (!winner) throw error;
      return winner;
    }
  }

  async findAccount(id: string) {
    const rows = await this.db.select().from(account).where(eq(account.id, id));
    return rows[0] ? toAccount(rows[0]) : null;
  }

  async listWallets(accountId: string): Promise<WalletLink[]> {
    return this.db.select().from(walletLink).where(eq(walletLink.accountId, accountId));
  }
}
