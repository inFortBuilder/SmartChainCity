// Grafo das ruas em volta do avatar, para o kit de ruas (docs/desenvolvimento/street-view.md, "Kit de ruas").
//
// O OSM de Pittsburg só traz o polígono das ruas. Para encaixar as peças do kit, é preciso a linha do meio de
// cada rua, a largura dela e os cruzamentos. Em volta do avatar:
// 1. Grade de 1 m, alinhada ao mundo, num quadrado de 240 m: cada célula é rua ou não (`isRoad`).
// 2. Distância de cada célula de rua até a borda (transformada de distância, chamfer 1/√2): a meia largura.
// 3. Esqueleto (afinamento de Zhang-Suen): a rua vira uma linha de uma célula, no meio dela.
// 4. Nós: células do esqueleto com 3 ou mais vizinhos (cruzamento, juntadas num nó só) ou com 1 (fim da rua).
//    Trechos: o caminho do esqueleto entre dois nós, simplificado (Douglas-Peucker a 1 m), com a largura
//    mediana dele.
// 5. Limpeza: espinho (trecho que sai de um nó e acaba solto, mais curto que a largura da rua) sai; dois
//    cruzamentos ligados por um trecho mais curto que a rua mais larga deles viram um só (o afinamento parte o
//    cruzamento em ângulo agudo em dois T); e os nós que ficam com 2 trechos se juntam.
//
// Cada nó diz o tipo: "cruz" (4 braços), "T" (3), "fim" (1), "borda" (1, na borda da grade: a rua segue)
// ou "outro" (5 ou mais), e os rumos dos braços.
// A grade é alinhada ao mundo: o mesmo trecho dá o mesmo grafo, vindo de qualquer lado.
//
// PREMISSAS: grade de 1 m num quadrado de 240 m; Douglas-Peucker a 1 m; espinho mais curto que 1,5 vez a
// largura sai; cruzamentos a menos de 1,2 vez a rua mais larga viram um, ou a menos de 2 vezes se os 4 braços
// juntos formam duas ruas retas (braços opostos a menos de 25°: o X em ângulo agudo).

export const GRAPH = { cell: 1, size: 240, simplify: 1, spur: 1.5, joinJunctions: 1.2, joinCross: 2, straight: (25 * Math.PI) / 180 };

/** Grade de rua (1) ou não (0), alinhada a múltiplos da célula, centrada em (cx, cz). */
export function roadRaster(isRoad, cx, cz, opt = GRAPH) {
  const n = Math.round(opt.size / opt.cell);
  const x0 = Math.floor((cx - opt.size / 2) / opt.cell) * opt.cell;
  const z0 = Math.floor((cz - opt.size / 2) / opt.cell) * opt.cell;
  const m = new Uint8Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) m[r * n + c] = isRoad(x0 + (c + 0.5) * opt.cell, z0 + (r + 0.5) * opt.cell) ? 1 : 0;
  return { n, x0, z0, cell: opt.cell, m };
}

/** Distância (em células) de cada célula de rua até a primeira que não é rua (chamfer 1/√2, duas passadas). */
export function distanceToEdge({ n, m }) {
  const d = new Float32Array(n * n);
  for (let k = 0; k < n * n; k++) d[k] = m[k] ? Infinity : 0;
  const D = Math.SQRT2;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const k = r * n + c;
      if (!m[k]) continue;
      let v = d[k];
      v = Math.min(v, c > 0 ? d[k - 1] + 1 : 1, r > 0 ? d[k - n] + 1 : 1);
      if (r > 0) v = Math.min(v, c > 0 ? d[k - n - 1] + D : D, c < n - 1 ? d[k - n + 1] + D : D);
      d[k] = v;
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    for (let c = n - 1; c >= 0; c--) {
      const k = r * n + c;
      if (!m[k]) continue;
      let v = d[k];
      v = Math.min(v, c < n - 1 ? d[k + 1] + 1 : 1, r < n - 1 ? d[k + n] + 1 : 1);
      if (r < n - 1) v = Math.min(v, c < n - 1 ? d[k + n + 1] + D : D, c > 0 ? d[k + n - 1] + D : D);
      d[k] = v;
    }
  }
  return d;
}

// Vizinhos de Zhang-Suen, no sentido horário a partir de cima: P2..P9.
const RING = [[-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1]];

/**
 * Esqueleto de uma célula de largura (Zhang-Suen). Devolve a máscara nova. Sem alocar nada por célula: os 8
 * vizinhos saem de deslocamentos fixos, e cada passada só revisita as células que ainda são rua (a lista
 * encolhe a cada passada). Na cidade, de cerca de 60 ms para poucos ms.
 */
