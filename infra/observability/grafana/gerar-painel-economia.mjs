/**
 * Gera o painel "Economia" do Grafana (dashboards/economia.json), E2.8.
 * Lê os medidores economy_* que o serviço economy recalcula a cada minuto
 * (services/economy, job economy.panel). Editar aqui e rodar de novo:
 *
 *   node infra/observability/grafana/gerar-painel-economia.mjs
 */
import { writeFileSync } from 'node:fs';

const ds = { type: 'prometheus', uid: 'prometheus' };
let id = 0;
const panel = (title, type, gridPos, targets, extra = {}) => ({
  id: ++id,
  title,
  type,
  datasource: ds,
  gridPos,
  targets: targets.map(([expr, legendFormat], k) => ({ refId: String.fromCharCode(65 + k), datasource: ds, expr, legendFormat })),
  ...extra,
});
const thaler = 'currency="THALER"';

const stat = (title, x, expr, unit, thresholds, decimals = 0) =>
  panel(title, 'stat', { x, y: 0, w: 6, h: 4 }, [[expr, '']], {
    fieldConfig: { defaults: { unit, decimals, thresholds: { mode: 'absolute', steps: thresholds } }, overrides: [] },
    options: { reduceOptions: { calcs: ['lastNotNull'] }, colorMode: 'background' },
  });

const series = (title, gridPos, targets, unit) =>
  panel(title, 'timeseries', gridPos, targets, { fieldConfig: { defaults: { unit }, overrides: [] } });

const panels = [
  // Meta do doc 04: dreno de 55% da renda.
  stat('Dreno ÷ emissão (7 dias)', 0, `economy_sink_ratio{${thaler},window="7d"}`, 'percentunit', [
    { color: 'red', value: null },
    { color: 'orange', value: 0.45 },
    { color: 'green', value: 0.55 },
  ], 2),
  stat('Pool P2E dura (dias)', 6, `economy_p2e_runway_days{${thaler}}`, 'd', [
    { color: 'red', value: null },
    { color: 'orange', value: 7 },
    { color: 'green', value: 30 },
  ]),
  stat('THALER por jogador', 12, `economy_per_capita_units{${thaler}}`, 'none', [{ color: 'blue', value: null }]),
  stat('Jogadores com saldo', 18, `economy_players_with_balance{${thaler}}`, 'none', [{ color: 'blue', value: null }]),
  series(
    'Emissão × dreno de THALER (7 dias)',
    { x: 0, y: 4, w: 12, h: 8 },
    [
      [`economy_faucet_units{${thaler},window="7d"}`, 'emissão (faucet)'],
      [`economy_sink_units{${thaler},window="7d"}`, 'dreno (sink)'],
    ],
    'none',
  ),
  series(
    'Emissão × dreno de THALER (24 h)',
    { x: 12, y: 4, w: 12, h: 8 },
    [
      [`economy_faucet_units{${thaler},window="24h"}`, 'emissão (faucet)'],
      [`economy_sink_units{${thaler},window="24h"}`, 'dreno (sink)'],
    ],
    'none',
  ),
  series('Saldo dos pools de THALER', { x: 0, y: 12, w: 12, h: 8 }, [[`economy_pool_units{${thaler}}`, '{{pool}}']], 'none'),
  series(
    'SCITY: emissão × dreno e pools (7 dias)',
    { x: 12, y: 12, w: 12, h: 8 },
    [
      ['economy_faucet_units{currency="SCITY",window="7d"}', 'emissão'],
      ['economy_sink_units{currency="SCITY",window="7d"}', 'dreno'],
      ['economy_pool_units{currency="SCITY"}', 'pool {{pool}}'],
    ],
    'none',
  ),
];

const dashboard = {
  uid: 'scc-economia',
  title: 'Smart Chain City — Economia',
  tags: ['scc', 'economia'],
  timezone: 'browser',
  refresh: '1m',
  time: { from: 'now-7d', to: 'now' },
  schemaVersion: 39,
  panels,
};

writeFileSync(new URL('./dashboards/economia.json', import.meta.url), `${JSON.stringify(dashboard, null, 2)}\n`);
console.log(`${panels.length} painéis`);
