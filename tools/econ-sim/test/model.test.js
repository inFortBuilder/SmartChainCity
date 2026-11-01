import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  attributeMultiplier,
  converter,
  medianPayback,
  poolBrakeLevel,
  poolReleasedUntil,
  shiftEarnings,
  targetPlayers,
  thalerUsd,
} from '../src/model.js';
import { mulberry32 } from '../src/rng.js';
import { evaluateGate, simulate } from '../src/simulate.js';

const params = JSON.parse(readFileSync(new URL('../params/base.json', import.meta.url)));
const quick = {
  priceUsd: 1,
  growth: { start: 2000, end: 3000 },
  days: 120,
  land: false,
  incomeSink: 0,
};

test('conversor do doc 04 §5 e THALER a dólar fixo', () => {
  assert.equal(converter(params.currency, 1), 20);
  assert.equal(converter(params.currency, 0.5), 10);
  assert.equal(thalerUsd(params.currency), 0.05);
});

test('multiplicadores do doc 02 §2.4, com teto de Exp. × Pet', () => {
  assert.equal(attributeMultiplier(params.multipliers, 10, 10), 3);
  assert.equal(attributeMultiplier({ ...params.multipliers, expPet: 9 }, 7, 1), 2.5);
});

test('moradia irregular rende 50% e evento soma bônus', () => {
  const base = { base: 100, attributes: 1, work: params.work };
  assert.equal(shiftEarnings({ ...base, regularized: true, eventWeek: false }), 100);
  assert.equal(shiftEarnings({ ...base, regularized: false, eventWeek: false }), 50);
  assert.ok(Math.abs(shiftEarnings({ ...base, regularized: true, eventWeek: true }) - 115) < 1e-9);
});

test('pool P2E libera o cronograma do doc 04 §3 ao longo do ano', () => {
  const y = params.p2ePool.yearlyReleaseScity;
  assert.ok(Math.abs(poolReleasedUntil(y, 364) - 123e6) < 1e-3);
  assert.ok(Math.abs(poolReleasedUntil(y, 729) - 225.5e6) < 1e-3);
  assert.equal(poolReleasedUntil(y, 10000), 410e6);
});

test('crescimento linear de start a end', () => {
  assert.equal(targetPlayers({ start: 10, end: 20 }, 0, 11), 10);
  assert.equal(targetPlayers({ start: 10, end: 20 }, 10, 11), 20);
});

test('mediana trata sem payback como infinito', () => {
  assert.equal(medianPayback([10, 20, 30]), 20);
  assert.equal(medianPayback([10, null, null]), null);
  assert.equal(medianPayback([]), null);
});

test('mesma semente, mesmo resultado; PRNG uniforme', () => {
  assert.deepEqual(simulate(params, quick).paybackByRarity, simulate(params, quick).paybackByRarity);
  const r = mulberry32(1);
  let s = 0;
  for (let i = 0; i < 100000; i++) s += r();
  assert.ok(Math.abs(s / 100000 - 0.5) < 0.01);
});

test('ledger fecha em zero', () => {
  for (const sinkScale of [0.5, 1, 4, 10]) {
    const r = simulate(params, { ...quick, sinkScale });
    assert.ok(Math.abs(r.ledgerError) < 1, `erro ${r.ledgerError}`);
  }
});

test('o dreno da saída é só o spread sobre o sacado', () => {
  const r = simulate(params, quick);
  const spread = params.currency.exitSpread;
  assert.ok(Math.abs(r.sinks.exitFee / (r.redeemedThaler / (1 - spread)) - spread) < 1e-9);
});

test('preço do SCITY muda o SCITY pago, não o payback em dólar', () => {
  const a = simulate(params, quick);
  const b = simulate(params, { ...quick, priceUsd: 0.5 });
  assert.deepEqual(a.paybackByRarity, b.paybackByRarity);
  assert.ok(Math.abs(b.scityPaid / a.scityPaid - 2) < 1e-6);
});

test('mais sinks reduzem o saque e sobem a razão', () => {
  const a = simulate(params, { ...quick, sinkScale: 1 });
  const b = simulate(params, { ...quick, sinkScale: 3 });
  assert.ok(b.sinkFaucetRatio > a.sinkFaucetRatio);
  assert.ok(b.usdOut < a.usdOut);
});

