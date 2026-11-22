import { and, asc, desc, eq, lt, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import { DAY_MS } from '../../domain/properties.js';
import { DEFAULT_AFTER_DAYS, type TaxBill, type TaxKind, type TaxStatus, type TaxStore } from '../../domain/taxes.js';
import { taxBill as billT } from './schema.js';

type Db = ReturnType<typeof drizzle>;

const toBill = (r: typeof billT.$inferSelect): TaxBill => ({
  ...r,
  kind: r.kind as TaxKind,
  status: r.status as TaxStatus,
  amountCents: Number(r.amountCents),
  fineCents: Number(r.fineCents),
});

export class PostgresTaxStore implements TaxStore {
  private readonly db: Db;

  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }
  async paidTotalCents() {
    const [r] = await this.db
      .select({ total: sql<string>`coalesce(sum(${billT.amountCents} + ${billT.fineCents}), 0)::text` })
      .from(billT)
      .where(eq(billT.status, 'paid'));
    return BigInt(r?.total ?? '0');
  }


  async upsertBills(bills: TaxBill[]) {
    let n = 0;
    for (let k = 0; k < bills.length; k += 1000) {
      const rows = bills
        .slice(k, k + 1000)
        .map((b) => ({ ...b, amountCents: String(b.amountCents), fineCents: String(b.fineCents) }));
      const inserted = await this.db
        .insert(billT)
        .values(rows)
        .onConflictDoNothing({ target: [billT.city, billT.lotId, billT.kind, billT.period] })
        .returning({ id: billT.id });
      n += inserted.length;
    }
    return n;
  }

  async pendingBills(accountId?: string) {
    const rows = await this.db
      .select()
      .from(billT)
      .where(accountId ? and(eq(billT.status, 'pending'), eq(billT.accountId, accountId)) : eq(billT.status, 'pending'))
      .orderBy(asc(billT.dueAt))
      .limit(5000);
    return rows.map(toBill);
  }

  async billsOf(accountId: string, limit: number) {
    const rows = await this.db
      .select()
      .from(billT)
      .where(eq(billT.accountId, accountId))
      .orderBy(desc(billT.dueAt))
      .limit(limit);
    return rows.map(toBill);
  }

  async setFine(id: string, fineCents: number) {
    await this.db
      .update(billT)
      .set({ fineCents: String(fineCents) })
      .where(and(eq(billT.id, id), eq(billT.fineCents, '0')));
  }

  async markPaid(id: string, at: Date) {
    await this.db
      .update(billT)
      .set({ status: 'paid', paidAt: at })
      .where(and(eq(billT.id, id), eq(billT.status, 'pending')));
  }

  async inDefault(city: string, lotId: number, now: Date) {
    const limit = new Date(now.getTime() - DEFAULT_AFTER_DAYS * DAY_MS);
    const [row] = await this.db
      .select({ id: billT.id })
      .from(billT)
      .where(and(eq(billT.city, city), eq(billT.lotId, lotId), eq(billT.status, 'pending'), lt(billT.dueAt, limit)))
      .limit(1);
    return row !== undefined;
  }
}
