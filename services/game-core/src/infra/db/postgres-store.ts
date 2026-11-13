import { AppError } from '@scc/shared';
import { and, asc, desc, eq, lte, sql } from 'drizzle-orm';
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
import { type Meal, type MealEffects, type MealPlanner, type MealStatus, type MealStore, eat } from '../../domain/meal.js';
import {
  type Shift,
  type ShiftHours,
  type ShiftPlanner,
  type ShiftResult,
  type ShiftStatus,
  type ShiftStore,
  type Snapshot,
  hoursSince,
  settle,
} from '../../domain/shift.js';
import { avatar, meal, workShift } from './schema.js';

type MealRow = typeof meal.$inferSelect;

const toMeal = (r: MealRow): Meal => ({
  id: r.id,
  avatarId: r.avatarId,
  accountId: r.accountId,
  foodCode: r.foodCode,
  priceCents: BigInt(r.priceCents),
  effects: r.effects as MealEffects,
  status: r.status as MealStatus,
  clientKey: r.clientKey,
  createdAt: r.createdAt,
  eatenAt: r.eatenAt,
});

/** Violação de unicidade do Postgres, venha crua ou embrulhada pelo Drizzle. */
const isUniqueViolation = (error: unknown) => {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
};

type ShiftRow = typeof workShift.$inferSelect;

/** O resultado vai em jsonb; o valor em centavos fica na coluna numérica e volta como bigint. */
const toShift = (r: ShiftRow): Shift => ({
  id: r.id,
  avatarId: r.avatarId,
  accountId: r.accountId,
  jobCode: r.jobCode,
  hours: r.shiftHours as ShiftHours,
  startsAt: r.startsAt,
  endsAt: r.endsAt,
  seedCommit: r.seedCommit,
  seed: r.seed,
  snapshot: r.snapshot as Snapshot,
  result: r.result
    ? { ...(r.result as Omit<ShiftResult, 'thalerCents'>), thalerCents: BigInt(r.thalerEarned ?? '0') }
    : null,
  status: r.status as ShiftStatus,
});

const resultJson = (result: ShiftResult) => ({ damaged: result.damaged, factors: result.factors });

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

export class PostgresAvatarStore implements AvatarStore, ShiftStore, MealStore {
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

  async beginShift(avatarId: string, accountId: string, now: Date, plan: ShiftPlanner) {
    return this.db.transaction(async (tx) => {
      // Trava o avatar: dois pedidos de turno em paralelo viram um turno e um erro.
      const [row] = await tx.select().from(avatar).where(eq(avatar.id, avatarId)).for('update');
      if (!row || row.accountId !== accountId) throw new AppError('not_found', 'Avatar não encontrado.', 404);
      const recent = await tx
        .select({ startsAt: workShift.startsAt, hours: workShift.shiftHours, status: workShift.status })
        .from(workShift)
        .where(and(eq(workShift.avatarId, avatarId), sql`${workShift.startsAt} >= ${new Date(now.getTime() - 86_400_000)}`));
      const { shift, avatar: next } = plan(decayed(toAvatar(row), now), {
        hoursToday: hoursSince(recent.map((r) => ({ startsAt: r.startsAt, hours: r.hours as ShiftHours })), now),
        running: recent.some((r) => r.status === 'running'),
      });
      await tx
        .update(avatar)
        .set({ ...toRow(next), lastWorkedAt: now })
        .where(eq(avatar.id, avatarId));
      await tx.insert(workShift).values({
        id: shift.id,
        avatarId: shift.avatarId,
        accountId: shift.accountId,
        jobCode: shift.jobCode,
        shiftHours: shift.hours,
        startsAt: shift.startsAt,
        endsAt: shift.endsAt,
        seedCommit: shift.seedCommit,
        seed: shift.seed,
        snapshot: shift.snapshot,
        status: shift.status,
      });
      return shift;
    });
  }