test('dreno sobre a renda fica no bucket próprio e o ledger fecha', () => {
  const r = simulate(params, { ...quick, incomeSink: 0.5 });
  assert.ok(Math.abs(r.ledgerError) < 1);
  assert.ok(r.sinks.income > 0.45 * r.faucets.work);
  assert.ok(r.sinks.income <= 0.5 * r.faucets.work + 1e-6);
});

test('com lotes ligados o ledger fecha e ninguém nasce dono', () => {
  const r = simulate(params, { ...quick, land: true });
  assert.ok(Math.abs(r.ledgerError) < 1, `erro ${r.ledgerError}`);
  assert.ok(r.landSold > 0);
  assert.ok(r.landUsdIn > 0);
  assert.ok(r.sinks.land > 0 && r.sinks.property > 0);
});

test('o estoque de lotes acaba e não vende além dele', () => {
  const tiers = [{ label: 'x', lots: 30, priceScity: 10 }];
  const p = { ...params, land: { ...params.land, tiers } };
  const r = simulate(p, { ...quick, land: true });
  assert.equal(r.landSold, 30);
  assert.ok(r.landSoldOutDay !== null);
});

test('preço menor barateia o lote em dólar', () => {
  const p = { ...params, land: { ...params.land, priceInUsd: false } };
  const a = simulate(p, { ...quick, land: true, priceUsd: 1 });
  const b = simulate(p, { ...quick, land: true, priceUsd: 0.2 });
  assert.ok(b.landUsdIn / b.landSold < a.landUsdIn / a.landSold);
});

test('lote em dólar não barateia quando o SCITY cai', () => {
  const p = { ...params, land: { ...params.land, priceInUsd: true } };
  const a = simulate(p, { ...quick, land: true, priceUsd: 1 });
  const b = simulate(p, { ...quick, land: true, priceUsd: 0.2 });
  assert.ok(Math.abs(b.landUsdIn / b.landSold - a.landUsdIn / a.landSold) < 1e-6);
});

test('freio do pool: zero até o início, cheio no limite', () => {
  assert.equal(poolBrakeLevel(50, 100, 0.7), 0);
  assert.ok(Math.abs(poolBrakeLevel(85, 100, 0.7) - 0.5) < 1e-9);
  assert.equal(poolBrakeLevel(100, 100, 0.7), 1);
  assert.equal(poolBrakeLevel(0, 0, 0.7), 0);
});

test('com freio o pool não esgota, o ledger fecha e o saque cai', () => {
  const pequeno = { ...params, p2ePool: { ...params.p2ePool, yearlyReleaseScity: [600000] } };
  const run = { ...quick, priceUsd: 0.2 };
  const sem = simulate(pequeno, { ...run, brake: false });
  const com = simulate(pequeno, { ...run, brake: true });
  assert.ok(sem.poolDryDay !== null);
  assert.equal(com.poolDryDay, null);
  assert.ok(com.brakeDays > 0);
  assert.ok(Math.abs(com.ledgerError) < 1);
  assert.ok(com.scityPaid <= 600000);
});

test('parâmetros de base adotam o dreno de 55% e o lote em dólar', () => {
  assert.equal(params.sinks.incomeRate, 0.55);
  assert.equal(params.land.priceInUsd, true);
  assert.equal(simulate(params, { ...quick, incomeSink: undefined }).incomeSink, 0.55);
});

test('o gate acusa cada motivo', () => {
  const gate = params.gate;
  const fora = {
    days: 365,
    dollarCoverage: 0.5,
    poolDryDay: 200,
    paybackByRarity: { common: 20, rare: 90, epic: null, legendary: 50 },
  };
  assert.equal(evaluateGate(fora, gate).reasons.length, 5);
  const ok = { days: 365, dollarCoverage: 1, poolDryDay: null, paybackByRarity: { common: 60 } };
  assert.deepEqual(evaluateGate(ok, gate), { pass: true, reasons: [] });
});

test('100 mil agentes em 365 dias em menos de 1 minuto', () => {
  const t0 = Date.now();
  simulate(params, { priceUsd: 1, growth: { start: 100000, end: 100000 } });
  assert.ok(Date.now() - t0 < 60000);
});
