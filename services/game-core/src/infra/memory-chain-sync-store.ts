import type { ChainSyncStore, PendingAvatar } from '../domain/chain-sync.js';

const copy = (p: PendingAvatar): PendingAvatar => ({ ...p, mint: p.mint && { ...p.mint } });

/** Para testes e desenvolvimento. */
export class MemoryChainSyncStore implements ChainSyncStore {
  private after = 0;
  private readonly rows = new Map<string, PendingAvatar>();

  async cursor() {
    return this.after;
  }

  async setCursor(after: number) {
    this.after = after;
  }

  async putPending(p: PendingAvatar) {
    this.rows.set(p.tokenId, copy(p));
  }

  async getPending(tokenId: string) {
    const p = this.rows.get(tokenId);
    return p ? copy(p) : null;
  }

  async pending(limit: number) {
    return [...this.rows.values()].sort((a, b) => a.eventId - b.eventId).slice(0, limit).map(copy);
  }

  async dropPending(tokenId: string) {
    this.rows.delete(tokenId);
  }
}