  async completeDue(now: Date, batch: number) {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(workShift)
        .where(and(eq(workShift.status, 'running'), lte(workShift.endsAt, now)))
        .limit(batch)
        .for('update', { skipLocked: true });
      for (const row of rows) {
        const result = settle(toShift(row));
        await tx
          .update(workShift)
          .set({ status: 'done', result: resultJson(result), thalerEarned: result.thalerCents.toString() })
          .where(eq(workShift.id, row.id));
      }
      return rows.length;
    });
  }

  async listShifts(avatarId: string, limit: number) {
    const rows = await this.db
      .select()
      .from(workShift)
      .where(eq(workShift.avatarId, avatarId))
      .orderBy(desc(workShift.startsAt))
      .limit(limit);
    return rows.map(toShift);
  }

  async markClaimed(shiftId: string) {
    await this.db
      .update(workShift)
      .set({ status: 'claimed' })
      .where(and(eq(workShift.id, shiftId), eq(workShift.status, 'done')));
  }

  private async mealByKey(accountId: string, clientKey: string) {
    const [row] = await this.db
      .select()
      .from(meal)
      .where(and(eq(meal.accountId, accountId), eq(meal.clientKey, clientKey)));
    return row ? toMeal(row) : null;
  }

  async beginMeal(avatarId: string, accountId: string, clientKey: string | null, now: Date, plan: MealPlanner) {
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx.select().from(avatar).where(eq(avatar.id, avatarId)).for('update');
        if (!row || row.accountId !== accountId) throw new AppError('not_found', 'Avatar não encontrado.', 404);
        if (clientKey !== null) {
          const [same] = await tx
            .select()
            .from(meal)
            .where(and(eq(meal.accountId, accountId), eq(meal.clientKey, clientKey)));
          if (same) return toMeal(same);
        }
        const planned = plan(decayed(toAvatar(row), now));
        const [created] = await tx
          .insert(meal)
          .values({
            id: planned.id,
            avatarId: planned.avatarId,
            accountId: planned.accountId,
            foodCode: planned.foodCode,
            priceCents: planned.priceCents.toString(),
            effects: planned.effects,
            status: planned.status,
            clientKey: planned.clientKey,
            createdAt: planned.createdAt,
          })
          .returning();
        return toMeal(created!);
      });
    } catch (error) {
      // A mesma chave em dois avatares da conta ao mesmo tempo: vale a que entrou primeiro.
      if (clientKey !== null && isUniqueViolation(error)) {
        const same = await this.mealByKey(accountId, clientKey);
        if (same) return same;
      }
      throw error;
    }
  }

  async finishMeal(mealId: string, now: Date) {
    return this.db.transaction(async (tx) => {
      const [found] = await tx.select().from(meal).where(eq(meal.id, mealId)).for('update');
      if (!found) throw new AppError('not_found', 'Refeição não encontrada.', 404);
      if (found.status !== 'pending') return toMeal(found);
      const [row] = await tx.select().from(avatar).where(eq(avatar.id, found.avatarId)).for('update');
      const next = eat(decayed(toAvatar(row!), now), found.effects as MealEffects, now);
      await tx.update(avatar).set(toRow(next)).where(eq(avatar.id, next.id));
      const [done] = await tx
        .update(meal)
        .set({ status: 'eaten', eatenAt: now })
        .where(eq(meal.id, mealId))
        .returning();
      return toMeal(done!);
    });
  }

  async failMeal(mealId: string) {
    await this.db
      .update(meal)
      .set({ status: 'failed' })
      .where(and(eq(meal.id, mealId), eq(meal.status, 'pending')));
    const [row] = await this.db.select().from(meal).where(eq(meal.id, mealId));
    if (!row) throw new AppError('not_found', 'Refeição não encontrada.', 404);
    return toMeal(row);
  }

  async listMeals(avatarId: string, limit: number) {
    const rows = await this.db
      .select()
      .from(meal)
      .where(eq(meal.avatarId, avatarId))
      .orderBy(desc(meal.createdAt))
      .limit(limit);
    return rows.map(toMeal);
  }
}
