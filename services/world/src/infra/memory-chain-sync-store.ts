import type { ChainSyncStore, PendingTransfer } from '../domain/chain-sync.js';

/** Para testes e desenvolvimento. */
export class MemoryChainSyncStore implements ChainSyncStore {
  private after = 0;
  private readonly rows = new Map<number, PendingTransfer>();

  async cursor() {
    return this.after;
  }

  async setCursor(after: number) {
    this.after = after;
  }

  async addPending(t: PendingTransfer) {
    this.rows.set(t.eventId, { ...t });
  }

  async pending(limit: number) {
    return [...this.rows.values()].sort((a, b) => a.eventId - b.eventId).slice(0, limit).map((t) => ({ ...t }));
  }

  async dropPending(eventId: number) {
    this.rows.delete(eventId);
  }

  async dropPendingFor(kind: PendingTransfer['kind'], tokenId: string) {
    for (const [id, t] of this.rows) if (t.kind === kind && t.tokenId === tokenId) this.rows.delete(id);
  }
}
