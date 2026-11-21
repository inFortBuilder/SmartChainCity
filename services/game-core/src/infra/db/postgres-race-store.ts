import { and, desc, eq, inArray, lte, ne, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import type { Race, RaceResult, RaceStatus, RaceStore } from '../../domain/race.js';
import { vehicleRace } from './schema.js';

const toRace = (r: typeof vehicleRace.$inferSelect): Race => ({
  ...r,
  result: r.result as RaceResult,
  fuelCents: BigInt(r.fuelCents),
  status: r.status as RaceStatus,
});

export class PostgresRaceStore implements RaceStore {
  private readonly db;

  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  async createWithinLimit(race: Race, limit: number) {
    return this.db.transaction(async (tx) => {
      // Trava o piloto: duas corridas juntas não passam do limite do dia.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`race:${race.avatarId}`}))`);
      const [{ n } = { n: 0 }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(vehicleRace)
        .where(and(eq(vehicleRace.avatarId, race.avatarId), eq(vehicleRace.day, race.day), ne(vehicleRace.status, 'failed')));
      if (n >= limit) return false;
      await tx.insert(vehicleRace).values({ ...race, fuelCents: race.fuelCents.toString() });
      return true;
    });
  }

  async countToday(avatarId: string, day: string) {
    const [{ n } = { n: 0 }] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(vehicleRace)
      .where(and(eq(vehicleRace.avatarId, avatarId), eq(vehicleRace.day, day), ne(vehicleRace.status, 'failed')));
    return n;
  }

  async get(id: string) {
    const [r] = await this.db.select().from(vehicleRace).where(eq(vehicleRace.id, id));
    return r ? toRace(r) : null;
  }

  async listByAccount(accountId: string, limit: number) {
    const rows = await this.db.select().from(vehicleRace).where(eq(vehicleRace.accountId, accountId)).orderBy(desc(vehicleRace.createdAt)).limit(limit);
    return rows.map(toRace);
  }

  async transition(id: string, from: RaceStatus, to: RaceStatus) {
    const rows = await this.db
      .update(vehicleRace)
      .set({ status: to })
      .where(and(eq(vehicleRace.id, id), eq(vehicleRace.status, from)))
      .returning({ id: vehicleRace.id });
    return rows.length > 0;
  }

  async stuck(olderThan: Date) {
    const rows = await this.db
      .select()
      .from(vehicleRace)
      .where(and(inArray(vehicleRace.status, ['pending', 'charged']), lte(vehicleRace.createdAt, olderThan)))
      .limit(200);
    return rows.map(toRace);
  }
}
