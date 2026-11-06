/** Relatórios: tabela de terminal, CSV e HTML anexáveis ao PR. */

const RARITIES = ['common', 'rare', 'epic', 'legendary'];
const num = (n, d = 0) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const days = (v) => (v === null ? 'nunca' : String(v));

/** Linha plana de um cenário, base do CSV e das tabelas. */
export function summaryRow(name, r, gate) {
  return {
    cenario: name,
    preco_usd: r.priceUsd,
    escala_sinks: r.sinkScale,
    dreno_renda: r.incomeSink,
    jogadores_ativos: r.activePlayers,
    payback_comum: r.paybackByRarity.common,
    payback_raro: r.paybackByRarity.rare,
    payback_epico: r.paybackByRarity.epic,
    payback_lendario: r.paybackByRarity.legendary,
    sinks_faucets: Number(r.sinkFaucetRatio.toFixed(3)),
    dreno_com_saques: Number(r.drainRatioWithRedemption.toFixed(3)),
    thaler_per_capita: Math.round(r.thalerPerCapita),
    scity_pago_ano: Math.round(r.scityPaid),
    pool_esgotou_dia: r.poolDryDay,
    freio_dias: r.brakeDays,
    freio_primeiro_dia: r.brakeFirstDay,
    freio_pico: Number(r.peakBrake.toFixed(2)),
    usd_entrou: Math.round(r.usdIn),
    usd_saiu: Math.round(r.usdOut),
    cobertura: Number(r.dollarCoverage.toFixed(2)),
    lotes_vendidos: r.landSold,
    usd_lotes: Math.round(r.landUsdIn),
    scity_comprado: Math.round(r.scityBought),
    lotes_esgotam_dia: r.landSoldOutDay,
    lotes_restantes: r.landStockLeft,
    preco_lote_mediano: Math.round(r.landPriceMedianScity),
    aprovado: gate.pass,
    motivos: gate.reasons.join('; '),
  };
}

export function toCsv(rows) {
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0]);
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}

export function printSummary(rows) {
  for (const r of rows) {
    const paybacks = [r.payback_comum, r.payback_raro, r.payback_epico, r.payback_lendario]
      .map(days)
      .join(' / ');
    console.log(
      `${r.aprovado ? 'OK    ' : 'FALHA '} ${r.cenario.padEnd(14)} payback C/R/E/L ${paybacks.padEnd(24)} ` +
        `cobertura ${r.cobertura.toFixed(2)}  sinks/faucets ${r.sinks_faucets.toFixed(2)}  SCITY ${num(r.scity_pago_ano)}` +
        `${r.pool_esgotou_dia ? `  pool esgota no dia ${r.pool_esgotou_dia}` : ''}` +
        `${r.freio_dias ? `  freio ${r.freio_dias} dias, pico ${r.freio_pico}` : ''}`
    );
  }
}

export function printSweep(rows, gate) {
  console.log('escala  renda  sinks/faucets  c/saques  payback C/R/E/L          40–78?  cobertura ≥ 1?');
  for (const r of rows) {
    const list = [r.payback_comum, r.payback_raro, r.payback_epico, r.payback_lendario];
    const okPayback = list.every(
      (d) => d !== null && d >= gate.paybackMinDays && d <= gate.paybackMaxDays
    );
    console.log(
      `${String(r.escala_sinks).padStart(5)}  ${r.dreno_renda.toFixed(2)}  ${r.sinks_faucets.toFixed(2).padStart(13)}  ` +
        `${r.dreno_com_saques.toFixed(2).padStart(8)}  ${list.map(days).join(' / ').padEnd(24)} ${(okPayback ? 'sim' : 'não').padEnd(7)} ` +
        `${r.cobertura >= gate.minDollarCoverage ? 'sim' : 'não'} (${r.cobertura.toFixed(2)})`
    );
  }
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function table(rows, cols) {
  const head = cols.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join('');
  const body = rows
    .map(
      (r) =>
        `<tr>${cols
          .map(([key]) => {
            const v = r[key];
            const text = v === null ? '—' : typeof v === 'number' ? num(v, Number.isInteger(v) ? 0 : 2) : v;
            return `<td>${escapeHtml(text === true ? 'sim' : text === false ? 'não' : text)}</td>`;
          })
          .join('')}</tr>`
    )
    .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function toHtml({ scenarios, sweep, generatedAt }) {
  const scenarioCols = [
    ['cenario', 'Cenário'],
    ['jogadores_ativos', 'Ativos'],
    ...RARITIES.map((_, i) => [
      ['payback_comum', 'payback_raro', 'payback_epico', 'payback_lendario'][i],
      ['Comum', 'Raro', 'Épico', 'Lendário'][i],
    ]),
    ['sinks_faucets', 'Sinks/faucets'],
    ['dreno_com_saques', 'Dreno c/ saques'],
    ['thaler_per_capita', 'THALER per capita'],
    ['scity_pago_ano', 'SCITY pago'],
    ['pool_esgotou_dia', 'Pool esgota (dia)'],
    ['freio_dias', 'Dias com freio'],
    ['freio_pico', 'Pico do freio'],
    ['usd_entrou', 'US$ entrou'],
    ['usd_saiu', 'US$ saiu'],
    ['cobertura', 'Cobertura'],
    ['lotes_vendidos', 'Lotes vendidos'],
    ['usd_lotes', 'US$ de lotes'],
    ['aprovado', 'Aprovado'],
  ];
  const sweepCols = [
    ['escala_sinks', 'Escala dos sinks'],
    ['dreno_renda', 'Dreno sobre a renda'],
    ['sinks_faucets', 'Sinks/faucets'],
    ['dreno_com_saques', 'Dreno c/ saques'],
    ['payback_comum', 'Comum'],
    ['payback_raro', 'Raro'],
    ['payback_epico', 'Épico'],
    ['payback_lendario', 'Lendário'],
    ['usd_saiu', 'US$ saiu'],
    ['cobertura', 'Cobertura'],
  ];
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Simulador econômico SCC</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;margin:24px;color:#1b1f24;background:#fff}
table{border-collapse:collapse;margin:12px 0;font-variant-numeric:tabular-nums}
th,td{border:1px solid #d0d7de;padding:4px 10px;text-align:right}
th:first-child,td:first-child{text-align:left}th{background:#f3f4f6}
</style></head><body>
<h1>Simulador econômico — relatório</h1>
<p>Gerado em ${escapeHtml(generatedAt)}. Payback em dias (mediana da coorte inicial que não saiu do jogo).</p>
<h2>Cenários</h2>${table(scenarios, scenarioCols)}
${sweep.length ? `<h2>Varredura da escala dos sinks</h2>${table(sweep, sweepCols)}` : ''}
</body></html>
`;
}
