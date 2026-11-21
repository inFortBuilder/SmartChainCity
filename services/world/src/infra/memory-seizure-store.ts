import type { Seizure, SeizureKind, SeizureStatus, SeizureStore } from '../domain/seizures.js';

/** Para testes e desenvolvimento. */
export class MemorySeizureStore implements SeizureStore {
  private readonly rows = new Map<string, Seizure>();

  async openSeizure(s: Seizure) {
    for (const [id, r] of this.rows) {
      if (r.kind === s.kind && r.tokenId === s.tokenId && r.status === 'open') this.rows.set(id, { ...r, status: 'cancelled', closedAt: s.createdAt });
    }
    this.rows.set(s.id, { ...s });
    return { ...s };
  }

  async get(id: string) {
    const r = this.rows.get(id);
    return r ? { ...r } : null;
  }

  async openFor(kind: SeizureKind, tokenId: string) {
    const r = [...this.rows.values()].find((x) => x.kind === kind && x.tokenId === tokenId && x.status === 'open');
    return r ? { ...r } : null;
  }

  async openOf(accountId: string) {
    return [...this.rows.values()]
      .filter((r) => r.toAccountId === accountId && r.status === 'open')
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((r) => ({ ...r }));
  }

  async close(id: string, status: Exclude<SeizureStatus, 'open'>, now: Date) {
    const r = this.rows.get(id);
    if (!r || r.status !== 'open') return false;
    this.rows.set(id, { ...r, status, closedAt: now });
    return true;
  }
}
