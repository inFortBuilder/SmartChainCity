import { type ExchangeStore, rateFromUsd } from './exchange.js';

/**
 * Cotação pelo TWAP 24 h da DEX (doc 04 §5, ADR-0004), o job `fx.twap`.
 *
 * Lê o oráculo do pool SCITY/USDT da PancakeSwap V3 (a mesma interface da
 * Uniswap V3): o pool guarda o tick acumulado no tempo, e a diferença entre dois
 * momentos dividida pelo intervalo é o tick médio. O preço do token0 em token1
 * é 1,0001^tick, ajustado pelas casas decimais. É uma média geométrica: um pico
 * curto mexe pouco nela. O USDT conta como US$ 1.
 *
 * De onde vem o acumulado de 24 h atrás:
 * 1. do próprio pool, `observe([24 h, 0])`, se ele guarda observações para isso;
 * 2. senão, das amostras que o job grava a cada rodada (`observe([0])`). Um pool
 *    movimentado enche o anel de observações em menos de 24 h (o WBNB/USDT da
 *    PancakeSwap, com 2.100 observações, cobre cerca de 1 h), e o pool reverte
 *    com "OLD". A amostra usada é a mais nova com 24 h ou mais, até 2 janelas.
 *
 * Proteções contra manipulação e erro:
 * - média de 24 h: mover o preço por um dia inteiro custa caro;
 * - uma cotação nova por período (24 h). Uma cotação da rota interna vale até a
 *   rodada seguinte do job, que volta a mandar;
 * - disjuntor: um salto maior que `maxJumpBps` sobre a cotação em vigor não é
 *   aplicado. O job registra o erro e quem opera decide pela rota interna;
 * - sem histórico ou preço absurdo, a cotação fica como está.
 */
export const TWAP_SOURCE = 'dex_twap';
export const MIN_SCITY_USD = 0.000001;
export const MAX_SCITY_USD = 1_000_000;

export interface PoolTokens {
  token0: string;
  token1: string;
  decimals0: number;
  decimals1: number;
}

export interface TickSample {
  /** Hora do bloco. */
  at: Date;
  tickCumulative: bigint;
}

export interface DexPool {
  tokens(): Promise<PoolTokens>;
  /** Tick acumulado agora, com a hora do bloco. */
  current(): Promise<TickSample>;
  /** Tick acumulado `secondsAgo` segundos antes do bloco de `current`. Reverte com "OLD" sem histórico. */
  cumulativeAgo(secondsAgo: number, current: TickSample): Promise<bigint>;
}

/** Amostras do tick acumulado, por pool. */
export interface TwapSampleStore {
  addSample(pool: string, s: TickSample): Promise<void>;
  /** A amostra mais nova com `at` <= `before`. */
  sampleAtOrBefore(pool: string, before: Date): Promise<TickSample | null>;
  pruneSamples(pool: string, before: Date): Promise<void>;
}

export interface TwapOptions {
  poolAddress: string;
  /** Endereço do SCITY: diz de que lado do par ele está. */
  scityToken: string;
  windowSeconds: number;
  periodMs: number;
  maxJumpBps: number;
}

export type TwapResult =
  | { kind: 'fresh' }
  | { kind: 'updated'; scityUsd: number; previousUsd: number | null; from: 'pool' | 'samples' }
  | { kind: 'rejected'; scityUsd: number; previousUsd: number; jumpBps: number }
  | { kind: 'unavailable'; reason: string };

/** Tick médio arredondado para baixo, como o `OracleLibrary.consult` da Uniswap. */
export function meanTick(before: bigint, now: bigint, seconds: number): number {
  const delta = now - before;
  const s = BigInt(seconds);
  let tick = delta / s;
  if (delta < 0n && delta % s !== 0n) tick -= 1n;
  return Number(tick);
}

export class PoolMismatchError extends Error {}

/** Preço do SCITY em dólar a partir do tick (token0 cotado em token1). */
export function scityUsdFromTick(tick: number, tokens: PoolTokens, scityToken: string): number {
  const scity = scityToken.toLowerCase();
  const isToken0 = tokens.token0.toLowerCase() === scity;
  if (!isToken0 && tokens.token1.toLowerCase() !== scity) {
    throw new PoolMismatchError(`O pool da DEX não tem o SCITY (${scityToken}): token0 ${tokens.token0}, token1 ${tokens.token1}.`);
  }
  const token0InToken1 = 1.0001 ** tick * 10 ** (tokens.decimals0 - tokens.decimals1);
  const usd = isToken0 ? token0InToken1 : 1 / token0InToken1;
  // A coluna guarda 8 casas.
  return Math.round(usd * 1e8) / 1e8;
}

const short = (error: unknown) => (error instanceof Error ? error.message : String(error)).split('\n')[0]!.slice(0, 200);

export async function refreshFxFromDex(
  deps: { store: ExchangeStore & TwapSampleStore; pool: DexPool },
  opts: TwapOptions,
  now: Date,
): Promise<TwapResult> {
  const poolId = opts.poolAddress.toLowerCase();
  const windowMs = opts.windowSeconds * 1000;

  // Toda rodada grava uma amostra: é o histórico quando o pool não tem 24 h.
  let tokens: PoolTokens;
  let current: TickSample;
  try {
    [tokens, current] = await Promise.all([deps.pool.tokens(), deps.pool.current()]);
  } catch (error) {
    return { kind: 'unavailable', reason: short(error) };
  }
  await deps.store.addSample(poolId, current);
  await deps.store.pruneSamples(poolId, new Date(current.at.getTime() - 3 * windowMs));

  const rate = await deps.store.latestRate(now);
  if (rate && rate.source === TWAP_SOURCE && now.getTime() - rate.validFrom.getTime() < opts.periodMs) return { kind: 'fresh' };

  let tick: number;
  let from: 'pool' | 'samples';
  try {
    tick = meanTick(await deps.pool.cumulativeAgo(opts.windowSeconds, current), current.tickCumulative, opts.windowSeconds);
    from = 'pool';
  } catch (error) {
    if (!/\bOLD\b/.test(error instanceof Error ? error.message : String(error))) return { kind: 'unavailable', reason: short(error) };
    const old = await deps.store.sampleAtOrBefore(poolId, new Date(current.at.getTime() - windowMs));
    const seconds = old ? Math.round((current.at.getTime() - old.at.getTime()) / 1000) : 0;
    if (!old || seconds > 2 * opts.windowSeconds) return { kind: 'unavailable', reason: 'history_too_short' };
    tick = meanTick(old.tickCumulative, current.tickCumulative, seconds);
    from = 'samples';
  }

  const scityUsd = scityUsdFromTick(tick, tokens, opts.scityToken);
  if (!Number.isFinite(scityUsd) || scityUsd < MIN_SCITY_USD || scityUsd > MAX_SCITY_USD) {
    return { kind: 'unavailable', reason: `price_out_of_range:${scityUsd}` };
  }
  const previousUsd = rate?.scityUsd ?? null;
  if (previousUsd !== null) {
    const jumpBps = Math.round((Math.abs(scityUsd - previousUsd) / previousUsd) * 10_000);
    if (jumpBps > opts.maxJumpBps) return { kind: 'rejected', scityUsd, previousUsd, jumpBps };
  }
  await deps.store.setRate(rateFromUsd(scityUsd, now, TWAP_SOURCE));
  return { kind: 'updated', scityUsd, previousUsd, from };
}
