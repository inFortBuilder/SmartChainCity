import { asc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import {
  type Avatar,
  type AvatarStore,
  DECAY,
  MAX_AVATARS_PER_ACCOUNT,
  decayDue,
  decayed,
  tooManyAvatars,
} from '../../domain/avatar.js';
import type { Rarity } from '../../domain/catalog.js';
import { avatar } from './schema.js';

type Row = typeof avatar.$inferSelect;

const toAvatar = (r: Row): Avatar => ({
  id: r.id,
  accountId: r.accountId,
  rarity: r.rarity as Rarity,
  jobCode: r.jobCode,
  attributes: {
    energy: r.energy,
    health: r.health,
    happiness: r.happiness,
    food: r.food,
    hygiene: r.hygiene,
    education: r.education,
  },
  anchors: { food: r.foodAt, happiness: r.happinessAt, hygiene: r.hygieneAt },
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const toRow = (a: Avatar) => ({
  id: a.id,
  accountId: a.accountId,
  rarity: a.rarity,
  jobCode: a.jobCode,
  ...a.attributes,
  foodAt: a.anchors.food,
  happinessAt: a.anchors.happiness,
  hygieneAt: a.anchors.hygiene,
  createdAt: a.createdAt,
  updatedAt: a.updatedAt,
});

export class PostgresAvatarStore implements AvatarStore {
  private readonly db;

  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  async create(a: Avatar) {
    return this.db.transaction(async (tx) => {
      // Trava por conta: dois pedidos em paralelo não passam juntos do limite.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'avatar:' + a.accountId}))`);
      const [{ owned }] = (await tx.execute<{ owned: string }>(
        sql`select count(*)::text as owned from game.avatar where account_id = ${a.accountId}`,
      )).rows as [{ owned: string }];
      if (Number(owned) >= MAX_AVATARS_PER_ACCOUNT) throw tooManyAvatars();
      const [row] = await tx.insert(avatar).values(toRow(a)).returning();
      return toAvatar(row!);
    });
  }

  async get(id: string) {
    const [row] = await this.db.select().from(avatar).where(eq(avatar.id, id));
    return row ? toAvatar(row) : null;
  }

  async listByAccount(accountId: string) {
    const rows = await this.db.select().from(avatar).where(eq(avatar.accountId, accountId)).orderBy(asc(avatar.createdAt));
    return rows.map(toAvatar);
  }

  async applyDecay(now: Date, batch: number) {
    const limit = (ms: number) => new Date(now.getTime() - ms);
    return this.db.transaction(async (tx) => {
      // Só quem já passou do instante da próxima queda. SKIP LOCKED: duas instâncias do job dividem o trabalho sem esperar uma pela outra.
      const rows = await tx
        .select()
        .from(avatar)
        .where(
          sql`(
            (${avatar.food} > 0 and ${avatar.foodAt} <= ${limit(DECAY.food.everyMs)}) or
            (${avatar.happiness} > 0 and ${avatar.happinessAt} <= ${limit(DECAY.happiness.everyMs)}) or
            (${avatar.hygiene} > 0 and ${avatar.hygieneAt} <= ${limit(DECAY.hygiene.everyMs)})
          )`,
        )
        .limit(batch)
        .for('update', { skipLocked: true });
      let done = 0;
      for (const row of rows) {
        const current = toAvatar(row);
        if (!decayDue(current, now)) continue;
        const next = decayed(current, now);
        await tx
          .update(avatar)
          .set({
            food: next.attributes.food,
            happiness: next.attributes.happiness,
            hygiene: next.attributes.hygiene,
            foodAt: next.anchors.food,
            happinessAt: next.anchors.happiness,
            hygieneAt: next.anchors.hygiene,
            updatedAt: now,
          })
          .where(eq(avatar.id, row.id));
        done++;
      }
      return done;
    });
  }
}

