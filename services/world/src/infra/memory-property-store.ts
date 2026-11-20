import { AppError } from '@scc/shared';

import type { Property, PropertyClaim, PropertyStore } from '../domain/properties.js';

/** Para testes e desenvolvimento. Uma thread só: cada operação é atômica. */
export class MemoryPropertyStore implements PropertyStore {
  private readonly properties = new Map<string, Property>();
  private readonly claims = new Map<string, PropertyClaim>();

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

  async markClaimPaid(id: string) {
    const c = this.claims.get(id);
    if (c) c.status = 'paid';
  }

  async pendingClaims(olderThan: Date) {
    return [...this.claims.values()].filter((c) => c.status === 'pending' && c.createdAt < olderThan);
  }
}
