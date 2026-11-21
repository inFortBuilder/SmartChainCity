import { AppError } from '@scc/shared';
import { and, count, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import type { Guest, GuestStore, PlaceKind } from '../../domain/visits.js';
import { placeGuest as gT } from './schema.js';

const toGuest = (r: typeof gT.$inferSelect): Guest => ({ ...r, kind: r.kind as PlaceKind });

export class PostgresGuestStore implements GuestStore {
  private readonly db;

  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  async addGuest(g: Guest, max: number) {
    await this.db.transaction(async (tx) => {
      // Um convite por vez no mesmo lugar, para o limite valer com pedidos simultâneos.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`world-guests:${g.kind}:${g.placeId}`}))`);
      const [existing] = await tx
        .select({ invitedBy: gT.invitedBy })
        .from(gT)
        .where(and(eq(gT.kind, g.kind), eq(gT.placeId, g.placeId), eq(gT.guestAccountId, g.guestAccountId)));
      if (!existing || existing.invitedBy !== g.invitedBy) {
        const [row] = await tx
          .select({ n: count() })
          .from(gT)
          .where(and(eq(gT.kind, g.kind), eq(gT.placeId, g.placeId), eq(gT.invitedBy, g.invitedBy)));
        if ((row?.n ?? 0) >= max) throw new AppError('guest_limit', `Até ${max} convidados por imóvel.`, 409);
      }
      await tx
        .insert(gT)
        .values(g)
        .onConflictDoUpdate({ target: [gT.kind, gT.placeId, gT.guestAccountId], set: { invitedBy: g.invitedBy, createdAt: g.createdAt } });
    });
  }

  async removeGuest(kind: PlaceKind, placeId: string, guestAccountId: string) {
    const rows = await this.db
      .delete(gT)
      .where(and(eq(gT.kind, kind), eq(gT.placeId, placeId), eq(gT.guestAccountId, guestAccountId)))
      .returning({ id: gT.placeId });
    return rows.length > 0;
  }

  async guestsOf(kind: PlaceKind, placeId: string, invitedBy: string) {
    const rows = await this.db.select().from(gT).where(and(eq(gT.kind, kind), eq(gT.placeId, placeId), eq(gT.invitedBy, invitedBy)));
    return rows.map(toGuest);
  }

  async isGuest(kind: PlaceKind, placeId: string, guestAccountId: string, invitedBy: string) {
    const [r] = await this.db
      .select({ invitedBy: gT.invitedBy })
      .from(gT)
      .where(and(eq(gT.kind, kind), eq(gT.placeId, placeId), eq(gT.guestAccountId, guestAccountId)));
    return r?.invitedBy === invitedBy;
  }

  async invitationsOf(guestAccountId: string) {
    const rows = await this.db.select().from(gT).where(eq(gT.guestAccountId, guestAccountId)).limit(200);
    return rows.map(toGuest);
  }
}
