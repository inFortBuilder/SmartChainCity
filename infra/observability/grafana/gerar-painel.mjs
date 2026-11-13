/**
 * Gera o painel "Serviços" do Grafana (dashboards/servicos.json).
 * Editar aqui e rodar de novo, em vez de mexer no JSON:
 *
 *   node infra/observability/grafana/gerar-painel.mjs
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
const sel = 'service=~"$service"';

const stat = (title, x, expr, unit, thresholds) =>
  panel(title, 'stat', { x, y: 0, w: 6, h: 4 }, [[expr, '']], {
    fieldConfig: { defaults: { unit, thresholds: { mode: 'absolute', steps: thresholds } }, overrides: [] },
    options: { reduceOptions: { calcs: ['lastNotNull'] }, colorMode: 'background' },
  });

const series = (title, gridPos, targets, unit) =>
  panel(title, 'timeseries', gridPos, targets, { fieldConfig: { defaults: { unit }, overrides: [] } });

const panels = [
  stat('Serviços no ar', 0, 'sum(up)', 'none', [
    { color: 'red', value: null },
    { color: 'green', value: 4 },
  ]),
  stat('Requisições/s', 6, `sum(rate(http_requests_total{${sel}}[1m]))`, 'reqps', [{ color: 'blue', value: null }]),
  stat('Erros 5xx (5 min)', 12, `sum(increase(http_requests_total{${sel},status=~"5.."}[5m]))`, 'none', [
    { color: 'green', value: null },
    { color: 'red', value: 1 },
  ]),
  stat(
    'p95 (5 min)',
    18,
    `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{${sel}}[5m])))`,
    's',
    [
      { color: 'green', value: null },
      { color: 'orange', value: 0.5 },
      { color: 'red', value: 1 },
    ],
  ),
  series('Requisições por serviço', { x: 0, y: 4, w: 12, h: 8 }, [[`sum by (service) (rate(http_requests_total{${sel}}[1m]))`, '{{service}}']], 'reqps'),
  series(
    'Erros por serviço (4xx e 5xx)',
    { x: 12, y: 4, w: 12, h: 8 },
    [
      [`sum by (service) (rate(http_requests_total{${sel},status=~"5.."}[1m]))`, '{{service}} 5xx'],
      [`sum by (service) (rate(http_requests_total{${sel},status=~"4.."}[1m]))`, '{{service}} 4xx'],
    ],
    'reqps',
  ),
  series(
    'Latência p95 por serviço',
    { x: 0, y: 12, w: 12, h: 8 },
    [[`histogram_quantile(0.95, sum by (service, le) (rate(http_request_duration_seconds_bucket{${sel}}[5m])))`, '{{service}}']],
    's',
  ),
  series('Memória residente', { x: 12, y: 12, w: 12, h: 8 }, [[`process_resident_memory_bytes{${sel}}`, '{{service}}']], 'bytes'),
  panel('Rotas mais chamadas (15 min)', 'table', { x: 0, y: 20, w: 24, h: 9 }, [[`topk(20, sum by (service, method, route, status) (increase(http_requests_total{${sel}}[15m])))`, '']], {
    targets: [
      {
        refId: 'A',
        datasource: ds,
        expr: `topk(20, sum by (service, method, route, status) (increase(http_requests_total{${sel}}[15m])))`,
        format: 'table',
        instant: true,
      },
    ],
    transformations: [{ id: 'organize', options: { excludeByName: { Time: true }, renameByName: { Value: 'requisições' } } }],
  }),
];

const dashboard = {
  uid: 'scc-servicos',
  title: 'Smart Chain City — Serviços',
  tags: ['scc'],
  timezone: 'browser',
  refresh: '10s',
  time: { from: 'now-30m', to: 'now' },
  schemaVersion: 39,
  templating: {
    list: [
      {
        name: 'service',
        label: 'Serviço',
        type: 'query',
        datasource: ds,
        query: { query: 'label_values(http_requests_total, service)', refId: 'service' },
        includeAll: true,
        multi: true,
        allValue: '.*',
        current: { text: 'All', value: '$__all' },
        refresh: 2,
      },
    ],
  },
  panels,
};

writeFileSync(new URL('./dashboards/servicos.json', import.meta.url), `${JSON.stringify(dashboard, null, 2)}\n`);
console.log(`${panels.length} painéis`);
