import { describe, expect, it } from 'vitest';

import { ROAD_PIECES, flipV, normalizePositions, rotateNormals } from '../bin/lib/road-kit.js';

describe('kit de ruas', () => {
  it('as peças do street view, com o cruzamento de 2 faixas juntando três peças do FBX', () => {
    expect(Object.keys(ROAD_PIECES)).toEqual([
      'reta2',
      'reta4',
      'cruz2',
      'cruz4',
      'faixa',
      'meiofio',
      'calcada',
      'asfalto',
    ]);
    expect(ROAD_PIECES.cruz2).toEqual(['modular_kit238', 'modular_kit239', 'modular_kit240']);
    expect(ROAD_PIECES.reta2).toBe('modular_kit05');
  });

  it('centro em x e z na origem, chão em y = 0, sem girar a reta mais larga que comprida', () => {
    // Uma reta de 7,71 m de largura (x) por 5,70 m (z), longe da origem e abaixo do zero, como no FBX.
    const pos = new Float32Array([
      10, -15.2, 100, 17.71, -15.2, 100, 10, -15.2, 105.7, 17.71, -15.05, 105.7,
    ]);
    const { positions, size, rotated } = normalizePositions(pos);
    expect(rotated).toBe(false);
    expect(size).toEqual({ w: 7.71, l: 5.7, h: 0.15 });
    expect(positions[0]).toBeCloseTo(-3.855);
    expect(positions[1]).toBeCloseTo(0);
    expect(positions[2]).toBeCloseTo(-2.85);
    expect(positions[10]).toBeCloseTo(0.15);
  });

  it('com alongZ, a peça mais comprida em x gira 90° (e as normais junto)', () => {
    const pos = new Float32Array([0, 0, 0, 10, 0, 0, 0, 0, 2]);
    const { positions, size, rotated } = normalizePositions(pos, { alongZ: true });
    expect(rotated).toBe(true);
    expect(size).toEqual({ w: 2, l: 10, h: 0 });
    // (x, z) → (−z, x): o ponto (5, −1) relativo ao centro vai para (1, 5).
    expect([positions[3], positions[5]].map((v) => +v.toFixed(2))).toEqual([1, 5]);
    expect([...rotateNormals(new Float32Array([1, 0, 0]), true)]).toEqual([-0, 0, 1]);
    expect(rotateNormals(new Float32Array([1, 0, 0]), false)[0]).toBe(1);
  });

  it('v do UV vira de cima para baixo (FBX → glTF)', () => {
    expect([...flipV(new Float32Array([0.25, 0.1, 1, 1]))].map((v) => +v.toFixed(2))).toEqual([
      0.25, 0.9, 1, 0,
    ]);
  });
});
