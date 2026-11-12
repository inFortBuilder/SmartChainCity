#!/usr/bin/env node
/**
 * Converte uma cidade em OBJ para o mapa da Smart Chain City.
 *
 *   node bin/city-import.js <cidade.obj> <pasta-de-saída> [--half 17300]
 *
 * Gera cidade.glb (Meshopt), predios.json e os lotes (lotes.json + lotes.bin). O modelo pode ser de terceiros:
 * deixe a saída em .local/, fora do repositório, até confirmar a licença.
 */
import { createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import readline from 'node:readline';
import { parseArgs } from 'node:util';

import { Document, Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { meshopt, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

import {
  Components,
  LAYERS,
  buildingRecord,
  classifyObject,
  faceVertex,
  insideBase,
  parseMtl,
} from './lib/city-import.js';
import {
  LOT_POINTS,
  Raster,
  SiteGrid,
  ZONES,
  lotPolygon,
  lotPrice,
  RELEASE_THRESHOLD,
  assignDistricts,
  polygonArea,
  vacantSites,
  zoneOf,
} from './lib/lots.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    half: { type: 'string', default: '17300' },
    // Cidade vazia: só o traçado, e todo terreno de prédio vira lote à venda.
    'sem-predios': { type: 'boolean', default: false },
  },
});
const [input, outDir] = positionals;
if (!input || !outDir) {
  console.error('Uso: node bin/city-import.js <cidade.obj> <pasta-de-saída> [--half 17300]');
  process.exit(1);
}
const half = Number(values.half);
const empty = values['sem-predios'];

const mtlPath = join(dirname(input), `${basename(input, '.obj')}.mtl`);
const colors = parseMtl(readFileSync(mtlPath, 'utf8'));

// Posições num array crescente: são 1,3 milhão de vértices, e objetos JS não caberiam.
let positions = new Float64Array((3 * 1) << 21);
let vertexCount = 0;
const layers = Object.fromEntries(
  Object.keys(LAYERS).map((name) => [
    name,
    { index: [], faces: 0, map: new Map(), pos: [], col: [] },
  ])
);
const components = new Components();
const stats = { faces: 0, kept: 0, clipped: 0, skipped: 0 };

// Margem do lote além do prédio e parâmetros dos lotes vazios, em metros.
const LOT_MARGIN = 12;
const VACANT = { spacing: 50, radius: 15, roadReach: 80 };
const raster = new Raster(half);

let layer = null;
let color = [0.6, 0.6, 0.6];
let blocksLots = false;

const addVertex = (target, v, rgb) => {
  const key = rgb === color ? v : `${v}:${rgb.join()}`;
  let id = target.map.get(key);
  if (id === undefined) {
    id = target.pos.length / 3;
    target.map.set(key, id);
    const bias = LAYERS[layer].bias;
    target.pos.push(positions[v * 3], positions[v * 3 + 1] + bias, positions[v * 3 + 2]);
    target.col.push(rgb[0], rgb[1], rgb[2]);
  }
  return id;
};

const rl = readline.createInterface({ input: createReadStream(input), crlfDelay: Infinity });

