// Pontos de ônibus do street view (fase 3 do mundo aberto, docs/desenvolvimento/mundo-aberto-terceira-pessoa.md).
//
// O OSM de Pittsburg não traz os pontos, então eles saem da grade da calçada, como os postes
// (mobiliario.js): um ponto por quadrado do mundo de 120 m, no meio-fio de uma rua de 7 m ou mais,
// escolhido por um sorteio fixo pela posição (refazer a grade não muda o ponto de lugar).
//
// O abrigo é procedural (cobertura, fundo de vidro, banco, colunas e a placa), virado para a rua, e
// ocupa a faixa do fundo na calçada (células 3, não andáveis). Cada ponto dá:
// - `wait`: onde o pedestre espera, na frente do banco;
// - `bay`: onde o ônibus para, na rua, na frente do abrigo (o carro de carros.js com `bus: true`).
//
// PREMISSAS: um ponto a cada 120 m (no máximo), rua de 7 m, abrigo de 3 m × 1,4 m a 1,2 m do meio-fio.

import { cellHash } from './mobiliario.js';

export const BUS_STOPS = { every: 120, minRoad: 7, inset: 1.2, length: 3, depth: 1.4, bay: 1.6 };

/**
 * Onde vão os pontos na grade da calçada (`kind`: 1 rua, 2 calçada). Devolve, de cada ponto, o centro do
 * abrigo, o rumo para a rua (`yaw`), a espera do pedestre e a parada do ônibus.
 */
export function placeBusStops(grid, opt = BUS_STOPS) {
  const { n, x0, z0, cell, kind } = grid;
  const best = new Map();
  for (let r = 2; r < n - 2; r++) {
    for (let c = 2; c < n - 2; c++) {
      const k = r * n + c;
      if (kind[k] !== 2) continue;
      // No meio-fio: o rumo para a rua é a soma dos vizinhos de rua.
      let ux = 0, uz = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (kind[(r + dr) * n + c + dc] === 1) { ux += dc; uz += dr; }
      const len = Math.hypot(ux, uz);
      if (!len) continue;
      ux /= len;
      uz /= len;
      const x = x0 + (c + 0.5) * cell, z = z0 + (r + 0.5) * cell;
      const key = `${Math.floor(x / opt.every)},${Math.floor(z / opt.every)}`;
      const h = cellHash(Math.round(x / cell) + 31337, Math.round(z / cell) - 4241);
      const cur = best.get(key);
      if (cur && h >= cur.h) continue;
      // Rua larga o bastante na frente (o ônibus para sem fechar a rua).
      let road = 0;
      for (let d = cell; d <= 20; d += cell / 2) {
        const kk = grid.at(x + ux * d, z + uz * d);
        if (kk !== 1) break;
        road = d;
      }
      if (road < opt.minRoad) continue;
      // O abrigo inteiro na calçada.
      const sx = x - ux * opt.inset, sz = z - uz * opt.inset;
      const px = -uz, pz = ux; // ao longo do meio-fio
      const half = opt.length / 2;
      const fits = [-half, 0, half].every((t) => grid.at(sx + px * t, sz + pz * t) === 2);
      if (!fits) continue;
      best.set(key, {
        h, x: sx, z: sz, yaw: Math.atan2(ux, uz), dir: [ux, uz],
        wait: { x: sx + ux * 0.6, z: sz + uz * 0.6 },
        bay: { x: x + ux * opt.bay, z: z + uz * opt.bay },
        key: `${sx.toFixed(1)},${sz.toFixed(1)}`,
      });
    }
  }
  return [...best.values()];
}

export function createBusStops(THREE, scene, max = 40) {
  const glass = new THREE.MeshStandardMaterial({ color: 0xbfd8e6, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.2 });
  const frame = new THREE.MeshStandardMaterial({ color: 0x2f5d8a, roughness: 0.5, metalness: 0.6 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.8 });
  const sign = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.5, emissive: 0x3a2a00 });
  const { length: L, depth: D } = BUS_STOPS;
  // Peças no espaço do abrigo: +z é a rua, x corre ao longo do meio-fio.
  const geo = {
    roof: [new THREE.BoxGeometry(L + 0.3, 0.08, D + 0.2).translate(0, 2.45, 0), frame],
    back: [new THREE.BoxGeometry(L, 1.9, 0.04).translate(0, 1.35, -D / 2), glass],
    posts: [mergeBoxes(THREE, [[-L / 2, -D / 2], [L / 2, -D / 2], [-L / 2, D / 2 - 0.1], [L / 2, D / 2 - 0.1]].map(([x, z]) => new THREE.BoxGeometry(0.07, 2.45, 0.07).translate(x, 1.22, z))), frame],
    bench: [new THREE.BoxGeometry(L - 0.6, 0.06, 0.4).translate(0, 0.46, -D / 2 + 0.3), wood],
    sign: [mergeBoxes(THREE, [new THREE.BoxGeometry(0.06, 2.6, 0.06).translate(L / 2 + 0.5, 1.3, D / 2), new THREE.BoxGeometry(0.5, 0.5, 0.05).translate(L / 2 + 0.5, 2.5, D / 2)]), sign],
  };
  const parts = {};
  for (const [k, [g, m]] of Object.entries(geo)) {
    const im = new THREE.InstancedMesh(g, m, max);
    im.count = 0;
    im.castShadow = k !== 'back';
    im.receiveShadow = true;
    im.frustumCulled = false;
    im.visible = false;
    scene.add(im);
    parts[k] = im;
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  let last = [];
  return {
    /** Refaz os abrigos a partir da grade; a faixa do fundo (vidro e banco) deixa de ser andável. */
    rebuild(grid, floorY) {
      last = placeBusStops(grid).slice(0, max);
      last.forEach((s, i) => {
        q.setFromAxisAngle(up, s.yaw);
        m4.compose(pos.set(s.x, floorY, s.z), q, one);
        for (const p of Object.values(parts)) p.setMatrixAt(i, m4);
        const [ux, uz] = s.dir;
        for (let t = -L / 2; t <= L / 2; t += grid.cell / 2) {
          for (const back of [-D / 2, -D / 2 + 0.3]) {
            const x = s.x - uz * t + ux * back, z = s.z + ux * t + uz * back;
            const c = Math.floor((x - grid.x0) / grid.cell), r = Math.floor((z - grid.z0) / grid.cell);
            if (c >= 0 && r >= 0 && c < grid.n && r < grid.n && grid.kind[r * grid.n + c] === 2) grid.kind[r * grid.n + c] = 3;
          }
        }
      });
      for (const p of Object.values(parts)) {
        p.count = last.length;
        p.instanceMatrix.needsUpdate = true;
        p.visible = true;
      }
      return last.length;
    },
    hide() {
      for (const p of Object.values(parts)) p.visible = false;
    },
    /** Os pontos da grade atual (cópia). */
    list: () => last.map((s) => ({ ...s, dir: [...s.dir], wait: { ...s.wait }, bay: { ...s.bay } })),
  };
}

/** Junta caixas numa geometria só (sem o BufferGeometryUtils, para não carregar mais um módulo). */
function mergeBoxes(THREE, boxes) {
  const pos = [], nor = [], idx = [];
  let base = 0;
  for (const b of boxes) {
    const g = b;
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    for (const i of g.index.array) idx.push(i + base);
    base += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}
