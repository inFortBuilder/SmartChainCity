import { AppError } from '@scc/shared';
import { and, asc, eq, lt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import type {
  ClaimStatus,
  Property,
  PropertyClaim,
  PropertyStatus,
  PropertyStore,
  PropertyWork,
  WorkKind,
  WorkStatus,
} from '../../domain/properties.js';
import { property as propertyT, propertyClaim as claimT, propertyWork as workT } from './schema.js';

const toWork = (r: typeof workT.$inferSelect): PropertyWork => ({
  ...r,
  kind: r.kind as WorkKind,
  status: r.status as WorkStatus,
  costCents: Number(r.costCents),
});

type Db = ReturnType<typeof drizzle>;

const toProperty = (r: typeof propertyT.$inferSelect): Property => ({
  ...r,
  status: r.status as PropertyStatus,
  priceCents: Number(r.priceCents),
});
const toClaim = (r: typeof claimT.$inferSelect): PropertyClaim => ({
  ...r,
  status: r.status as ClaimStatus,
  amountCents: Number(r.amountCents),
});

const isUniqueViolation = (error: unknown) => {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
};

export class PostgresPropertyStore implements PropertyStore {
  private readonly db: Db;

  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  async createProperty(p: Property) {
    try {
      await this.db.insert(propertyT).values({ ...p, priceCents: String(p.priceCents) });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError('lot_has_property', 'Este lote já tem um imóvel.', 409);
      throw error;
    }
  }

  async getProperty(id: string) {
    const [r] = await this.db.select().from(propertyT).where(eq(propertyT.id, id));
    return r ? toProperty(r) : null;
  }

  async propertyOnLot(city: string, lotId: number) {
    const [r] = await this.db
      .select()
      .from(propertyT)
      .where(and(eq(propertyT.city, city), eq(propertyT.lotId, lotId)));
    return r ? toProperty(r) : null;
  }

  async propertiesOf(accountId: string) {
    const rows = await this.db
      .select()
      .from(propertyT)
      .where(eq(propertyT.ownerAccountId, accountId))
      .orderBy(asc(propertyT.createdAt));
    return rows.map(toProperty);
  }

  async transferProperty(id: string, from: string, to: string) {
    await this.db
      .update(propertyT)
      .set({ ownerAccountId: to })
      .where(and(eq(propertyT.id, id), eq(propertyT.ownerAccountId, from)));
  }

  async activateProperty(id: string) {
    await this.db.update(propertyT).set({ status: 'active' }).where(eq(propertyT.id, id));
  }

  async dropPendingProperty(id: string) {
    await this.db.delete(propertyT).where(and(eq(propertyT.id, id), eq(propertyT.status, 'pending')));
  }

  async pendingProperties(olderThan: Date) {
    const rows = await this.db
      .select()
      .from(propertyT)
      .where(and(eq(propertyT.status, 'pending'), lt(propertyT.createdAt, olderThan)))
      .limit(100);
    return rows.map(toProperty);
  }

  async startClaim(claim: PropertyClaim, expected: Date, until: Date) {
    return this.db.transaction(async (tx) => {
      // Só fecha o período se ninguém coletou desde a leitura.
      const moved = await tx
        .update(propertyT)
        .set({ lastClaimAt: until })
        .where(and(eq(propertyT.id, claim.propertyId), eq(propertyT.lastClaimAt, expected)))
        .returning({ id: propertyT.id });
      if (moved.length === 0) return null;
      await tx.insert(claimT).values({ ...claim, amountCents: String(claim.amountCents) });
      return claim;
    });
  }

  async markClaimPaid(id: string) {
    await this.db.update(claimT).set({ status: 'paid' }).where(eq(claimT.id, id));
  }

  async pendingClaims(olderThan: Date) {
    const rows = await this.db
      .select()
      .from(claimT)
      .where(and(eq(claimT.status, 'pending'), lt(claimT.createdAt, olderThan)))
      .limit(100);
    return rows.map(toClaim);
  }

  async createWork(w: PropertyWork) {
    try {
      await this.db.insert(workT).values({ ...w, costCents: String(w.costCents) });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError('work_in_progress', 'Este imóvel já tem uma obra em andamento.', 409);
      }
      throw error;
    }
  }

  async applyWork(workId: string, apply: (p: Property) => { property: Property; claim: PropertyClaim | null }) {
    return this.db.transaction(async (tx) => {
      const [w] = await tx.select().from(workT).where(eq(workT.id, workId)).for('update');
      if (!w || w.status !== 'pending') return null;
      const [row] = await tx.select().from(propertyT).where(eq(propertyT.id, w.propertyId)).for('update');
      if (!row) return null;
      const result = apply(toProperty(row));
      const next = result.property;
      await tx
        .update(propertyT)
        .set({ level: next.level, wearBase: next.wearBase, wearSince: next.wearSince, lastClaimAt: next.lastClaimAt })
        .where(eq(propertyT.id, next.id));
      if (result.claim) {
        await tx.insert(claimT).values({ ...result.claim, amountCents: String(result.claim.amountCents) });
      }
      await tx.update(workT).set({ status: 'applied' }).where(eq(workT.id, workId));
      return result;
    });
  }

  async failWork(id: string) {
    await this.db
      .update(workT)
      .set({ status: 'failed' })
      .where(and(eq(workT.id, id), eq(workT.status, 'pending')));
  }

  async pendingWorks(olderThan: Date) {
    const rows = await this.db
      .select()
      .from(workT)
      .where(and(eq(workT.status, 'pending'), lt(workT.createdAt, olderThan)))
      .limit(100);
    return rows.map(toWork);
  }
}
