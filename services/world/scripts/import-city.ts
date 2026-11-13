/**
 * Carrega os lotes de uma cidade convertida (tools/scc-builder city-import +
 * city-chunks) no Postgres do world: zonas, bairros, área e situação. Lotes
 * já vendidos ou reservados mantêm o dono.
 *
 *   pnpm --filter @scc/world import:city ../../.local/cidades/pittsburg --code pittsburg --nome "Pittsburg, Califórnia"
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Pool } from 'pg';

import type { City, Lot } from '../src/domain/lots.js';
import { PostgresWorldStore } from '../src/infra/db/postgres-store.js';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const k = args.indexOf(`--${name}`);
  return k >= 0 ? args[k + 1]! : fallback;
};
const dir = resolve(args.find((a, k) => !a.startsWith('--') && !args[k - 1]?.startsWith('--')) ?? '');
const code = flag('code', 'pittsburg');
const name = flag('nome', 'Pittsburg, Califórnia');

const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Defina DATABASE_URL.');

type ZoneJson = { key: string; label: string; price: number; max_height_m: number; far: number; setback_m: number };
const meta = JSON.parse(readFileSync(join(dir, 'lotes.json'), 'utf8')) as {
  pontos: number;
  zonas: ZoneJson[];
  resumo: { total: number };
  liberacao?: { limiar: number; abertos_no_inicio: number };
  bairros: unknown[];
};
let civic: { lotes: number[] } | null = null;
try {
  civic = JSON.parse(readFileSync(join(dir, 'civico.json'), 'utf8'));
} catch {
  civic = null;
}

// lotes.bin: pontos, áreas (Float32), zonas, vagos (Uint8), bairro (Uint16).
const bin = readFileSync(join(dir, 'lotes.bin'));
const buffer = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
const count = meta.resumo.total;
const polyBytes = count * meta.pontos * 2 * 4;
const areas = new Float32Array(buffer, polyBytes, count);
const zones = new Uint8Array(buffer, polyBytes + count * 4, count);
const vacant = new Uint8Array(buffer, polyBytes + count * 5, count);
const district = new Uint16Array(buffer, polyBytes + count * 6, count);
const civicSet = new Set(civic?.lotes ?? []);

const city: City = {
  code,
  name,
  zones: meta.zonas.map((z) => ({
    key: z.key,
    label: z.label,
    usdPerM2: z.price,
    maxHeightM: z.max_height_m,
    far: z.far,
    setbackM: z.setback_m,
  })),
  openCount: meta.liberacao?.abertos_no_inicio ?? 1,
  districtCount: meta.bairros.length,
  releaseThreshold: meta.liberacao?.limiar ?? 0.7,
};

const lots: Pick<Lot, 'id' | 'district' | 'zone' | 'areaM2' | 'status'>[] = [];
for (let i = 0; i < count; i++) {
  // Lote ocupado na conversão (prédio existente) não está à venda: fica como da cidade.
  const status = civicSet.has(i) || !vacant[i] ? 'civic' : 'vacant';
  lots.push({ id: i, district: district[i]!, zone: meta.zonas[zones[i]!]!.key, areaM2: areas[i]!, status });
}

const started = Date.now();
const pool = new Pool({ connectionString: url });
await new PostgresWorldStore(pool).importCity(city, lots);
await pool.end();
console.log(
  `${name}: ${lots.length.toLocaleString('pt-BR')} lotes em ${city.districtCount} bairros (${civicSet.size} da Prefeitura) em ${((Date.now() - started) / 1000).toFixed(1)} s`,
);
