import { and, asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import type { Seizure, SeizureKind, SeizureStatus, SeizureStore } from '../../domain/seizures.js';
import { seizure as sT } from './schema.js';

const toSeizure = (r: typeof sT.$inferSelect): Seizure => ({
  ...r,
  kind: r.kind as SeizureKind,
  status: r.status as SeizureStatus,
  nonce: BigInt(r.nonce),
});

export class PostgresSeizureStore implements SeizureStore {
  private readonly db;

  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  async openSeizure(s: Seizure) {
    return this.db.transaction(async (tx) => {
      // Vale a última: a aberta do mesmo token (de um leilão anterior) é cancelada.
      await tx
        .update(sT)
        .set({ status: 'cancelled', closedAt: s.createdAt })
        .where(and(eq(sT.kind, s.kind), eq(sT.tokenId, s.tokenId), eq(sT.status, 'open')));
      const [row] = await tx.insert(sT).values({ ...s, nonce: s.nonce.toString() }).returning();
      return toSeizure(row!);
    });
  }

  async get(id: string) {
    const [r] = await this.db.select().from(sT).where(eq(sT.id, id));
    return r ? toSeizure(r) : null;
  }

  async openFor(kind: SeizureKind, tokenId: string) {
    const [r] = await this.db.select().from(sT).where(and(eq(sT.kind, kind), eq(sT.tokenId, tokenId), eq(sT.status, 'open')));
    return r ? toSeizure(r) : null;
  }

  async openOf(accountId: string) {
    const rows = await this.db.select().from(sT).where(and(eq(sT.toAccountId, accountId), eq(sT.status, 'open'))).orderBy(asc(sT.createdAt));
    return rows.map(toSeizure);
  }

  async close(id: string, status: Exclude<SeizureStatus, 'open'>, now: Date) {
    const rows = await this.db
      .update(sT)
      .set({ status, closedAt: now })
      .where(and(eq(sT.id, id), eq(sT.status, 'open')))
      .returning({ id: sT.id });
    return rows.length > 0;
  }
}
