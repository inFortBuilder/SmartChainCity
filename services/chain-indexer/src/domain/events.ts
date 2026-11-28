import { type Hex, hexToString, parseAbi } from 'viem';

/**
 * Eventos que o indexer lê (doc 07 §4), dos contratos que já existem em
 * contracts/src. O depósito do GameVault vira saldo no ledger (deposits.ts).
 */
export const CONTRACT_ABIS = {
  LandNFT: parseAbi([
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
    'event LotSold(uint256 indexed tokenId, uint32 city, uint32 lot, address indexed buyer, address currency, uint256 price, uint256 indexed nonce)',
  ]),
  AvatarNFT: parseAbi([
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
    'event AvatarMinted(uint256 indexed tokenId, address indexed to, uint8 rarity, bytes32 profession)',
  ]),
  PropertyNFT: parseAbi([
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
    'event PropertyMinted(uint256 indexed tokenId, uint256 indexed lotId, address indexed owner, bytes32 typeCode, uint16 level)',
    'event PropertyUpgraded(uint256 indexed tokenId, uint16 level)',
  ]),
  GameVault: parseAbi([
    'event Deposited(address indexed account, uint256 amount)',
    'event Withdrawn(address indexed to, uint256 amount, uint256 indexed nonce)',
    'event VoucherCancelled(address indexed to, uint256 indexed nonce)',
  ]),
  Marketplace: parseAbi([
    'event Listed(uint256 indexed listingId, address indexed seller, uint256 price, uint64 expiresAt, address[] collections, uint256[] tokenIds)',
    'event Sold(uint256 indexed listingId, address indexed seller, address indexed buyer, uint256 price, uint256 fee, uint256 royalty)',
    'event Cancelled(uint256 indexed listingId)',
    'event AuctionCreated(uint256 indexed auctionId, address indexed seller, uint256 startPrice, uint64 endsAt, address[] collections, uint256[] tokenIds)',
    'event BidPlaced(uint256 indexed auctionId, address indexed bidder, uint256 amount, uint64 endsAt)',
    'event AuctionSettled(uint256 indexed auctionId, address indexed seller, address indexed winner, uint256 price, uint256 fee, uint256 royalty)',
    'event AuctionCancelled(uint256 indexed auctionId)',
  ]),
  BuildingNFT: parseAbi([
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
    'event BuildingMinted(uint256 indexed tokenId, uint256 indexed lotId, address indexed developer, bytes32 modelHash, uint16 floors)',
    'event BuildingDemolished(uint256 indexed tokenId, uint256 indexed lotId)',
  ]),
  UnitNFT: parseAbi([
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
    'event UnitMinted(uint256 indexed tokenId, uint256 indexed buildingId, uint256 indexed unitKey, address to, address developer, uint16 floor, uint32 areaM2x100, bytes16 code)',
  ]),
  UnitMarket: parseAbi([
    'event PrimarySold(uint256 indexed tokenId, uint256 indexed buildingId, address indexed buyer, address developer, uint256 price, uint256 fee)',
    'event RentOffered(uint256 indexed tokenId, address indexed owner, uint256 pricePerDay)',
    'event Rented(uint256 indexed tokenId, address indexed tenant, address indexed owner, uint64 endsAt, uint256 paid, uint256 fee)',
  ]),
  LuckyBox: parseAbi([
    'event BoxOpened(uint256 indexed requestId, address indexed buyer, uint32 indexed tierId)',
    'event AvatarRevealed(uint256 indexed requestId, address indexed buyer, uint256 tokenId, uint8 rarity, bytes32 profession)',
  ]),
} as const;

export type ContractName = keyof typeof CONTRACT_ABIS;

/** Valores dos argumentos em texto (bigint vira string decimal; endereço em minúsculas). */
export type EventArgs = Record<string, string | number | boolean>;

export interface ChainEvent {
  chainId: number;
  blockNumber: bigint;
  blockHash: Hex;
  txHash: Hex;
  logIndex: number;
  contract: ContractName;
  event: string;
  args: EventArgs;
}

/** Bloco já processado: o hash detecta reorganização. */
export interface Cursor {
  block: bigint;
  hash: Hex;
}

/** Normaliza os argumentos decodificados pelo viem para guardar em JSON. */
export function normalizeArgs(args: Record<string, unknown>): EventArgs {
  const out: EventArgs = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === 'bigint') out[k] = v.toString();
    // Listas (coleções e tokens de uma listagem): texto separado por vírgula.
    else if (Array.isArray(v)) out[k] = v.map((x) => (typeof x === 'bigint' ? x.toString() : String(x).toLowerCase())).join(',');
    else if (typeof v === 'string') out[k] = /^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else out[k] = String(v);
  }
  return out;
}

