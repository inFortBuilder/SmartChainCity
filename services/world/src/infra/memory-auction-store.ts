import type { Auction, AuctionStatus, AuctionStore, Bid } from '../domain/auctions.js';

const active = (a: Auction) => a.status === 'open' || a.status === 'charged';
const copy = (a: Auction): Auction => ({ ...a, billIds: [...a.billIds] });

/** Para testes e desenvolvimento. Uma thread só: cada operação é atômica. */
export class MemoryAuctionStore implements AuctionStore {
  private readonly auctions = new Map<string, Auction>();
  private readonly bids: Bid[] = [];

  async openAuction(a: Auction) {
    for (const x of this.auctions.values()) if (x.city === a.city && x.lotId === a.lotId && active(x)) return false;
    this.auctions.set(a.id, copy(a));
    return true;
  }

  async getAuction(id: string) {
    const a = this.auctions.get(id);
    return a ? copy(a) : null;
  }

  async activeOnLot(city: string, lotId: number) {
    const a = [...this.auctions.values()].find((x) => x.city === city && x.lotId === lotId && active(x));
    return a ? copy(a) : null;
  }

  async listOpen(limit: number) {
    return [...this.auctions.values()]
      .filter((a) => a.status === 'open')
      .sort((x, y) => x.endsAt.getTime() - y.endsAt.getTime())
      .slice(0, limit)
      .map(copy);
  }

  async due(now: Date) {
    return [...this.auctions.values()]
      .filter((a) => (a.status === 'open' && a.endsAt.getTime() <= now.getTime()) || a.status === 'charged')
      .map(copy);
  }

  async bidsOf(auctionId: string) {
    return this.bids
      .filter((b) => b.auctionId === auctionId)
      .sort((x, y) => y.amountCents - x.amountCents || x.createdAt.getTime() - y.createdAt.getTime())
      .map((b) => ({ ...b }));
  }

  async placeBid(bid: Bid, check: (a: Auction, top: Bid | null) => Date) {
    const a = this.auctions.get(bid.auctionId)!;
    const [top] = await this.bidsOf(a.id);
    const endsAt = check(copy(a), top ?? null);
    this.bids.push({ ...bid });
    a.endsAt = endsAt;
    return copy(a);
  }

  async transition(id: string, from: AuctionStatus, patch: Partial<Pick<Auction, 'status' | 'winnerAccountId' | 'priceCents' | 'closedAt'>>) {
    const a = this.auctions.get(id);
    if (!a || a.status !== from) return false;
    Object.assign(a, patch);
    return true;
  }
}
