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
    polygon: jsonb('polygon'),
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

/** Impostos dos lotes (E2.6): uma conta por lote, tipo e período. */
export const taxBill = world.table(
  'tax_bill',
  {
    id: uuid('id').primaryKey(),
    city: text('city').notNull(),
    lotId: integer('lot_id').notNull(),
    accountId: uuid('account_id').notNull(),
    kind: text('kind').notNull(),
    period: integer('period').notNull(),
    amountCents: numeric('amount_cents', { precision: 20, scale: 0 }).notNull(),
    fineCents: numeric('fine_cents', { precision: 20, scale: 0 }).notNull(),
    dueAt: timestamptz('due_at').notNull(),
    status: text('status').notNull(),
    paidAt: timestamptz('paid_at'),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('tax_bill_period_idx').on(t.city, t.lotId, t.kind, t.period),
    index('tax_bill_account_idx').on(t.accountId, t.dueAt),
    index('tax_bill_pending_idx').on(t.status, t.dueAt),
    check('tax_bill_kind_check', sql`${t.kind} in ('iptu', 'pt')`),
    check('tax_bill_status_check', sql`${t.status} in ('pending', 'paid')`),
  ],
);

/** Prédios de construtores (doc 13 §4, E2.10): validados contra o lote, à espera do alvará. */
export const building = world.table(
  'building',
  {
    id: uuid('id').primaryKey(),
    city: text('city').notNull(),
    lotId: integer('lot_id').notNull(),
    ownerAccountId: uuid('owner_account_id').notNull(),
    jobId: text('job_id').notNull(),
    modelId: text('model_id').notNull(),
    modelVersion: integer('model_version').notNull(),
    rotationDeg: real('rotation_deg').notNull(),
    position: jsonb('position').notNull(),
    heightM: real('height_m').notNull(),
    footprintM2: integer('footprint_m2').notNull(),
    floors: integer('floors').notNull(),
    gfaM2: integer('gfa_m2').notNull(),
    outorgaWei: numeric('outorga_wei', { precision: 78, scale: 0 }).notNull(),
    checks: jsonb('checks').notNull(),
    artifacts: jsonb('artifacts').notNull(),
    modelSha256: text('model_sha256'),
    status: text('status').notNull(),
    reviewNote: text('review_note'),
    createdAt: timestamptz('created_at').notNull(),
    reviewedAt: timestamptz('reviewed_at'),
  },
  (t) => [
    // Um prédio vigente por lote; os recusados ficam no histórico.
    uniqueIndex('building_lot_active_idx').on(t.city, t.lotId).where(sql`status <> 'rejected'`),
    index('building_owner_idx').on(t.ownerAccountId),
    index('building_status_idx').on(t.status, t.createdAt),
    check('building_status_check', sql`${t.status} in ('pending_payment', 'pending_review', 'approved', 'rejected')`),
  ],
);
