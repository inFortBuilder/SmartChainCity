import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { TransactionRollbackError } from 'drizzle-orm';
import type { Pool } from 'pg';

import type {
  Account,
  AccountStatus,
  AuthStore,
  LinkWalletResult,
  SetEmailResult,
  WalletLink,
} from '../../domain/ports.js';
import { account, authNonce, emailCode, walletLink } from './schema.js';

/** Violação de unicidade do Postgres, venha crua ou embrulhada pelo Drizzle. */
const isUniqueViolation = (error: unknown) => {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
};

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

  /** INSERT com ON CONFLICT DO NOTHING: dois primeiros logins juntos dão uma conta só. */
  async findOrCreateAccountByEmail(email: string, now: Date) {
    const [created] = await this.db.insert(account).values({ email, createdAt: now }).onConflictDoNothing().returning();
    if (created) return toAccount(created);
    const rows = await this.db.select().from(account).where(eq(account.email, email));
    return toAccount(rows[0]!);
  }

  /** Um só comando: o UPDATE do conflito só troca o código se o anterior for velho. */
  async saveEmailCode(email: string, codeHash: string, expiresAt: Date, now: Date, minIntervalSeconds: number) {
    const rows = await this.db
      .insert(emailCode)
      .values({ email, codeHash, expiresAt, attempts: 0, createdAt: now })
      .onConflictDoUpdate({
        target: emailCode.email,
        set: { codeHash, expiresAt, attempts: 0, createdAt: now },
        setWhere: lt(emailCode.createdAt, new Date(now.getTime() - minIntervalSeconds * 1000)),
      })
      .returning({ email: emailCode.email });
    // Códigos vencidos se acumulariam; isto mantém a tabela pequena sem job.
    await this.db.delete(emailCode).where(lt(emailCode.expiresAt, new Date(now.getTime() - 86_400_000)));
    return rows.length === 1;
  }

  /** O DELETE é o que garante uso único: só um chamador recebe a linha. */
  async consumeEmailCode(email: string, codeHash: string, now: Date, maxAttempts: number) {
    const hit = await this.db
      .delete(emailCode)
      .where(
        and(
          eq(emailCode.email, email),
          eq(emailCode.codeHash, codeHash),
          gt(emailCode.expiresAt, now),
          lt(emailCode.attempts, maxAttempts),
        ),
      )
      .returning({ email: emailCode.email });
    if (hit.length === 1) return true;
    await this.db
      .update(emailCode)
      .set({ attempts: sql`${emailCode.attempts} + 1` })
      .where(eq(emailCode.email, email));
    return false;
  }

  /** ON CONFLICT DO NOTHING cobre a chave e o índice único do endereço. */
  async linkWallet(accountId: string, address: string, chainId: number, now: Date): Promise<LinkWalletResult> {
    const rows = await this.db
      .insert(walletLink)
      .values({ accountId, address, chainId, verifiedAt: now })
      .onConflictDoNothing()
      .returning({ address: walletLink.address });
    if (rows.length === 1) return 'linked';
    const owner = await this.db
      .select({ accountId: walletLink.accountId })
      .from(walletLink)
      .where(eq(walletLink.address, address));
    return owner[0]?.accountId === accountId ? 'already_linked' : 'taken';
  }

  /** O UPDATE só pega conta sem e-mail; o índice único barra o e-mail de outra conta. */
  async setAccountEmail(accountId: string, email: string): Promise<SetEmailResult> {
    try {
      const rows = await this.db
        .update(account)
        .set({ email })
        .where(and(eq(account.id, accountId), isNull(account.email)))
        .returning({ id: account.id });
      if (rows.length === 1) return 'set';
    } catch (error) {
      if (isUniqueViolation(error)) return 'taken';
      throw error;
    }
    const current = await this.findAccount(accountId);
    return current?.email === email ? 'already_set' : 'has_other';
  }

  async findAccount(id: string) {
    const rows = await this.db.select().from(account).where(eq(account.id, id));
    return rows[0] ? toAccount(rows[0]) : null;
  }

  async listWallets(accountId: string): Promise<WalletLink[]> {
    return this.db.select().from(walletLink).where(eq(walletLink.accountId, accountId));
  }
}
