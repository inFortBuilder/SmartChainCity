import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, jsonb, numeric, pgSchema, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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
    /** Habilitação (E3.5): {readyAt}, o fim da autoescola. */
    license: jsonb('license'),
    /** Moradia paga: {kind, level, since, until, mealsDay?, mealsUsed?}; null sem estadia. */
    housing: jsonb('housing'),
    /** Descanso em curso: {startsAt, endsAt, energy}; null acordado. */
    rest: jsonb('rest'),
    /** Higiene em casa: {codigo: ISO} da última vez. */
    chores: jsonb('chores'),
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

/**
 * Campeonato mensal de futebol de botão (E3.3): um por mês (`id` = AAAA-MM), com a semente do sorteio
 * (o hash publicado na criação) e o resultado depois da disputa.
 */
export const championship = game.table(
  'championship',
  {
    id: text('id').primaryKey(),
    seed: text('seed').notNull(),
    seedCommit: text('seed_commit').notNull(),
    status: text('status').notNull(),
    endsAt: timestamptz('ends_at').notNull(),
    settledAt: timestamptz('settled_at'),
    result: jsonb('result'),
  },
  (t) => [
    index('championship_due_idx').on(t.status, t.endsAt),
    check('championship_status_check', sql`${t.status} in ('open', 'settled')`),
  ],
);

export const championshipTeam = game.table(
  'championship_team',
  {
    id: uuid('id').primaryKey(),
    championshipId: text('championship_id')
      .notNull()
      .references(() => championship.id),
    name: text('name').notNull(),
    captainAccountId: uuid('captain_account_id').notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [uniqueIndex('championship_team_name_unique').on(t.championshipId, sql`lower(${t.name})`)],
);

/** Jogador inscrito: um time por conta em cada campeonato. */
export const championshipMember = game.table(
  'championship_member',
  {
    championshipId: text('championship_id')
      .notNull()
      .references(() => championship.id),
    teamId: uuid('team_id')
      .notNull()
      .references(() => championshipTeam.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id').notNull(),
    avatarId: uuid('avatar_id').notNull(),
    feeCents: numeric('fee_cents', { precision: 38, scale: 0 }).notNull(),
    status: text('status').notNull(),
    joinedAt: timestamptz('joined_at').notNull(),
  },
  (t) => [
    uniqueIndex('championship_member_account_unique').on(t.championshipId, t.accountId),
    index('championship_member_team_idx').on(t.teamId),
    index('championship_member_pending_idx').on(t.status, t.joinedAt),
    check('championship_member_status_check', sql`${t.status} in ('pending', 'paid')`),
  ],
);

/**
 * Veículos (E3.5): carro comprado ou alugado na agência do jogo. Só no jogo por enquanto (o VehicleNFT do
 * doc 07 é opcional na fase 2).
 */
export const vehicle = game.table(
  'vehicle',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id').notNull(),
    model: text('model').notNull(),
    kind: text('kind').notNull(),
    paidCents: numeric('paid_cents', { precision: 38, scale: 0 }).notNull(),
    boughtAt: timestamptz('bought_at').notNull(),
    rentalUntil: timestamptz('rental_until'),
    ipvaPaidUntil: timestamptz('ipva_paid_until'),
    status: text('status').notNull(),
    soldAt: timestamptz('sold_at'),
    /** Pane da corrida (E3.5) e a oficina: leve, moderado ou grave; o conserto termina em repair_until. */
    breakdown: text('breakdown'),
    brokenAt: timestamptz('broken_at'),
    repairUntil: timestamptz('repair_until'),
    revisionUntil: timestamptz('revision_until'),
  },
  (t) => [
    index('vehicle_account_idx').on(t.accountId, t.boughtAt),
    index('vehicle_pending_idx').on(t.status, t.boughtAt),
    check('vehicle_kind_check', sql`${t.kind} in ('owned', 'rental')`),
    check('vehicle_status_check', sql`${t.status} in ('pending', 'active', 'sold')`),
  ],
);

/** Corridas diárias (E3.5): o resultado sai da semente, gravada junto. */
export const vehicleRace = game.table(
  'vehicle_race',
  {
    id: uuid('id').primaryKey(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicle.id),
    avatarId: uuid('avatar_id').notNull(),
    accountId: uuid('account_id').notNull(),
    day: text('day').notNull(),
    seed: text('seed').notNull(),
    result: jsonb('result').notNull(),
    fuelCents: numeric('fuel_cents', { precision: 38, scale: 0 }).notNull(),
    status: text('status').notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [
    index('vehicle_race_avatar_day_idx').on(t.avatarId, t.day),
    index('vehicle_race_account_idx').on(t.accountId, t.createdAt),
    index('vehicle_race_stuck_idx').on(t.status, t.createdAt),
    check('vehicle_race_status_check', sql`${t.status} in ('pending', 'charged', 'done', 'failed')`),
  ],
);

/** GamePass (E3.10): o nível da conta em cada temporada. */
export const gamePass = game.table(
  'game_pass',
  {
    accountId: uuid('account_id').notNull(),
    season: text('season').notNull(),
    level: smallint('level').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('game_pass_account_season_unique').on(t.accountId, t.season),
    // O teto é o PASS_LEVEL_CAP de events.ts: a temporada no Strapi escolhe o nível máximo até 10.
    check('game_pass_level_check', sql`${t.level} between 1 and 10`),
  ],
);

/**
 * Fazenda (E3.4): um slot por conta, com o nível, as colheitas, as máquinas e os 4 canteiros (jsonb).
 * `version` é a trava otimista das gravações.
 */
export const farm = game.table(
  'farm',
  {
    accountId: uuid('account_id').primaryKey(),
    level: smallint('level').notNull(),
    harvestsAtLevel: integer('harvests_at_level').notNull(),
    harvestsTotal: integer('harvests_total').notNull(),
    state: jsonb('state').notNull(),
    boughtAt: timestamptz('bought_at').notNull(),
    version: integer('version').notNull(),
  },
  (t) => [check('farm_level_check', sql`${t.level} between 1 and 3`)],
);

/** Pet Sitter (E3.1): a oferta do avatar com a profissão (preço da diária e se atende). */
export const petSitterOffer = game.table('pet_sitter_offer', {
  avatarId: uuid('avatar_id').primaryKey(),
  accountId: uuid('account_id').notNull(),
  priceCents: bigint('price_cents', { mode: 'bigint' }).notNull(),
  open: boolean('open').notNull(),
  updatedAt: timestamptz('updated_at').notNull(),
});

/** Cada estadia de pet com um Pet Sitter: a vaga é reservada antes da cobrança e cancelada se ela falhar. */
export const petSitting = game.table(
  'pet_sitting',
  {
    id: uuid('id').primaryKey(),
    sitterAvatarId: uuid('sitter_avatar_id').notNull(),
    sitterAccountId: uuid('sitter_account_id').notNull(),
    ownerAvatarId: uuid('owner_avatar_id').notNull(),
    ownerAccountId: uuid('owner_account_id').notNull(),
    priceCents: bigint('price_cents', { mode: 'bigint' }).notNull(),
    startsAt: timestamptz('starts_at').notNull(),
    endsAt: timestamptz('ends_at').notNull(),
    status: text('status').notNull(),
  },
  (t) => [
    index('pet_sitting_sitter_idx').on(t.sitterAvatarId, t.endsAt),
    index('pet_sitting_owner_idx').on(t.ownerAvatarId, t.startsAt),
    check('pet_sitting_status_check', sql`${t.status} in ('reserved', 'active', 'cancelled')`),
  ],
);
