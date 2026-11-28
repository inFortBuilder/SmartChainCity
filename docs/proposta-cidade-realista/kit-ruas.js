// Ruas do street view com as peças do kit de ruas (docs/desenvolvimento/street-view.md, "Kit de ruas").
//
// O kit ("modular kit city build v2", licença não confirmada) só existe em .local/rouds/kit-ruas.glb, gerado
// por tools/scc-builder/bin/road-kit.js. Sem ele, nada muda: ficam as ruas de hoje.
//
// Com o kit, a cada grafo novo (ruas-grafo.js, refeito a cada 60 m em volta do avatar):
// - cruzamento de 4 braços em ângulo reto (até 20° fora): a peça de cruzamento de 2 faixas, ou a de 4 se a
//   rua mais larga passar de 12 m, girada pelo 1º braço e com a escala pela largura;
// - T em ângulo reto: a mesma peça, com o braço que falta coberto pelo piso da calçada;
// - trechos: uma faixa contínua (fita) ao longo da linha do meio, na largura da rua, com a textura da reta de 2
//   faixas (ou 4, acima de 12 m) recortada do atlas e repetida a cada 5,70 m. Nas dobras, a fita vira em
//   chanfro (as duas bordas se encontram), sem quebrar a linha amarela. Ela começa e acaba fora da peça de
//   cruzamento;
// - o que não é ângulo reto (X agudo, 5 braços) fica com o asfalto do OSM, que continua por baixo. Esse
//   asfalto ganha a textura do asfalto liso do kit (recortada do atlas, repetida a cada 7,71 m pelo mundo),
//   para não destoar das peças. Vale também para o mapa visto de cima.
// As peças ficam 3 cm acima do asfalto do OSM. As listras das faixas de pedestre de hoje (faixas.js) saem: as
// peças de cruzamento já trazem as delas.
//
// PREMISSAS: ângulo reto até 20° fora; 4 faixas acima de 12 m de largura; escala da largura entre 0,6 e 1,6.

export const KIT = { url: '../../.local/rouds/kit-ruas.glb', square: (20 * Math.PI) / 180, wide: 12, minScale: 0.6, maxScale: 1.6, lift: 0.03, max: 2000 };

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Os braços em ângulo reto? Devolve o rumo do 1º braço e quais dos 4 rumos (0°, 90°, 180°, 270°) existem. */
export function squareArms(arms, tol = KIT.square) {
  if (!arms.length) return null;
  const base = arms[0];
  const slots = [false, false, false, false];
  for (const a of arms) {
    const rel = wrap(a - base);
    const q = Math.round(rel / (Math.PI / 2));
    if (Math.abs(rel - q * (Math.PI / 2)) > tol) return null;
    const k = ((q % 4) + 4) % 4;
    if (slots[k]) return null;
    slots[k] = true;
  }
  return { base, slots };
}

/** Comprimento de uma linha de pontos {x, z}. */
const lengthOf = (pts) => pts.reduce((sum, p, i) => (i ? sum + Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) : 0), 0);

/** Ponto a `d` metros do começo da linha. */
function pointAt(pts, d) {
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    if (run + seg >= d) {
      const t = seg ? (d - run) / seg : 0;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, z: pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t, i };
    }
    run += seg;
  }
  const last = pts[pts.length - 1];
  return { x: last.x, z: last.z, i: pts.length - 1 };
}

/** Corta `a` metros do começo e `b` do fim da linha (nada sobra se a linha for mais curta). */
export function trimPolyline(pts, a, b) {
  const total = lengthOf(pts);
  if (total - a - b < 0.5) return [];
  const p = pointAt(pts, a), q = pointAt(pts, total - b);
  // p fica no segmento que termina em pts[p.i] e q no que termina em pts[q.i]: no meio, pts[p.i .. q.i − 1].
  const line = [p, ...pts.slice(p.i, q.i), q].map(({ x, z }) => ({ x, z }));
  return line.filter((pt, k) => k === 0 || Math.hypot(pt.x - line[k - 1].x, pt.z - line[k - 1].z) > 0.05);
}

