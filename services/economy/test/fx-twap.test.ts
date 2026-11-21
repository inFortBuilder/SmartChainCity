import { afterAll, describe, expect, it } from 'vitest';

import { type ExchangeStore, rateFromUsd } from '../src/domain/exchange.js';
import {
  type DexPool,
  type PoolTokens,
  TWAP_SOURCE,
  type TwapSampleStore,
  meanTick,
  refreshFxFromDex,
  scityUsdFromTick,
} from '../src/domain/fx-twap.js';
import { PostgresExchangeStore } from '../src/infra/db/postgres-exchange-store.js';
import { MemoryExchangeStore } from '../src/infra/memory-exchange-store.js';
import { pool as pg } from './stores.js';

const SCITY = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const USDT = '0x55d398326f99059fF775485246999027B3197955';
const T0 = new Date('2026-11-21T12:00:00Z');
const at = (h: number) => new Date(T0.getTime() + h * 3_600_000);

afterAll(async () => {
  await pg?.end();
});

/**
 * Pool falso com relógio: acumula o tick no tempo, como o pool real, e só lembra
 * `memoryHours` para trás (depois disso, "OLD").
 */
class FakePool implements DexPool {
  clock = at(-100);
  fail: string | null = null;
  private readonly marks: { at: number; cum: bigint; tick: number }[];

  constructor(
    tick: number,
    private readonly memoryHours = 1000,
    private readonly pair: PoolTokens = { token0: SCITY, token1: USDT, decimals0: 18, decimals1: 18 },
  ) {
    this.marks = [{ at: this.clock.getTime(), cum: 0n, tick }];
  }

  private cumAt(ms: number) {
    const m = this.marks.filter((x) => x.at <= ms).at(-1)!;
    return m.cum + BigInt(m.tick) * BigInt(Math.round((ms - m.at) / 1000));
  }

  /** Avança o relógio até `t` e passa a cotar `tick`. */
  setTick(t: Date, tick: number) {
    this.clock = t;
    this.marks.push({ at: t.getTime(), cum: this.cumAt(t.getTime()), tick });
  }

  async tokens() {
    return this.pair;
  }

  async current() {
    if (this.fail) throw new Error(this.fail);
    return { at: this.clock, tickCumulative: this.cumAt(this.clock.getTime()) };
  }

  async cumulativeAgo(secondsAgo: number) {
    if (secondsAgo > this.memoryHours * 3600) throw new Error('The contract function "observe" reverted with the following reason:\nOLD');
    return this.cumAt(this.clock.getTime() - secondsAgo * 1000);
  }
}

const opts = { poolAddress: '0xPool', scityToken: SCITY, windowSeconds: 86_400, periodMs: 24 * 3_600_000, maxJumpBps: 5000 };
const run = (store: ExchangeStore & TwapSampleStore, pool: FakePool) => refreshFxFromDex({ store, pool }, opts, pool.clock);
const usd = (r: unknown) => (r as { scityUsd: number }).scityUsd;

describe('matemática do TWAP', () => {
  it('tick médio arredonda para baixo, como o OracleLibrary da Uniswap', () => {
    expect(meanTick(0n, 600n, 60)).toBe(10);
    expect(meanTick(0n, -7n, 2)).toBe(-4);
    expect(meanTick(0n, -8n, 2)).toBe(-4);
  });

  it('preço do SCITY dos dois lados do par e com casas decimais diferentes', () => {
    const t = { token0: SCITY, token1: USDT, decimals0: 18, decimals1: 18 };
    expect(scityUsdFromTick(0, t, SCITY)).toBe(1);
    // 1,0001^-6932 ≈ 0,5: SCITY como token0 vale US$ 0,50; como token1, o inverso.
    expect(scityUsdFromTick(-6932, t, SCITY)).toBeCloseTo(0.5, 3);
    expect(scityUsdFromTick(-6932, { ...t, token0: USDT, token1: SCITY }, SCITY.toLowerCase())).toBeCloseTo(2, 3);
    // Dólar com 6 casas (o USDC da Ethereum): o tick de US$ 1 fica perto de -276.324.
    expect(scityUsdFromTick(-276_324, { ...t, decimals1: 6 }, SCITY)).toBeCloseTo(1, 3);
    expect(() => scityUsdFromTick(0, { ...t, token0: USDT, token1: USDT }, SCITY)).toThrow(/não tem o SCITY/);
  });
});

