#!/usr/bin/env node
/**
 * node src/cli.js --scenario p100 --growth base   um cenário
 * node src/cli.js --all [--gate]                  os 3 × 3 cenários; --gate falha fora da meta
 * node src/cli.js --sweep                         varre a escala dos sinks fixos
 * node src/cli.js --sweep-income                  varre um dreno proporcional à renda
 *
 * Opções: --days N · --sink-scale X · --income-sink R · --exp-pet M · --no-land · --land-usd · --no-brake · --params arquivo.json · --out pasta
 * Relatórios em out/ (CSV, HTML e JSON).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { printSummary, printSweep, summaryRow, toCsv, toHtml } from './report.js';
import { evaluateGate, simulate } from './simulate.js';

const here = dirname(fileURLToPath(import.meta.url));

const { values: opts } = parseArgs({
  options: {
    scenario: { type: 'string', default: 'p100' },
    growth: { type: 'string', default: 'base' },
    days: { type: 'string' },
    'sink-scale': { type: 'string' },
    'income-sink': { type: 'string' },
    'exp-pet': { type: 'string' },
    params: { type: 'string', default: join(here, '..', 'params', 'base.json') },
    out: { type: 'string', default: join(here, '..', 'out') },
    all: { type: 'boolean', default: false },
    sweep: { type: 'boolean', default: false },
    'sweep-income': { type: 'boolean', default: false },
    gate: { type: 'boolean', default: false },
    'no-land': { type: 'boolean', default: false },
    'land-usd': { type: 'boolean', default: false },
    'no-brake': { type: 'boolean', default: false },
  },
});

const params = JSON.parse(readFileSync(resolve(opts.params), 'utf8'));
if (opts['exp-pet']) params.multipliers.expPet = Number(opts['exp-pet']);
if (opts['land-usd']) params.land.priceInUsd = true;
const prices = params.scenarios.priceUsd;
const growths = params.scenarios.growth;
const days = opts.days ? Number(opts.days) : undefined;
const sinkScale = opts['sink-scale'] ? Number(opts['sink-scale']) : 1;
const incomeSinkOpt = opts['income-sink'] ? Number(opts['income-sink']) : undefined;

const runOne = (priceKey, growthKey, scale = sinkScale, incomeSink = incomeSinkOpt) => {
  if (!(priceKey in prices) || !(growthKey in growths)) {
    throw new Error(`Cenário desconhecido: ${priceKey}/${growthKey}`);
  }
  const result = simulate(params, {
    priceUsd: prices[priceKey],
    growth: growths[growthKey],
    sinkScale: scale,
    incomeSink,
    land: opts['no-land'] ? false : undefined,
    brake: opts['no-brake'] ? false : undefined,
    days,
  });
  if (Math.abs(result.ledgerError) > 1) {
    throw new Error(`Ledger não fechou em ${priceKey}/${growthKey}: ${result.ledgerError}`);
  }
  return summaryRow(`${priceKey}/${growthKey}`, result, evaluateGate(result, params.gate));
};

const scenarios = [];
const sweep = [];

if (opts.sweep) {
  for (const scale of [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 10]) {
    sweep.push(runOne(opts.scenario, opts.growth, scale));
  }
  printSweep(sweep, params.gate);
} else if (opts['sweep-income']) {
  for (const rate of [0, 0.2, 0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]) {
    sweep.push(runOne(opts.scenario, opts.growth, sinkScale, rate));
  }
  printSweep(sweep, params.gate);
} else if (opts.all) {
  for (const p of Object.keys(prices)) {
    for (const g of Object.keys(growths)) scenarios.push(runOne(p, g));
  }
  printSummary(scenarios);
} else {
  scenarios.push(runOne(opts.scenario, opts.growth));
  printSummary(scenarios);
}

mkdirSync(opts.out, { recursive: true });
const rows = [...scenarios, ...sweep];
writeFileSync(join(opts.out, 'relatorio.csv'), toCsv(rows));
writeFileSync(join(opts.out, 'relatorio.json'), JSON.stringify(rows, null, 2));
writeFileSync(
  join(opts.out, 'relatorio.html'),
  toHtml({ scenarios, sweep, generatedAt: new Date().toISOString() })
);
console.log(`\nRelatórios em ${opts.out}`);

if (opts.gate && rows.some((r) => !r.aprovado)) {
  console.error('REPROVADO: ao menos um cenário ficou fora do critério do ROADMAP E0.5.');
  process.exit(1);
}