for await (const line of rl) {
  const c0 = line.charCodeAt(0);
  if (c0 === 118 /* v */ && line.charCodeAt(1) === 32) {
    if ((vertexCount + 1) * 3 > positions.length) {
      const bigger = new Float64Array(positions.length * 2);
      bigger.set(positions);
      positions = bigger;
    }
    const parts = line.split(' ');
    positions[vertexCount * 3] = Number(parts[1]);
    positions[vertexCount * 3 + 1] = Number(parts[2]);
    positions[vertexCount * 3 + 2] = Number(parts[3]);
    vertexCount++;
  } else if (c0 === 111 /* o */ && line.charCodeAt(1) === 32) {
    const name = line.slice(2);
    layer = classifyObject(name);
    // Caminho de pedestre corta o quarteirão sem separar lotes; rua, água e parque separam.
    blocksLots =
      layer === 'water' ||
      (layer === 'roads' && !/^highway_(footway|path|cycleway|steps|track)/.test(name)) ||
      (layer === 'land' && /^leisure/.test(name));
  } else if (line.startsWith('usemtl ')) {
    color = colors[line.slice(7)] ?? color;
  } else if (c0 === 102 /* f */ && line.charCodeAt(1) === 32) {
    stats.faces++;
    if (!layer) {
      stats.skipped++;
      continue;
    }
    const face = line
      .slice(2)
      .trim()
      .split(/\s+/)
      .map((t) => faceVertex(t, vertexCount));
    const xs = face.map((v) => positions[v * 3]);
    const zs = face.map((v) => positions[v * 3 + 2]);
    // A base do chão é o próprio limite, não passa pelo recorte.
    if (layer !== 'ground' && !insideBase(xs, zs, half)) {
      stats.clipped++;
      continue;
    }
    stats.kept++;
    if (blocksLots) {
      for (let i = 1; i + 1 < face.length; i++) {
        raster.fillTriangle(xs[0], zs[0], xs[i], zs[i], xs[i + 1], zs[i + 1]);
      }
    }
    const target = layers[layer];
    target.faces++;
    if (layer === 'buildings') {
      for (let i = 1; i < face.length; i++) components.union(face[0], face[i]);
    }
    const ids = face.map((v) => addVertex(target, v, color));
    for (let i = 1; i + 1 < ids.length; i++) target.index.push(ids[0], ids[i], ids[i + 1]);
  }
}

// ─ Prédios: cada componente conexa é um prédio ─
const boxes = new Map();
for (const [v] of components.parent) {
  const root = components.find(v);
  const x = positions[v * 3];
  const y = positions[v * 3 + 1];
  const z = positions[v * 3 + 2];
  const box = boxes.get(root);
  if (!box) boxes.set(root, { minX: x, maxX: x, minY: y, maxY: y, minZ: z, maxZ: z });
  else {
    box.minX = Math.min(box.minX, x);
    box.maxX = Math.max(box.maxX, x);
    box.minY = Math.min(box.minY, y);
    box.maxY = Math.max(box.maxY, y);
    box.minZ = Math.min(box.minZ, z);
    box.maxZ = Math.max(box.maxZ, z);
  }
}
const buildings = [...boxes.values()].map(buildingRecord);

// ─ GLB: um nó por camada, cor por vértice, sem normais (sombreamento plano) ─
const doc = new Document().setLogger(new Logger(Logger.Verbosity.WARN));
const buffer = doc.createBuffer();
const scene = doc.createScene('cidade');
for (const [name, target] of Object.entries(layers)) {
  if (target.index.length === 0) continue;
  if (empty && name === 'buildings') continue;
  const prim = doc
    .createPrimitive()
    .setAttribute(
      'POSITION',
      doc.createAccessor().setType('VEC3').setArray(new Float32Array(target.pos)).setBuffer(buffer)
    )
    .setAttribute(
      'COLOR_0',
      doc.createAccessor().setType('VEC3').setArray(new Float32Array(target.col)).setBuffer(buffer)
    )
    .setIndices(
      doc
        .createAccessor()
        .setType('SCALAR')
        .setArray(new Uint32Array(target.index))
        .setBuffer(buffer)
    )
    .setMaterial(doc.createMaterial(name).setRoughnessFactor(0.9).setMetallicFactor(0));
  scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
}

