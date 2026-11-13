import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import {
  type AccountRef,
  type AuditReport,
  type Balance,
  type Currency,
  type LedgerStore,
  type OwnerType,
  type PostedTx,
  type PostingRequest,
  accountKey,
  applyLegs,
  fingerprint,
  idempotencyConflict,
  validatePosting,
} from '../../domain/ledger.js';
import { ledgerAccount, ledgerEntry, ledgerTx } from './schema.js';

type Db = ReturnType<typeof drizzle>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const refOf = (row: { ownerType: string; ownerId: string; currency: string }): AccountRef => ({
  ownerType: row.ownerType as OwnerType,
  ownerId: row.ownerId,
  currency: row.currency as Currency,
});

/** Violação de unicidade, com ou sem o embrulho de erro do Drizzle. */
const isUniqueViolation = (error: unknown) => {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
};

export class PostgresLedgerStore implements LedgerStore {
  private readonly db: Db;

  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  /** Transação já lançada com esta chave; outro pedido com a mesma chave é conflito. */
  private async findByKey(db: Db | Tx, key: string, hash: string): Promise<PostedTx | null> {
    const [row] = await db.select().from(ledgerTx).where(eq(ledgerTx.idempotencyKey, key));
    if (!row) return null;
    if (row.requestHash !== hash) throw idempotencyConflict();
    const legs = await db
      .select({ amount: ledgerEntry.amount, account: ledgerAccount })
      .from(ledgerEntry)
      .innerJoin(ledgerAccount, eq(ledgerAccount.id, ledgerEntry.accountId))
      .where(eq(ledgerEntry.txId, row.id));
    return {
      id: row.id,
      seq: row.seq,
      kind: row.kind,
      refType: row.refType,
      refId: row.refId,
      createdAt: row.createdAt,
      legs: legs.map((l) => ({ account: refOf(l.account), amount: BigInt(l.amount) })),
    };
  }

  async post(req: PostingRequest, now: Date) {
    validatePosting(req);
    const hash = fingerprint(req);
    const known = await this.findByKey(this.db, req.idempotencyKey, hash);
    if (known) return { tx: known, replayed: true };

    try {
      return await this.db.transaction(async (tx) => {
        await tx
          .insert(ledgerAccount)
          .values(req.legs.map((l) => ({ ...l.account })))
          .onConflictDoNothing();

        // Trava as contas sempre na mesma ordem (id): dois lançamentos que
        // tocam as mesmas contas esperam um pelo outro, sem deadlock.
        const rows = await tx
          .select()
          .from(ledgerAccount)
          .where(
            or(
              ...req.legs.map((l) =>
                and(
                  eq(ledgerAccount.ownerType, l.account.ownerType),
                  eq(ledgerAccount.ownerId, l.account.ownerId),
                  eq(ledgerAccount.currency, l.account.currency),
                ),
              ),
            ),
          )
          .orderBy(ledgerAccount.id)
          .for('update');

        // Quem esperou a trava confere a chave de novo: o pedido gêmeo pode ter acabado de entrar.
        const twin = await this.findByKey(tx, req.idempotencyKey, hash);
        if (twin) return { tx: twin, replayed: true };

        const byKey = new Map(rows.map((r) => [accountKey(refOf(r)), r]));
        const next = applyLegs(
          new Map([...byKey].map(([key, r]) => [key, BigInt(r.balance)])),
          req.legs,
        );

        const [created] = await tx
          .insert(ledgerTx)
          .values({
            kind: req.kind,
            refType: req.refType ?? null,
            refId: req.refId ?? null,
            idempotencyKey: req.idempotencyKey,
            requestHash: hash,
            createdAt: now,
          })
          .returning();
        await tx.insert(ledgerEntry).values(
          req.legs.map((l) => ({
            txId: created!.id,
            accountId: byKey.get(accountKey(l.account))!.id,
            amount: l.amount.toString(),
          })),
        );
        for (const l of req.legs) {
          const key = accountKey(l.account);
          await tx
            .update(ledgerAccount)
            .set({ balance: next.get(key)!.toString() })
            .where(eq(ledgerAccount.id, byKey.get(key)!.id));
        }

        const posted: PostedTx = {
          id: created!.id,
          seq: created!.seq,
          kind: created!.kind,
          refType: created!.refType,
          refId: created!.refId,
          createdAt: created!.createdAt,
          legs: req.legs.map((l) => ({ account: { ...l.account }, amount: l.amount })),
        };
        return { tx: posted, replayed: false };
      });
    } catch (error) {
      // Corrida com o pedido gêmeo na criação da transação: devolve a que ficou.
      if (isUniqueViolation(error)) {
        const again = await this.findByKey(this.db, req.idempotencyKey, hash);
        if (again) return { tx: again, replayed: true };
      }
      throw error;
    }
  }