export function thin({ n, m }) {
  const s = Uint8Array.from(m);
  // A borda da grade não entra (o afinamento olha os 8 vizinhos).
  for (let i = 0; i < n; i++) s[i] = s[(n - 1) * n + i] = s[i * n] = s[i * n + n - 1] = 0;
  // P2..P9 no sentido horário a partir de cima, como deslocamentos no vetor.
  const o = RING.map(([dr, dc]) => dr * n + dc);
  let live = [];
  for (let k = 0; k < n * n; k++) if (s[k]) live.push(k);
  const del = [];
  for (let changed = true; changed; ) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      del.length = 0;
      for (let i = 0; i < live.length; i++) {
        const k = live[i];
        if (!s[k]) continue;
        const p2 = s[k + o[0]], p3 = s[k + o[1]], p4 = s[k + o[2]], p5 = s[k + o[3]];
        const p6 = s[k + o[4]], p7 = s[k + o[5]], p8 = s[k + o[6]], p9 = s[k + o[7]];
        const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (b < 2 || b > 6) continue;
        const a = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
        if (a !== 1) continue;
        // P2·P4·P6 e P4·P6·P8 (1º passo); P2·P4·P8 e P2·P6·P8 (2º).
        if (step === 0 ? (p2 && p4 && p6) || (p4 && p6 && p8) : (p2 && p4 && p8) || (p2 && p6 && p8)) continue;
        del.push(k);
      }
      for (let i = 0; i < del.length; i++) s[del[i]] = 0;
      if (del.length) changed = true;
    }
    if (changed) live = live.filter((k) => s[k]);
  }
  return s;
}

/** Douglas-Peucker em pontos {x, z}. */
export function simplify(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
  let worst = 0, at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i].x - a.x) * dz - (pts[i].z - a.z) * dx) / len;
    if (d > worst) { worst = d; at = i; }
  }
  if (worst <= eps) return [a, b];
  return [...simplify(pts.slice(0, at + 1), eps).slice(0, -1), ...simplify(pts.slice(at), eps)];
}

const median = (v) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/**
 * O grafo das ruas em volta de (cx, cz): {nodes, edges, raster}. Nó: {id, x, z, kind, arms (rumos em rad,
 * no sentido de `heading` do street view: 0 = +z), edges}. Trecho: {id, a, b, points [{x, z}], width, length}.
 */
