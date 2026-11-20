import { CURRENCIES, type Currency, type Leg, type PostedTx } from './ledger.js';

/**
 * Painel econômico (E2.8, doc 04 §7 "faucets e sinks", ADR-0010).
 *
 * Cada transação do ledger vira um fluxo, olhando a parte dos jogadores:
 * - emissão (faucet): os jogadores recebem de um pool ou do sistema (turno, renda de imóvel, crédito da ponte);
 * - dreno (sink): os jogadores pagam para a queima ou para um pool (comida, imposto, obra, lote);
 * - circulação: entre jogadores, soma zero (aluguel, mercado entre jogadores).
 *
 * Indicadores, em 24 h e 7 dias:
 * - dreno ÷ emissão: o doc 04 §6 pede um dreno-alvo de 55% da renda. Abaixo
 *   disso, o THALER se acumula e pressiona o saque;
 * - THALER por jogador com saldo;
 * - saldo do pool P2E e quantos dias ele dura no ritmo de emissão dos últimos 7 dias.
 *
 * Alertas (limites de partida, ajustar com o alpha):
 * - `sink_ratio_low`: dreno ÷ emissão abaixo de 0,55 em 7 dias, com emissão relevante;
 * - `p2e_runway_short`: o pool P2E acaba em menos de 30 dias (crítico abaixo de 7).
 */

export const SINK_RATIO_TARGET = 0.55;
export const RUNWAY_WARN_DAYS = 30;
export const RUNWAY_CRITICAL_DAYS = 7;
/** Sem emissão relevante (menos de 1.000 THALER na semana), a razão não diz nada. */
export const MIN_FAUCET_FOR_RATIO = 1000_00n;

export interface FlowRow {
  kind: string;
  /** Contas do outro lado: "pool/p2e", "burn/food", "system/bridge"… */
  counterpart: string;
  faucet: bigint;
  sink: bigint;
  /** Transações entre jogadores (soma zero), só contadas. */
  transfers: number;
  txs: number;
}

export interface Snapshot {
  playerTotal: bigint;
  players: number;
  pools: { ownerId: string; balance: bigint }[];
}

export interface PanelStore {
  flows(currency: Currency, since: Date): Promise<FlowRow[]>;
  snapshot(currency: Currency): Promise<Snapshot>;
}

/** Classifica uma transação pela parte dos jogadores (usado pelo store em memória). */
export function classify(legs: Leg[], currency: Currency) {
  const mine = legs.filter((l) => l.account.currency === currency);
  const player = mine.filter((l) => l.account.ownerType === 'player').reduce((s, l) => s + l.amount, 0n);
  const counterpart = [
    ...new Set(mine.filter((l) => l.account.ownerType !== 'player').map((l) => `${l.account.ownerType}/${l.account.ownerId}`)),
  ]
    .sort()
    .join(',');
  return { player, counterpart, touchesPlayers: mine.some((l) => l.account.ownerType === 'player'), hasCurrency: mine.length > 0 };
}

/** Agrega transações já lançadas (o store em memória usa; o Postgres faz o mesmo em SQL). */
export function aggregate(txs: PostedTx[], currency: Currency, since: Date): FlowRow[] {
  const rows = new Map<string, FlowRow>();
  for (const tx of txs) {
    if (tx.createdAt < since) continue;
    const c = classify(tx.legs, currency);
    if (!c.hasCurrency || !c.touchesPlayers) continue;
    const key = `${tx.kind}|${c.counterpart}`;
    const row = rows.get(key) ?? { kind: tx.kind, counterpart: c.counterpart, faucet: 0n, sink: 0n, transfers: 0, txs: 0 };
    if (c.player > 0n) row.faucet += c.player;
    else if (c.player < 0n) row.sink += -c.player;
    else row.transfers++;
    row.txs++;
    rows.set(key, row);
  }
  return [...rows.values()];
}

const toUnits = (v: bigint, currency: Currency) => Number(v) / 10 ** CURRENCIES[currency];

export interface PanelAlert {
  code: 'sink_ratio_low' | 'p2e_runway_short';
  severity: 'warning' | 'critical';
  message: string;
}

