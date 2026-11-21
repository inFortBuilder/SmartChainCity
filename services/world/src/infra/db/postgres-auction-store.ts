import { and, asc, desc, eq, inArray, lte, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import type { Auction, AuctionStatus, AuctionStore, Bid } from '../../domain/auctions.js';
import { auction as auctionT, auctionBid as bidT } from './schema.js';

type Db = ReturnType<typeof drizzle>;

const toAuction = (r: typeof auctionT.$inferSelect): Auction => ({
  ...r,
  status: r.status as AuctionStatus,
  debtCents: Number(r.debtCents),
  billIds: r.billIds as string[],
  priceCents: r.priceCents === null ? null : Number(r.priceCents),
});

const toBid = (r: typeof bidT.$inferSelect): Bid => ({ ...r, amountCents: Number(r.amountCents) });

const ACTIVE: AuctionStatus[] = ['open', 'charged'];

export class PostgresAuctionStore implements AuctionStore {
  private readonly db: Db;

  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  async openAuction(a: Auction) {
    // O índice único parcial segura um leilão ativo por lote, mesmo com dois jobs ao mesmo tempo.
    const inserted = await this.db
      .insert(auctionT)
      .values({ ...a, debtCents: String(a.debtCents), priceCents: a.priceCents === null ? null : String(a.priceCents) })
      .onConflictDoNothing()
      .returning({ id: auctionT.id });
    return inserted.length > 0;
  }

  async getAuction(id: string) {
    const [r] = await this.db.select().from(auctionT).where(eq(auctionT.id, id));
    return r ? toAuction(r) : null;
  }

  async activeOnLot(city: string, lotId: number) {
    const [r] = await this.db
      .select()
      .from(auctionT)
      .where(and(eq(auctionT.city, city), eq(auctionT.lotId, lotId), inArray(auctionT.status, ACTIVE)));
    return r ? toAuction(r) : null;
  }

  async listOpen(limit: number) {
    const rows = await this.db.select().from(auctionT).where(eq(auctionT.status, 'open')).orderBy(asc(auctionT.endsAt)).limit(limit);
    return rows.map(toAuction);
  }

  async due(now: Date) {
    const rows = await this.db
      .select()
      .from(auctionT)
      .where(or(and(eq(auctionT.status, 'open'), lte(auctionT.endsAt, now)), eq(auctionT.status, 'charged')))
      .orderBy(asc(auctionT.endsAt))
      .limit(500);
    return rows.map(toAuction);
  }

  async bidsOf(auctionId: string) {
    const rows = await this.db
      .select()
      .from(bidT)
      .where(eq(bidT.auctionId, auctionId))
      .orderBy(desc(bidT.amountCents), asc(bidT.createdAt));
    return rows.map(toBid);
  }

  async placeBid(bid: Bid, check: (a: Auction, top: Bid | null) => Date) {
    return this.db.transaction(async (tx) => {
      // Trava o leilão: dois lances ao mesmo tempo comparam com o maior de verdade.
      const [row] = await tx.select().from(auctionT).where(eq(auctionT.id, bid.auctionId)).for('update');
      const a = toAuction(row!);
      const [top] = await tx
        .select()
        .from(bidT)
        .where(eq(bidT.auctionId, a.id))
        .orderBy(desc(bidT.amountCents), asc(bidT.createdAt))
        .limit(1);
      const endsAt = check(a, top ? toBid(top) : null);
      await tx.insert(bidT).values({ ...bid, amountCents: String(bid.amountCents) });
      await tx.update(auctionT).set({ endsAt }).where(eq(auctionT.id, a.id));
      return { ...a, endsAt };
    });
  }

  async transition(id: string, from: AuctionStatus, patch: Partial<Pick<Auction, 'status' | 'winnerAccountId' | 'priceCents' | 'closedAt'>>) {
    const { priceCents, ...rest } = patch;
    const updated = await this.db
      .update(auctionT)
      .set({ ...rest, ...(priceCents === undefined ? {} : { priceCents: priceCents === null ? null : String(priceCents) }) })
      .where(and(eq(auctionT.id, id), eq(auctionT.status, from)))
      .returning({ id: auctionT.id });
    return updated.length > 0;
  }
}