export function roadGraph(isRoad, cx, cz, opt = GRAPH) {
  const raster = roadRaster(isRoad, cx, cz, opt);
  const { n, x0, z0, cell } = raster;
  const dist = distanceToEdge(raster);
  const sk = thin(raster);
  const at = (k) => ({ x: x0 + ((k % n) + 0.5) * cell, z: z0 + (((k / n) | 0) + 0.5) * cell });
  const nbrs = (k) => {
    const out = [];
    const r = (k / n) | 0, c = k % n;
    for (const [dr, dc] of RING) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && cc >= 0 && rr < n && cc < n && sk[rr * n + cc]) out.push(rr * n + cc);
    }
    return out;
  };
  // Nós: células com 1 vizinho ou com 3+; as de cruzamento vizinhas viram um nó só.
  const nodeOf = new Int32Array(n * n).fill(-1);
  const nodes = [];
  for (let k = 0; k < n * n; k++) {
    if (!sk[k] || nodeOf[k] !== -1) continue;
    const deg = nbrs(k).length;
    if (deg === 2) continue;
    const id = nodes.length;
    const cells = [k];
    nodeOf[k] = id;
    if (deg >= 3) {
      for (let i = 0; i < cells.length; i++) {
        for (const q of nbrs(cells[i])) if (nodeOf[q] === -1 && nbrs(q).length >= 3) { nodeOf[q] = id; cells.push(q); }
      }
    }
    const ps = cells.map(at);
    nodes.push({ id, x: ps.reduce((s, p) => s + p.x, 0) / ps.length, z: ps.reduce((s, p) => s + p.z, 0) / ps.length, cells, edges: [] });
  }
  // Trechos: de cada nó, segue o esqueleto até o próximo nó.
  const edges = [];
  const used = new Set();
  for (const node of nodes) {
    for (const start of node.cells) {
      for (const first of nbrs(start)) {
        if (nodeOf[first] === node.id) continue;
        const key = start < first ? `${start}:${first}` : `${first}:${start}`;
        if (used.has(key)) continue;
        used.add(key);
        const path = [start, first];
        let prev = start, cur = first;
        while (nodeOf[cur] === -1) {
          const next = nbrs(cur).find((q) => q !== prev && !path.includes(q));
          if (next === undefined) break;
          used.add(cur < next ? `${cur}:${next}` : `${next}:${cur}`);
          path.push(next);
          prev = cur;
          cur = next;
        }
        const end = nodeOf[cur];
        if (end === -1 || (end === node.id && path.length < 4)) continue;
        const pts = path.map(at);
        const width = 2 * median(path.map((k) => dist[k])) * cell;
        const simple = simplify(pts, opt.simplify);
        simple[0] = { x: node.x, z: node.z };
        simple[simple.length - 1] = { x: nodes[end].x, z: nodes[end].z };
        const length = simple.reduce((s, p, i) => (i ? s + Math.hypot(p.x - simple[i - 1].x, p.z - simple[i - 1].z) : 0), 0);
        const e = { id: edges.length, a: node.id, b: end, points: simple, width: +width.toFixed(1), length: +length.toFixed(1) };
        edges.push(e);
      }
    }
  }
  // Espinhos: trecho até um fim de rua mais curto que 1,5 vez a largura sai (a sobra do afinamento nas quinas).
  let alive = edges.map(() => true);
  const degree = (id) => edges.filter((e, i) => alive[i] && (e.a === id || e.b === id)).length;
  for (let again = true; again; ) {
    again = false;
    edges.forEach((e, i) => {
      if (!alive[i]) return;
      const loose = degree(e.a) === 1 ? e.a : degree(e.b) === 1 ? e.b : null;
      const other = loose === e.a ? e.b : e.a;
      if (loose !== null && degree(other) >= 3 && e.length < opt.spur * e.width) {
        alive[i] = false;
        again = true;
      }
    });
  }
  let live = edges.filter((_, i) => alive[i]);
  /** Os braços dos dois nós de `e` (sem `e`), vistos do meio dele, formam duas ruas retas? */
  const crossesStraight = (e, near) => {
    if (near.length !== 4) return false;
    const mx = (nodes[e.a].x + nodes[e.b].x) / 2, mz = (nodes[e.a].z + nodes[e.b].z) / 2;
    const arms = near.map((o) => {
      const fromA = o.a === e.a || o.a === e.b;
      const pts = fromA ? o.points : o.points.slice().reverse();
      const p = pts[Math.min(2, pts.length - 1)];
      return Math.atan2(p.x - mx, p.z - mz);
    });
    const opposite = (h1, h2) => Math.abs(Math.atan2(Math.sin(h1 - h2 - Math.PI), Math.cos(h1 - h2 - Math.PI))) < opt.straight;
    return arms.every((h, i) => arms.some((g, j) => j !== i && opposite(h, g)));
  };
  // Dois cruzamentos colados (ângulo agudo): o trecho curto entre eles some e os dois nós viram um.
  const degLive = (id) => live.filter((e) => e.a === id || e.b === id).length;
  for (let again = true; again; ) {
    again = false;
    for (const e of live) {
      if (e.a === e.b || degLive(e.a) < 3 || degLive(e.b) < 3) continue;
      const near = live.filter((o) => o !== e && [e.a, e.b].some((id) => o.a === id || o.b === id));
      const widest = Math.max(e.width, ...near.map((o) => o.width));
      if (e.length >= opt.joinCross * widest) continue;
      if (e.length >= opt.joinJunctions * widest && !crossesStraight(e, near)) continue;
      const A = nodes[e.a], B = nodes[e.b];
      A.x = (A.x + B.x) / 2;
      A.z = (A.z + B.z) / 2;
      live = live.filter((o) => o !== e).map((o) => ({ ...o, a: o.a === B.id ? A.id : o.a, b: o.b === B.id ? A.id : o.b }));
      for (const o of live) {
        if (o.a === A.id) o.points[0] = { x: A.x, z: A.z };
        if (o.b === A.id) o.points[o.points.length - 1] = { x: A.x, z: A.z };
      }
      again = true;
      break;
    }
  }
  // Nó que ficou com 2 trechos: junta os dois num só.
  const merged = [];
  const gone = new Set();
  for (const e of live) merged.push({ ...e, points: e.points.slice() });
  for (const node of nodes) {
    const mine = merged.filter((e) => !gone.has(e) && (e.a === node.id || e.b === node.id));
    if (mine.length !== 2 || mine[0] === mine[1]) continue;
    const [e1, e2] = mine;
    const p1 = e1.b === node.id ? e1.points : e1.points.slice().reverse();
    const p2 = e2.a === node.id ? e2.points : e2.points.slice().reverse();
    const from = e1.b === node.id ? e1.a : e1.b;
    const to = e2.a === node.id ? e2.b : e2.a;
    if (from === node.id || to === node.id) continue;
    const points = simplify([...p1, ...p2.slice(1)], opt.simplify);
    const len = (e1.length + e2.length);
    const comb = { id: e1.id, a: from, b: to, points, width: +(((e1.width * e1.length + e2.width * e2.length) / (len || 1))).toFixed(1), length: +len.toFixed(1) };
    gone.add(e1);
    gone.add(e2);
    merged.push(comb);
    node.merged = true;
  }
  const finalEdges = merged.filter((e) => !gone.has(e)).map((e, i) => ({ ...e, id: i }));
  const keep = nodes.filter((nd) => !nd.merged && finalEdges.some((e) => e.a === nd.id || e.b === nd.id));
  for (const nd of keep) {
    nd.edges = finalEdges.filter((e) => e.a === nd.id || e.b === nd.id).map((e) => e.id);
    // Rumo de cada braço: do nó para o 2º ponto do trecho (o 1º é o próprio nó).
    nd.arms = nd.edges.map((id) => {
      const e = finalEdges[id];
      const pts = e.a === nd.id ? e.points : e.points.slice().reverse();
      const p = pts[Math.min(1, pts.length - 1)];
      return Math.atan2(p.x - nd.x, p.z - nd.z);
    });
    const deg = nd.edges.length;
    // Na borda da grade, o trecho só foi cortado: a rua segue.
    // O afinamento come a ponta cortada: a borda vale até meia largura da rua (mais 3 células) para dentro.
    const w = finalEdges[nd.edges[0]]?.width ?? 0;
    const border = Math.min(nd.x - x0, nd.z - z0, x0 + n * cell - nd.x, z0 + n * cell - nd.z) < w / 2 + 3 * cell;
    nd.kind = deg === 1 ? (border ? 'borda' : 'fim') : deg === 3 ? 'T' : deg === 4 ? 'cruz' : 'outro';
    delete nd.cells;
  }
  return { nodes: keep, edges: finalEdges, raster: { n, x0, z0, cell } };
}

