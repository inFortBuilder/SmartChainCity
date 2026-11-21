import { AppError } from '@scc/shared';

import type { Property, PropertyClaim, PropertyStore, PropertyWork } from '../domain/properties.js';

/** Para testes e desenvolvimento. Uma thread só: cada operação é atômica. */
export class MemoryPropertyStore implements PropertyStore {
  private readonly properties = new Map<string, Property>();
  private readonly claims = new Map<string, PropertyClaim>();
  private readonly works = new Map<string, PropertyWork>();

  async createProperty(p: Property) {
    for (const q of this.properties.values()) {
      if (q.city === p.city && q.lotId === p.lotId) {
        throw new AppError('lot_has_property', 'Este lote já tem um imóvel.', 409);
      }
    }
    this.properties.set(p.id, { ...p });
  }

  async getProperty(id: string) {
    const p = this.properties.get(id);
    return p ? { ...p } : null;
  }

  async propertyOnLot(city: string, lotId: number) {
    const p = [...this.properties.values()].find((q) => q.city === city && q.lotId === lotId);
    return p ? { ...p } : null;
  }

  async propertiesOf(accountId: string) {
    return [...this.properties.values()]
      .filter((p) => p.ownerAccountId === accountId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((p) => ({ ...p }));
  }

  async transferProperty(id: string, from: string, to: string) {
    const p = this.properties.get(id);
    if (p && p.ownerAccountId === from) p.ownerAccountId = to;
  }

  async activateProperty(id: string) {
    const p = this.properties.get(id);
    if (p) p.status = 'active';
  }

  async dropPendingProperty(id: string) {
    if (this.properties.get(id)?.status === 'pending') this.properties.delete(id);
  }

  async pendingProperties(olderThan: Date) {
    return [...this.properties.values()].filter((p) => p.status === 'pending' && p.createdAt < olderThan);
  }

  async startClaim(claim: PropertyClaim, expected: Date, until: Date) {
    const p = this.properties.get(claim.propertyId);
    if (!p || p.lastClaimAt.getTime() !== expected.getTime()) return null;
    p.lastClaimAt = until;
    this.claims.set(claim.id, { ...claim });
    return { ...claim };
  }

  async skipIncome(propertyId: string, expected: Date, until: Date) {
    const p = this.properties.get(propertyId);
    if (!p || p.lastClaimAt.getTime() !== expected.getTime()) return false;
    p.lastClaimAt = until;
    return true;
  }

  async markClaimPaid(id: string) {
    const c = this.claims.get(id);
    if (c) c.status = 'paid';
  }

  async pendingClaims(olderThan: Date) {
    return [...this.claims.values()].filter((c) => c.status === 'pending' && c.createdAt < olderThan);
  }

  async createWork(w: PropertyWork) {
    for (const x of this.works.values()) {
      if (x.propertyId === w.propertyId && x.status === 'pending') {
        throw new AppError('work_in_progress', 'Este imóvel já tem uma obra em andamento.', 409);
      }
    }
    this.works.set(w.id, { ...w });
  }

  async applyWork(workId: string, apply: (p: Property) => { property: Property; claim: PropertyClaim | null }) {
    const w = this.works.get(workId);
    const p = w ? this.properties.get(w.propertyId) : undefined;
    if (!w || w.status !== 'pending' || !p) return null;
    const result = apply({ ...p });
    this.properties.set(p.id, { ...result.property });
    if (result.claim) this.claims.set(result.claim.id, { ...result.claim });
    w.status = 'applied';
    return result;
  }

  async failWork(id: string) {
    const w = this.works.get(id);
    if (w?.status === 'pending') w.status = 'failed';
  }

  async pendingWorks(olderThan: Date) {
    return [...this.works.values()].filter((w) => w.status === 'pending' && w.createdAt < olderThan).map((w) => ({ ...w }));
  }
}
