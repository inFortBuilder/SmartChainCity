import { sql } from 'drizzle-orm';
import { check, index, numeric, pgSchema, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
