import { and, desc, eq, gte, lte, ne, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import type { Conversion, Direction, ExchangeStore, FxRate } from '../../domain/exchange.js';
import type { TickSample, TwapSampleStore } from '../../domain/fx-twap.js';
import { fxConversion as cT, fxRate as rT, fxTickSample as sT } from './schema.js';

type Db = ReturnType<typeof drizzle>;

const toConversion = (r: typeof cT.$inferSelect): Conversion => ({
  ...r,
  direction: r.direction as Direction,
  thalerCents: BigInt(r.thalerCents),
  scityWei: BigInt(r.scityWei),
  feeCents: BigInt(r.feeCents),
  thalerPerScityMicro: BigInt(r.thalerPerScityMicro),
  status: r.status as Conversion['status'],
});

export class PostgresExchangeStore implements ExchangeStore, TwapSampleStore {
  private readonly db: Db;

  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  async addSample(pool: string, s: TickSample) {
    await this.db.insert(sT).values({ pool, at: s.at, tickCumulative: s.tickCumulative.toString() }).onConflictDoNothing();
  }

  async sampleAtOrBefore(pool: string, before: Date) {
    const [r] = await this.db.select().from(sT).where(and(eq(sT.pool, pool), lte(sT.at, before))).orderBy(desc(sT.at)).limit(1);
    return r ? { at: r.at, tickCumulative: BigInt(r.tickCumulative) } : null;
  }

  async pruneSamples(pool: string, before: Date) {
    await this.db.delete(sT).where(and(eq(sT.pool, pool), sql`${sT.at} < ${before}`));
  }

  async latestRate(at: Date) {
    const [r] = await this.db.select().from(rT).where(lte(rT.validFrom, at)).orderBy(desc(rT.validFrom)).limit(1);
    return r ? { validFrom: r.validFrom, thalerPerScityMicro: BigInt(r.thalerPerScityMicro), scityUsd: Number(r.scityUsd), source: r.source } : null;
  }

  async get(id: string) {
    const [r] = await this.db.select().from(cT).where(eq(cT.id, id));
    return r ? toConversion(r) : null;
  }

  async setRate(rate: FxRate) {
    await this.db
      .insert(rT)
      .values({ ...rate, thalerPerScityMicro: rate.thalerPerScityMicro.toString(), scityUsd: String(rate.scityUsd) })
      .onConflictDoUpdate({
        target: rT.validFrom,
        set: { thalerPerScityMicro: rate.thalerPerScityMicro.toString(), scityUsd: String(rate.scityUsd), source: rate.source },
      });
  }

  async createWithinLimit(c: Conversion, since: Date, limitCents: bigint) {
    return this.db.transaction(async (tx) => {
      if (c.direction === 'thaler_to_scity') {
        // Uma saída por conta de cada vez: duas juntas não passam do teto.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`fx:${c.accountId}`}))`);
        const [row] = await tx
          .select({ used: sql<string>`coalesce(sum(${cT.thalerCents}), 0)` })
          .from(cT)
          .where(and(eq(cT.accountId, c.accountId), eq(cT.direction, 'thaler_to_scity'), ne(cT.status, 'failed'), gte(cT.createdAt, since)));
        if (BigInt(row?.used ?? '0') + c.thalerCents > limitCents) return false;
      }
      await tx.insert(cT).values({
        ...c,
        thalerCents: c.thalerCents.toString(),
        scityWei: c.scityWei.toString(),
        feeCents: c.feeCents.toString(),
        thalerPerScityMicro: c.thalerPerScityMicro.toString(),
      });
      return true;
    });
  }

  async setStatus(id: string, status: 'done' | 'failed') {
    await this.db.update(cT).set({ status }).where(and(eq(cT.id, id), eq(cT.status, 'created')));
  }

  async scityPaidOut() {
    const [row] = await this.db
      .select({ paid: sql<string>`coalesce(sum(${cT.scityWei}), 0)` })
      .from(cT)
      .where(and(eq(cT.direction, 'thaler_to_scity'), eq(cT.status, 'done')));
    return BigInt(row?.paid ?? '0');
  }

  async listOf(accountId: string, limit: number) {
    const rows = await this.db.select().from(cT).where(eq(cT.accountId, accountId)).orderBy(desc(cT.createdAt)).limit(limit);
    return rows.map(toConversion);
  }
}
