import { sql } from 'drizzle-orm';
import { check, index, jsonb, numeric, pgSchema, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * Esquema próprio `game` (o serviço não toca o banco dos outros). Tabela
 * `avatar` do doc 06 §2, com os instantes de referência da queda de cada
 * atributo (`*_at`) e sem `home_property_id` (imóveis entram com o world).
 */
export const game = pgSchema('game');

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
const attr = (name: string) => smallint(name).notNull();
const range = (column: unknown, max: number) => sql`${column} between 0 and ${sql.raw(String(max))}`;

export const avatar = game.table(
  'avatar',
  {
    id: uuid('id').primaryKey(),
    tokenId: numeric('token_id', { precision: 78, scale: 0 }).unique(),
    accountId: uuid('account_id').notNull(),
    rarity: text('rarity').notNull(),
    jobCode: text('job_code').notNull(),
    energy: attr('energy'),
    health: attr('health'),
    happiness: attr('happiness'),
    food: attr('food'),
    hygiene: attr('hygiene'),
    education: attr('education'),
    foodAt: timestamptz('food_at').notNull(),
    happinessAt: timestamptz('happiness_at').notNull(),
    hygieneAt: timestamptz('hygiene_at').notNull(),
    employmentStatus: text('employment_status').notNull().default('employed'),
    lastWorkedAt: timestamptz('last_worked_at'),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [
    index('avatar_account_idx').on(t.accountId),
    check('avatar_rarity_check', sql`${t.rarity} in ('common', 'rare', 'epic', 'legendary')`),
    check('avatar_energy_check', range(t.energy, 10)),
    check('avatar_health_check', range(t.health, 10)),
    check('avatar_happiness_check', range(t.happiness, 10)),
    check('avatar_food_check', range(t.food, 10)),
    check('avatar_hygiene_check', range(t.hygiene, 10)),
    check('avatar_education_check', range(t.education, 100)),
  ],
);

/**
 * Turno de trabalho (doc 06 §2 `work_shift`). A semente fica em `seed` e só
 * sai na API depois que o turno acaba; até lá, só o `seed_commit` (sha256).
 */
export const workShift = game.table(
  'work_shift',
  {
    id: uuid('id').primaryKey(),
    avatarId: uuid('avatar_id')
      .notNull()
      .references(() => avatar.id),
    accountId: uuid('account_id').notNull(),
    jobCode: text('job_code').notNull(),
    shiftHours: smallint('shift_hours').notNull(),
    startsAt: timestamptz('starts_at').notNull(),
    endsAt: timestamptz('ends_at').notNull(),
    seedCommit: text('seed_commit').notNull(),
    seed: text('seed').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    result: jsonb('result'),
    thalerEarned: numeric('thaler_earned', { precision: 38, scale: 0 }),
    status: text('status').notNull(),
  },
  (t) => [
    index('work_shift_avatar_idx').on(t.avatarId, t.startsAt),
    index('work_shift_due_idx').on(t.status, t.endsAt),
    check('work_shift_hours_check', sql`${t.shiftHours} in (6, 12)`),
    check('work_shift_status_check', sql`${t.status} in ('running', 'done', 'claimed')`),
  ],
);

/**
 * Refeição no mercado do jogo (E2.3). Nasce `pending`, antes da cobrança no
 * ledger; vira `eaten` com os efeitos aplicados ao avatar, ou `failed` se o
 * ledger recusar. A chave do cliente (Idempotency-Key) é única por conta.
 */
export const meal = game.table(
  'meal',
  {
    id: uuid('id').primaryKey(),
    avatarId: uuid('avatar_id')
      .notNull()
      .references(() => avatar.id),
    accountId: uuid('account_id').notNull(),
    foodCode: text('food_code').notNull(),
    priceCents: numeric('price_cents', { precision: 38, scale: 0 }).notNull(),
    effects: jsonb('effects').notNull(),
    status: text('status').notNull(),
    clientKey: text('client_key'),
    createdAt: timestamptz('created_at').notNull(),
    eatenAt: timestamptz('eaten_at'),
  },
  (t) => [
    index('meal_avatar_idx').on(t.avatarId, t.createdAt),
    uniqueIndex('meal_client_key_unique').on(t.accountId, t.clientKey),
    check('meal_status_check', sql`${t.status} in ('pending', 'eaten', 'failed')`),
    check('meal_price_check', sql`${t.priceCents} > 0`),
  ],
);
