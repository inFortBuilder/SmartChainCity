/**
 * Divisão por bairro entre processos do realtime (E3.9). Cada sala é de um bairro (ou de um lote, no
 * interior), então processos diferentes podem cuidar de bairros diferentes sem dividir estado. A regra
 * é a mesma no cliente (docs/proposta-cidade-realista/realtime-shard.js, conferida no teste):
 * FNV-1a de 32 bits da chave, módulo o número de processos.
 */
export const fnv1a = (text: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

export const districtKey = (city: string, district: number) => `${city}:${district}`;
export const interiorKey = (city: string, lot: number) => `${city}:lote:${lot}`;
export const shardIndex = (key: string, count: number) => (count <= 1 ? 0 : fnv1a(key) % count);

/** `SHARD=i/n` (ex.: 0/3): este processo é o i de n. Sem ele, cuida de tudo. */
export function parseShard(value: string | undefined): { index: number; count: number } | null {
  if (!value) return null;
  const m = /^(\d+)\/(\d+)$/.exec(value.trim());
  if (!m) throw new Error('SHARD precisa ser i/n, por exemplo 0/3.');
  const index = Number(m[1]);
  const count = Number(m[2]);
  if (count < 1 || index >= count) throw new Error('SHARD: o índice vai de 0 a n−1.');
  return { index, count };
}

/** A chave é deste processo? */
export const owns = (shard: { index: number; count: number } | null, key: string) => !shard || shardIndex(key, shard.count) === shard.index;
