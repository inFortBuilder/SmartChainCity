import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Esquema próprio `economy`: o serviço não toca nas tabelas do gateway
 * (`public`) e vice-versa. Modelo do doc 06 §2, com duas adições:
 * `ledger_account.balance` (saldo guardado, conferido pela auditoria) e
 * `ledger_tx.seq` / `request_hash` (cursor do extrato e idempotência).
 */
export const economy = pgSchema('economy');

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
const amount = (name: string) => numeric(name, { precision: 38, scale: 0 });

export const ledgerAccount = economy.table(
  'ledger_account',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerType: text('owner_type').notNull(),
    ownerId: text('owner_id').notNull(),
    currency: text('currency').notNull(),
    balance: amount('balance').notNull().default('0'),
  },
  (t) => [
    unique('ledger_account_owner_unique').on(t.ownerType, t.ownerId, t.currency),
    check('ledger_account_owner_type_check', sql`${t.ownerType} in ('player', 'system', 'pool', 'burn', 'escrow')`),
    check('ledger_account_currency_check', sql`${t.currency} in ('THALER', 'SCITY')`),
    // Última defesa: mesmo com um bug no serviço, só a emissora fica negativa.
    check('ledger_account_balance_check', sql`${t.ownerType} = 'system' or ${t.balance} >= 0`),
  ],
);

export const ledgerTx = economy.table('ledger_tx', {
  id: uuid('id').primaryKey().defaultRandom(),
  seq: bigserial('seq', { mode: 'bigint' }).notNull().unique(),
  kind: text('kind').notNull(),
  refType: text('ref_type'),
  refId: text('ref_id'),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  requestHash: text('request_hash').notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const ledgerEntry = economy.table(
  'ledger_entry',
  {
    txId: uuid('tx_id')
      .notNull()
      .references(() => ledgerTx.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => ledgerAccount.id),
    amount: amount('amount').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.txId, t.accountId] }),
    index('ledger_entry_account_idx').on(t.accountId),
    check('ledger_entry_amount_check', sql`${t.amount} <> 0`),
  ],
);

/**
 * Saques pelo GameVault (E3.7): o voucher assinado e a situação. O nonce é o id
 * (128 bits), então é único sem índice extra.
 */
export const withdrawal = economy.table(
  'withdrawal',
  {
    id: uuid('id').primaryKey(),
    accountId: text('account_id').notNull(),
    wallet: text('wallet').notNull(),
    amountWei: numeric('amount_wei', { precision: 78, scale: 0 }).notNull(),
    nonce: numeric('nonce', { precision: 78, scale: 0 }).notNull().unique(),
    deadline: timestamptz('deadline').notNull(),
    signature: text('signature'),
    status: text('status').notNull(),
    createdAt: timestamptz('created_at').notNull(),
    closedAt: timestamptz('closed_at'),
  },
  (t) => [
    index('withdrawal_account_idx').on(t.accountId, t.createdAt),
    index('withdrawal_open_idx').on(t.status, t.createdAt),
    check('withdrawal_status_check', sql`${t.status} in ('created', 'pending', 'claimed', 'refunded', 'cancelled', 'failed')`),
  ],
);

/** Cotação do câmbio (doc 06 §2): THALER por SCITY em milionésimos, a partir de `valid_from`. */
export const fxRate = economy.table('fx_rate', {
  validFrom: timestamptz('valid_from').primaryKey(),
  thalerPerScityMicro: numeric('thaler_per_scity_micro', { precision: 38, scale: 0 }).notNull(),
  scityUsd: numeric('scity_usd', { precision: 20, scale: 8 }).notNull(),
  source: text('source').notNull(),
});

/** Amostras do tick acumulado do pool da DEX (job fx.twap): o histórico do TWAP quando o pool não guarda 24 h. */
export const fxTickSample = economy.table(
  'fx_tick_sample',
  {
    pool: text('pool').notNull(),
    at: timestamptz('at').notNull(),
    tickCumulative: numeric('tick_cumulative', { precision: 38, scale: 0 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.pool, t.at] })],
);

/** Cada conversão THALER ↔ SCITY: o teto de 24 h e o freio do pool contam daqui. */
export const fxConversion = economy.table(
  'fx_conversion',
  {
    id: uuid('id').primaryKey(),
    accountId: text('account_id').notNull(),
    direction: text('direction').notNull(),
    thalerCents: amount('thaler_cents').notNull(),
    scityWei: numeric('scity_wei', { precision: 78, scale: 0 }).notNull(),
    feeCents: amount('fee_cents').notNull(),
    thalerPerScityMicro: amount('thaler_per_scity_micro').notNull(),
    spreadBps: integer('spread_bps').notNull(),
    status: text('status').notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [
    index('fx_conversion_account_idx').on(t.accountId, t.createdAt),
    check('fx_conversion_direction_check', sql`${t.direction} in ('scity_to_thaler', 'thaler_to_scity')`),
    check('fx_conversion_status_check', sql`${t.status} in ('created', 'done', 'failed')`),
  ],
);

/** Travas de incidente (E4.6): uma linha por trava, com quem mudou, quando e o motivo público. */
export const incidentSwitch = economy.table('incident_switch', {
  name: text('name').primaryKey(),
  frozen: boolean('frozen').notNull(),
  reason: text('reason'),
  changedBy: text('changed_by'),
  since: timestamptz('since'),
});
