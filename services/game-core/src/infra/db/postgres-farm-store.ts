import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import { type Farm, type FarmStore, farmFromJson, farmToJson } from '../../domain/farm.js';
import { farm } from './schema.js';

const toFarm = (r: typeof farm.$inferSelect): Farm => ({
  accountId: r.accountId,
  level: r.level,
  harvestsAtLevel: r.harvestsAtLevel,
  harvestsTotal: r.harvestsTotal,
  boughtAt: r.boughtAt,
  version: r.version,
  ...farmFromJson(r.state as { machines?: string[]; plots?: unknown[] }),
});

export class PostgresFarmStore implements FarmStore {
  private readonly db;

  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  async get(accountId: string) {
    const [r] = await this.db.select().from(farm).where(eq(farm.accountId, accountId));
    return r ? toFarm(r) : null;
  }

  async create(f: Farm) {
    const rows = await this.db
      .insert(farm)
      .values({
        accountId: f.accountId,
        level: f.level,
        harvestsAtLevel: f.harvestsAtLevel,
        harvestsTotal: f.harvestsTotal,
        state: farmToJson(f),
        boughtAt: f.boughtAt,
        version: f.version,
      })
      .onConflictDoNothing()
      .returning({ id: farm.accountId });
    return rows.length > 0;
  }

  async save(f: Farm) {
    const rows = await this.db
      .update(farm)
      .set({ level: f.level, harvestsAtLevel: f.harvestsAtLevel, harvestsTotal: f.harvestsTotal, state: farmToJson(f), version: f.version + 1 })
      .where(and(eq(farm.accountId, f.accountId), eq(farm.version, f.version)))
      .returning({ id: farm.accountId });
    return rows.length > 0;
  }
}
