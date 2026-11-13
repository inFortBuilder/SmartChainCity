import { randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';
import { and, asc, eq, lt, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import {
  type City,
  type Lot,
  type LotStatus,
  type Purchase,
  type PurchaseStatus,
  RESERVATION_MS,
  type WorldStore,
  type Zone,
  checkPurchase,
  isAvailable,
  nextOpenCount,
} from '../../domain/lots.js';
import { city as cityT, lot as lotT, purchase as purchaseT } from './schema.js';

type Db = ReturnType<typeof drizzle>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const toLot = (r: typeof lotT.$inferSelect): Lot => ({ ...r, status: r.status as LotStatus });
const toCity = (r: typeof cityT.$inferSelect): City => ({ ...r, zones: r.zones as Zone[] });
const toPurchase = (r: typeof purchaseT.$inferSelect): Purchase => ({
  ...r,
  priceWei: BigInt(r.priceWei),
  status: r.status as PurchaseStatus,
});

const notFound = () => new AppError('not_found', 'Lote não encontrado.', 404);

/** Contagem por bairro, a partir da tabela de lotes. */
async function districtCounts(db: Db | Tx, code: string) {
  const rows = await db.execute<{ order: number; lots: string; sold: string; for_sale: string; area: number }>(sql`
    select district as "order", count(*)::text as lots,
      count(*) filter (where status = 'sold')::text as sold,
      count(*) filter (where status <> 'civic')::text as for_sale,
      sum(area_m2) as area
    from world.lot where city = ${code} group by district order by district`);
  return rows.rows.map((r) => ({
    order: Number(r.order),
    lots: Number(r.lots),
    sold: Number(r.sold),
    forSale: Number(r.for_sale),
    areaM2: Number(r.area),
  }));
}

export class PostgresWorldStore implements WorldStore {
  private readonly db: Db;

  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  async importCity(c: City, lots: Pick<Lot, 'id' | 'district' | 'zone' | 'areaM2' | 'status'>[]) {
    await this.db.transaction(async (tx) => {
      await tx
        .insert(cityT)
        .values(c)
        .onConflictDoUpdate({
          target: cityT.code,
          set: { name: c.name, zones: c.zones, districtCount: c.districtCount, releaseThreshold: c.releaseThreshold },
        });
      // Lotes em lotes de 2.000; vendidos não são tocados.
      for (let k = 0; k < lots.length; k += 2000) {
        const chunk = lots.slice(k, k + 2000).map((l) => ({ city: c.code, ...l }));
        await tx
          .insert(lotT)
          .values(chunk)
          .onConflictDoUpdate({
            target: [lotT.city, lotT.id],
            set: {
              district: sql`excluded.district`,
              zone: sql`excluded.zone`,
              areaM2: sql`excluded.area_m2`,
              status: sql`case when ${lotT.status} in ('sold', 'reserved') then ${lotT.status} else excluded.status end`,
            },
          });
      }
    });
  }

  async getCity(code: string) {
    const [r] = await this.db.select().from(cityT).where(eq(cityT.code, code));
    return r ? toCity(r) : null;
  }

  districts(code: string) {
    return districtCounts(this.db, code);
  }

  async lotsOfDistrict(code: string, district: number) {
    const rows = await this.db
      .select()
      .from(lotT)
      .where(and(eq(lotT.city, code), eq(lotT.district, district)))
      .orderBy(asc(lotT.id));
    return rows.map(toLot);
  }

  async getLot(code: string, id: number) {
    const [r] = await this.db.select().from(lotT).where(and(eq(lotT.city, code), eq(lotT.id, id)));
    return r ? toLot(r) : null;
  }

  async lotsOf(accountId: string) {
    const rows = await this.db.select().from(lotT).where(eq(lotT.ownerAccountId, accountId)).orderBy(asc(lotT.id));
    return rows.map(toLot);
  }

  async reserve(
    code: string,
    lotId: number,
    accountId: string,
    now: Date,
    price: (lot: Lot, city: City) => { priceWei: bigint; priceUsd: number },
  ) {
    return this.db.transaction(async (tx) => {
      // Trava por comprador: as regras de "um bairro" e "teto de área" olham os
      // outros lotes dele, e duas compras paralelas do mesmo jogador não podem
      // passar juntas pelo teto.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'world-buyer:' + accountId}))`);
      const [cityRow] = await tx.select().from(cityT).where(eq(cityT.code, code));
      const [row] = await tx
        .select()
        .from(lotT)
        .where(and(eq(lotT.city, code), eq(lotT.id, lotId)))
        .for('update');
      if (!cityRow || !row) throw notFound();
      const lot = toLot(row);
      if (lot.status === 'reserved' && lot.reservedBy === accountId && !isAvailable(lot, now) && lot.reservationId) {
        const [p] = await tx.select().from(purchaseT).where(eq(purchaseT.id, lot.reservationId));
        if (p) return toPurchase(p);
      }
      const owned = (await tx.select().from(lotT).where(and(eq(lotT.city, code), eq(lotT.ownerAccountId, accountId)))).map(toLot);
      const [{ area }] = (
        await tx.execute<{ area: number }>(
          sql`select coalesce(sum(area_m2), 0) as area from world.lot where city = ${code} and district = ${lot.district}`,
        )
      ).rows as [{ area: number }];
      const c = toCity(cityRow);
      checkPurchase(lot, c, { accountId, owned, districtArea: Number(area) }, now);

      const { priceWei, priceUsd } = price(lot, c);
      const p: Purchase = { id: randomUUID(), city: code, lotId, accountId, priceWei, priceUsd, status: 'pending', createdAt: now };
      await tx.insert(purchaseT).values({ ...p, priceWei: priceWei.toString() });
      await tx
        .update(lotT)
        .set({
          status: 'reserved',
          reservedBy: accountId,
          reservedUntil: new Date(now.getTime() + RESERVATION_MS),
          reservationId: p.id,
        })
        .where(and(eq(lotT.city, code), eq(lotT.id, lotId)));
      return p;
    });
  }

  async confirm(purchaseId: string, now: Date) {
    return this.db.transaction(async (tx) => {
      const [pRow] = await tx.select().from(purchaseT).where(eq(purchaseT.id, purchaseId)).for('update');
      if (!pRow) return false;
      const p = toPurchase(pRow);
      if (p.status === 'paid') return true;
      const [row] = await tx
        .select()
        .from(lotT)
        .where(and(eq(lotT.city, p.city), eq(lotT.id, p.lotId)))
        .for('update');
      const lot = toLot(row!);
      const holds = lot.status === 'reserved' && lot.reservationId === p.id;
      if (!holds && !isAvailable(lot, now)) return false;
      await tx
        .update(lotT)
        .set({ status: 'sold', ownerAccountId: p.accountId, soldAt: now, reservedBy: null, reservedUntil: null, reservationId: null })
        .where(and(eq(lotT.city, p.city), eq(lotT.id, p.lotId)));
      await tx.update(purchaseT).set({ status: 'paid' }).where(eq(purchaseT.id, p.id));

      // Liberação por bairro: a venda pode abrir o próximo.
      const [cityRow] = await tx.select().from(cityT).where(eq(cityT.code, p.city)).for('update');
      const c = toCity(cityRow!);
      const counts = await districtCounts(tx, p.city);
      const open = nextOpenCount(c, (n) => {
        const inOpen = counts.filter((d) => d.order < n);
        return { sold: inOpen.reduce((s, d) => s + d.sold, 0), forSale: inOpen.reduce((s, d) => s + d.forSale, 0) };
      });
      if (open !== c.openCount) await tx.update(cityT).set({ openCount: open }).where(eq(cityT.code, p.city));
      return true;
    });
  }

  async fail(purchaseId: string, status: 'failed' | 'refunded') {
    await this.db.transaction(async (tx) => {
      const [pRow] = await tx.select().from(purchaseT).where(eq(purchaseT.id, purchaseId)).for('update');
      if (!pRow || pRow.status === 'paid') return;
      await tx.update(purchaseT).set({ status }).where(eq(purchaseT.id, purchaseId));
      await tx
        .update(lotT)
        .set({ status: 'vacant', reservedBy: null, reservedUntil: null, reservationId: null })
        .where(and(eq(lotT.reservationId, purchaseId), eq(lotT.status, 'reserved')));
    });
  }

  async stalePending(before: Date, limit: number) {
    const rows = await this.db
      .select()
      .from(purchaseT)
      .where(and(eq(purchaseT.status, 'pending'), lt(purchaseT.createdAt, before)))
      .orderBy(asc(purchaseT.createdAt))
      .limit(limit);
    return rows.map(toPurchase);
  }
}
