/**
 * Terreno para um prédio público (Centro Administrativo, doc 03 §5): procura,
 * a partir do centro da cidade, o lugar mais próximo onde a base do prédio,
 * com uma margem de praça, fica inteira sobre lotes, sem cruzar rua nem água.
 * Os lotes cobertos saem da venda e passam a ser da Prefeitura.
 */
import { pointInPolygon } from './lots.js';

/** Lotes vizinhos não encostam exatamente: fresta menor que isto não é rua. */
export const GAP_TOLERANCE_M = 2.5;

function distToSegment(x, z, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
  return Math.hypot(x - (ax + t * dx), z - (az + t * dz));
}

/**
 * Índice espacial dos lotes por célula, para achar o lote de um ponto rápido.
 *
 * @param {Array<Array<[number, number]>>} rings polígono de cada lote
 * @param {number} cell tamanho da célula em metros
 */
export function lotIndex(rings, cell = 50) {
  const grid = new Map();
  rings.forEach((ring, i) => {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of ring) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    const pad = GAP_TOLERANCE_M;
    for (let a = Math.floor((minX - pad) / cell); a <= Math.floor((maxX + pad) / cell); a++) {
      for (let b = Math.floor((minZ - pad) / cell); b <= Math.floor((maxZ + pad) / cell); b++) {
        const key = `${a},${b}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(i);
      }
    }
  });

  /** Lote que contém o ponto; senão, um a menos de GAP_TOLERANCE_M; senão -1. */
  function lotAt(x, z) {
    const near = grid.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) ?? [];
    for (const i of near) if (pointInPolygon(x, z, rings[i])) return i;
    for (const i of near) {
      const ring = rings[i];
      for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
        if (distToSegment(x, z, ring[b][0], ring[b][1], ring[a][0], ring[a][1]) <= GAP_TOLERANCE_M)
          return i;
      }
    }
    return -1;
  }

  return { lotAt };
}

/** Pontos de amostra que cobrem o retângulo w × d girado, a cada `step` metros. */
export function footprintSamples(cx, cz, w, d, angle, step = 6) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const nu = Math.max(1, Math.ceil(w / step));
  const nv = Math.max(1, Math.ceil(d / step));
  const pts = [];
  for (let a = 0; a <= nu; a++) {
    for (let b = 0; b <= nv; b++) {
      const x = -w / 2 + (w * a) / nu;
      const z = -d / 2 + (d * b) / nv;
      pts.push([cx + x * c - z * s, cz + x * s + z * c]);
    }
  }
  return pts;
}

/**
 * Procura em anéis cada vez mais longe do centro e para no primeiro que tem
 * lugar: o resultado é o terreno viável mais central.
 *
 * @param {Array<Array<[number, number]>>} rings
 * @param {{w: number, d: number}} size base do prédio em metros
 * @param {[number, number]} target centro da cidade
 * @param {{margin?: number, step?: number, radius?: number, angles?: number}} [opts]
 * @returns {{center: [number, number], angle: number, distance: number, lots: number[]} | null}
 */
export function findCivicSite(rings, size, target, opts = {}) {
  const margin = opts.margin ?? 6;
  const step = opts.step ?? 20;
  const radius = opts.radius ?? 2000;
  const angles = opts.angles ?? 12;
  const index = opts.index ?? lotIndex(rings);
  const w = size.w + 2 * margin;
  const d = size.d + 2 * margin;

  // Os cantos e o meio primeiro: a maioria dos lugares ruins cai logo neles.
  const tryAt = (cx, cz, angle) => {
    const pts = footprintSamples(cx, cz, w, d, angle);
    const order = [0, pts.length - 1, Math.floor(pts.length / 2)];
    const covered = new Set();
    for (const k of order) if (index.lotAt(...pts[k]) < 0) return null;
    for (const [x, z] of pts) {
      const lot = index.lotAt(x, z);
      if (lot < 0) return null;
      covered.add(lot);
    }
    return [...covered].sort((a, b) => a - b);
  };

  for (let r = 0; r <= radius; r += step) {
    const cand = [];
    if (r === 0) cand.push([target[0], target[1]]);
    else {
      const n = Math.ceil((2 * Math.PI * r) / step);
      for (let k = 0; k < n; k++) {
        const t = (2 * Math.PI * k) / n;
        cand.push([target[0] + r * Math.cos(t), target[1] + r * Math.sin(t)]);
      }
    }
    for (const [cx, cz] of cand) {
      for (let a = 0; a < angles; a++) {
        const angle = (Math.PI * a) / angles;
        const lots = tryAt(cx, cz, angle);
        if (lots) return { center: [cx, cz], angle, distance: r, lots };
      }
    }
  }
  return null;
}