  async balances(ownerType: OwnerType, ownerId: string): Promise<Balance[]> {
    const rows = await this.db
      .select({ currency: ledgerAccount.currency, balance: ledgerAccount.balance })
      .from(ledgerAccount)
      .where(and(eq(ledgerAccount.ownerType, ownerType), eq(ledgerAccount.ownerId, ownerId)))
      .orderBy(ledgerAccount.currency);
    return rows.map((r) => ({ currency: r.currency as Currency, amount: BigInt(r.balance) }));
  }

  async statement(
    ownerType: OwnerType,
    ownerId: string,
    options: { currency?: Currency; before?: bigint; limit: number },
  ) {
    const rows = await this.db
      .select({
        txId: ledgerTx.id,
        seq: ledgerTx.seq,
        kind: ledgerTx.kind,
        refType: ledgerTx.refType,
        refId: ledgerTx.refId,
        createdAt: ledgerTx.createdAt,
        currency: ledgerAccount.currency,
        amount: ledgerEntry.amount,
      })
      .from(ledgerEntry)
      .innerJoin(ledgerAccount, eq(ledgerAccount.id, ledgerEntry.accountId))
      .innerJoin(ledgerTx, eq(ledgerTx.id, ledgerEntry.txId))
      .where(
        and(
          eq(ledgerAccount.ownerType, ownerType),
          eq(ledgerAccount.ownerId, ownerId),
          options.currency ? eq(ledgerAccount.currency, options.currency) : undefined,
          options.before !== undefined ? lt(ledgerTx.seq, options.before) : undefined,
        ),
      )
      .orderBy(desc(ledgerTx.seq), ledgerAccount.currency)
      .limit(options.limit + 1);
    const lines = rows.slice(0, options.limit).map((r) => ({
      ...r,
      currency: r.currency as Currency,
      amount: BigInt(r.amount),
    }));
    return { lines, next: rows.length > options.limit ? lines.at(-1)!.seq : null };
  }

  async audit(): Promise<AuditReport> {
    const sumsRows = await this.db.execute<{ currency: string; total: string }>(sql`
      select a.currency, coalesce(sum(e.amount), 0)::text as total
      from economy.ledger_entry e join economy.ledger_account a on a.id = e.account_id
      group by a.currency`);
    const [counts] = (
      await this.db.execute<{ mismatches: string; negatives: string; unbalanced: string }>(sql`
      select
        (select count(*) from economy.ledger_account a
          where a.balance <> coalesce((select sum(e.amount) from economy.ledger_entry e where e.account_id = a.id), 0))::text as mismatches,
        (select count(*) from economy.ledger_account a where a.owner_type <> 'system' and a.balance < 0)::text as negatives,
        (select count(*) from (
          select e.tx_id from economy.ledger_entry e join economy.ledger_account a on a.id = e.account_id
          group by e.tx_id, a.currency having sum(e.amount) <> 0) u)::text as unbalanced`)
    ).rows;
    return {
      sums: new Map(sumsRows.rows.map((r) => [r.currency as Currency, BigInt(r.total)])),
      mismatches: Number(counts!.mismatches),
      negatives: Number(counts!.negatives),
      unbalancedTx: Number(counts!.unbalanced),
    };
  }
}
