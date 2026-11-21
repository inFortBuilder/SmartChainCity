import { and, asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import type { ChainSyncStore, PendingTransfer } from '../../domain/chain-sync.js';
import { chainCursor, chainTransferPending as pT } from './schema.js';

const NAME = 'chain-indexer';

export class PostgresChainSyncStore implements ChainSyncStore {
  private readonly db;

  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  async cursor() {
    const [r] = await this.db.select().from(chainCursor).where(eq(chainCursor.name, NAME));
    return r?.after ?? 0;
  }

  async setCursor(after: number) {
    await this.db.insert(chainCursor).values({ name: NAME, after }).onConflictDoUpdate({ target: chainCursor.name, set: { after } });
  }

  async addPending(t: PendingTransfer) {
    await this.db.insert(pT).values({ eventId: t.eventId, kind: t.kind, tokenId: t.tokenId, toAddress: t.to }).onConflictDoNothing();
  }

  async pending(limit: number) {
    const rows = await this.db.select().from(pT).orderBy(asc(pT.eventId)).limit(limit);
    return rows.map((r) => ({ eventId: r.eventId, kind: r.kind as PendingTransfer['kind'], tokenId: r.tokenId, to: r.toAddress }));
  }

  async dropPending(eventId: number) {
    await this.db.delete(pT).where(eq(pT.eventId, eventId));
  }

  async dropPendingFor(kind: PendingTransfer['kind'], tokenId: string) {
    await this.db.delete(pT).where(and(eq(pT.kind, kind), eq(pT.tokenId, tokenId)));
  }
}
