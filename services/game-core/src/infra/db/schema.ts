import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, numeric, pgSchema, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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
    /** Desde quando é desta conta (criação ou compra na blockchain): os mais antigos trabalham. */
    ownedSince: timestamptz('owned_since').notNull(),
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
    /** Internado até este instante (E2.3); null fora do hospital. */
    hospitalUntil: timestamptz('hospital_until'),
    /**
     * Doenças graves (E2.3): quando cai a próxima saúde e quando a saúde gravada
     * chega a 0 só por elas. Calculados ao gravar (drainMarks), para o job da
     * queda e a internação acharem o avatar sem varrer todos.
     */
    healthDrainAt: timestamptz('health_drain_at'),
    healthZeroAt: timestamptz('health_zero_at'),
    /**
     * Doenças leves em curso ou marcadas para o fim do turno (E2.3): a
     * `avatar_condition` do doc 06 §2, guardada no próprio avatar porque é
     * sempre lida e gravada junto com ele. [{code, startsAt, endsAt}]
     */
    conditions: jsonb('conditions').notNull().default([]),
    /** Despensa (E2.3): unidades por alimento, {codigo: unidades}. */
    pantry: jsonb('pantry').notNull().default({}),
    /** Pet do avatar (E3.1), com as datas em ISO; null sem pet. */
    pet: jsonb('pet'),
    /** Escola (E3.2): última aula e troca de profissão em curso, com as datas em ISO. */
    school: jsonb('school'),
    /** Lazer (E3.3): última vez de cada atividade, {lastAt: {codigo: ISO}}. */
    leisure: jsonb('leisure'),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [
    index('avatar_account_idx').on(t.accountId),
    // Só os avatares com doença grave: o job da queda e a internação procuram por aqui.
    index('avatar_health_drain_idx').on(t.healthDrainAt).where(sql`health_drain_at is not null`),
    index('avatar_health_zero_idx').on(t.healthZeroAt).where(sql`health_zero_at is not null`),
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

/**
 * Internação compulsória (E2.3): saúde 0 ou energia 0. A taxa nasce
 * `pending` e vira `paid` quando o ledger cobra, ou `waived` se o jogador
 * não tem THALER.
 */
export const hospitalStay = game.table(
  'hospital_stay',
  {
    id: uuid('id').primaryKey(),
    avatarId: uuid('avatar_id')
      .notNull()
      .references(() => avatar.id),
    accountId: uuid('account_id').notNull(),
    reason: text('reason').notNull(),
    feeCents: numeric('fee_cents', { precision: 38, scale: 0 }).notNull(),
    feeStatus: text('fee_status').notNull(),
    admittedAt: timestamptz('admitted_at').notNull(),
    dischargeAt: timestamptz('discharge_at').notNull(),
  },
  (t) => [
    index('hospital_stay_avatar_idx').on(t.avatarId, t.admittedAt),
    index('hospital_stay_fee_idx').on(t.feeStatus, t.admittedAt),
    check('hospital_stay_reason_check', sql`${t.reason} in ('health', 'energy', 'treatment')`),
    check('hospital_stay_fee_status_check', sql`${t.feeStatus} in ('pending', 'paid', 'waived')`),
    check('hospital_stay_fee_check', sql`${t.feeCents} > 0`),
    check('hospital_stay_period_check', sql`${t.dischargeAt} > ${t.admittedAt}`),
  ],
);

/**
 * Antifraude (E2.9): sinais por conta, aparelho e rede, só em HMAC (sem IP nem id
 * puro). Uma linha por combinação, com a primeira e a última vez.
 */
export const riskSignal = game.table(
  'risk_signal',
  {
    accountId: uuid('account_id').notNull(),
    device: text('device').notNull().default(''),
    network: text('network').notNull(),
    firstSeen: timestamptz('first_seen').notNull(),
    lastSeen: timestamptz('last_seen').notNull(),
  },
  (t) => [
    uniqueIndex('risk_signal_key_idx').on(t.accountId, t.device, t.network),
    index('risk_signal_device_idx').on(t.device, t.lastSeen),
    index('risk_signal_network_idx').on(t.network, t.lastSeen),
  ],
);

/** Decisão manual da revisão: libera ou bloqueia a conta, acima das regras. */
export const riskDecision = game.table(
  'risk_decision',
  {
    accountId: uuid('account_id').primaryKey(),
    decision: text('decision').notNull(),
    note: text('note'),
    at: timestamptz('at').notNull(),
  },
  (t) => [check('risk_decision_check', sql`${t.decision} in ('allow', 'block')`)],
);

/** Até onde o job chain.sync leu o feed do chain-indexer. */
export const chainCursor = game.table('chain_cursor', {
  name: text('name').primaryKey(),
  after: integer('after').notNull(),
});

/**
 * AvatarNFT numa carteira sem conta: uma linha por token, aplicada quando a
 * carteira for ligada. `rarity` e `job_code` só no mint ainda não aplicado.
 */
export const chainAvatarPending = game.table('chain_avatar_pending', {
  tokenId: text('token_id').primaryKey(),
  eventId: integer('event_id').notNull(),
  toAddress: text('to_address').notNull(),
  rarity: smallint('rarity'),
  jobCode: text('job_code'),
});
