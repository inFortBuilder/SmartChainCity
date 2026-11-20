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
  uniqueIndex,
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

/** Imóveis sobre os lotes (doc 03 §6, E2.5). Um por lote, por enquanto. */
export const property = world.table(
  'property',
  {
    id: uuid('id').primaryKey(),
    city: text('city').notNull(),
    lotId: integer('lot_id').notNull(),
    ownerAccountId: uuid('owner_account_id').notNull(),
    type: text('type').notNull(),
    level: smallint('level').notNull(),
    status: text('status').notNull(),
    priceCents: numeric('price_cents', { precision: 20, scale: 0 }).notNull(),
    createdAt: timestamptz('created_at').notNull(),
    readyAt: timestamptz('ready_at').notNull(),
    wearBase: real('wear_base').notNull(),
    wearSince: timestamptz('wear_since').notNull(),
    lastClaimAt: timestamptz('last_claim_at').notNull(),
  },
  (t) => [
    uniqueIndex('property_lot_idx').on(t.city, t.lotId),
    index('property_owner_idx').on(t.ownerAccountId),
    index('property_pending_idx').on(t.status, t.createdAt),
    check('property_status_check', sql`${t.status} in ('pending', 'active')`),
  ],
);

/** Cada coleta de renda: fecha o período e é paga pelo ledger com a chave da coleta. */
export const propertyClaim = world.table(
  'property_claim',
  {
    id: uuid('id').primaryKey(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => property.id),
    accountId: uuid('account_id').notNull(),
    amountCents: numeric('amount_cents', { precision: 20, scale: 0 }).notNull(),
    status: text('status').notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [
    index('property_claim_pending_idx').on(t.status, t.createdAt),
    check('property_claim_status_check', sql`${t.status} in ('pending', 'paid')`),
  ],
);

/** Reparo e upgrade: cobrados antes e aplicados com o imóvel travado. Um pendente por imóvel. */
export const propertyWork = world.table(
  'property_work',
  {
    id: uuid('id').primaryKey(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => property.id),
    accountId: uuid('account_id').notNull(),
    kind: text('kind').notNull(),
    costCents: numeric('cost_cents', { precision: 20, scale: 0 }).notNull(),
    toLevel: smallint('to_level'),
    status: text('status').notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('property_work_one_pending_idx').on(t.propertyId).where(sql`status = 'pending'`),
    index('property_work_pending_idx').on(t.status, t.createdAt),
    check('property_work_kind_check', sql`${t.kind} in ('repair', 'upgrade')`),
    check('property_work_status_check', sql`${t.status} in ('pending', 'applied', 'failed')`),
  ],
);
