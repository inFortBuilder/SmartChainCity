#!/usr/bin/env node
/**
 * Põe um prédio público (o Centro Administrativo) no centro da cidade.
 *
 *   node bin/city-civic.js <pasta-da-cidade> <pasta-do-predio> [--nome "Centro Administrativo"] [--margem 6]
 *
 * <pasta-da-cidade> é a saída do city-import.js (lotes.json, lotes.bin,
 * predios.json). <pasta-do-predio> tem os LODs e o <nome>.meta.json gerados
 * pelo tools/scc-optimize (preset SCC). Grava civico.json na pasta da cidade:
 * onde o prédio fica, girado quanto, e quais lotes saem da venda.
 */
import fs from 'node:fs';
import path from 'node:path';

import { findCivicSite } from './lib/civic.js';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const k = args.indexOf(`--${name}`);
  return k >= 0 ? args[k + 1] : fallback;
};
const [cityDir, buildingDir] = args.filter(
  (a, k) => !a.startsWith('--') && !args[k - 1]?.startsWith('--')
);
if (!cityDir || !buildingDir) {
  console.error(
    'Uso: node bin/city-civic.js <pasta-da-cidade> <pasta-do-predio> [--nome "..."] [--margem 6]'
  );
  process.exit(1);
}
const name = flag('nome', 'Centro Administrativo');
const margin = Number(flag('margem', 6));

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const lotsMeta = read(path.join(cityDir, 'lotes.json'));
const city = read(path.join(cityDir, 'predios.json'));
const metaFile = fs.readdirSync(buildingDir).find((f) => f.endsWith('.meta.json'));
if (!metaFile) {
  console.error(`Sem .meta.json em ${buildingDir}: gere os LODs com o tools/scc-optimize antes.`);
  process.exit(1);
}
const building = read(path.join(buildingDir, metaFile));

// lotes.bin começa pelos polígonos: count × pontos × (x, z) em Float32.
const bin = fs.readFileSync(path.join(cityDir, 'lotes.bin'));
const n = lotsMeta.pontos;
const count = lotsMeta.resumo.total;
const polys = new Float32Array(bin.buffer, bin.byteOffset, count * n * 2);
const rings = Array.from({ length: count }, (_, i) =>
  Array.from({ length: n }, (_, k) => [polys[(i * n + k) * 2], polys[(i * n + k) * 2 + 1]])
);

const [w, , d] = building.bounds.size;
const target = city.resumo?.centro ?? city.centro;
if (!target) {
  console.error('predios.json sem resumo.centro: gere a cidade de novo com o city-import.js.');
  process.exit(1);
}
const started = Date.now();
const site = findCivicSite(rings, { w, d }, target, { margin });
if (!site) {
  console.error(`Nenhum lugar para ${w} × ${d} m a até 2 km do centro: diminua a --margem.`);
  process.exit(2);
}

const rel = path.relative(cityDir, buildingDir).split(path.sep).join('/');
const out = {
  nome: name,
  funcao: 'Prefeitura: sede do governo da cidade; não está à venda',
  modelo: {
    origem: building.source,
    lods: ['lod0', 'lod1', 'lod2']
      .filter((k) => building.lods[k])
      .map((k) => `${rel}/${building.lods[k].file}`),
    triangulos: building.lods.lod0?.triangles ?? 0,
    tamanho_m: building.bounds.size,
  },
  centro: site.center.map((v) => Math.round(v * 10) / 10),
  angulo: site.angle,
  distancia_do_centro_m: site.distance,
  margem_m: margin,
  lotes: site.lots,
};
fs.writeFileSync(path.join(cityDir, 'civico.json'), JSON.stringify(out, null, 2));
const area = Math.round((w + 2 * margin) * (d + 2 * margin));
console.log(
  `${name}: ${w} × ${d} m a ${site.distance} m do centro, ${site.lots.length} lotes (${area} m² com a praça) em ${Date.now() - started} ms`
);
