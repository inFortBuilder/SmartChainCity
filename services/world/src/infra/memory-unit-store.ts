import { AppError } from '@scc/shared';

import type { Unit, UnitLease, UnitSale, UnitStore } from '../domain/units.js';

/** Para testes e desenvolvimento. Uma thread só: cada operação é atômica. */
export class MemoryUnitStore implements UnitStore {
  private readonly units = new Map<string, Unit>();
  private readonly sales = new Map<string, UnitSale>();
  private readonly leases = new Map<string, UnitLease>();

  async createUnits(units: Unit[]) {
    if (!units.length) return;
    if ([...this.units.values()].some((u) => u.buildingId === units[0]!.buildingId)) {
      throw new AppError('units_exist', 'Este prédio já tem unidades.', 409);
    }
    for (const u of units) this.units.set(u.id, { ...u });
  }

  async getUnit(id: string) {
    const u = this.units.get(id);
    return u ? { ...u } : null;
  }

  async unitsOfBuilding(buildingId: string) {
    return [...this.units.values()]
      .filter((u) => u.buildingId === buildingId)
      .sort((a, b) => a.floor - b.floor || a.number - b.number)
      .map((u) => ({ ...u }));
  }

  async unitsOwnedBy(accountId: string) {
    return [...this.units.values()].filter((u) => u.ownerAccountId === accountId).map((u) => ({ ...u }));
  }

  async unitsForRent(city: string, limit: number) {
    return [...this.units.values()]
      .filter((u) => u.city === city && u.kind === 'residencial' && u.rentCentsPerDay !== null)
      .sort((a, b) => a.rentCentsPerDay! - b.rentCentsPerDay!)
      .slice(0, limit)
      .map((u) => ({ ...u }));
  }

  async setOffer(id: string, offer: { priceCents: number | null; rentCentsPerDay: number | null }) {
    const u = this.units.get(id);
    if (u) Object.assign(u, offer);
  }

  async beginSale(sale: UnitSale) {
    const u = this.units.get(sale.unitId);
    if (!u || u.pendingSaleId || u.priceCents !== sale.priceCents) return null;
    u.pendingSaleId = sale.id;
    this.sales.set(sale.id, { ...sale });
    return { ...sale };
  }

  async finishSale(id: string) {
    const s = this.sales.get(id);
    if (!s || s.status !== 'pending') return;
    s.status = 'paid';
    const u = this.units.get(s.unitId)!;
    Object.assign(u, { ownerAccountId: s.buyerAccountId, priceCents: null, rentCentsPerDay: null, pendingSaleId: null });
  }

  async failSale(id: string) {
    const s = this.sales.get(id);
    if (!s || s.status !== 'pending') return;
    s.status = 'failed';
    const u = this.units.get(s.unitId);
    if (u?.pendingSaleId === id) u.pendingSaleId = null;
  }

  async pendingSales(olderThan: Date) {
    return [...this.sales.values()].filter((s) => s.status === 'pending' && s.createdAt < olderThan).map((s) => ({ ...s }));
  }

  async beginLease(lease: UnitLease, now: Date) {
    const current = [...this.leases.values()]
      .filter((l) => l.unitId === lease.unitId && l.status !== 'failed' && l.endsAt > now)
      .sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime());
    if (current.some((l) => l.avatarId !== lease.avatarId || l.status === 'pending')) {
      throw new AppError('unit_rented', 'A unidade está alugada para outro morador.', 409);
    }
    // O mesmo avatar estende do fim do aluguel atual.
    const from = current[0]?.endsAt ?? lease.startsAt;
    const next = { ...lease, startsAt: from, endsAt: new Date(from.getTime() + (lease.endsAt.getTime() - lease.startsAt.getTime())) };
    this.leases.set(next.id, next);
    return { ...next };
  }

  async finishLease(id: string) {
    const l = this.leases.get(id);
    if (l?.status === 'pending') l.status = 'paid';
  }

  async failLease(id: string) {
    const l = this.leases.get(id);
    if (l?.status === 'pending') l.status = 'failed';
  }

  async pendingLeases(olderThan: Date) {
    return [...this.leases.values()].filter((l) => l.status === 'pending' && l.createdAt < olderThan).map((l) => ({ ...l }));
  }

  async activeLeasesOf(accountId: string, now: Date) {
    return [...this.leases.values()]
      .filter((l) => l.tenantAccountId === accountId && l.status === 'paid' && l.startsAt <= now && l.endsAt > now)
      .map((l) => ({ ...l }));
  }

  async activeLeaseOfUnit(unitId: string, now: Date) {
    const l = [...this.leases.values()]
      .filter((x) => x.unitId === unitId && x.status === 'paid' && x.endsAt > now)
      .sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime())[0];
    return l ? { ...l } : null;
  }
}
