import { describe, expect, it } from 'vitest';

import { readChunk, splitLotsByDistrict } from '../bin/lib/lot-chunks.js';

// 5 lotes de 4 pontos em 2 bairros, fora de ordem.
const n = 4;
const count = 5;
const polygons = new Float32Array(count * n * 2).map((_, k) => k);
const areas = Float32Array.from([10, 20, 30, 40, 50]);
const zones = Uint8Array.from([0, 1, 2, 0, 1]);
const vacant = Uint8Array.from([1, 0, 1, 1, 0]);
const district = Uint16Array.from([1, 0, 1, 0, 1]);

describe('splitLotsByDistrict', () => {
  const chunks = splitLotsByDistrict({ count, n, polygons, areas, zones, vacant, district });

  it('agrupa por bairro e conta os vagos', () => {
    expect(chunks.map((c) => c.order)).toEqual([0, 1]);
    expect([...chunks[0].ids]).toEqual([1, 3]);
    expect([...chunks[1].ids]).toEqual([0, 2, 4]);
    expect(chunks[1].vacant).toBe(2);
  });

  it('o bloco lido devolve os mesmos dados do lote original', () => {
    const c = readChunk(chunks[1].bytes.buffer, n);
    expect([...c.ids]).toEqual([0, 2, 4]);
    expect([...c.areas]).toEqual([10, 30, 50]);
    expect([...c.zones]).toEqual([0, 2, 1]);
    expect([...c.vacant]).toEqual([1, 1, 0]);
    expect([...c.polygons.subarray(n * 2, n * 4)]).toEqual([
      ...polygons.subarray(2 * n * 2, 3 * n * 2),
    ]);
  });

  it('bbox cobre os pontos do bairro e o buffer fica alinhado em 4 bytes', () => {
    expect(chunks[0].bbox[0]).toBe(8);
    expect(chunks.every((c) => c.bytes.byteLength % 4 === 0)).toBe(true);
  });
});
