import { type Vehicle, type VehicleStore, isBroken } from '../domain/vehicle.js';

/** Para testes e desenvolvimento. Uma thread só: cada operação é atômica. */
export class MemoryVehicleStore implements VehicleStore {
  private readonly vehicles = new Map<string, Vehicle>();

  async create(v: Vehicle) {
    this.vehicles.set(v.id, { ...v });
  }

  async get(id: string) {
    const v = this.vehicles.get(id);
    return v ? { ...v } : null;
  }

  async listByAccount(accountId: string) {
    return [...this.vehicles.values()]
      .filter((v) => v.accountId === accountId)
      .sort((a, b) => b.boughtAt.getTime() - a.boughtAt.getTime())
      .map((v) => ({ ...v }));
  }

  async activate(id: string) {
    const v = this.vehicles.get(id);
    if (v?.status === 'pending') v.status = 'active';
  }

  async dropPending(id: string) {
    if (this.vehicles.get(id)?.status === 'pending') this.vehicles.delete(id);
  }

  async extendIpva(id: string, expected: Date, until: Date) {
    const v = this.vehicles.get(id);
    if (!v || v.ipvaPaidUntil?.getTime() !== expected.getTime()) return false;
    v.ipvaPaidUntil = until;
    return true;
  }

  async markSold(id: string, now: Date) {
    const v = this.vehicles.get(id);
    if (!v || v.status !== 'active') return false;
    v.status = 'sold';
    v.soldAt = now;
    return true;
  }

  async setBreakdown(id: string, severity: 'leve' | 'moderado' | 'grave', now: Date) {
    const v = this.vehicles.get(id);
    if (!v || isBroken(v, now)) return false;
    Object.assign(v, { breakdown: severity, brokenAt: now, repairUntil: null });
    return true;
  }

  async startRepair(id: string, brokenAt: Date, until: Date) {
    const v = this.vehicles.get(id);
    if (!v || v.brokenAt?.getTime() !== brokenAt.getTime() || v.repairUntil) return false;
    v.repairUntil = until;
    return true;
  }

  async setRevision(id: string, expected: Date | null, until: Date) {
    const v = this.vehicles.get(id);
    if (!v || (v.revisionUntil?.getTime() ?? null) !== (expected?.getTime() ?? null)) return false;
    v.revisionUntil = until;
    return true;
  }

  async pendingOlderThan(t: Date) {
    return [...this.vehicles.values()].filter((v) => v.status === 'pending' && v.boughtAt <= t).map((v) => ({ ...v }));
  }
}
