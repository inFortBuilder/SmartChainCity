import { AppError } from '@scc/shared';
import { and, asc, desc, eq, lt, ne } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import type { BuilderCheck, Building, BuildingStatus, BuildingStore } from '../../domain/buildings.js';
import { building as buildingT } from './schema.js';

type Db = ReturnType<typeof drizzle>;

const toBuilding = (r: typeof buildingT.$inferSelect): Building => ({
  ...r,
  position: r.position as [number, number],
  outorgaWei: BigInt(r.outorgaWei),
  checks: r.checks as BuilderCheck[],
  artifacts: r.artifacts as Record<string, string | null>,
  status: r.status as BuildingStatus,
});

const isUniqueViolation = (error: unknown) => {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
};

export class PostgresBuildingStore implements BuildingStore {
  private readonly db: Db;

  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  async createBuilding(b: Building) {
    try {
      await this.db.insert(buildingT).values({ ...b, outorgaWei: b.outorgaWei.toString() });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError('lot_has_building', 'Este lote já tem um prédio.', 409);
      throw error;
    }
  }

  async getBuilding(id: string) {
    const [r] = await this.db.select().from(buildingT).where(eq(buildingT.id, id));
    return r ? toBuilding(r) : null;
  }

  async buildingOnLot(city: string, lotId: number) {
    const [r] = await this.db
      .select()
      .from(buildingT)
      .where(and(eq(buildingT.city, city), eq(buildingT.lotId, lotId), ne(buildingT.status, 'rejected')))
      .orderBy(desc(buildingT.createdAt))
      .limit(1);
    return r ? toBuilding(r) : null;
  }

  async buildingsOf(accountId: string) {
    const rows = await this.db
      .select()
      .from(buildingT)
      .where(eq(buildingT.ownerAccountId, accountId))
      .orderBy(asc(buildingT.createdAt));
    return rows.map(toBuilding);
  }

  async moveBuilding(id: string, from: BuildingStatus, to: BuildingStatus, note: string | null, at: Date) {
    const review = to === 'approved' || to === 'rejected' ? { reviewNote: note, reviewedAt: at } : {};
    const rows = await this.db
      .update(buildingT)
      .set({ status: to, ...review })
      .where(and(eq(buildingT.id, id), eq(buildingT.status, from)))
      .returning({ id: buildingT.id });
    return rows.length > 0;
  }

  async dropPendingBuilding(id: string) {
    await this.db.delete(buildingT).where(and(eq(buildingT.id, id), eq(buildingT.status, 'pending_payment')));
  }

  async pendingPaymentBuildings(olderThan: Date) {
    const rows = await this.db
      .select()
      .from(buildingT)
      .where(and(eq(buildingT.status, 'pending_payment'), lt(buildingT.createdAt, olderThan)))
      .limit(100);
    return rows.map(toBuilding);
  }
}
