// Divisão por bairro entre processos do realtime (E3.9). `?realtime=` aceita uma
// lista separada por vírgula; cada bairro (e cada interior de lote) vai sempre
// para o mesmo processo. A regra é a do servidor (services/realtime/src/shard.ts):
// FNV-1a de 32 bits da chave, módulo o número de processos. Cada processo sobe
// com SHARD=i/n e recusa o que não é dele.

// Fora do navegador (o teste do realtime importa este arquivo), sem location nem window.
const params = new URLSearchParams(globalThis.location?.search ?? '');
export const REALTIME_URLS = (params.get('realtime') ?? globalThis.SCC_REALTIME ?? 'http://127.0.0.1:8050')
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);

export const fnv1a = (text) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

export const districtKey = (city, district) => `${city}:${district}`;
export const interiorKey = (city, lot) => `${city}:lote:${lot}`;
export const shardIndex = (key, count) => (count <= 1 ? 0 : fnv1a(key) % count);

/** O processo do realtime para a chave. */
export const realtimeFor = (key, urls = REALTIME_URLS) => urls[shardIndex(key, urls.length)];
