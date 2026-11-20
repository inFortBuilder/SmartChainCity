import { randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';

import {
  type City,
  type Lot,
  type Purchase,
  RESERVATION_MS,
  type WorldStore,
  checkPurchase,
  isAvailable,
  nextOpenCount,
} from '../domain/lots.js';

const notFound = () => new AppError('not_found', 'Lote não encontrado.', 404);

/** Para testes e desenvolvimento. Uma thread só: cada operação é atômica. */
export class MemoryWorldStore implements WorldStore {
  private readonly cities = new Map<string, City>();
  private readonly lots = new Map<string, Lot>();
  private readonly purchases = new Map<string, Purchase>();

  private key = (code: string, id: number) => `${code}:${id}`;
  private cityLots = (code: string) => [...this.lots.values()].filter((l) => l.city === code);

  async importCity(city: City, lots: Pick<Lot, 'id' | 'district' | 'zone' | 'areaM2' | 'status'>[]) {
    this.cities.set(city.code, { ...city });
    for (const l of lots) {
      const k = this.key(city.code, l.id);
      const old = this.lots.get(k);
      if (old?.status === 'sold') continue;
      this.lots.set(k, {
        city: city.code,
        ...l,
        ownerAccountId: null,
        reservedBy: null,
        reservedUntil: null,
        reservationId: null,
        soldAt: null,
      });
    }
  }

  async getCity(code: string) {
    const c = this.cities.get(code);
    return c ? { ...c } : null;
  }

  async districts(code: string) {
    const by = new Map<number, { order: number; lots: number; sold: number; forSale: number; areaM2: number }>();
    for (const l of this.cityLots(code)) {
      const d = by.get(l.district) ?? { order: l.district, lots: 0, sold: 0, forSale: 0, areaM2: 0 };
      d.lots++;
      d.areaM2 += l.areaM2;
      if (l.status !== 'civic') d.forSale++;
      if (l.status === 'sold') d.sold++;
      by.set(l.district, d);
    }
    return [...by.values()].sort((a, b) => a.order - b.order);
  }

  async lotsOfDistrict(code: string, district: number) {
    return this.cityLots(code)
      .filter((l) => l.district === district)
      .sort((a, b) => a.id - b.id)
      .map((l) => ({ ...l }));
  }

  async getLot(code: string, id: number) {
    const l = this.lots.get(this.key(code, id));
    return l ? { ...l } : null;
  }

  async lotsOf(accountId: string) {
    return [...this.lots.values()].filter((l) => l.ownerAccountId === accountId).map((l) => ({ ...l }));
  }

  async reserve(
    code: string,
    lotId: number,
    accountId: string,
    now: Date,
    price: (lot: Lot, city: City) => { priceWei: bigint; priceUsd: number },
  ) {
    const city = this.cities.get(code);
    const lot = this.lots.get(this.key(code, lotId));
    if (!city || !lot) throw notFound();
    // Pedido repetido do mesmo comprador, com a reserva valendo: a mesma compra.
    if (lot.status === 'reserved' && lot.reservedBy === accountId && !isAvailable(lot, now) && lot.reservationId) {
      return { ...this.purchases.get(lot.reservationId)! };
    }
    const owned = (await this.lotsOf(accountId)).filter((l) => l.city === code);
    const districtArea = this.cityLots(code)
      .filter((l) => l.district === lot.district)
      .reduce((s, l) => s + l.areaM2, 0);
    checkPurchase(lot, city, { accountId, owned, districtArea }, now);

    const { priceWei, priceUsd } = price(lot, city);
    const purchase: Purchase = { id: randomUUID(), city: code, lotId, accountId, priceWei, priceUsd, status: 'pending', createdAt: now };
    this.purchases.set(purchase.id, purchase);
    Object.assign(lot, {
      status: 'reserved',
      reservedBy: accountId,
      reservedUntil: new Date(now.getTime() + RESERVATION_MS),
      reservationId: purchase.id,
    });
    return { ...purchase };
  }

  async confirm(purchaseId: string, now: Date) {
    const p = this.purchases.get(purchaseId);
    if (!p) return false;
    if (p.status === 'paid') return true;
    const lot = this.lots.get(this.key(p.city, p.lotId))!;
    const holds = lot.status === 'reserved' && lot.reservationId === p.id;
    if (!holds && !isAvailable(lot, now)) return false;
    Object.assign(lot, {
      status: 'sold',
      ownerAccountId: p.accountId,
      soldAt: now,
      reservedBy: null,
      reservedUntil: null,
      reservationId: null,
    });
    p.status = 'paid';
    const city = this.cities.get(p.city)!;
    const counts = await this.districts(p.city);
    city.openCount = nextOpenCount(city, (open) => {
      const inOpen = counts.filter((d) => d.order < open);
      return { sold: inOpen.reduce((s, d) => s + d.sold, 0), forSale: inOpen.reduce((s, d) => s + d.forSale, 0) };
    });
    return true;
  }

  async fail(purchaseId: string, status: 'failed' | 'refunded') {
    const p = this.purchases.get(purchaseId);
    if (!p || p.status === 'paid') return;
    p.status = status;
    const lot = this.lots.get(this.key(p.city, p.lotId))!;
    if (lot.status === 'reserved' && lot.reservationId === p.id) {
      Object.assign(lot, { status: 'vacant', reservedBy: null, reservedUntil: null, reservationId: null });
    }
  }

  async stalePending(before: Date, limit: number) {
    return [...this.purchases.values()]
      .filter((p) => p.status === 'pending' && p.createdAt < before)
      .slice(0, limit)
      .map((p) => ({ ...p }));
  }
}
