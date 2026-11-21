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

export interface BoxRequest {
  requestId: string;
  buyer: string;
  tierId: number;
  status: 'opened' | 'revealed';
  tokenId: string | null;
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
  | { kind: 'deposit'; txHash: string; logIndex: number; account: string; amountWei: string; block: bigint }
  | { kind: 'box_opened'; value: BoxRequest }
  | { kind: 'box_revealed'; requestId: string; buyer: string; tokenId: string; block: bigint };

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
  // LotSold fica só no registro de eventos: a posse vem do Transfer. Withdrawn vai pelo feed para o economy.
  return [];
}

export const byChainOrder = (x: ChainEvent, y: ChainEvent) =>
  x.blockNumber === y.blockNumber ? x.logIndex - y.logIndex : x.blockNumber < y.blockNumber ? -1 : 1;