const KIND_COLOR = { cruz: 0x22c55e, T: 0xf59e0b, fim: 0xef4444, borda: 0x64748b, outro: 0xa855f7 };

/**
 * O grafo em volta do avatar, refeito quando ele se afasta `rebuildAt` m do centro do último. Com `show`,
 * desenha o grafo na rua (linha do meio em azul, cruzamento verde, T laranja, fim vermelho), para conferir.
 */
export function createRoadGraph({ THREE, scene, streetView, show = false, rebuildAt = 60, opt = GRAPH }) {
  const group = new THREE.Group();
  group.name = 'grafo-ruas';
  scene.add(group);
  let graph = null;
  let center = null;
  const stats = { builds: 0, ms: 0 };

  function draw() {
    for (const c of [...group.children]) {
      group.remove(c);
      c.geometry.dispose();
      c.material.dispose();
    }
    const y = streetView.groundY() + 0.2;
    const pos = [];
    for (const e of graph.edges) for (let i = 1; i < e.points.length; i++) pos.push(e.points[i - 1].x, y, e.points[i - 1].z, e.points[i].x, y, e.points[i].z);
    const lines = new THREE.BufferGeometry();
    lines.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    group.add(new THREE.LineSegments(lines, new THREE.LineBasicMaterial({ color: 0x38bdf8, depthTest: false })));
    for (const n of graph.nodes) {
      const dot = new THREE.Mesh(new THREE.CylinderGeometry(n.kind === 'cruz' || n.kind === 'T' ? 2 : 1, 1, 0.1, 16), new THREE.MeshBasicMaterial({ color: KIND_COLOR[n.kind], depthTest: false }));
      dot.position.set(n.x, y, n.z);
      dot.renderOrder = 10;
      group.add(dot);
    }
  }

  function rebuild(x, z) {
    const t0 = performance.now();
    graph = roadGraph((px, pz) => streetView.isRoad(px, pz), x, z, opt);
    stats.ms = Math.round(performance.now() - t0);
    stats.builds++;
    center = { x, z };
    if (show) draw();
  }

  return {
    update() {
      const on = streetView.active();
      group.visible = on && show;
      if (!on) return;
      const a = streetView.position();
      if (!center || Math.hypot(a.x - center.x, a.z - center.z) > rebuildAt) rebuild(a.x, a.z);
    },
    /** O grafo de agora (null antes de entrar no street view). */
    graph: () => graph,
    debug: () => graph && {
      ...stats,
      nodes: graph.nodes.reduce((acc, n) => ((acc[n.kind] = (acc[n.kind] ?? 0) + 1), acc), {}),
      edges: graph.edges.length,
      widths: graph.edges.map((e) => e.width).sort((a, b) => a - b),
    },
  };
}
