import { DAY_MS } from '../domain/properties.js';
import { DEFAULT_AFTER_DAYS, type TaxBill, type TaxStore } from '../domain/taxes.js';

/** Para testes e desenvolvimento. Uma thread só: cada operação é atômica. */
export class MemoryTaxStore implements TaxStore {
  private readonly bills = new Map<string, TaxBill>();

  private key = (b: Pick<TaxBill, 'city' | 'lotId' | 'kind' | 'period'>) => `${b.city}:${b.lotId}:${b.kind}:${b.period}`;

  async upsertBills(bills: TaxBill[]) {
    let n = 0;
    for (const b of bills) {
      const k = this.key(b);
      if (this.bills.has(k)) continue;
      this.bills.set(k, { ...b });
      n++;
    }
    return n;
  }

  async pendingBills(accountId?: string) {
    return [...this.bills.values()]
      .filter((b) => b.status === 'pending' && (accountId === undefined || b.accountId === accountId))
      .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
      .map((b) => ({ ...b }));
  }

  async billsOf(accountId: string, limit: number) {
    return [...this.bills.values()]
      .filter((b) => b.accountId === accountId)
      .sort((a, b) => b.dueAt.getTime() - a.dueAt.getTime())
      .slice(0, limit)
      .map((b) => ({ ...b }));
  }

  private byId(id: string) {
    return [...this.bills.values()].find((b) => b.id === id);
  }

  async setFine(id: string, fineCents: number) {
    const b = this.byId(id);
    if (b && b.fineCents === 0) b.fineCents = fineCents;
  }

  async markPaid(id: string, at: Date) {
    const b = this.byId(id);
    if (b && b.status === 'pending') {
      b.status = 'paid';
      b.paidAt = at;
    }
  }

  async inDefault(city: string, lotId: number, now: Date) {
    const limit = now.getTime() - DEFAULT_AFTER_DAYS * DAY_MS;
    return [...this.bills.values()].some(
      (b) => b.city === city && b.lotId === lotId && b.status === 'pending' && b.dueAt.getTime() < limit,
    );
  }
}
