import { AppError } from '@scc/shared';

import type { Building, BuildingStatus, BuildingStore } from '../domain/buildings.js';

/** Para testes e desenvolvimento. Uma thread só: cada operação é atômica. */
export class MemoryBuildingStore implements BuildingStore {
  private readonly buildings = new Map<string, Building>();

  private copy = (b: Building): Building => ({ ...b, checks: [...b.checks], artifacts: { ...b.artifacts } });

  async createBuilding(b: Building) {
    if (await this.buildingOnLot(b.city, b.lotId)) {
      throw new AppError('lot_has_building', 'Este lote já tem um prédio.', 409);
    }
    this.buildings.set(b.id, this.copy(b));
  }

  async getBuilding(id: string) {
    const b = this.buildings.get(id);
    return b ? this.copy(b) : null;
  }

  async buildingOnLot(city: string, lotId: number) {
    const b = [...this.buildings.values()]
      .filter((x) => x.city === city && x.lotId === lotId && x.status !== 'rejected')
      .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())[0];
    return b ? this.copy(b) : null;
  }

  async buildingsOf(accountId: string) {
    return [...this.buildings.values()]
      .filter((b) => b.ownerAccountId === accountId)
      .sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())
      .map(this.copy);
  }

  async moveBuilding(id: string, from: BuildingStatus, to: BuildingStatus, note: string | null, at: Date) {
    const b = this.buildings.get(id);
    if (!b || b.status !== from) return false;
    b.status = to;
    if (to === 'approved' || to === 'rejected') {
      b.reviewNote = note;
      b.reviewedAt = at;
    }
    return true;
  }

  async dropPendingBuilding(id: string) {
    if (this.buildings.get(id)?.status === 'pending_payment') this.buildings.delete(id);
  }

  async pendingPaymentBuildings(olderThan: Date) {
    return [...this.buildings.values()].filter((b) => b.status === 'pending_payment' && b.createdAt < olderThan).map(this.copy);
  }
}
