#!/usr/bin/env node
/**
 * Resume os lotes gerados pelo tools/scc-builder/bin/city-import.js em faixas
 * de área, para o simulador vender o estoque real em vez de faixas genéricas.
 *
 *   node scripts/lotes-para-params.mjs <pasta com lotes.json e lotes.bin> <saída.json>
 *
 * Só contagens por faixa de 100 m² e zona: nenhuma geometria sai daqui.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, out] = process.argv.slice(2);
if (!dir || !out) {
  console.error('Uso: node scripts/lotes-para-params.mjs <pasta-dos-lotes> <saída.json>');
  process.exit(1);
}

const meta = JSON.parse(readFileSync(join(dir, 'lotes.json'), 'utf8'));
const raw = readFileSync(join(dir, 'lotes.bin'));
const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
const count = meta.resumo.total;
const polygonsBytes = count * meta.pontos * 2 * 4;
const areas = new Float32Array(buffer, polygonsBytes, count);
const zones = new Uint8Array(buffer, polygonsBytes + count * 4, count);
const vacant = new Uint8Array(buffer, polygonsBytes + count * 5, count);
// Bairro em Uint16 no fim, quando o conversor gerou os bairros.
const hasDistricts = raw.byteLength >= polygonsBytes + count * 8;
const district = hasDistricts ? new Uint16Array(buffer, polygonsBytes + count * 6, count) : null;

// Faixas de 200 m²: com 198 bairros, faixas menores fariam um arquivo grande sem mudar o resultado.
const BIN = 200;
const bins = new Map();
for (let i = 0; i < count; i++) {
  if (!vacant[i]) continue;
  const area = Math.max(BIN, Math.round(areas[i] / BIN) * BIN);
  const key = `${district ? district[i] : 0}:${zones[i]}:${area}`;
  bins.set(key, (bins.get(key) ?? 0) + 1);
}

const groups = new Map();
for (const [key, n] of bins) {
  const [d, zone, area] = key.split(':').map(Number);
  if (!groups.has(d)) groups.set(d, []);
  groups.get(d).push({ zone: meta.zonas[zone].key, area, count: n });
}
const bairros = [...groups.entries()]
  .sort((a, b) => a[0] - b[0])
  .map(([order, lots]) => ({
    order,
    lots: lots.sort((a, b) => a.zone.localeCompare(b.zone) || a.area - b.area),
  }));
const lots = bairros.flatMap((b) => b.lots);
const total = lots.reduce((s, l) => s + l.count, 0);
writeFileSync(
  out,
  `${JSON.stringify(
    {
      fonte: `lotes vazios de ${dir.replace(/\\/g, '/').split('/').filter(Boolean).at(-1)}, faixas de ${BIN} m²`,
      total,
      liberacao: meta.liberacao ?? null,
      bairros: district ? bairros : undefined,
      lots: district ? undefined : lots,
    },
    null,
    2
  )}\n`
);
console.log(`${total} lotes vazios, ${bairros.length} bairro(s), ${lots.length} faixas → ${out}`);
