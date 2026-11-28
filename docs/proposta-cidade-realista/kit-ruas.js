// Ruas do street view com as peças do kit de ruas (docs/desenvolvimento/street-view.md, "Kit de ruas").
//
// O kit ("modular kit city build v2", licença não confirmada) só existe em .local/rouds/kit-ruas.glb, gerado
// por tools/scc-builder/bin/road-kit.js. Sem ele, nada muda: ficam as ruas de hoje.
//
// Com o kit, a cada grafo novo (ruas-grafo.js, refeito a cada 60 m em volta do avatar):
// - cruzamento de 4 braços em ângulo reto (até 20° fora): a peça de cruzamento de 2 faixas, ou a de 4 se a
//   rua mais larga passar de 12 m, girada pelo 1º braço e com a escala pela largura;
// - T em ângulo reto: a mesma peça, com o braço que falta coberto pelo piso da calçada;
// - trechos: as retas de 2 faixas (ou 4, acima de 12 m), em fileira ao longo de cada segmento, giradas pelo rumo
//   dele e esticadas na largura da rua. Elas começam e acabam fora da peça de cruzamento. A última da
//   fileira encolhe para caber;
// - nas dobras do trecho, um quadrado de asfalto do kit cobre a junta;
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

/**
 * As peças para o grafo: lista de {code, x, z, yaw, sx, sz}. `size(code)` dá {w, l} da peça (do
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
  for (const e of graph.edges) {
    const code = e.width > opt.wide ? 'reta4' : 'reta2';
    const p = size(code);
    const sx = clamp(e.width / p.w);
    const pts = e.points;
    // Corta as pontas que entram nos cruzamentos.
    const cutA = reserve.get(e.a) ?? 0, cutB = reserve.get(e.b) ?? 0;
    const total = pts.reduce((s2, q, i) => (i ? s2 + Math.hypot(q.x - pts[i - 1].x, q.z - pts[i - 1].z) : 0), 0);
    let run = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      if (segLen < 0.5) continue;
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      const from = Math.max(0, cutA - run), to = Math.min(segLen, total - cutB - run);
      run += segLen;
      if (to - from < 0.5) continue;
      const ux = (b.x - a.x) / segLen, uz = (b.z - a.z) / segLen;
      for (let t = from; t < to - 0.01; t += p.l) {
        const len = Math.min(p.l, to - t);
        const mid = t + len / 2;
        out.push({ code, x: a.x + ux * mid, z: a.z + uz * mid, yaw, sx, sz: len / p.l });
      }
      // Junta da dobra (não nas pontas do trecho).
      if (i < pts.length - 1 && run < total - cutB) {
        const q = size('asfalto');
        out.push({ code: 'asfalto', x: b.x, z: b.z, yaw, sx: (e.width * 0.98) / q.w, sz: (e.width * 0.98) / q.l });
      }
    }
  }
  return out;
}

export function createRoadKit({ THREE, scene, streetView, roadGraph, loadGltf, roads = null, opt = KIT }) {
  const group = new THREE.Group();
  group.name = 'kit-ruas';
  scene.add(group);
  let pieces = null; // code → { geometry, material, size }
  let meshes = {};
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