/** `bytes32` de profissão ("padeiro") ou de tipo de imóvel ("t1"), com zeros à direita → texto. */
export const professionText = (b: string) => hexToString(b as Hex, { size: 32 }).replace(/\0+$/, '');

/** O `tokenId` do LandNFT é cidade << 32 | lote. */
export const lotOfToken = (tokenId: bigint) => ({ city: Number(tokenId >> 32n), lot: Number(tokenId & 0xffffffffn) });

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// ---------------------------------------------------------------- projeções

/** Posse espelhada de um lote. */
export interface LotToken {
  tokenId: string;
  city: number;
  lot: number;
  owner: string;
  block: bigint;
}

export interface AvatarToken {
  tokenId: string;
  owner: string;
  rarity: number | null;
  profession: string | null;
  block: bigint;
}

/** Imóvel (PropertyNFT): o dono vem do Transfer; lote, tipo e nível, do mint e do upgrade. */
export interface PropertyToken {
  tokenId: string;
  owner: string;
  /** `tokenId` do lote âncora no LandNFT. */
  lotId: string | null;
  typeCode: string | null;
  level: number | null;
  block: bigint;
}

/** Prédio de construtor (BuildingNFT): o dono vem do Transfer; lote, modelo e andares, do mint. */
export interface BuildingToken {
  tokenId: string;
  owner: string;
  /** `tokenId` do lote no LandNFT. */
  lotId: string | null;
  developer: string | null;
  modelHash: string | null;
  floors: number | null;
  demolished: boolean;
  block: bigint;
}

/** Unidade de prédio (UnitNFT + UnitMarket): dono, dados da unidade, oferta de aluguel e o aluguel em curso. */
export interface UnitToken {
  tokenId: string;
  owner: string;
  buildingId: string | null;
  unitKey: string | null;
  developer: string | null;
  floor: number | null;
  areaM2x100: number | null;
  code: string | null;
  /** Oferta de aluguel: vale só enquanto `rentOwner` for o dono (o contrato faz o mesmo). */
  rentPerDayWei: string | null;
  rentOwner: string | null;
  tenant: string | null;
  /** Unix, em segundos. */
  leaseEndsAt: number | null;
  block: bigint;
}

/** `bytes16` do código da unidade ("0302") → texto. */
export const unitCodeText = (b: string) => hexToString(b as Hex, { size: 16 }).replace(/\0+$/, '');

export interface BoxRequest {
  requestId: string;
  buyer: string;
  tierId: number;
  status: 'opened' | 'revealed';
  tokenId: string | null;
  block: bigint;
}

/** Listagem do Marketplace (E3.6): um NFT ou um combo, por um preço em SCITY. */
export interface MarketListing {
  listingId: string;
  seller: string;
  priceWei: string;
  /** Unix, em segundos. */
  expiresAt: number;
  /** Endereço da coleção (minúsculas) e token. */
  items: { collection: string; tokenId: string }[];
  /** `replaced`: o NFT foi listado de novo por quem o tem agora (o contrato fecha a velha sem evento). */
  status: 'active' | 'sold' | 'cancelled' | 'replaced';
  buyer: string | null;
  block: bigint;
}

/** Leilão do Marketplace: os NFTs ficam no contrato até o fim; lances em SCITY. */
export interface MarketAuction {
  auctionId: string;
  seller: string;
  startPriceWei: string;
  /** Unix, em segundos (o lance no fim estica). */
  endsAt: number;
  items: { collection: string; tokenId: string }[];
  /** `settled` com `winner` nulo: terminou sem lance e os NFTs voltaram ao vendedor. */
  status: 'active' | 'settled' | 'cancelled';
  highestBidWei: string | null;
  highestBidder: string | null;
  bids: number;
  winner: string | null;
  block: bigint;
}

/**
 * O que um evento muda nas projeções. Os dois stores aplicam a mesma lista, na
 * ordem (bloco, log), então memória e Postgres chegam ao mesmo estado.
 */
