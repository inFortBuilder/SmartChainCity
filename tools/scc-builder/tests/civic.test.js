import { describe, expect, it } from 'vitest';

import { findCivicSite, footprintSamples, lotIndex } from '../bin/lib/civic.js';

const square = (x, z, s) => [
  [x, z],
  [x + s, z],
  [x + s, z + s],
  [x, z + s],
];

// Duas quadras de 3 × 3 lotes de 40 m, separadas por uma rua de 20 m em x = 120..140.
const lots = [];
for (const ox of [0, 140]) {
  for (let a = 0; a < 3; a++)
    for (let b = 0; b < 3; b++) lots.push(square(ox + a * 40, b * 40, 40));
}

describe('footprintSamples', () => {
  it('cobre os cantos do retângulo girado', () => {
    const pts = footprintSamples(0, 0, 20, 10, 0, 5);
    expect(pts).toContainEqual([-10, -5]);
    expect(pts).toContainEqual([10, 5]);
  });
});

describe('lotIndex', () => {
  it('acha o lote, perdoa fresta pequena e recusa a rua', () => {
    const idx = lotIndex(lots);
    expect(idx.lotAt(20, 20)).toBe(0);
    expect(idx.lotAt(121, 60)).toBeGreaterThanOrEqual(0); // fresta de 1 m
    expect(idx.lotAt(130, 60)).toBe(-1); // meio da rua
  });
});

describe('findCivicSite', () => {
  it('põe o prédio na quadra, sem cruzar a rua, o mais perto possível do centro', () => {
    // Centro em cima da rua: o prédio tem de ir para uma das quadras.
    const site = findCivicSite(lots, { w: 60, d: 60 }, [130, 60], { margin: 4, step: 5 });
    expect(site).not.toBeNull();
    const [cx] = site.center;
    expect(cx + 34 <= 122.5 || cx - 34 >= 137.5).toBe(true);
    expect(site.lots.length).toBeGreaterThanOrEqual(4);
  });

  it('devolve null quando nada cabe', () => {
    expect(findCivicSite(lots, { w: 200, d: 200 }, [60, 60], { radius: 100 })).toBeNull();
  });
});
