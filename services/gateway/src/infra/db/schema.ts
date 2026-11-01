import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

/** doc 06 §2. `email` is stored lowercase instead of citext, which needs an extension. */
export const account = pgTable(
  'account',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    status: text('status').notNull().default('active'),
    kycLevel: smallint('kyc_level').notNull().default(0),
  },
  (t) => [
    uniqueIndex('account_email_unique').on(t.email),
    check('account_status_check', sql`${t.status} in ('active', 'suspended', 'banned')`),
  ],
);

export const walletLink = pgTable(
  'wallet_link',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id),
    address: text('address').notNull(),
    chainId: integer('chain_id').notNull(),
    verifiedAt: timestamptz('verified_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.address] }),
    uniqueIndex('wallet_link_address_unique').on(t.address),
  ],
);

export const authNonce = pgTable('auth_nonce', {
  nonce: text('nonce').primaryKey(),
  expiresAt: timestamptz('expires_at').notNull(),
});
