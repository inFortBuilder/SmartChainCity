import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import type { Hex } from 'viem';

import {
  type AvatarToken,
  type BoxRequest,
  type ChainEvent,
  type ContractName,
  type Cursor,
  type EventArgs,
  type LotToken,
  type ProjectionOp,
  type PropertyToken,
  byChainOrder,
  projectionOps,
} from '../../domain/events.js';
import type { IndexerStore } from '../../domain/indexer.js';
import {
  avatarToken as avatarT,
  boxRequest as boxT,
  chainEvent as eventT,
  cursor as cursorT,
  lotToken as lotT,
  propertyToken as propT,
} from './schema.js';

type Db = ReturnType<typeof drizzle>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const toEvent = (r: typeof eventT.$inferSelect): ChainEvent & { id: number } => ({
  id: r.id,
  chainId: r.chainId,
  blockNumber: r.blockNumber,
  blockHash: r.blockHash as Hex,
  txHash: r.txHash as Hex,
  logIndex: r.logIndex,
  contract: r.contract as ContractName,
  event: r.event,
  args: r.args as EventArgs,
});

async function apply(tx: Tx, chainId: number, op: ProjectionOp) {
  switch (op.kind) {
    case 'lot':
      await tx
        .insert(lotT)
        .values({ chainId, ...op.value })
        .onConflictDoUpdate({ target: [lotT.chainId, lotT.tokenId], set: { owner: op.value.owner, block: op.value.block } });
      return;
    case 'avatar_owner':
      await tx
        .insert(avatarT)
        .values({ chainId, tokenId: op.tokenId, owner: op.owner, block: op.block })
        .onConflictDoUpdate({ target: [avatarT.chainId, avatarT.tokenId], set: { owner: op.owner, block: op.block } });
      return;
    case 'avatar_traits':
      await tx
        .insert(avatarT)
        .values({ chainId, tokenId: op.tokenId, owner: op.owner, rarity: op.rarity, profession: op.profession, block: op.block })
        .onConflictDoUpdate({
          target: [avatarT.chainId, avatarT.tokenId],
          set: { rarity: op.rarity, profession: op.profession, block: op.block },
        });
      return;
    case 'property_owner':
      await tx
        .insert(propT)
        .values({ chainId, tokenId: op.tokenId, owner: op.owner, block: op.block })
        .onConflictDoUpdate({ target: [propT.chainId, propT.tokenId], set: { owner: op.owner, block: op.block } });
      return;
    case 'property_traits':
      await tx
        .insert(propT)
        .values({ chainId, tokenId: op.tokenId, owner: op.owner, lotId: op.lotId, typeCode: op.typeCode, level: op.level, block: op.block })
        .onConflictDoUpdate({
          target: [propT.chainId, propT.tokenId],
          set: { lotId: op.lotId, typeCode: op.typeCode, level: op.level, block: op.block },
        });
      return;
    case 'property_level':
      await tx
        .update(propT)
        .set({ level: op.level, block: op.block })
        .where(and(eq(propT.chainId, chainId), eq(propT.tokenId, op.tokenId)));
      return;
    case 'box_opened':
      await tx
        .insert(boxT)
        .values({ chainId, ...op.value })
        .onConflictDoUpdate({ target: [boxT.chainId, boxT.requestId], set: { buyer: op.value.buyer, tierId: op.value.tierId } });
      return;
    case 'box_revealed':
      await tx
        .insert(boxT)
        .values({ chainId, requestId: op.requestId, buyer: op.buyer, tierId: 0, status: 'revealed', tokenId: op.tokenId, block: op.block })
        .onConflictDoUpdate({
          target: [boxT.chainId, boxT.requestId],
          set: { status: 'revealed', tokenId: op.tokenId, block: op.block },
        });
      return;
  }
}

export class PostgresIndexerStore implements IndexerStore {
  private readonly db: Db;

  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  async cursor(chainId: number) {
    const [r] = await this.db.select().from(cursorT).where(eq(cursorT.chainId, chainId));
    return r ? { block: r.block, hash: r.hash as Hex } : null;
  }

  private async setCursor(tx: Tx, chainId: number, c: Cursor | null) {
    if (!c) {
      await tx.delete(cursorT).where(eq(cursorT.chainId, chainId));
      return;
    }
    await tx
      .insert(cursorT)
      .values({ chainId, block: c.block, hash: c.hash })
      .onConflictDoUpdate({ target: cursorT.chainId, set: { block: c.block, hash: c.hash } });
  }

