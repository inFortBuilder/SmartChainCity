/**
 * Métricas geométricas exatas.
 *
 * A v1 estimava volume como `bbox.x * bbox.y * bbox.z * 0.75` — um chute que
 * errava por ordens de magnitude em plantas arquitetônicas, e a "estimativa
 * de peso" derivada dele não tinha significado físico.
 *
 * Aqui o volume vem da soma de tetraedros com sinal e a área da soma real
 * dos triângulos. Ambos são O(n) e exatos para malhas fechadas.
 */
import { locale, t } from '../i18n/index.js';

/**
 * Volume com sinal pelo teorema da divergência.
 *
 * Para cada triângulo (a, b, c), o tetraedro formado com a origem contribui
 * com `(a · (b × c)) / 6`. Somando sobre uma malha fechada e orientada de
 * forma coerente, as contribuições externas se cancelam e resta o volume.
 *
 * @param {ArrayLike<number>} positions XYZ intercalado
 * @param {ArrayLike<number>|null} [indices]
 * @returns {number} volume nas unidades do modelo (pode ser negativo se as
 *                   normais estiverem invertidas — use Math.abs)
 */
export function signedVolume(positions, indices = null) {
  let volume = 0;

  const triangleCount = indices ? Math.floor(indices.length / 3) : Math.floor(positions.length / 9);

  for (let t = 0; t < triangleCount; t++) {
    let i0;
    let i1;
    let i2;

    if (indices) {
      i0 = indices[t * 3] * 3;
      i1 = indices[t * 3 + 1] * 3;
      i2 = indices[t * 3 + 2] * 3;
    } else {
      i0 = t * 9;
      i1 = i0 + 3;
      i2 = i0 + 6;
    }

    const ax = positions[i0];
    const ay = positions[i0 + 1];
    const az = positions[i0 + 2];
    const bx = positions[i1];
    const by = positions[i1 + 1];
    const bz = positions[i1 + 2];
    const cx = positions[i2];
    const cy = positions[i2 + 1];
    const cz = positions[i2 + 2];

    // a · (b × c)
    volume += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }

  return volume / 6;
}

/**
 * Área de superfície real: soma de |(b - a) × (c - a)| / 2.
 *
 * @param {ArrayLike<number>} positions
 * @param {ArrayLike<number>|null} [indices]
 * @returns {number}
 */
export function surfaceArea(positions, indices = null) {
  let area = 0;

  const triangleCount = indices ? Math.floor(indices.length / 3) : Math.floor(positions.length / 9);

  for (let t = 0; t < triangleCount; t++) {
    let i0;
    let i1;
    let i2;

    if (indices) {
      i0 = indices[t * 3] * 3;
      i1 = indices[t * 3 + 1] * 3;
      i2 = indices[t * 3 + 2] * 3;
    } else {
      i0 = t * 9;
      i1 = i0 + 3;
      i2 = i0 + 6;
    }

    const abx = positions[i1] - positions[i0];
    const aby = positions[i1 + 1] - positions[i0 + 1];
    const abz = positions[i1 + 2] - positions[i0 + 2];
    const acx = positions[i2] - positions[i0];
    const acy = positions[i2 + 1] - positions[i0 + 1];
    const acz = positions[i2 + 2] - positions[i0 + 2];

    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;

    area += Math.sqrt(nx * nx + ny * ny + nz * nz) * 0.5;
  }

  return area;
}

/**
 * Verifica se a malha é estanque (cada aresta compartilhada por exatamente
 * dois triângulos). Só faz sentido calcular volume em malha estanque —
 * caso contrário sinalizamos "indisponível" em vez de exibir um número falso.
 *
 * @param {ArrayLike<number>|null} indices
 * @param {ArrayLike<number>} positions
 * @returns {{watertight: boolean, boundaryEdges: number, nonManifoldEdges: number}}
 */
export function analyzeManifold(indices, positions) {
  // Sem índices, cada triângulo é isolado: a malha nunca é estanque.
  if (!indices) {
    return { watertight: false, boundaryEdges: -1, nonManifoldEdges: -1 };
  }

  void positions;

  /** @type {Map<string, number>} */
  const edges = new Map();
  const triangleCount = Math.floor(indices.length / 3);

  for (let t = 0; t < triangleCount; t++) {
    const a = indices[t * 3];
    const b = indices[t * 3 + 1];
    const c = indices[t * 3 + 2];

    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const key = u < v ? `${u}_${v}` : `${v}_${u}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }

  let boundaryEdges = 0;
  let nonManifoldEdges = 0;

  for (const count of edges.values()) {
    if (count === 1) boundaryEdges++;
    else if (count > 2) nonManifoldEdges++;
  }

  return {
    watertight: boundaryEdges === 0 && nonManifoldEdges === 0,
    boundaryEdges,
    nonManifoldEdges,
  };
}

/**
 * Densidades em g/cm³ para estimativa de massa.
 * Fonte: valores nominais de fabricantes de filamento e tabelas de materiais.
 */
export const MATERIAL_DENSITIES = {
  pla: 1.24,
  abs: 1.04,
  petg: 1.27,
  resina: 1.1,
  nylon: 1.15,
  aluminio: 2.7,
  aco: 7.85,
  concreto: 2.4,
  madeira: 0.65,
  vidro: 2.5,
  ouro: 19.32,
};

/**
 * Estima a massa a partir do volume.
 *
 * @param {number} volumeCm3
 * @param {keyof typeof MATERIAL_DENSITIES | number} material
 * @returns {number} massa em gramas
 */
export function estimateMass(volumeCm3, material = 'pla') {
  const density =
    typeof material === 'number'
      ? material
      : (MATERIAL_DENSITIES[material] ?? MATERIAL_DENSITIES.pla);

  return Math.max(0, volumeCm3) * density;
}

/**
 * Converte volume das unidades do modelo para cm³.
 *
 * @param {number} volume
 * @param {number} unitInMeters quanto vale 1 unidade do modelo, em metros
 *                              (1 = metros, 0.01 = centímetros, 0.001 = milímetros)
 */
export function volumeToCm3(volume, unitInMeters = 1) {
  const cmPerUnit = unitInMeters * 100;

  return volume * cmPerUnit ** 3;
}

/**
 * Converte área das unidades do modelo para cm².
 * @param {number} area
 * @param {number} unitInMeters
 */
export function areaToCm2(area, unitInMeters = 1) {
  const cmPerUnit = unitInMeters * 100;

  return area * cmPerUnit ** 2;
}

/**
 * Formata contagens grandes de forma legível (12.400 → "12,4 mil").
 * @param {number} value
 */
export function formatCount(value) {
  if (!Number.isFinite(value)) return '—';
  if (value < 1000) return value.toLocaleString(locale);
  if (value < 1_000_000)
    return t('^1 mil', (value / 1000).toLocaleString(locale, { maximumFractionDigits: 1 }));

  return t('^1 mi', (value / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 2 }));
}
