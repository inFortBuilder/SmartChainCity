import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import type { ChainSyncStore, PendingAvatar } from '../../domain/chain-sync.js';
import { chainAvatarPending as pA, chainCursor } from './schema.js';

const NAME = 'chain-indexer';

const toPending = (r: typeof pA.$inferSelect): PendingAvatar => ({
  tokenId: r.tokenId,
  eventId: r.eventId,
  to: r.toAddress,
  mint: r.jobCode !== null && r.rarity !== null ? { rarity: r.rarity, profession: r.jobCode } : null,
});

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

  async putPending(p: PendingAvatar) {
    const row = { eventId: p.eventId, toAddress: p.to, rarity: p.mint?.rarity ?? null, jobCode: p.mint?.profession ?? null };
    await this.db.insert(pA).values({ tokenId: p.tokenId, ...row }).onConflictDoUpdate({ target: pA.tokenId, set: row });
  }

  async getPending(tokenId: string) {
    const [r] = await this.db.select().from(pA).where(eq(pA.tokenId, tokenId));
    return r ? toPending(r) : null;
  }

  async pending(limit: number) {
    return (await this.db.select().from(pA).orderBy(asc(pA.eventId)).limit(limit)).map(toPending);
  }

  async dropPending(tokenId: string) {
    await this.db.delete(pA).where(eq(pA.tokenId, tokenId));
  }
}
