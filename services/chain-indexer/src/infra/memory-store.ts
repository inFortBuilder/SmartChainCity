import {
  type AvatarToken,
  type BoxRequest,
  type ChainEvent,
  type Cursor,
  type LotToken,
  type MarketListing,
  type ProjectionOp,
  type PropertyToken,
  byChainOrder,
  projectionOps,
} from '../domain/events.js';
import type { Deposit } from '../domain/deposits.js';
import type { IndexerStore } from '../domain/indexer.js';

interface ChainState {
  cursor: Cursor | null;
  events: (ChainEvent & { id: number })[];
  keys: Set<string>;
  lots: Map<string, LotToken>;
  avatars: Map<string, AvatarToken>;
  boxes: Map<string, BoxRequest>;
  properties: Map<string, PropertyToken>;
  deposits: Map<string, Deposit>;
  listings: Map<string, MarketListing>;
}

/** Para testes e desenvolvimento. Uma thread só: cada operação é atômica. */
export class MemoryIndexerStore implements IndexerStore {
  private readonly chains = new Map<number, ChainState>();
  private nextId = 1;

  private state(chainId: number): ChainState {
    let s = this.chains.get(chainId);
    if (!s) {
      s = { cursor: null, events: [], keys: new Set(), lots: new Map(), avatars: new Map(), boxes: new Map(), properties: new Map(), deposits: new Map(), listings: new Map() };
      this.chains.set(chainId, s);
    }
    return s;
  }

  private apply(s: ChainState, op: ProjectionOp) {
    switch (op.kind) {
      case 'lot':
        s.lots.set(op.value.tokenId, { ...op.value });
        break;
      case 'avatar_owner': {
        const cur = s.avatars.get(op.tokenId);
        s.avatars.set(op.tokenId, { tokenId: op.tokenId, owner: op.owner, rarity: cur?.rarity ?? null, profession: cur?.profession ?? null, block: op.block });
        break;
      }
      case 'avatar_traits': {
        const cur = s.avatars.get(op.tokenId);
        s.avatars.set(op.tokenId, { tokenId: op.tokenId, owner: cur?.owner ?? op.owner, rarity: op.rarity, profession: op.profession, block: op.block });
        break;
      }
      case 'property_owner': {
        const cur = s.properties.get(op.tokenId);
        s.properties.set(op.tokenId, {
          tokenId: op.tokenId,
          owner: op.owner,
          lotId: cur?.lotId ?? null,
          typeCode: cur?.typeCode ?? null,
          level: cur?.level ?? null,
          block: op.block,
        });
        break;
      }
      case 'property_traits': {
        const cur = s.properties.get(op.tokenId);
        s.properties.set(op.tokenId, {
          tokenId: op.tokenId,
          owner: cur?.owner ?? op.owner,
          lotId: op.lotId,
          typeCode: op.typeCode,
          level: op.level,
          block: op.block,
        });
        break;
      }
      case 'property_level': {
        const cur = s.properties.get(op.tokenId);
        if (cur) s.properties.set(op.tokenId, { ...cur, level: op.level, block: op.block });
        break;
      }
      case 'deposit': {
        const k = `${op.txHash}:${op.logIndex}`;
        if (!s.deposits.has(k)) {
          s.deposits.set(k, {
            txHash: op.txHash,
            logIndex: op.logIndex,
            account: op.account,
            amountWei: op.amountWei,
            block: op.block,
            status: 'pending',
            accountId: null,
          });
        }
        break;
      }
      case 'box_opened':
        s.boxes.set(op.value.requestId, { ...op.value });
        break;
      case 'listing_created': {
        // A listagem velha de um NFT listado de novo fecha (o contrato faz o mesmo, sem evento).
        for (const l of s.listings.values()) {
          if (l.status !== 'active') continue;
          if (l.items.some((i) => op.value.items.some((n) => n.collection === i.collection && n.tokenId === i.tokenId))) l.status = 'replaced';
        }
        s.listings.set(op.value.listingId, { ...op.value, items: op.value.items.map((i) => ({ ...i })) });
        break;
      }
      case 'listing_closed': {
        const l = s.listings.get(op.listingId);
        if (l) Object.assign(l, { status: op.status, buyer: op.buyer, block: op.block });
        break;
      }
      case 'box_revealed': {
        const cur = s.boxes.get(op.requestId);
        s.boxes.set(op.requestId, {
          requestId: op.requestId,
          buyer: cur?.buyer ?? op.buyer,
          tierId: cur?.tierId ?? 0,
          status: 'revealed',
          tokenId: op.tokenId,
          block: op.block,
        });
        break;
      }
    }
  }

