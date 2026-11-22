import type { QueueTicket, SaleConfig, SaleStore } from '../domain/sale.js';

interface Row {
  id: number;
  city: string;
  accountId: string;
  joinedAt: Date;
  preOpen: boolean;
  lottery: number;
}

/** Fila do lançamento em memória (dev e testes). Mesmo contrato do Postgres. */
export class MemorySaleStore implements SaleStore {
  private readonly sales = new Map<string, SaleConfig>();
  private readonly rows: Row[] = [];
  private nextId = 1;

  async getSale(city: string) {
    const s = this.sales.get(city);
    return s ? { ...s } : null;
  }

  async setSale(sale: SaleConfig) {
    this.sales.set(sale.city, { ...sale });
  }

  async clearSale(city: string) {
    this.sales.delete(city);
  }

  private position(r: Row) {
    const city = this.rows.filter((x) => x.city === r.city);
    if (r.preOpen) {
      return 1 + city.filter((x) => x.preOpen && (x.lottery < r.lottery || (x.lottery === r.lottery && x.id < r.id))).length;
    }
    return city.filter((x) => x.preOpen).length + 1 + city.filter((x) => !x.preOpen && x.id < r.id).length;
  }

  private ticket(r: Row): QueueTicket {
    return { id: r.id, city: r.city, accountId: r.accountId, joinedAt: r.joinedAt, preOpen: r.preOpen, position: this.position(r) };
  }

  private latest(city: string, accountId: string) {
    const mine = this.rows.filter((r) => r.city === city && r.accountId === accountId);
    const last = mine[mine.length - 1];
    return last ? this.ticket(last) : null;
  }

  async latestTicket(city: string, accountId: string) {
    return this.latest(city, accountId);
  }

  /** Sem await entre olhar e gravar: dois pedidos juntos não criam duas fichas. */
  async join(city: string, accountId: string, now: Date, preOpen: boolean, stillValid: (t: QueueTicket) => boolean) {
    const current = this.latest(city, accountId);
    if (current && stillValid(current)) return current;
    const row: Row = { id: this.nextId++, city, accountId, joinedAt: now, preOpen, lottery: Math.random() };
    this.rows.push(row);
    return this.ticket(row);
  }
}
