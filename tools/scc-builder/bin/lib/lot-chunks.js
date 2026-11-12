/**
 * Divide os lotes da cidade em um arquivo por bairro, para o cliente baixar só
 * os bairros perto da câmera (spike E0.9, ADR-0009). O número de cada lote não
 * muda: o arquivo do bairro leva a lista de ids, e o cliente preenche os
 * mesmos arrays globais de antes.
 *
 * Formato de cada bloco (little-endian, alinhado em 4 bytes):
 *   Uint32 k · Uint32 ids[k] · Float32 pontos[k × n × 2] · Float32 áreas[k] · Uint8 zonas[k] · Uint8 vagos[k]
 */

/** Versão do formato; o cliente recusa versão que não conhece. */
export const CHUNK_FORMAT = 1;

/**
 * @param {{count: number, n: number, polygons: Float32Array, areas: Float32Array, zones: Uint8Array, vacant: Uint8Array, district: Uint16Array}} lots
 * @returns {Array<{order: number, ids: Uint32Array, vacant: number, bbox: number[], bytes: Uint8Array}>}
 */
export function splitLotsByDistrict(lots) {
  const { count, n, polygons, areas, zones, vacant, district } = lots;
  const groups = new Map();
  for (let i = 0; i < count; i++) {
    const d = district[i];
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(i);
  }

  return [...groups.keys()]
    .sort((a, b) => a - b)
    .map((order) => {
      const ids = Uint32Array.from(groups.get(order));
      const k = ids.length;
      const size = 4 + 4 * k + 4 * k * n * 2 + 4 * k + 2 * k;
      const buffer = new ArrayBuffer(Math.ceil(size / 4) * 4);
      new Uint32Array(buffer, 0, 1)[0] = k;
      new Uint32Array(buffer, 4, k).set(ids);
      const pts = new Float32Array(buffer, 4 + 4 * k, k * n * 2);
      const ar = new Float32Array(buffer, 4 + 4 * k + 4 * k * n * 2, k);
      const zoneOffset = 4 + 4 * k + 4 * k * n * 2 + 4 * k;
      const zo = new Uint8Array(buffer, zoneOffset, k);
      const va = new Uint8Array(buffer, zoneOffset + k, k);

      let minX = Infinity;
      let minZ = Infinity;
      let maxX = -Infinity;
      let maxZ = -Infinity;
      let free = 0;
      ids.forEach((id, j) => {
        pts.set(polygons.subarray(id * n * 2, (id + 1) * n * 2), j * n * 2);
        ar[j] = areas[id];
        zo[j] = zones[id];
        va[j] = vacant[id];
        free += vacant[id];
        for (let p = 0; p < n; p++) {
          const x = polygons[(id * n + p) * 2];
          const z = polygons[(id * n + p) * 2 + 1];
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minZ = Math.min(minZ, z);
          maxZ = Math.max(maxZ, z);
        }
      });
      const r = (v) => Math.round(v);
      return {
        order,
        ids,
        vacant: free,
        bbox: [r(minX), r(minZ), r(maxX), r(maxZ)],
        bytes: new Uint8Array(buffer),
      };
    });
}

/** Lê um bloco (o mesmo código roda no cliente). */
export function readChunk(buffer, n) {
  const k = new Uint32Array(buffer, 0, 1)[0];
  const ids = new Uint32Array(buffer, 4, k);
  const polygons = new Float32Array(buffer, 4 + 4 * k, k * n * 2);
  const areas = new Float32Array(buffer, 4 + 4 * k + 4 * k * n * 2, k);
  const zoneOffset = 4 + 4 * k + 4 * k * n * 2 + 4 * k;
  return {
    ids,
    polygons,
    areas,
    zones: new Uint8Array(buffer, zoneOffset, k),
    vacant: new Uint8Array(buffer, zoneOffset + k, k),
  };
}