await MeshoptEncoder.ready;
doc.createExtension(EXTMeshoptCompression);
await doc.transform(weld(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

mkdirSync(outDir, { recursive: true });
const glbPath = join(outDir, 'cidade.glb');
writeFileSync(glbPath, await io.writeBinary(doc));

// ─ Lotes ─
const buildingSites = buildings.map((b) => ({
  x: b.x,
  z: b.z,
  r: Math.hypot(b.w, b.d) / 2,
  h: b.h,
}));
const buildingGrid = new SiteGrid();
for (const site of buildingSites) buildingGrid.add(site, LOT_MARGIN);

// Só a mancha urbana recebe lotes vazios: a base tem 34 km, quase toda sem cidade.
const sortedX = buildings.map((b) => b.x).sort((a, b) => a - b);
const sortedZ = buildings.map((b) => b.z).sort((a, b) => a - b);
const pct = (list, p) => list[Math.floor((list.length - 1) * p)];
const extent = {
  minX: pct(sortedX, 0.01),
  maxX: pct(sortedX, 0.99),
  minZ: pct(sortedZ, 0.01),
  maxZ: pct(sortedZ, 0.99),
};
const vacant = vacantSites(extent, VACANT.spacing, raster, buildingGrid, VACANT);

const sites = [...buildingSites, ...vacant];
const lotGrid = new SiteGrid();
for (const site of sites) lotGrid.add(site, LOT_MARGIN);

const lots = [];
for (const site of sites) {
  const polygon = lotPolygon(site, lotGrid.neighbors(site, LOT_MARGIN), raster, LOT_MARGIN);
  const area = polygonArea(polygon);
  // Sobra de fronteira, menor que um terreno de verdade.
  if (area >= 60)
    // Sem prédios, o lote mantém a zona do que havia ali e fica à venda.
    lots.push({
      polygon,
      area,
      zone: zoneOf(site),
      vacant: empty || Boolean(site.vacant),
      h: empty ? 0 : site.h,
    });
}

// Bairros para a liberação em fases, do centro para fora.
const { district, districts } = assignDistricts(
  lots.map((lot) => [
    lot.polygon.reduce((s, p) => s + p[0], 0) / LOT_POINTS,
    lot.polygon.reduce((s, p) => s + p[1], 0) / LOT_POINTS,
  ]),
  [pct(sortedX, 0.5), pct(sortedZ, 0.5)]
);

// Binário: polígonos em Float32, área em Float32, zona e situação em Uint8, bairro em Uint16.
const polygons = new Float32Array(lots.length * LOT_POINTS * 2);
const areas = new Float32Array(lots.length);
const zones = new Uint8Array(lots.length);
const vacancy = new Uint8Array(lots.length);
lots.forEach((lot, i) => {
  lot.polygon.forEach(([x, z], k) => {
    polygons[(i * LOT_POINTS + k) * 2] = x;
    polygons[(i * LOT_POINTS + k) * 2 + 1] = z;
  });
  areas[i] = lot.area;
  zones[i] = lot.zone;
  vacancy[i] = lot.vacant ? 1 : 0;
});

mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, 'lotes.bin'),
  Buffer.concat([polygons, areas, zones, vacancy, district].map((a) => Buffer.from(a.buffer)))
);

const median = (list) => [...list].sort((a, b) => a - b)[list.length >> 1] ?? 0;
const lotSummary = {
  total: lots.length,
  ocupados: lots.filter((l) => !l.vacant).length,
  vazios: lots.filter((l) => l.vacant).length,
  area_mediana_m2: Math.round(median(lots.map((l) => l.area))),
  preco_mediano_scity: median(lots.map((l) => lotPrice(l.area, l.zone))),
  valor_total_vazios_scity: lots
    .filter((l) => l.vacant)
    .reduce((sum, l) => sum + lotPrice(l.area, l.zone), 0),
  por_zona: Object.fromEntries(
    ZONES.map((z, i) => [z.key, lots.filter((l) => l.zone === i).length])
  ),
  acima_do_gabarito: lots.filter((l) => l.h > ZONES[l.zone].max_height_m).length,
  bairros: districts.length,
};
writeFileSync(
  join(outDir, 'lotes.json'),
  JSON.stringify({
    pontos: LOT_POINTS,
    zonas: ZONES,
    resumo: lotSummary,
    liberacao: { limiar: RELEASE_THRESHOLD, abertos_no_inicio: 1 },
    bairros: districts,
  })
);

const heights = buildings.map((b) => b.h).sort((a, b) => a - b);
const summary = {
  fonte: basename(input),
  base_m: half * 2,
  faces: stats,
  camadas: Object.fromEntries(Object.entries(layers).map(([k, v]) => [k, v.faces])),
  predios: empty ? 0 : buildings.length,
  sem_predios: empty,
  // Centro da mancha urbana, para a página enquadrar a cidade mesmo sem prédios.
  centro: [pct(sortedX, 0.5), pct(sortedZ, 0.5)],
  altura_mediana_m: heights[Math.floor(heights.length / 2)] ?? 0,
  altura_maxima_m: heights.at(-1) ?? 0,
  glb_mb: Number((statSync(glbPath).size / 1048576).toFixed(1)),
  lotes: lotSummary,
};
writeFileSync(
  join(outDir, 'predios.json'),
  JSON.stringify({ resumo: summary, predios: empty ? [] : buildings })
);
console.log(JSON.stringify(summary, null, 2));
