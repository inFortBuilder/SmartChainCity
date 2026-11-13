import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  index,
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