  async cursor(chainId: number) {
    const c = this.state(chainId).cursor;
    return c ? { ...c } : null;
  }

  async commit(chainId: number, events: ChainEvent[], cursor: Cursor) {
    const s = this.state(chainId);
    let inserted = 0;
    for (const e of [...events].sort(byChainOrder)) {
      const key = `${e.txHash}:${e.logIndex}`;
      if (s.keys.has(key)) continue;
      s.keys.add(key);
      s.events.push({ ...e, id: this.nextId++ });
      for (const op of projectionOps(e)) this.apply(s, op);
      inserted++;
    }
    s.cursor = { ...cursor };
    return inserted;
  }

  async rewind(chainId: number, cursor: Cursor | null) {
    const s = this.state(chainId);
    const keep = s.events.filter((e) => cursor !== null && e.blockNumber <= cursor.block);
    const dropped = s.events.length - keep.length;
    s.events = keep;
    s.keys = new Set(keep.map((e) => `${e.txHash}:${e.logIndex}`));
    s.lots.clear();
    s.avatars.clear();
    s.boxes.clear();
    s.properties.clear();
    s.deposits.clear();
    s.listings.clear();
    for (const e of [...keep].sort(byChainOrder)) for (const op of projectionOps(e)) this.apply(s, op);
    s.cursor = cursor ? { ...cursor } : null;
    return dropped;
  }

  async lot(chainId: number, tokenId: string) {
    const l = this.state(chainId).lots.get(tokenId);
    return l ? { ...l } : null;
  }

  async lotsOf(chainId: number, owner: string) {
    return [...this.state(chainId).lots.values()].filter((l) => l.owner === owner.toLowerCase()).map((l) => ({ ...l }));
  }

  async avatar(chainId: number, tokenId: string) {
    const a = this.state(chainId).avatars.get(tokenId);
    return a ? { ...a } : null;
  }

  async avatarsOf(chainId: number, owner: string) {
    return [...this.state(chainId).avatars.values()].filter((a) => a.owner === owner.toLowerCase()).map((a) => ({ ...a }));
  }

  async property(chainId: number, tokenId: string) {
    const p = this.state(chainId).properties.get(tokenId);
    return p ? { ...p } : null;
  }

  async propertiesOf(chainId: number, owner: string) {
    return [...this.state(chainId).properties.values()].filter((p) => p.owner === owner.toLowerCase()).map((p) => ({ ...p }));
  }

  async pendingDeposits(chainId: number, limit: number) {
    return [...this.state(chainId).deposits.values()]
      .filter((d) => d.status === 'pending')
      .sort((x, y) => (x.block === y.block ? x.logIndex - y.logIndex : x.block < y.block ? -1 : 1))
      .slice(0, limit)
      .map((d) => ({ ...d }));
  }

  async markDepositCredited(chainId: number, txHash: string, logIndex: number, accountId: string) {
    const d = this.state(chainId).deposits.get(`${txHash}:${logIndex}`);
    if (d) Object.assign(d, { status: 'credited', accountId });
  }

  async depositsOf(chainId: number, account: string) {
    return [...this.state(chainId).deposits.values()].filter((d) => d.account === account.toLowerCase()).map((d) => ({ ...d }));
  }

  async box(chainId: number, requestId: string) {
    const b = this.state(chainId).boxes.get(requestId);
    return b ? { ...b } : null;
  }

  async eventsAfter(chainId: number, afterId: number, limit: number) {
    return this.state(chainId)
      .events.filter((e) => e.id > afterId)
      .slice(0, limit)
      .map((e) => ({ ...e }));
  }

  async activeListings(chainId: number, limit: number) {
    return [...this.state(chainId).listings.values()]
      .filter((l) => l.status === 'active')
      .sort((a, b) => Number(BigInt(b.listingId) - BigInt(a.listingId)))
      .slice(0, limit)
      .map((l) => ({ ...l, items: l.items.map((i) => ({ ...i })) }));
  }

  async listing(chainId: number, listingId: string) {
    const l = this.state(chainId).listings.get(listingId);
    return l ? { ...l, items: l.items.map((i) => ({ ...i })) } : null;
  }
}