export async function buildPanel(store: PanelStore, currency: Currency, now: Date) {
  const day = await store.flows(currency, new Date(now.getTime() - 86_400_000));
  const week = await store.flows(currency, new Date(now.getTime() - 7 * 86_400_000));
  const snap = await store.snapshot(currency);

  const totals = (rows: FlowRow[]) => {
    const faucet = rows.reduce((s, r) => s + r.faucet, 0n);
    const sink = rows.reduce((s, r) => s + r.sink, 0n);
    return {
      faucet,
      sink,
      ratio: faucet > 0n ? Number((sink * 10_000n) / faucet) / 10_000 : null,
      transfers: rows.reduce((s, r) => s + r.transfers, 0),
    };
  };
  const d = totals(day);
  const w = totals(week);

  const p2e = snap.pools.find((p) => p.ownerId === 'p2e')?.balance ?? 0n;
  const p2eOutWeek = week.filter((r) => r.counterpart.split(',').includes('pool/p2e')).reduce((s, r) => s + r.faucet, 0n);
  const runwayDays = p2eOutWeek > 0n ? Math.round((toUnits(p2e, currency) / (toUnits(p2eOutWeek, currency) / 7)) * 10) / 10 : null;

  const alerts: PanelAlert[] = [];
  if (currency === 'THALER' && w.faucet >= MIN_FAUCET_FOR_RATIO && w.ratio !== null && w.ratio < SINK_RATIO_TARGET) {
    alerts.push({
      code: 'sink_ratio_low',
      severity: 'warning',
      message: `Dreno de ${(w.ratio * 100).toFixed(0)}% da emissão em 7 dias; a meta é ${SINK_RATIO_TARGET * 100}% (doc 04).`,
    });
  }
  if (runwayDays !== null && runwayDays < RUNWAY_WARN_DAYS) {
    alerts.push({
      code: 'p2e_runway_short',
      severity: runwayDays < RUNWAY_CRITICAL_DAYS ? 'critical' : 'warning',
      message: `O pool P2E acaba em ${runwayDays} dias no ritmo da última semana.`,
    });
  }

  const byKind = (rows: FlowRow[]) =>
    rows
      .filter((r) => r.faucet > 0n || r.sink > 0n || r.transfers > 0)
      .sort((a, b) => Number(b.faucet + b.sink - (a.faucet + a.sink)))
      .map((r) => ({
        kind: r.kind,
        counterpart: r.counterpart,
        faucet: r.faucet.toString(),
        sink: r.sink.toString(),
        transfers: r.transfers,
        txs: r.txs,
      }));

  return {
    currency,
    decimals: CURRENCIES[currency],
    at: now.toISOString(),
    window_24h: { faucet: d.faucet.toString(), sink: d.sink.toString(), sink_ratio: d.ratio, transfers: d.transfers, by_kind: byKind(day) },
    window_7d: { faucet: w.faucet.toString(), sink: w.sink.toString(), sink_ratio: w.ratio, transfers: w.transfers, by_kind: byKind(week) },
    players: snap.players,
    player_total: snap.playerTotal.toString(),
    per_capita: snap.players > 0 ? (snap.playerTotal / BigInt(snap.players)).toString() : '0',
    pools: snap.pools.map((p) => ({ owner_id: p.ownerId, balance: p.balance.toString() })),
    p2e_runway_days: runwayDays,
    target_sink_ratio: SINK_RATIO_TARGET,
    alerts,
  };
}

export type Panel = Awaited<ReturnType<typeof buildPanel>>;

/** Medidores para o Prometheus (painel "Economia" no Grafana). */
export function panelGauges(p: Panel, set: (name: string, help: string, labels: Record<string, string>, value: number) => void) {
  const cur = { currency: p.currency };
  const units = (v: string) => Number(v) / 10 ** p.decimals;
  set('economy_faucet_units', 'Emissão para os jogadores na janela, em unidades da moeda.', { ...cur, window: '24h' }, units(p.window_24h.faucet));
  set('economy_faucet_units', 'Emissão para os jogadores na janela, em unidades da moeda.', { ...cur, window: '7d' }, units(p.window_7d.faucet));
  set('economy_sink_units', 'Dreno dos jogadores na janela, em unidades da moeda.', { ...cur, window: '24h' }, units(p.window_24h.sink));
  set('economy_sink_units', 'Dreno dos jogadores na janela, em unidades da moeda.', { ...cur, window: '7d' }, units(p.window_7d.sink));
  set('economy_sink_ratio', 'Dreno ÷ emissão na janela (meta 0,55).', { ...cur, window: '7d' }, p.window_7d.sink_ratio ?? Number.NaN);
  set('economy_players_with_balance', 'Jogadores com saldo.', cur, p.players);
  set('economy_per_capita_units', 'Saldo médio por jogador com saldo.', cur, units(p.per_capita));
  for (const pool of p.pools) set('economy_pool_units', 'Saldo dos pools.', { ...cur, pool: pool.owner_id }, units(pool.balance));
  set('economy_p2e_runway_days', 'Dias até o pool P2E acabar no ritmo de 7 dias.', cur, p.p2e_runway_days ?? Number.NaN);
}