/**
 * A fita de uma rua: dois vértices por ponto da linha do meio, um de cada lado a meia largura, com chanfro nas
 * dobras (a normal é a média dos dois segmentos, esticada para a largura não afinar, até 2 vezes). UV: u de 0
 * (esquerda) a 1 (direita), v = distância / `repeat` (a peça se repete ao longo da rua). Devolve as posições,
 * as UVs e os índices, para juntar várias fitas numa malha só.
 */
export function ribbon(points, width, repeat, y = 0) {
  const n = points.length;
  const pos = [], uv = [], idx = [];
  let run = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
    // Rumo antes e depois do ponto; a normal (para a esquerda) é a média.
    const d1 = i > 0 ? norm(p.x - a.x, p.z - a.z) : norm(b.x - p.x, b.z - p.z);
    const d2 = i < n - 1 ? norm(b.x - p.x, b.z - p.z) : d1;
    let nx = -(d1.z + d2.z), nz = d1.x + d2.x;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl;
    nz /= nl;
    // Chanfro: no canto, a borda se afasta 1/cos(meio ângulo) para a largura não afinar.
    const cosHalf = Math.max(0.5, nx * -d1.z + nz * d1.x);
    const h = width / 2 / cosHalf;
    if (i > 0) run += Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z);
    pos.push(p.x + nx * h, y, p.z + nz * h, p.x - nx * h, y, p.z - nz * h);
    uv.push(0, run / repeat, 1, run / repeat);
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k, k - 1, k - 1, k, k + 1);
    }
  }
  return { pos, uv, idx };
}

const norm = (x, z) => {
  const l = Math.hypot(x, z) || 1;
  return { x: x / l, z: z / l };
};

/**
 * As peças para o grafo: lista de {code, x, z, yaw, sx, sz} (os cruzamentos e a calçada dos T) e, em
 * `.streets`, as fitas dos trechos: {code, width, points}. `size(code)` dá {w, l} da peça (do
 * kit-ruas.json, ou das medidas do GLB). Puro, para os testes.
 */
export function layout(graph, size, opt = KIT) {
  const out = [];
  const clamp = (v) => Math.max(opt.minScale, Math.min(opt.maxScale, v));
  // Quanto cada nó ocupa a partir do centro (meia peça de cruzamento), para as retas começarem fora dele.
  const reserve = new Map();
  for (const n of graph.nodes) {
    if (n.kind !== 'cruz' && n.kind !== 'T') continue;
    const sq = squareArms(n.arms, opt.square);
    if (!sq || (n.kind === 'cruz' && sq.slots.some((s) => !s))) continue;
    const widths = n.edges.map((id) => graph.edges[id].width);
    const widest = Math.max(...widths);
    const code = widest > opt.wide ? 'cruz4' : 'cruz2';
    const lane = code === 'cruz4' ? size('reta4').w : size('reta2').w;
    const s = clamp(widest / lane);
    const half = (size(code).w * s) / 2;
    out.push({ code, x: n.x, z: n.z, yaw: sq.base, sx: s, sz: s });
    reserve.set(n.id, half);
    // T: o braço que falta vira calçada (o piso cobre o asfalto da peça daquele lado).
    sq.slots.forEach((has, k) => {
      if (has) return;
      const h = sq.base + (k * Math.PI) / 2;
      // O braço vai da borda da rua que passa (meia largura dela) até a ponta da peça.
      const c = size('calcada');
      const road = (lane * s) / 2;
      const arm = half - road;
      const d = road + arm / 2;
      out.push({ code: 'calcada', x: n.x + Math.sin(h) * d, z: n.z + Math.cos(h) * d, yaw: h, sx: (lane * s * 1.1) / c.w, sz: arm / c.l });
    });
  }
  // Trechos: a linha do meio cortada fora dos cruzamentos, para a fita.
  const streets = [];
  for (const e of graph.edges) {
    const pts = trimPolyline(e.points, reserve.get(e.a) ?? 0, reserve.get(e.b) ?? 0);
    if (pts.length < 2) continue;
    streets.push({ code: e.width > opt.wide ? 'reta4' : 'reta2', width: e.width, points: pts });
  }
  out.streets = streets;
  return out;
}

