import { and, desc, eq, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import type { ModelCode, Vehicle, VehicleStore } from '../../domain/vehicle.js';
import { vehicle } from './schema.js';

const toVehicle = (r: typeof vehicle.$inferSelect): Vehicle => ({
  ...r,
  model: r.model as ModelCode,
  kind: r.kind as Vehicle['kind'],
  status: r.status as Vehicle['status'],
  paidCents: BigInt(r.paidCents),
});

export class PostgresVehicleStore implements VehicleStore {
  private readonly db;

  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  async create(v: Vehicle) {
    await this.db.insert(vehicle).values({ ...v, paidCents: v.paidCents.toString() });
  }

  async get(id: string) {
    const [r] = await this.db.select().from(vehicle).where(eq(vehicle.id, id));
    return r ? toVehicle(r) : null;
  }

  async listByAccount(accountId: string) {
    const rows = await this.db.select().from(vehicle).where(eq(vehicle.accountId, accountId)).orderBy(desc(vehicle.boughtAt));
    return rows.map(toVehicle);
  }

  async activate(id: string) {
    await this.db.update(vehicle).set({ status: 'active' }).where(and(eq(vehicle.id, id), eq(vehicle.status, 'pending')));
  }

  async dropPending(id: string) {
    await this.db.delete(vehicle).where(and(eq(vehicle.id, id), eq(vehicle.status, 'pending')));
  }

  async extendIpva(id: string, expected: Date, until: Date) {
    const rows = await this.db
      .update(vehicle)
      .set({ ipvaPaidUntil: until })
      .where(and(eq(vehicle.id, id), eq(vehicle.ipvaPaidUntil, expected)))
      .returning({ id: vehicle.id });
    return rows.length > 0;
  }

  async markSold(id: string, now: Date) {
    const rows = await this.db
      .update(vehicle)
      .set({ status: 'sold', soldAt: now })
      .where(and(eq(vehicle.id, id), eq(vehicle.status, 'active')))
      .returning({ id: vehicle.id });
    return rows.length > 0;
  }

  async pendingOlderThan(t: Date) {
    const rows = await this.db
      .select()
      .from(vehicle)
      .where(and(eq(vehicle.status, 'pending'), lte(vehicle.boughtAt, t)))
      .limit(200);
    return rows.map(toVehicle);
  }
}
