#!/usr/bin/env node
/**
 * Divide os lotes de uma cidade em um arquivo por bairro (spike E0.9).
 *
 *   node bin/city-chunks.js <pasta-da-cidade>
 *
 * Lê lotes.json e lotes.bin (saída do city-import.js) e grava:
 *   lotes/b<bairro>.bin   os lotes de cada bairro (formato em lib/lot-chunks.js)
 *   lotes-bairros.bin     o bairro de cada lote (Uint16), para achar o bloco de um id
 * e acrescenta `blocos` ao lotes.json. O lotes.bin inteiro continua lá para as
 * ferramentas; o mapa passa a baixar só os blocos perto da câmera.
 */
import fs from 'node:fs';
import path from 'node:path';

import { CHUNK_FORMAT, splitLotsByDistrict } from './lib/lot-chunks.js';

const cityDir = process.argv[2];
if (!cityDir) {
  console.error('Uso: node bin/city-chunks.js <pasta-da-cidade>');
  process.exit(1);
}

const metaFile = path.join(cityDir, 'lotes.json');
const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
const bin = fs.readFileSync(path.join(cityDir, 'lotes.bin'));
const buffer = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
const n = meta.pontos;
const count = meta.resumo.total;

// Mesmo layout que o mapa lia: pontos, áreas, zonas, vagos, bairro.
const polygons = new Float32Array(buffer, 0, count * n * 2);
const areas = new Float32Array(buffer, polygons.byteLength, count);
const zones = new Uint8Array(buffer, polygons.byteLength + areas.byteLength, count);
const vacant = new Uint8Array(buffer, polygons.byteLength + areas.byteLength + count, count);
const districtOffset = polygons.byteLength + areas.byteLength + 2 * count;
if (buffer.byteLength < districtOffset + 2 * count) {
  console.error('lotes.bin sem bairros: gere a cidade de novo com o city-import.js.');
  process.exit(1);
}
const district = new Uint16Array(buffer, districtOffset, count);

const started = Date.now();
const chunks = splitLotsByDistrict({ count, n, polygons, areas, zones, vacant, district });
const outDir = path.join(cityDir, 'lotes');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir);
for (const c of chunks) fs.writeFileSync(path.join(outDir, `b${c.order}.bin`), c.bytes);
fs.writeFileSync(
  path.join(cityDir, 'lotes-bairros.bin'),
  Buffer.from(district.buffer, district.byteOffset, district.byteLength)
);

meta.blocos = {
  formato: CHUNK_FORMAT,
  arquivo: 'lotes/b{bairro}.bin',
  bairro_de_cada_lote: 'lotes-bairros.bin',
  bairros: chunks.map((c) => ({
    bairro: c.order,
    lotes: c.ids.length,
    vagos: c.vacant,
    bbox: c.bbox,
    bytes: c.bytes.byteLength,
  })),
};
fs.writeFileSync(metaFile, JSON.stringify(meta));

const sizes = chunks.map((c) => c.bytes.byteLength).sort((a, b) => a - b);
const kb = (v) => `${Math.round(v / 1024)} KB`;
console.log(
  `${chunks.length} blocos em ${Date.now() - started} ms · mediano ${kb(sizes[sizes.length >> 1])}, maior ${kb(sizes.at(-1))} · lotes-bairros.bin ${kb(district.byteLength)}`
);
