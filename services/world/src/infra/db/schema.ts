import { sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Esquema próprio `world`. A geometria dos lotes fica nos arquivos estáticos
 * por bairro (o mapa já baixa); aqui fica o que muda e o que decide a venda:
 * zona, área, bairro, situação e dono (ADR-0012, doc 06 §2).
 */
export const world = pgSchema('world');

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const city = world.table('city', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  zones: jsonb('zones').notNull(),
  openCount: integer('open_count').notNull(),
  districtCount: integer('district_count').notNull(),
  releaseThreshold: real('release_threshold').notNull(),
});

export const lot = world.table(
  'lot',
  {
    city: text('city')
      .notNull()
      .references(() => city.code),
    id: integer('id').notNull(),
    district: smallint('district').notNull(),
    zone: text('zone').notNull(),
    areaM2: doublePrecision('area_m2').notNull(),
    status: text('status').notNull(),
    ownerAccountId: uuid('owner_account_id'),
    reservedBy: uuid('reserved_by'),
    reservedUntil: timestamptz('reserved_until'),
    reservationId: uuid('reservation_id'),
    soldAt: timestamptz('sold_at'),
  },
  (t) => [
    primaryKey({ columns: [t.city, t.id] }),
    index('lot_district_idx').on(t.city, t.district),
    index('lot_owner_idx').on(t.ownerAccountId),
    check('lot_status_check', sql`${t.status} in ('vacant', 'reserved', 'sold', 'civic')`),
    // Lote vendido sempre tem dono; nenhum outro tem.
    check('lot_owner_check', sql`(${t.status} = 'sold') = (${t.ownerAccountId} is not null)`),
  ],
);

export const purchase = world.table(
  'purchase',
  {
    id: uuid('id').primaryKey(),
    city: text('city').notNull(),
    lotId: integer('lot_id').notNull(),
    accountId: uuid('account_id').notNull(),
    priceWei: numeric('price_wei', { precision: 78, scale: 0 }).notNull(),
    priceUsd: doublePrecision('price_usd').notNull(),
    status: text('status').notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [
    index('purchase_pending_idx').on(t.status, t.createdAt),
    check('purchase_status_check', sql`${t.status} in ('pending', 'paid', 'failed', 'refunded')`),
  ],
);
