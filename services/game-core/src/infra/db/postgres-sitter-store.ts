import { AppError } from '@scc/shared';
import { and, desc, eq, gt, ne, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import type { PetSitterStore, SitterOffer, Sitting, SittingStatus } from '../../domain/sitter.js';
import { petSitterOffer as offerT, petSitting as sitT } from './schema.js';

type Db = ReturnType<typeof drizzle>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const toSitting = (r: typeof sitT.$inferSelect): Sitting => ({ ...r, status: r.status as SittingStatus });

export class PostgresPetSitterStore implements PetSitterStore {
  private readonly db: Db;

  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  async offer(avatarId: string) {
    const [r] = await this.db.select().from(offerT).where(eq(offerT.avatarId, avatarId));
    return r ?? null;
  }

  async setOffer(o: SitterOffer) {
    await this.db.insert(offerT).values(o).onConflictDoUpdate({ target: offerT.avatarId, set: o });
  }

  async openOffers() {
    return this.db.select().from(offerT).where(eq(offerT.open, true));
  }

  private live(db: Db | Tx, sitterAvatarId: string, now: Date) {
    return db
      .select()
      .from(sitT)
      .where(and(eq(sitT.sitterAvatarId, sitterAvatarId), ne(sitT.status, 'cancelled'), gt(sitT.endsAt, now)));
  }

  async reserve(sitting: Sitting, capacity: number, now: Date) {
    return this.db.transaction(async (tx) => {
      // Uma reserva por vez por sitter: a contagem e a gravação andam juntas.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`game-sitter:${sitting.sitterAvatarId}`}))`);
      if ((await this.live(tx, sitting.sitterAvatarId, now)).length >= capacity) {
        throw new AppError('sitter_full', 'Este Pet Sitter já está com todos os pets que pode cuidar.', 409);
      }
      await tx.insert(sitT).values(sitting);
      return { ...sitting };
    });
  }

  async setStatus(id: string, status: SittingStatus) {
    await this.db.update(sitT).set({ status }).where(eq(sitT.id, id));
  }

  async current(sitterAvatarId: string, now: Date) {
    return (await this.live(this.db, sitterAvatarId, now)).map(toSitting);
  }

  async latestOf(ownerAvatarId: string) {
    const [r] = await this.db.select().from(sitT).where(eq(sitT.ownerAvatarId, ownerAvatarId)).orderBy(desc(sitT.startsAt)).limit(1);
    return r ? toSitting(r) : null;
  }
}