describe('job fx.twap', () => {
  it('média de 24 h do pool, uma por período; a rota interna vale até a rodada seguinte', async () => {
    const store = new MemoryExchangeStore();
    await store.setRate(rateFromUsd(1, at(-200), 'config'));
    const pool = new FakePool(0);
    pool.setTick(at(-12), -6932); // 12 h a US$ 1 e 12 h a US$ 0,50
    pool.clock = T0;

    const r = await run(store, pool);
    expect(r).toMatchObject({ kind: 'updated', previousUsd: 1, from: 'pool' });
    expect(usd(r)).toBeCloseTo(Math.SQRT1_2, 3); // média geométrica
    expect((await store.latestRate(T0))!.source).toBe(TWAP_SOURCE);

    pool.setTick(at(23), -5000);
    expect(await run(store, pool)).toEqual({ kind: 'fresh' });
    pool.clock = at(24);
    expect(await run(store, pool)).toMatchObject({ kind: 'updated' });

    await store.setRate(rateFromUsd(0.6, at(25), 'manual'));
    pool.clock = at(26);
    expect(await run(store, pool)).toMatchObject({ kind: 'updated', previousUsd: 0.6 });
  });

  it('pool que só lembra 1 h: o TWAP sai das amostras gravadas pelo job', async () => {
    const store = new MemoryExchangeStore();
    await store.setRate(rateFromUsd(1, at(-200), 'config'));
    const pool = new FakePool(0, 1);

    // Uma amostra por hora; o preço cai para US$ 0,50 nas últimas 6 h.
    for (let h = -24; h <= 0; h++) {
      if (h === -6) pool.setTick(at(h), -6932);
      else pool.clock = at(h);
      const r = await run(store, pool);
      if (h < 0) expect(r).toEqual({ kind: 'unavailable', reason: 'history_too_short' });
      else {
        expect(r).toMatchObject({ kind: 'updated', from: 'samples' });
        expect(usd(r)).toBeCloseTo(0.5 ** (6 / 24), 3);
      }
    }
  });

  it('amostras de mais de 2 janelas atrás (serviço parado) não valem', async () => {
    const store = new MemoryExchangeStore();
    const pool = new FakePool(0, 1);
    pool.clock = at(-60);
    await run(store, pool);
    pool.clock = T0;
    expect(await run(store, pool)).toEqual({ kind: 'unavailable', reason: 'history_too_short' });
  });

  it('disjuntor: salto acima do limite não é aplicado até quem opera confirmar', async () => {
    const store = new MemoryExchangeStore();
    await store.setRate(rateFromUsd(1, at(-200), 'config'));
    const pool = new FakePool(-13_864); // ≈ US$ 0,25 o dia todo: queda de 75%
    pool.clock = T0;

    expect(await run(store, pool)).toMatchObject({ kind: 'rejected', previousUsd: 1, jumpBps: 7500 });
    expect((await store.latestRate(T0))!.source).toBe('config');

    await store.setRate(rateFromUsd(0.3, at(1), 'manual'));
    pool.clock = at(2);
    expect(await run(store, pool)).toMatchObject({ kind: 'updated', previousUsd: 0.3 });
  });

  it('RPC fora ou preço absurdo: a cotação fica como está; pool sem o SCITY é erro', async () => {
    const store = new MemoryExchangeStore();
    await store.setRate(rateFromUsd(1, at(-200), 'config'));
    const pool = new FakePool(-500_000);
    pool.clock = T0;
    pool.fail = 'fetch failed';
    expect(await run(store, pool)).toEqual({ kind: 'unavailable', reason: 'fetch failed' });
    pool.fail = null;
    expect(await run(store, pool)).toMatchObject({ kind: 'unavailable', reason: expect.stringMatching(/^price_out_of_range/) });
    expect((await store.latestRate(T0))!.source).toBe('config');

    const wrong = new FakePool(0, 1000, { token0: USDT, token1: USDT, decimals0: 18, decimals1: 18 });
    wrong.clock = T0;
    await expect(run(store, wrong)).rejects.toThrow(/não tem o SCITY/);
  });
});

describe.each([
  ['memória', () => new MemoryExchangeStore() as TwapSampleStore, true],
  ['postgres', () => new PostgresExchangeStore(pg!) as TwapSampleStore, pg !== null],
] as const)('amostras do TWAP (%s)', (_name, make, enabled) => {
  it.skipIf(!enabled)('a mais nova até a data, por pool, sem duplicar; poda as antigas', async () => {
    const store = make();
    const p = `0xpool-${Math.random()}`;
    const other = `0xoutro-${Math.random()}`;
    await store.addSample(p, { at: at(0), tickCumulative: -5n });
    await store.addSample(p, { at: at(0), tickCumulative: 99n });
    await store.addSample(p, { at: at(2), tickCumulative: 10n ** 20n });
    await store.addSample(other, { at: at(1), tickCumulative: 1n });
    expect(await store.sampleAtOrBefore(p, at(1))).toEqual({ at: at(0), tickCumulative: -5n });
    expect(await store.sampleAtOrBefore(p, at(5))).toEqual({ at: at(2), tickCumulative: 10n ** 20n });
    expect(await store.sampleAtOrBefore(p, at(-1))).toBeNull();
    await store.pruneSamples(p, at(1));
    expect(await store.sampleAtOrBefore(p, at(1))).toBeNull();
    expect(await store.sampleAtOrBefore(other, at(1))).not.toBeNull();
  });
});