  async commit(chainId: number, events: ChainEvent[], c: Cursor) {
    return this.db.transaction(async (tx) => {
      let inserted = 0;
      for (const e of [...events].sort(byChainOrder)) {
        const rows = await tx
          .insert(eventT)
          .values({
            chainId,
            blockNumber: e.blockNumber,
            blockHash: e.blockHash,
            txHash: e.txHash,
            logIndex: e.logIndex,
            contract: e.contract,
            event: e.event,
            args: e.args,
          })
          .onConflictDoNothing({ target: [eventT.chainId, eventT.txHash, eventT.logIndex] })
          .returning({ id: eventT.id });
        if (rows.length === 0) continue; // já visto
        for (const op of projectionOps(e)) await apply(tx, chainId, op);
        inserted++;
      }
      await this.setCursor(tx, chainId, c);
      return inserted;
    });
  }

  async rewind(chainId: number, c: Cursor | null) {
    return this.db.transaction(async (tx) => {
      const deleted = await tx
        .delete(eventT)
        .where(c ? and(eq(eventT.chainId, chainId), gt(eventT.blockNumber, c.block)) : eq(eventT.chainId, chainId))
        .returning({ id: eventT.id });
      await tx.delete(lotT).where(eq(lotT.chainId, chainId));
      await tx.delete(avatarT).where(eq(avatarT.chainId, chainId));
      await tx.delete(boxT).where(eq(boxT.chainId, chainId));
      await tx.delete(propT).where(eq(propT.chainId, chainId));
      const keep = await tx
        .select()
        .from(eventT)
        .where(eq(eventT.chainId, chainId))
        .orderBy(asc(eventT.blockNumber), asc(eventT.logIndex));
      for (const r of keep) for (const op of projectionOps(toEvent(r))) await apply(tx, chainId, op);
      await this.setCursor(tx, chainId, c);
      return deleted.length;
    });
  }

  async lot(chainId: number, tokenId: string) {
    const [r] = await this.db.select().from(lotT).where(and(eq(lotT.chainId, chainId), eq(lotT.tokenId, tokenId)));
    return r ? (({ chainId: _c, ...rest }) => rest as LotToken)(r) : null;
  }

  async lotsOf(chainId: number, owner: string) {
    const rows = await this.db
      .select()
      .from(lotT)
      .where(and(eq(lotT.chainId, chainId), eq(lotT.owner, owner.toLowerCase())))
      .orderBy(asc(sql`${lotT.tokenId}::numeric`));
    return rows.map(({ chainId: _c, ...rest }) => rest as LotToken);
  }

  async avatar(chainId: number, tokenId: string) {
    const [r] = await this.db.select().from(avatarT).where(and(eq(avatarT.chainId, chainId), eq(avatarT.tokenId, tokenId)));
    return r ? (({ chainId: _c, ...rest }) => rest as AvatarToken)(r) : null;
  }

  async avatarsOf(chainId: number, owner: string) {
    const rows = await this.db
      .select()
      .from(avatarT)
      .where(and(eq(avatarT.chainId, chainId), eq(avatarT.owner, owner.toLowerCase())))
      .orderBy(asc(sql`${avatarT.tokenId}::numeric`));
    return rows.map(({ chainId: _c, ...rest }) => rest as AvatarToken);
  }

  async property(chainId: number, tokenId: string) {
    const [r] = await this.db.select().from(propT).where(and(eq(propT.chainId, chainId), eq(propT.tokenId, tokenId)));
    return r ? (({ chainId: _c, ...rest }) => rest as PropertyToken)(r) : null;
  }

  async propertiesOf(chainId: number, owner: string) {
    const rows = await this.db
      .select()
      .from(propT)
      .where(and(eq(propT.chainId, chainId), eq(propT.owner, owner.toLowerCase())))
      .orderBy(asc(sql`${propT.tokenId}::numeric`));
    return rows.map(({ chainId: _c, ...rest }) => rest as PropertyToken);
  }

  async box(chainId: number, requestId: string) {
    const [r] = await this.db.select().from(boxT).where(and(eq(boxT.chainId, chainId), eq(boxT.requestId, requestId)));
    return r ? (({ chainId: _c, ...rest }) => rest as BoxRequest)(r) : null;
  }

  async eventsAfter(chainId: number, afterId: number, limit: number) {
    const rows = await this.db
      .select()
      .from(eventT)
      .where(and(eq(eventT.chainId, chainId), gt(eventT.id, afterId)))
      .orderBy(asc(eventT.id))
      .limit(limit);
    return rows.map(toEvent);
  }
}
