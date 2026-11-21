import type { Conversion, ExchangeStore, FxRate } from '../domain/exchange.js';
import type { TickSample, TwapSampleStore } from '../domain/fx-twap.js';

/** Para testes e desenvolvimento. Uma thread só: cada operação é atômica. */
export class MemoryExchangeStore implements ExchangeStore, TwapSampleStore {
  private readonly rates: FxRate[] = [];
  private readonly samples: (TickSample & { pool: string })[] = [];

  async addSample(pool: string, s: TickSample) {
    if (!this.samples.some((x) => x.pool === pool && x.at.getTime() === s.at.getTime())) this.samples.push({ pool, ...s });
  }

  async sampleAtOrBefore(pool: string, before: Date) {
    const s = this.samples.filter((x) => x.pool === pool && x.at.getTime() <= before.getTime()).sort((a, b) => b.at.getTime() - a.at.getTime())[0];
    return s ? { at: s.at, tickCumulative: s.tickCumulative } : null;
  }

  async pruneSamples(pool: string, before: Date) {
    for (let i = this.samples.length - 1; i >= 0; i--) {
      if (this.samples[i]!.pool === pool && this.samples[i]!.at.getTime() < before.getTime()) this.samples.splice(i, 1);
    }
  }
  private readonly rows = new Map<string, Conversion>();

  async latestRate(at: Date) {
    const r = this.rates.filter((x) => x.validFrom.getTime() <= at.getTime()).sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime())[0];
    return r ? { ...r } : null;
  }

  async get(id: string) {
    const c = this.rows.get(id);
    return c ? { ...c } : null;
  }

  async setRate(rate: FxRate) {
    this.rates.push({ ...rate });
  }

  async createWithinLimit(c: Conversion, since: Date, limitCents: bigint) {
    if (c.direction === 'thaler_to_scity') {
      const used = [...this.rows.values()]
        .filter((x) => x.accountId === c.accountId && x.direction === 'thaler_to_scity' && x.status !== 'failed' && x.createdAt.getTime() >= since.getTime())
        .reduce((s, x) => s + x.thalerCents, 0n);
      if (used + c.thalerCents > limitCents) return false;
    }
    this.rows.set(c.id, { ...c });
    return true;
  }

  async setStatus(id: string, status: 'done' | 'failed') {
    const c = this.rows.get(id);
    if (c && c.status === 'created') c.status = status;
  }

  async scityPaidOut() {
    return [...this.rows.values()].filter((c) => c.direction === 'thaler_to_scity' && c.status === 'done').reduce((s, c) => s + c.scityWei, 0n);
  }

  async listOf(accountId: string, limit: number) {
    return [...this.rows.values()]
      .filter((c) => c.accountId === accountId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((c) => ({ ...c }));
  }
}
