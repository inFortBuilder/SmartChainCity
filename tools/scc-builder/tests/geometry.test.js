import { describe, expect, it } from 'vitest';

import {
  MATERIAL_DENSITIES,
  analyzeManifold,
  areaToCm2,
  estimateMass,
  formatCount,
  signedVolume,
  surfaceArea,
  volumeToCm3,
} from '../src/utils/geometry.js';

/**
 * Cubo unitário indexado centrado na origem, arestas de comprimento 1.
 * Volume esperado: 1. Área esperada: 6.
 */
function unitCube() {
  const h = 0.5;
  const positions = new Float32Array([
    -h,
    -h,
    -h,
    h,
    -h,
    -h,
    h,
    h,
    -h,
    -h,
    h,
    -h, // z = -h
    -h,
    -h,
    h,
    h,
    -h,
    h,
    h,
    h,
    h,
    -h,
    h,
    h, // z = +h
  ]);

  // Faces com orientação anti-horária vista de fora (normais para fora).
  const indices = new Uint32Array([
    4,
    5,
    6,
    4,
    6,
    7, // frente  (z+)
    1,
    0,
    3,
    1,
    3,
    2, // trás    (z-)
    0,
    4,
    7,
    0,
    7,
    3, // esquerda (x-)
    5,
    1,
    2,
    5,
    2,
    6, // direita  (x+)
    3,
    7,
    6,
    3,
    6,
    2, // topo     (y+)
    0,
    1,
    5,
    0,
    5,
    4, // base     (y-)
  ]);

  return { positions, indices };
}

/** Um único triângulo retângulo de catetos 1 → área 0,5. */
const singleTriangle = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);

describe('signedVolume', () => {
  it('calcula o volume exato de um cubo unitário', () => {
    const { positions, indices } = unitCube();

    expect(Math.abs(signedVolume(positions, indices))).toBeCloseTo(1, 5);
  });

  it('é invariante à translação', () => {
    const { positions, indices } = unitCube();
    const moved = Float32Array.from(positions, (v, i) => (i % 3 === 0 ? v + 100 : v));

    expect(Math.abs(signedVolume(moved, indices))).toBeCloseTo(1, 4);
  });

  it('escala com o cubo do fator de escala', () => {
    const { positions, indices } = unitCube();
    const scaled = Float32Array.from(positions, (v) => v * 2);

    expect(Math.abs(signedVolume(scaled, indices))).toBeCloseTo(8, 4);
  });

  it('inverte o sinal quando a orientação das faces é invertida', () => {
    const { positions, indices } = unitCube();
    const flipped = new Uint32Array(indices.length);
    for (let t = 0; t < indices.length / 3; t++) {
      flipped[t * 3] = indices[t * 3];
      flipped[t * 3 + 1] = indices[t * 3 + 2];
      flipped[t * 3 + 2] = indices[t * 3 + 1];
    }

    expect(signedVolume(positions, indices)).toBeCloseTo(-signedVolume(positions, flipped), 5);
  });

  it('devolve zero para uma malha plana', () => {
    expect(signedVolume(singleTriangle)).toBeCloseTo(0, 6);
  });

  it('aceita geometria não indexada', () => {
    expect(signedVolume(new Float32Array(0))).toBe(0);
  });
});

describe('surfaceArea', () => {
  it('calcula a área de um triângulo isolado', () => {
    expect(surfaceArea(singleTriangle)).toBeCloseTo(0.5, 6);
  });

  it('calcula a área de um cubo unitário', () => {
    const { positions, indices } = unitCube();

    expect(surfaceArea(positions, indices)).toBeCloseTo(6, 5);
  });

  it('escala com o quadrado do fator de escala', () => {
    const scaled = Float32Array.from(singleTriangle, (v) => v * 3);

    expect(surfaceArea(scaled)).toBeCloseTo(0.5 * 9, 5);
  });

  it('ignora triângulos degenerados', () => {
    expect(surfaceArea(new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2]))).toBeCloseTo(0, 6);
  });
});

describe('analyzeManifold', () => {
  it('reconhece o cubo como estanque', () => {
    const { positions, indices } = unitCube();
    const result = analyzeManifold(indices, positions);

    expect(result.watertight).toBe(true);
    expect(result.boundaryEdges).toBe(0);
    expect(result.nonManifoldEdges).toBe(0);
  });

  it('detecta arestas de borda em uma malha aberta', () => {
    const result = analyzeManifold(new Uint32Array([0, 1, 2]), singleTriangle);

    expect(result.watertight).toBe(false);
    expect(result.boundaryEdges).toBe(3);
  });

  it('nunca considera estanque uma malha não indexada', () => {
    expect(analyzeManifold(null, singleTriangle).watertight).toBe(false);
  });

  it('detecta arestas não-manifold', () => {
    // Três triângulos compartilhando a mesma aresta 0-1
    const indices = new Uint32Array([0, 1, 2, 0, 1, 3, 0, 1, 4]);
    const result = analyzeManifold(indices, new Float32Array(15));

    expect(result.nonManifoldEdges).toBe(1);
    expect(result.watertight).toBe(false);
  });
});

describe('conversão de unidades', () => {
  it('converte metros cúbicos para cm³', () => {
    expect(volumeToCm3(1, 1)).toBeCloseTo(1_000_000, 0);
  });

  it('converte milímetros cúbicos para cm³', () => {
    expect(volumeToCm3(1000, 0.001)).toBeCloseTo(1, 6);
  });

  it('converte metros quadrados para cm²', () => {
    expect(areaToCm2(1, 1)).toBeCloseTo(10_000, 0);
  });
});

describe('estimateMass', () => {
  it('usa a densidade do material nomeado', () => {
    expect(estimateMass(10, 'aco')).toBeCloseTo(78.5, 5);
  });

  it('aceita densidade numérica direta', () => {
    expect(estimateMass(10, 2)).toBeCloseTo(20, 5);
  });

  it('cai no PLA para material desconhecido', () => {
    expect(estimateMass(10, 'inexistente')).toBeCloseTo(10 * MATERIAL_DENSITIES.pla, 5);
  });

  it('nunca devolve massa negativa', () => {
    expect(estimateMass(-5, 'pla')).toBe(0);
  });
});

describe('formatCount', () => {
  it.each([
    [0, '0'],
    [999, '999'],
  ])('formata %i como %s', (input, expected) => {
    expect(formatCount(input)).toBe(expected);
  });

  it('abrevia milhares e milhões', () => {
    expect(formatCount(12_400)).toMatch(/mil/);
    expect(formatCount(3_400_000)).toMatch(/mi/);
  });

  it('trata valores inválidos', () => {
    expect(formatCount(Number.NaN)).toBe('—');
  });
});