export type ProjectionOp =
  | { kind: 'lot'; value: LotToken }
  | { kind: 'avatar_owner'; tokenId: string; owner: string; block: bigint }
  | { kind: 'avatar_traits'; tokenId: string; owner: string; rarity: number; profession: string; block: bigint }
  | { kind: 'property_owner'; tokenId: string; owner: string; block: bigint }
  | { kind: 'property_traits'; tokenId: string; owner: string; lotId: string; typeCode: string; level: number; block: bigint }
  | { kind: 'property_level'; tokenId: string; level: number; block: bigint }
  | { kind: 'building_owner'; tokenId: string; owner: string; block: bigint }
  | { kind: 'building_traits'; tokenId: string; owner: string; lotId: string; developer: string; modelHash: string; floors: number; block: bigint }
  | { kind: 'building_demolished'; tokenId: string; block: bigint }
  | { kind: 'unit_owner'; tokenId: string; owner: string; block: bigint }
  | {
      kind: 'unit_traits';
      tokenId: string;
      owner: string;
      buildingId: string;
      unitKey: string;
      developer: string;
      floor: number;
      areaM2x100: number;
      code: string;
      block: bigint;
    }
  | { kind: 'unit_rent_offer'; tokenId: string; owner: string; pricePerDayWei: string; block: bigint }
  | { kind: 'unit_lease'; tokenId: string; tenant: string; endsAt: number; block: bigint }
  | { kind: 'deposit'; txHash: string; logIndex: number; account: string; amountWei: string; block: bigint }
  | { kind: 'box_opened'; value: BoxRequest }
  | { kind: 'box_revealed'; requestId: string; buyer: string; tokenId: string; block: bigint }
  | { kind: 'listing_created'; value: MarketListing }
  | { kind: 'listing_closed'; listingId: string; status: 'sold' | 'cancelled'; buyer: string | null; block: bigint }
  | { kind: 'auction_created'; value: MarketAuction }
  | { kind: 'auction_bid'; auctionId: string; bidder: string; amountWei: string; endsAt: number; block: bigint }
  | { kind: 'auction_closed'; auctionId: string; status: 'settled' | 'cancelled'; winner: string | null; block: bigint };