export function createRoadKit({ THREE, scene, streetView, roadGraph, loadGltf, roads = null, opt = KIT }) {
  const group = new THREE.Group();
  group.name = 'kit-ruas';
  scene.add(group);
  let pieces = null; // code → { geometry, material, size }
  let meshes = {};
  /** As fitas das ruas, uma malha por reta (2 e 4 faixas). */
  const ribbons = {};
  let lastGraph = null;
  const stats = { loaded: false, missing: false, layouts: 0, placed: {}, ms: 0 };

  const url = new URL(opt.url, import.meta.url).href;
  loadGltf(url)
    .then((gltf) => {
      pieces = {};
      gltf.scene.updateMatrixWorld(true);
      for (const node of gltf.scene.children) {
        let mesh = null;
        node.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
        if (!mesh) continue;
        const box = new THREE.Box3().setFromObject(mesh);
        pieces[node.name] = { geometry: mesh.geometry, material: mesh.material, size: { w: box.max.x - box.min.x, l: box.max.z - box.min.z } };
      }
      for (const [code, p] of Object.entries(pieces)) {
        p.material.polygonOffset = true;
        p.material.polygonOffsetFactor = -1;
        const m = new THREE.InstancedMesh(p.geometry, p.material, opt.max);
        m.count = 0;
        m.receiveShadow = true;
        m.frustumCulled = false;
        // A calçada do T vai por cima do asfalto da peça de cruzamento.
        if (code === 'calcada') m.renderOrder = 2;
        group.add(m);
        meshes[code] = m;
      }
      if (roads && pieces.asfalto) dressRoads(pieces.asfalto);
      // As fitas das ruas: a textura de cada reta, recortada do atlas, repetida ao longo da rua.
      for (const code of ['reta2', 'reta4']) {
        if (!pieces[code]) continue;
        const map = cropPiece(pieces[code]);
        const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1 });
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        group.add(mesh);
        ribbons[code] = mesh;
      }
      stats.loaded = true;
      lastGraph = null;
    })
    .catch(() => {
      // Sem o kit em .local/: ficam as ruas de hoje.
      stats.missing = true;
    });

  /**
   * O asfalto do OSM com a textura do asfalto liso do kit: recorta do atlas o pedaço que a peça usa e repete
   * pelo mundo (UV = x e z do mundo ÷ o tamanho da peça). As cores por vértice saem (a textura manda).
   */
  function dressRoads(asfalto) {
    const uv = asfalto.geometry.attributes.uv;
    const img = asfalto.material.map?.image;
    if (!uv || !img) return;
    let u0 = 1, v0 = 1, u1 = 0, v1 = 0;
    for (let i = 0; i < uv.count; i++) {
      u0 = Math.min(u0, uv.getX(i)); u1 = Math.max(u1, uv.getX(i));
      v0 = Math.min(v0, uv.getY(i)); v1 = Math.max(v1, uv.getY(i));
    }
    const W = img.width, H = img.height;
    // Um pouco para dentro, para não pegar a borda das peças vizinhas no atlas.
    const pad = 0.08;
    const sx = (u0 + (u1 - u0) * pad) * W, sy = (v0 + (v1 - v0) * pad) * H;
    const sw = (u1 - u0) * (1 - 2 * pad) * W, sh = (v1 - v0) * (1 - 2 * pad) * H;
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, 512, 512);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    // UV pelo mundo: a malha das ruas vem quantizada (meshopt), então passa pela matriz dela.
    roads.updateMatrixWorld(true);
    const p = roads.geometry.attributes.position, v = new THREE.Vector3();
    const out = new Float32Array(p.count * 2);
    const tile = asfalto.size.w;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(roads.matrixWorld);
      out[i * 2] = v.x / tile;
      out[i * 2 + 1] = v.z / tile;
    }
    roads.geometry.setAttribute('uv', new THREE.BufferAttribute(out, 2));
    roads.material.map = tex;
    roads.material.vertexColors = false;
    roads.material.color.set(0xffffff);
    roads.material.needsUpdate = true;
    stats.dressed = p.count;
  }

  /**
   * A textura de uma peça, recortada do atlas como ela aparece na peça: u ao longo de x (a largura) e v ao
   * longo de z (o sentido da rua), seja qual for a posição dela no atlas (a transformação afim sai de três
   * cantos). Repete em v, para a fita seguir a rua.
   */
  function cropPiece(piece) {
    const g = piece.geometry, p = g.attributes.position, uv = g.attributes.uv, img = piece.material.map.image;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < p.count; i++) {
      x0 = Math.min(x0, p.getX(i)); x1 = Math.max(x1, p.getX(i));
      z0 = Math.min(z0, p.getZ(i)); z1 = Math.max(z1, p.getZ(i));
    }
    const corner = (x, z) => {
      let best = 0, bd = Infinity;
      for (let i = 0; i < p.count; i++) {
        const d = Math.hypot(p.getX(i) - x, p.getZ(i) - z);
        if (d < bd) { bd = d; best = i; }
      }
      return [uv.getX(best) * img.width, uv.getY(best) * img.height];
    };
    const P00 = corner(x0, z0), P10 = corner(x1, z0), P01 = corner(x0, z1);
    const W = 256, H = 256;
    // Canvas → imagem: P00 + cx/W·(P10 − P00) + cy/H·(P01 − P00). O canvas precisa do inverso.
    const ax = (P10[0] - P00[0]) / W, ay = (P10[1] - P00[1]) / W, bx = (P01[0] - P00[0]) / H, by = (P01[1] - P00[1]) / H;
    const det = ax * by - bx * ay;
    const i11 = by / det, i12 = -bx / det, i21 = -ay / det, i22 = ax / det;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    ctx.setTransform(i11, i21, i12, i22, -(i11 * P00[0] + i12 * P00[1]), -(i21 * P00[0] + i22 * P00[1]));
    ctx.drawImage(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  /** Junta as fitas de uma reta numa malha só. */
  function buildRibbons(code, streets, y) {
    const mesh = ribbons[code];
    if (!mesh) return 0;
    const repeat = pieces[code].size.l;
    const pos = [], uvs = [], idx = [];
    for (const st of streets) {
      if (st.code !== code) continue;
      const r = ribbon(st.points, st.width, repeat, y);
      const base = pos.length / 3;
      pos.push(...r.pos);
      uvs.push(...r.uv);
      for (const k of r.idx) idx.push(base + k);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    mesh.geometry.dispose();
    mesh.geometry = g;
    return idx.length / 3;
  }

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

  function place(graph) {
    const t0 = performance.now();
    const list = layout(graph, (code) => pieces[code].size, opt);
    const y = streetView.groundY() + opt.lift;
    const counts = {};
    for (const it of list) {
      const m = meshes[it.code];
      if (!m) continue;
      const k = counts[it.code] ?? 0;
      if (k >= opt.max) continue;
      // A calçada do T fica 1 cm acima da peça de cruzamento.
      const lift = it.code === 'calcada' ? 0.17 : it.code === 'asfalto' ? -0.01 : 0;
      q.setFromAxisAngle(up, it.yaw);
      m4.compose(pos.set(it.x, y + lift, it.z), q, scl.set(it.sx, 1, it.sz));
      m.setMatrixAt(k, m4);
      counts[it.code] = k + 1;
    }
    for (const [code, m] of Object.entries(meshes)) {
      m.count = counts[code] ?? 0;
      m.instanceMatrix.needsUpdate = true;
    }
    // As fitas das ruas, por cima do asfalto do OSM e por baixo das peças de cruzamento.
    for (const code of ['reta2', 'reta4']) counts[`fita-${code}`] = buildRibbons(code, list.streets, y - 0.005);
    stats.placed = counts;
    stats.layouts++;
    stats.ms = Math.round(performance.now() - t0);
    streetView.drawCrosswalks?.(false);
  }

  return {
    update() {
      const on = streetView.active() && stats.loaded;
      group.visible = on;
      if (!on) return;
      const g = roadGraph.graph();
      if (g && g !== lastGraph) {
        lastGraph = g;
        place(g);
      }
    },
    debug: () => ({ ...stats, placed: { ...stats.placed } }),
  };
}
