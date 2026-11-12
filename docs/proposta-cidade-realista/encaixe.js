// O prédio vindo do SCC Builder cabe no lote? Confere gabarito, recuo e
// coeficiente (doc 13 §4) e devolve onde e como girar. Sem DOM nem Three.js.

/** Pé-direito usado para estimar andares a partir da altura. */
export const FLOOR_HEIGHT_M = 3;

const fmt1 = (n) => (Math.round(n * 10) / 10).toLocaleString('pt-BR');

export function pointInRing(x, z, ring) {
  let inside = false;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const [xa, za] = ring[a];
    const [xb, zb] = ring[b];
    if (za > z !== zb > z && x < ((xb - xa) * (z - za)) / (zb - za) + xa) inside = !inside;
  }
  return inside;
}

function distToSegment(x, z, [xa, za], [xb, zb]) {
  const dx = xb - xa;
  const dz = zb - za;
  const len2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - xa) * dx + (z - za) * dz) / len2));
  return Math.hypot(x - (xa + t * dx), z - (za + t * dz));
}

/** Menor distância do ponto à borda do lote. */
export function distToRing(x, z, ring) {
  let best = Infinity;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    best = Math.min(best, distToSegment(x, z, ring[b], ring[a]));
  }
  return best;
}

/** Ângulo do lado mais comprido do lote: a frente do prédio fica paralela a ele. */
export function longestEdgeAngle(ring) {
  let best = 0;
  let angle = 0;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const dx = ring[a][0] - ring[b][0];
    const dz = ring[a][1] - ring[b][1];
    const len = Math.hypot(dx, dz);
    if (len > best) {
      best = len;
      angle = Math.atan2(dz, dx);
    }
  }
  return angle;
}

export function ringCentroid(ring) {
  let area = 0;
  let cx = 0;
  let cz = 0;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const cross = ring[b][0] * ring[a][1] - ring[a][0] * ring[b][1];
    area += cross;
    cx += (ring[b][0] + ring[a][0]) * cross;
    cz += (ring[b][1] + ring[a][1]) * cross;
  }
  if (Math.abs(area) < 1e-9) {
    return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
  }
  return [cx / (3 * area), cz / (3 * area)];
}

/** Cantos e meios de lado da projeção do prédio, girada e centrada. */
function footprintPoints(cx, cz, w, d, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const pts = [];
  for (const [u, v] of [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]) {
    const x = (u * w) / 2;
    const z = (v * d) / 2;
    pts.push([cx + x * c - z * s, cz + x * s + z * c]);
  }
  return pts;
}

/**
 * @param {Array<[number, number]>} ring polígono do lote (x, z em metros)
 * @param {{w: number, d: number, h: number}} size caixa do prédio em metros
 * @param {{max_height_m: number, setback_m: number, far: number}} zone regras da zona
 * @param {number} area área do lote em m²
 * @returns {{ok: boolean, reasons: string[], center: [number, number], angle: number, floors: number, built: number, maxBuilt: number}}
 */
export function fitBuilding(ring, size, zone, area) {
  const reasons = [];
  const floors = Math.max(1, Math.round(size.h / FLOOR_HEIGHT_M));
  const built = Math.round(size.w * size.d * floors);
  const maxBuilt = Math.round(area * zone.far);

  if (size.h > zone.max_height_m + 0.01) {
    reasons.push(`altura de ${fmt1(size.h)} m passa o gabarito de ${zone.max_height_m} m`);
  }
  if (built > maxBuilt) {
    reasons.push(`${built.toLocaleString('pt-BR')} m² construídos passam o coeficiente (${maxBuilt.toLocaleString('pt-BR')} m²)`);
  }

  // Tenta alinhado ao lado mais comprido e girado 90°, no centro do lote.
  const center = ringCentroid(ring);
  const base = longestEdgeAngle(ring);
  let angle = null;
  for (const a of [base, base + Math.PI / 2]) {
    const pts = footprintPoints(center[0], center[1], size.w, size.d, a);
    if (pts.every(([x, z]) => pointInRing(x, z, ring) && distToRing(x, z, ring) >= zone.setback_m - 0.01)) {
      angle = a;
      break;
    }
  }
  if (angle === null) {
    reasons.push(`a base de ${fmt1(size.w)} × ${fmt1(size.d)} m não cabe com recuo de ${zone.setback_m} m`);
  }

  return { ok: reasons.length === 0, reasons, center, angle: angle ?? base, floors, built, maxBuilt };
}