export function projectionOps(e: ChainEvent): ProjectionOp[] {
  const a = e.args;
  if (e.contract === 'LandNFT' && e.event === 'Transfer') {
    const tokenId = BigInt(a.tokenId as string);
    return [{ kind: 'lot', value: { tokenId: tokenId.toString(), ...lotOfToken(tokenId), owner: a.to as string, block: e.blockNumber } }];
  }
  if (e.contract === 'AvatarNFT' && e.event === 'Transfer') {
    return [{ kind: 'avatar_owner', tokenId: a.tokenId as string, owner: a.to as string, block: e.blockNumber }];
  }
  if (e.contract === 'AvatarNFT' && e.event === 'AvatarMinted') {
    return [
      {
        kind: 'avatar_traits',
        tokenId: a.tokenId as string,
        owner: a.to as string,
        rarity: Number(a.rarity),
        profession: professionText(a.profession as string),
        block: e.blockNumber,
      },
    ];
  }
  if (e.contract === 'PropertyNFT' && e.event === 'Transfer') {
    return [{ kind: 'property_owner', tokenId: a.tokenId as string, owner: a.to as string, block: e.blockNumber }];
  }
  if (e.contract === 'PropertyNFT' && e.event === 'PropertyMinted') {
    return [
      {
        kind: 'property_traits',
        tokenId: a.tokenId as string,
        owner: a.owner as string,
        lotId: a.lotId as string,
        typeCode: professionText(a.typeCode as string),
        level: Number(a.level),
        block: e.blockNumber,
      },
    ];
  }
  if (e.contract === 'PropertyNFT' && e.event === 'PropertyUpgraded') {
    return [{ kind: 'property_level', tokenId: a.tokenId as string, level: Number(a.level), block: e.blockNumber }];
  }
  if (e.contract === 'BuildingNFT' && e.event === 'Transfer') {
    // A demolição queima (Transfer para o endereço zero): o BuildingDemolished marca.
    if (a.to === ZERO_ADDRESS) return [];
    return [{ kind: 'building_owner', tokenId: a.tokenId as string, owner: a.to as string, block: e.blockNumber }];
  }
  if (e.contract === 'BuildingNFT' && e.event === 'BuildingMinted') {
    return [
      {
        kind: 'building_traits',
        tokenId: a.tokenId as string,
        owner: a.developer as string,
        lotId: a.lotId as string,
        developer: a.developer as string,
        modelHash: a.modelHash as string,
        floors: Number(a.floors),
        block: e.blockNumber,
      },
    ];
  }
  if (e.contract === 'BuildingNFT' && e.event === 'BuildingDemolished') {
    return [{ kind: 'building_demolished', tokenId: a.tokenId as string, block: e.blockNumber }];
  }
  if (e.contract === 'UnitNFT' && e.event === 'Transfer') {
    return [{ kind: 'unit_owner', tokenId: a.tokenId as string, owner: a.to as string, block: e.blockNumber }];
  }
  if (e.contract === 'UnitNFT' && e.event === 'UnitMinted') {
    return [
      {
        kind: 'unit_traits',
        tokenId: a.tokenId as string,
        owner: a.to as string,
        buildingId: a.buildingId as string,
        unitKey: a.unitKey as string,
        developer: a.developer as string,
        floor: Number(a.floor),
        areaM2x100: Number(a.areaM2x100),
        code: unitCodeText(a.code as string),
        block: e.blockNumber,
      },
    ];
  }
  if (e.contract === 'UnitMarket' && e.event === 'RentOffered') {
    return [{ kind: 'unit_rent_offer', tokenId: a.tokenId as string, owner: a.owner as string, pricePerDayWei: a.pricePerDay as string, block: e.blockNumber }];
  }
  if (e.contract === 'UnitMarket' && e.event === 'Rented') {
    return [{ kind: 'unit_lease', tokenId: a.tokenId as string, tenant: a.tenant as string, endsAt: Number(a.endsAt), block: e.blockNumber }];
  }
  if (e.contract === 'GameVault' && e.event === 'Deposited') {
    return [{ kind: 'deposit', txHash: e.txHash, logIndex: e.logIndex, account: a.account as string, amountWei: a.amount as string, block: e.blockNumber }];
  }
  if (e.contract === 'LuckyBox' && e.event === 'BoxOpened') {
    return [
      {
        kind: 'box_opened',
        value: {
          requestId: a.requestId as string,
          buyer: a.buyer as string,
          tierId: Number(a.tierId),
          status: 'opened',
          tokenId: null,
          block: e.blockNumber,
        },
      },
    ];
  }
  if (e.contract === 'LuckyBox' && e.event === 'AvatarRevealed') {
    return [{ kind: 'box_revealed', requestId: a.requestId as string, buyer: a.buyer as string, tokenId: a.tokenId as string, block: e.blockNumber }];
  }
  if (e.contract === 'Marketplace' && e.event === 'Listed') {
    const collections = String(a.collections).split(',');
    const tokenIds = String(a.tokenIds).split(',');
    return [
      {
        kind: 'listing_created',
        value: {
          listingId: a.listingId as string,
          seller: a.seller as string,
          priceWei: a.price as string,
          expiresAt: Number(a.expiresAt),
          items: collections.map((collection, i) => ({ collection, tokenId: tokenIds[i]! })),
          status: 'active',
          buyer: null,
          block: e.blockNumber,
        },
      },
    ];
  }
  if (e.contract === 'Marketplace' && e.event === 'Sold') {
    return [{ kind: 'listing_closed', listingId: a.listingId as string, status: 'sold', buyer: a.buyer as string, block: e.blockNumber }];
  }
  if (e.contract === 'Marketplace' && e.event === 'Cancelled') {
    return [{ kind: 'listing_closed', listingId: a.listingId as string, status: 'cancelled', buyer: null, block: e.blockNumber }];
  }
  if (e.contract === 'Marketplace' && e.event === 'AuctionCreated') {
    const collections = String(a.collections).split(',');
    const tokenIds = String(a.tokenIds).split(',');
    return [
      {
        kind: 'auction_created',
        value: {
          auctionId: a.auctionId as string,
          seller: a.seller as string,
          startPriceWei: a.startPrice as string,
          endsAt: Number(a.endsAt),
          items: collections.map((collection, i) => ({ collection, tokenId: tokenIds[i]! })),
          status: 'active',
          highestBidWei: null,
          highestBidder: null,
          bids: 0,
          winner: null,
          block: e.blockNumber,
        },
      },
    ];
  }
  if (e.contract === 'Marketplace' && e.event === 'BidPlaced') {
    return [
      { kind: 'auction_bid', auctionId: a.auctionId as string, bidder: a.bidder as string, amountWei: a.amount as string, endsAt: Number(a.endsAt), block: e.blockNumber },
    ];
  }
  if (e.contract === 'Marketplace' && e.event === 'AuctionSettled') {
    const winner = a.winner === ZERO_ADDRESS ? null : (a.winner as string);
    return [{ kind: 'auction_closed', auctionId: a.auctionId as string, status: 'settled', winner, block: e.blockNumber }];
  }
  if (e.contract === 'Marketplace' && e.event === 'AuctionCancelled') {
    return [{ kind: 'auction_closed', auctionId: a.auctionId as string, status: 'cancelled', winner: null, block: e.blockNumber }];
  }
  // PrimarySold fica só no registro de eventos: a posse da unidade vem do Transfer do UnitNFT.
  // LotSold fica só no registro de eventos: a posse vem do Transfer. Withdrawn e VoucherCancelled vão pelo feed para o economy.
  return [];
}

export const byChainOrder = (x: ChainEvent, y: ChainEvent) =>
  x.blockNumber === y.blockNumber ? x.logIndex - y.logIndex : x.blockNumber < y.blockNumber ? -1 : 1;
