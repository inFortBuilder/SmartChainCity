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

const BIN = 100;
const bins = new Map();
for (let i = 0; i < count; i++) {
  if (!vacant[i]) continue;
  const area = Math.max(BIN, Math.round(areas[i] / BIN) * BIN);
  const key = `${zones[i]}:${area}`;
  bins.set(key, (bins.get(key) ?? 0) + 1);
}

const lots = [...bins.entries()]
  .map(([key, n]) => {
    const [zone, area] = key.split(':').map(Number);
    return { zone: meta.zonas[zone].key, area, count: n };
  })
  .sort((a, b) => a.zone.localeCompare(b.zone) || a.area - b.area);

const total = lots.reduce((s, l) => s + l.count, 0);
writeFileSync(
  out,
  `${JSON.stringify(
    {
      fonte: `lotes vazios de ${dir.replace(/\\/g, '/').split('/').filter(Boolean).at(-1)}, faixas de ${BIN} m²`,
      total,
      lots,
    },
    null,
    2
  )}\n`
);
console.log(`${total} lotes vazios em ${lots.length} faixas → ${out}`);
