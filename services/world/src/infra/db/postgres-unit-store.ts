import { AppError } from '@scc/shared';
import { and, asc, desc, eq, gt, isNotNull, isNull, lt, lte, ne } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import type { PayStatus, Unit, UnitKind, UnitLease, UnitSale, UnitStore } from '../../domain/units.js';
import { buildingUnit as unitT, unitLease as leaseT, unitSale as saleT } from './schema.js';

const num = (v: string | null) => (v === null ? null : Number(v));
const toUnit = (r: typeof unitT.$inferSelect): Unit => ({
  ...r,
  kind: r.kind as UnitKind,
  priceCents: num(r.priceCents),
  rentCentsPerDay: num(r.rentCentsPerDay),
});
const toSale = (r: typeof saleT.$inferSelect): UnitSale => ({ ...r, status: r.status as PayStatus, priceCents: Number(r.priceCents) });
const toLease = (r: typeof leaseT.$inferSelect): UnitLease => ({ ...r, status: r.status as PayStatus, centsPerDay: Number(r.centsPerDay) });
const str = (v: number | null) => (v === null ? null : String(v));

const isUniqueViolation = (error: unknown) => {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
};

export class PostgresUnitStore implements UnitStore {
  private readonly db;

  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  async createUnits(units: Unit[]) {
    if (!units.length) return;
    await this.db.transaction(async (tx) => {
      const [any] = await tx.select({ id: unitT.id }).from(unitT).where(eq(unitT.buildingId, units[0]!.buildingId)).limit(1);
      if (any) throw new AppError('units_exist', 'Este prédio já tem unidades.', 409);
      try {
        for (let i = 0; i < units.length; i += 200) {
          await tx.insert(unitT).values(
            units.slice(i, i + 200).map((u) => ({ ...u, priceCents: str(u.priceCents), rentCentsPerDay: str(u.rentCentsPerDay) })),
          );
        }
      } catch (error) {
        if (isUniqueViolation(error)) throw new AppError('units_exist', 'Este prédio já tem unidades.', 409);
        throw error;
      }
    });
  }

  async getUnit(id: string) {
    const [r] = await this.db.select().from(unitT).where(eq(unitT.id, id));
    return r ? toUnit(r) : null;
  }

  async unitsOfBuilding(buildingId: string) {
    const rows = await this.db.select().from(unitT).where(eq(unitT.buildingId, buildingId)).orderBy(asc(unitT.floor), asc(unitT.number));
    return rows.map(toUnit);
  }

  async unitsOwnedBy(accountId: string) {
    return (await this.db.select().from(unitT).where(eq(unitT.ownerAccountId, accountId))).map(toUnit);
  }

  async unitsForRent(city: string, limit: number) {
    const rows = await this.db
      .select()
      .from(unitT)
      .where(and(eq(unitT.city, city), eq(unitT.kind, 'residencial'), isNotNull(unitT.rentCentsPerDay)))
      .orderBy(asc(unitT.rentCentsPerDay))
      .limit(limit);
    return rows.map(toUnit);
  }

  async setOffer(id: string, offer: { priceCents: number | null; rentCentsPerDay: number | null }) {
    await this.db
      .update(unitT)
      .set({ priceCents: str(offer.priceCents), rentCentsPerDay: str(offer.rentCentsPerDay) })
      .where(and(eq(unitT.id, id), isNull(unitT.pendingSaleId)));
  }

  async beginSale(sale: UnitSale) {
    return this.db.transaction(async (tx) => {
      const held = await tx
        .update(unitT)
        .set({ pendingSaleId: sale.id })
        .where(and(eq(unitT.id, sale.unitId), isNull(unitT.pendingSaleId), eq(unitT.priceCents, String(sale.priceCents))))
        .returning({ id: unitT.id });
      if (!held.length) return null;
      await tx.insert(saleT).values({ ...sale, priceCents: String(sale.priceCents) });
      return sale;
    });
  }

  async finishSale(id: string) {
    await this.db.transaction(async (tx) => {
      const [s] = await tx.update(saleT).set({ status: 'paid' }).where(and(eq(saleT.id, id), eq(saleT.status, 'pending'))).returning();
      if (!s) return;
      await tx
        .update(unitT)
        .set({ ownerAccountId: s.buyerAccountId, priceCents: null, rentCentsPerDay: null, pendingSaleId: null })
        .where(and(eq(unitT.id, s.unitId), eq(unitT.pendingSaleId, id)));
    });
  }

  async failSale(id: string) {
    await this.db.transaction(async (tx) => {
      const [s] = await tx.update(saleT).set({ status: 'failed' }).where(and(eq(saleT.id, id), eq(saleT.status, 'pending'))).returning();
      if (!s) return;
      await tx.update(unitT).set({ pendingSaleId: null }).where(and(eq(unitT.id, s.unitId), eq(unitT.pendingSaleId, id)));
    });
  }

  async pendingSales(olderThan: Date) {
    const rows = await this.db.select().from(saleT).where(and(eq(saleT.status, 'pending'), lt(saleT.createdAt, olderThan))).limit(100);
    return rows.map(toSale);
  }

  async beginLease(lease: UnitLease, now: Date) {
    return this.db.transaction(async (tx) => {
      // A unidade travada: dois aluguéis ao mesmo tempo não passam juntos.
      await tx.select({ id: unitT.id }).from(unitT).where(eq(unitT.id, lease.unitId)).for('update');
      const current = await tx
        .select()
        .from(leaseT)
        .where(and(eq(leaseT.unitId, lease.unitId), ne(leaseT.status, 'failed'), gt(leaseT.endsAt, now)))
        .orderBy(desc(leaseT.endsAt));
      if (current.some((l) => l.avatarId !== lease.avatarId || l.status === 'pending')) {
        throw new AppError('unit_rented', 'A unidade está alugada para outro morador.', 409);
      }
      const from = current[0]?.endsAt ?? lease.startsAt;
      const next = { ...lease, startsAt: from, endsAt: new Date(from.getTime() + (lease.endsAt.getTime() - lease.startsAt.getTime())) };
      await tx.insert(leaseT).values({ ...next, centsPerDay: String(next.centsPerDay) });
      return next;
    });
  }

  async finishLease(id: string) {
    await this.db.update(leaseT).set({ status: 'paid' }).where(and(eq(leaseT.id, id), eq(leaseT.status, 'pending')));
  }

  async failLease(id: string) {
    await this.db.update(leaseT).set({ status: 'failed' }).where(and(eq(leaseT.id, id), eq(leaseT.status, 'pending')));
  }

  async pendingLeases(olderThan: Date) {
    const rows = await this.db.select().from(leaseT).where(and(eq(leaseT.status, 'pending'), lt(leaseT.createdAt, olderThan))).limit(100);
    return rows.map(toLease);
  }

  async activeLeasesOf(accountId: string, now: Date) {
    const rows = await this.db
      .select()
      .from(leaseT)
      .where(and(eq(leaseT.tenantAccountId, accountId), eq(leaseT.status, 'paid'), lte(leaseT.startsAt, now), gt(leaseT.endsAt, now)));
    return rows.map(toLease);
  }

  async activeLeaseOfUnit(unitId: string, now: Date) {
    const [r] = await this.db
      .select()
      .from(leaseT)
      .where(and(eq(leaseT.unitId, unitId), eq(leaseT.status, 'paid'), gt(leaseT.endsAt, now)))
      .orderBy(desc(leaseT.endsAt))
      .limit(1);
    return r ? toLease(r) : null;
  }
}
