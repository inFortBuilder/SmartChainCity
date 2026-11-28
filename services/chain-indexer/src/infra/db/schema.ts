import { bigint, bigserial, boolean, index, integer, jsonb, pgSchema, primaryKey, smallint, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Esquema próprio `indexer`: os eventos lidos da rede (cada um uma vez, por
 * `tx_hash + log_index`), o cursor por rede e as projeções de posse que saem
 * dos eventos. As projeções podem ser refeitas a partir dos eventos a qualquer hora.
 */
export const indexer = pgSchema('indexer');

const block = (name: string) => bigint(name, { mode: 'bigint' });

export const cursor = indexer.table('cursor', {
  chainId: integer('chain_id').primaryKey(),
  block: block('block').notNull(),
  hash: text('hash').notNull(),
});

export const chainEvent = indexer.table(
  'chain_event',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    chainId: integer('chain_id').notNull(),
    blockNumber: block('block_number').notNull(),
    blockHash: text('block_hash').notNull(),
    txHash: text('tx_hash').notNull(),
    logIndex: integer('log_index').notNull(),
    contract: text('contract').notNull(),
    event: text('event').notNull(),
    args: jsonb('args').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('chain_event_log_idx').on(t.chainId, t.txHash, t.logIndex),
    index('chain_event_block_idx').on(t.chainId, t.blockNumber, t.logIndex),
  ],
);

export const lotToken = indexer.table(
  'lot_token',
  {
    chainId: integer('chain_id').notNull(),
    tokenId: text('token_id').notNull(),
    city: integer('city').notNull(),
    lot: integer('lot').notNull(),
    owner: text('owner').notNull(),
    block: block('block').notNull(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.tokenId] }), index('lot_token_owner_idx').on(t.chainId, t.owner)],
);

export const avatarToken = indexer.table(
  'avatar_token',
  {
    chainId: integer('chain_id').notNull(),
    tokenId: text('token_id').notNull(),
    owner: text('owner').notNull(),
    rarity: smallint('rarity'),
    profession: text('profession'),
    block: block('block').notNull(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.tokenId] }), index('avatar_token_owner_idx').on(t.chainId, t.owner)],
);

export const propertyToken = indexer.table(
  'property_token',
  {
    chainId: integer('chain_id').notNull(),
    tokenId: text('token_id').notNull(),
    owner: text('owner').notNull(),
    lotId: text('lot_id'),
    typeCode: text('type_code'),
    level: smallint('level'),
    block: block('block').notNull(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.tokenId] }), index('property_token_owner_idx').on(t.chainId, t.owner)],
);

/** Prédios de construtor (BuildingNFT): dono, lote, construtor, modelo e andares; a demolição marca. */
export const buildingToken = indexer.table(
  'building_token',
  {
    chainId: integer('chain_id').notNull(),
    tokenId: text('token_id').notNull(),
    owner: text('owner').notNull(),
    lotId: text('lot_id'),
    developer: text('developer'),
    modelHash: text('model_hash'),
    floors: smallint('floors'),
    demolished: boolean('demolished').notNull().default(false),
    block: block('block').notNull(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.tokenId] }), index('building_token_owner_idx').on(t.chainId, t.owner)],
);

/** Unidades dos prédios (UnitNFT + UnitMarket): dono, dados da unidade, oferta de aluguel e o aluguel em curso. */
export const unitToken = indexer.table(
  'unit_token',
  {
    chainId: integer('chain_id').notNull(),
    tokenId: text('token_id').notNull(),
    owner: text('owner').notNull(),
    buildingId: text('building_id'),
    unitKey: text('unit_key'),
    developer: text('developer'),
    floor: smallint('floor'),
    areaM2x100: integer('area_m2x100'),
    code: text('code'),
    rentPerDayWei: text('rent_per_day_wei'),
    rentOwner: text('rent_owner'),
    tenant: text('tenant'),
    leaseEndsAt: bigint('lease_ends_at', { mode: 'number' }),
    block: block('block').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.tokenId] }),
    index('unit_token_owner_idx').on(t.chainId, t.owner),
    index('unit_token_building_idx').on(t.chainId, t.buildingId),
  ],
);

/** Depósitos do GameVault: `pending` até o crédito no ledger (chave `chain:<rede>:<tx>:<log>`). */
export const deposit = indexer.table(
  'deposit',
  {
    chainId: integer('chain_id').notNull(),
    txHash: text('tx_hash').notNull(),
    logIndex: integer('log_index').notNull(),
    account: text('account').notNull(),
    amountWei: text('amount_wei').notNull(),
    block: block('block').notNull(),
    status: text('status').notNull(),
    accountId: text('account_id'),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.txHash, t.logIndex] }),
    index('deposit_pending_idx').on(t.chainId, t.status, t.block),
    index('deposit_account_idx').on(t.chainId, t.account),
  ],
);

export const boxRequest = indexer.table(
  'box_request',
  {
    chainId: integer('chain_id').notNull(),
    requestId: text('request_id').notNull(),
    buyer: text('buyer').notNull(),
    tierId: integer('tier_id').notNull(),
    status: text('status').notNull(),
    tokenId: text('token_id'),
    block: block('block').notNull(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.requestId] })],
);

/** Listagens do Marketplace (E3.6). `items`: [{collection, tokenId}]. */
export const marketListing = indexer.table(
  'market_listing',
  {
    chainId: integer('chain_id').notNull(),
    listingId: text('listing_id').notNull(),
    seller: text('seller').notNull(),
    priceWei: text('price_wei').notNull(),
    expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
    items: jsonb('items').notNull(),
    status: text('status').notNull(),
    buyer: text('buyer'),
    block: block('block').notNull(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.listingId] }), index('market_listing_status_idx').on(t.chainId, t.status)],
);

/** Leilões do Marketplace (E3.6). */
export const marketAuction = indexer.table(
  'market_auction',
  {
    chainId: integer('chain_id').notNull(),
    auctionId: text('auction_id').notNull(),
    seller: text('seller').notNull(),
    startPriceWei: text('start_price_wei').notNull(),
    endsAt: bigint('ends_at', { mode: 'number' }).notNull(),
    items: jsonb('items').notNull(),
    status: text('status').notNull(),
    highestBidWei: text('highest_bid_wei'),
    highestBidder: text('highest_bidder'),
    bids: integer('bids').notNull(),
    winner: text('winner'),
    block: block('block').notNull(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.auctionId] }), index('market_auction_status_idx').on(t.chainId, t.status)],
);
