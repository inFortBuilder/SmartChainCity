// Street view: o jogador arrasta o boneco do canto da tela até uma rua e passa a
// caminhar com o avatar no nível do chão, só pelas ruas (como o Street View do
// Google). A área de caminhada é a própria camada `roads` da cidade (OSM): um
// índice em grade dos triângulos das ruas responde "este ponto é rua?".
//
// Avatar: os manequins da Universal Animation Library (Quaternius, CC0), Man ou
// Woman, escolhidos na barra do street view (ver avatar.js).
//
// Calçada (fase 1 do mundo aberto, docs/desenvolvimento/mundo-aberto-terceira-pessoa.md):
// em volta do avatar, uma grade de 0,5 m marca a faixa de 3 m ao lado das ruas como
// calçada, 15 cm acima do asfalto (o meio-fio). Dá para andar nela, e ela é
// desenhada no chão. Os prédios (caixas) ficam de fora da calçada e empurram a
// câmera para não atravessar a parede. Espaço pula.

import { AVATAR_TYPES, getAvatarType, loadAvatarAssets, makeAvatar, setAvatarType } from './avatar.js';
import { findPath } from './caminho.js';
import { createCrosswalks } from './faixas.js';
import { createFurniture } from './mobiliario.js';
import { createBusStops } from './onibus.js';

const CELL = 32; // m por célula do índice
const SPEED = { walk: 1.5, run: 4.2 }; // m/s
const CAM = { dist: 4.5, minDist: 2, maxDist: 14, height: 1.6 };
/**
 * Calçada em volta do avatar. PREMISSAS: 3 m de largura ao lado de toda rua (o OSM quase nunca
 * desenha a calçada), meio-fio de 15 cm, grade de 0,5 m num raio de 40 m, refeita a cada 20 m.
 */
export const SIDEWALK = { width: 3, curb: 0.15, cell: 0.5, radius: 40, rebuildAt: 20 };
const JUMP = { speed: 4.2, gravity: 9.8 };
/** Virada no lugar: começa acima de 100°, gira a 7 rad/s (~400°/s) e termina a 20° do rumo pedido. */
const TURN = { start: 1.75, rate: 7, done: 0.35 };

/**
 * Grade da calçada em volta de (cx, cz): 1 = rua, 2 = calçada, 0 = fora. A distância até a rua sai de
 * uma transformada de distância em duas passadas (chamfer 1/√2), sem testar os vizinhos um a um.
 * `blocked(x, z)` tira da calçada o chão dos prédios.
 */
export function buildSidewalkGrid(isRoad, cx, cz, blocked = () => false, opt = SIDEWALK) {
  const n = Math.ceil((opt.radius * 2) / opt.cell);
  // Alinhada a múltiplos da célula no mundo: refazer a grade em outro centro dá as mesmas células (e o
  // mesmo sorteio de postes, árvores e pontos de ônibus).
  const x0 = Math.floor((cx - (n * opt.cell) / 2) / opt.cell) * opt.cell;
  const z0 = Math.floor((cz - (n * opt.cell) / 2) / opt.cell) * opt.cell;
  const kind = new Uint8Array(n * n);
  const dist = new Float32Array(n * n).fill(Infinity);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const x = x0 + (c + 0.5) * opt.cell, z = z0 + (r + 0.5) * opt.cell;
      if (isRoad(x, z)) { kind[r * n + c] = 1; dist[r * n + c] = 0; }
    }
  }
  const D = Math.SQRT2;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const k = r * n + c;
      let d = dist[k];
      if (c > 0) d = Math.min(d, dist[k - 1] + 1);
      if (r > 0) {
        d = Math.min(d, dist[k - n] + 1);
        if (c > 0) d = Math.min(d, dist[k - n - 1] + D);
        if (c < n - 1) d = Math.min(d, dist[k - n + 1] + D);
      }
      dist[k] = d;
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    for (let c = n - 1; c >= 0; c--) {
      const k = r * n + c;
      let d = dist[k];
      if (c < n - 1) d = Math.min(d, dist[k + 1] + 1);
      if (r < n - 1) {
        d = Math.min(d, dist[k + n] + 1);
        if (c < n - 1) d = Math.min(d, dist[k + n + 1] + D);
        if (c > 0) d = Math.min(d, dist[k + n - 1] + D);
      }
      dist[k] = d;
    }
  }
  const maxCells = opt.width / opt.cell;
  let sidewalk = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const k = r * n + c;
      if (kind[k] || dist[k] > maxCells) continue;
      const x = x0 + (c + 0.5) * opt.cell, z = z0 + (r + 0.5) * opt.cell;
      if (blocked(x, z)) continue;
      kind[k] = 2;
      sidewalk++;
    }
  }
  const at = (x, z) => {
    const c = Math.floor((x - x0) / opt.cell), r = Math.floor((z - z0) / opt.cell);
    return c < 0 || r < 0 || c >= n || r >= n ? -1 : kind[r * n + c];
  };
  return { n, x0, z0, cell: opt.cell, kind, dist, sidewalk, cx, cz, at };
}

// Marching squares, versão preenchida: para cada caso (bits dos 4 cantos: 1 = c0, 2 = c1, 4 = c2, 8 = c3),
// o polígono cheio (cantos 0–3 e meios das arestas 4–7: 4 = c0–c1, 5 = c1–c2, 6 = c2–c3, 7 = c3–c0) e os
// trechos da borda (pares de meios), onde entra a face do meio-fio. Nas selas (5 e 10), os cantos cheios
// ficam ligados.
const MS_FILL = [
  [], [0, 4, 7], [4, 1, 5], [0, 1, 5, 7], [5, 2, 6], [0, 4, 5, 2, 6, 7], [4, 1, 2, 6], [0, 1, 2, 6, 7],
  [6, 3, 7], [0, 4, 6, 3], [4, 1, 5, 6, 3, 7], [0, 1, 5, 6, 3], [5, 2, 3, 7], [0, 4, 5, 2, 3], [4, 1, 2, 3, 7], [0, 1, 2, 3],
];
const MS_EDGE = [
  [], [4, 7], [4, 5], [5, 7], [5, 6], [4, 5, 6, 7], [4, 6], [6, 7],
  [6, 7], [4, 6], [5, 6, 7, 4], [5, 6], [5, 7], [4, 5], [4, 7], [],
];

/**
 * Malha da calçada a partir da grade: o topo (a \`top\`) com a borda em diagonal, em vez de degraus de
 * 0,5 m, e a face do meio-fio (de \`top\` até \`bottom\`) ao longo da borda. Posições e normais prontas para
 * um BufferGeometry, sem índice.
 */
export function sidewalkMesh(grid, top, bottom) {
  const { n, x0, z0, cell, kind } = grid;
  const pos = [];
  const nor = [];
  const filled = (r, c) => kind[r * n + c] >= 2;
  const px = new Float64Array(8), pz = new Float64Array(8);
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const code = (filled(r, c) ? 1 : 0) | (filled(r, c + 1) ? 2 : 0) | (filled(r + 1, c + 1) ? 4 : 0) | (filled(r + 1, c) ? 8 : 0);
      if (!code) continue;
      const xa = x0 + (c + 0.5) * cell, xb = xa + cell, za = z0 + (r + 0.5) * cell, zb = za + cell;
      // Cantos c0 (r, c), c1 (r, c+1), c2 (r+1, c+1), c3 (r+1, c) e os meios das arestas.
      px[0] = xa; pz[0] = za; px[1] = xb; pz[1] = za; px[2] = xb; pz[2] = zb; px[3] = xa; pz[3] = zb;
      px[4] = (xa + xb) / 2; pz[4] = za; px[5] = xb; pz[5] = (za + zb) / 2; px[6] = (xa + xb) / 2; pz[6] = zb; px[7] = xa; pz[7] = (za + zb) / 2;
      const poly = MS_FILL[code];
      // Ordem invertida: a face de cima fica virada para +Y (vista de cima, no sentido anti-horário).
      for (let i = 1; i < poly.length - 1; i++) {
        for (const v of [poly[0], poly[i + 1], poly[i]]) {
          pos.push(px[v], top, pz[v]);
          nor.push(0, 1, 0);
        }
      }
      const edge = MS_EDGE[code];
      for (let i = 0; i < edge.length; i += 2) {
        const a = edge[i], b = edge[i + 1];
        const dx = px[b] - px[a], dz = pz[b] - pz[a];
        const len = Math.hypot(dx, dz) || 1;
        const nx = dz / len, nz = -dx / len;
        for (const [v, y] of [[a, top], [b, top], [b, bottom], [a, top], [b, bottom], [a, bottom]]) {
          pos.push(px[v], y, pz[v]);
          nor.push(nx, 0, nz);
        }
      }
    }
  }
  return { position: new Float32Array(pos), normal: new Float32Array(nor), triangles: pos.length / 9 };
}

/** Índice dos triângulos das ruas no plano XZ, em grade (formato CSR). */
export function buildRoadIndex(mesh) {
  mesh.updateWorldMatrix(true, false);
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const idx = g.index;
  const n = (idx ? idx.count : pos.count) / 3;
  const e = mesh.matrixWorld.elements;
  // Vértices em XZ do mundo (a camada é plana; a rotação e a escala entram igual).
  const xz = new Float32Array(pos.count * 2);
  let y = 0;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    xz[i * 2] = e[0] * px + e[4] * py + e[8] * pz + e[12];
    xz[i * 2 + 1] = e[2] * px + e[6] * py + e[10] * pz + e[14];
    if (i === 0) y = e[1] * px + e[5] * py + e[9] * pz + e[13];
  }
  const tri = new Uint32Array(n * 3);
  for (let t = 0; t < n * 3; t++) tri[t] = idx ? idx.getX(t) : t;

  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = xz[i * 2], z = xz[i * 2 + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const cols = Math.ceil((maxX - minX) / CELL) + 1;
  const rows = Math.ceil((maxZ - minZ) / CELL) + 1;
  const span = (t, fn) => {
    const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2];
    const x0 = Math.min(xz[a * 2], xz[b * 2], xz[c * 2]), x1 = Math.max(xz[a * 2], xz[b * 2], xz[c * 2]);
    const z0 = Math.min(xz[a * 2 + 1], xz[b * 2 + 1], xz[c * 2 + 1]), z1 = Math.max(xz[a * 2 + 1], xz[b * 2 + 1], xz[c * 2 + 1]);
    const c0 = Math.floor((x0 - minX) / CELL), c1 = Math.floor((x1 - minX) / CELL);
    const r0 = Math.floor((z0 - minZ) / CELL), r1 = Math.floor((z1 - minZ) / CELL);
    for (let r = r0; r <= r1; r++) for (let col = c0; col <= c1; col++) fn(r * cols + col);
  };
  const start = new Uint32Array(cols * rows + 1);
  for (let t = 0; t < n; t++) span(t, (k) => start[k + 1]++);
  for (let k = 0; k < cols * rows; k++) start[k + 1] += start[k];
  const fill = start.slice(0, cols * rows);
  const items = new Uint32Array(start[cols * rows]);
  for (let t = 0; t < n; t++) span(t, (k) => { items[fill[k]++] = t; });

  const inside = (t, x, z) => {
    const a = tri[t * 3] * 2, b = tri[t * 3 + 1] * 2, c = tri[t * 3 + 2] * 2;
    const d1 = (x - xz[b]) * (xz[a + 1] - xz[b + 1]) - (xz[a] - xz[b]) * (z - xz[b + 1]);
    const d2 = (x - xz[c]) * (xz[b + 1] - xz[c + 1]) - (xz[b] - xz[c]) * (z - xz[c + 1]);
    const d3 = (x - xz[a]) * (xz[c + 1] - xz[a + 1]) - (xz[c] - xz[a]) * (z - xz[a + 1]);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos_ = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos_);
  };
  return {
    y,
    triangles: n,
    isRoad(x, z) {
      const col = Math.floor((x - minX) / CELL), r = Math.floor((z - minZ) / CELL);
      if (col < 0 || r < 0 || col >= cols || r >= rows) return false;
      const k = r * cols + col;
      for (let i = start[k]; i < start[k + 1]; i++) if (inside(items[i], x, z)) return true;
      return false;
    },
  };
}

const PEGMAN = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><circle cx="12" cy="4.6" r="3" fill="#f59e0b"/><path d="M8 9.5c0-1 .8-1.8 1.8-1.8h4.4c1 0 1.8.8 1.8 1.8v5.2c0 .7-.5 1.2-1.2 1.2h-.6l-.4 6.1h-3.6l-.4-6.1h-.6c-.7 0-1.2-.5-1.2-1.2z" fill="#f59e0b" stroke="#b45309" stroke-width=".8"/></svg>`;

export function createStreetView({
  THREE, scene, camera, controls, canvas, roads, loadGltf, onPlaceClick,
  blockers = () => [],
  /** Chão andável fora da rua e da calçada (o salão do mercado, mercado-rua.js) e a altura dele. */
  extraWalkable = () => false,
  extraFloor = () => null,
}) {
  let index = null;
  let walk = null; // grade da calçada em volta do avatar
  let boxes = []; // caixas dos prédios perto do avatar (câmera e calçada)
  let active = false;
  let saved = null;
  // target: o próximo ponto; path: os pontos depois dele (caminho.js), quando o clique contorna obstáculos.
  const avatar = { obj: new THREE.Group(), mixer: null, heading: 0, target: null, path: [], speed: 0, model: null, clips: [], type: null, source: null };
  /** Vai até (x, z) pelo caminho em volta dos obstáculos; sem caminho, em linha reta. Devolve os pontos. */
  /** No ônibus: devolve {x, z, heading} do ônibus a cada quadro (viagem.js), ou null a pé. */
  let ride = null;
  let rideDist = null;
  const walkTo = (x, z) => {
    const o = avatar.obj.position;
    const path = findPath(isWalkable, { x: o.x, z: o.z }, { x, z }) ?? [{ x, z }];
    avatar.path = path.slice(1).map((p) => new THREE.Vector3(p.x, o.y, p.z));
    avatar.target = new THREE.Vector3(path[0].x, o.y, path[0].z);
    return path;
  };
  avatar.obj.visible = false;
  scene.add(avatar.obj);
  const view = { yaw: 0, pitch: 0.12, dist: CAM.dist };
  const keys = new Set();
  const roadColor = roads.material.color.clone();

  // ---------- UI: boneco no canto, marcador no chão, botão de voltar ----------
  const style = document.createElement('style');
  style.textContent = `
    .sv-peg { position: fixed; right: 16px; bottom: 40px; z-index: 6; width: 48px; height: 48px; border-radius: 12px; border: 0;
      background: #fff; box-shadow: 0 4px 14px rgba(0,0,0,.25); display: grid; place-items: center; cursor: grab; touch-action: none; }
    .sv-peg:hover { background: #fff7e6; }
    .sv-peg[hidden] { display: none; }
    .sv-ghost { position: fixed; z-index: 20; pointer-events: none; transform: translate(-50%, -85%) scale(1.5); filter: drop-shadow(0 3px 4px rgba(0,0,0,.35)); }
    .sv-tip { position: fixed; z-index: 20; left: 50%; bottom: 100px; transform: translateX(-50%); padding: 8px 14px; border-radius: 999px;
      background: rgba(15,23,42,.85); color: #fff; font: 600 13px system-ui, sans-serif; pointer-events: none; }
    .sv-bar { position: fixed; left: 16px; top: 16px; z-index: 7; display: flex; gap: 8px; align-items: center; padding: 8px 10px;
      border-radius: 12px; background: rgba(15,23,42,.82); color: #fff; font: 13px system-ui, sans-serif; }
    .sv-bar[hidden] { display: none; }
    .sv-tipo { display: inline-flex; gap: 4px; align-items: center; }
    .sv-tipo button { background: rgba(255,255,255,.15) !important; color: #fff !important; font-weight: 600 !important; padding: 5px 10px !important; }
    .sv-tipo button[aria-pressed="true"] { background: #f59e0b !important; color: #0b1220 !important; }
    .sv-bar button { border: 0; border-radius: 8px; padding: 7px 12px; font-weight: 700; cursor: pointer; background: #fff; color: #0b1220; }
    .sv-help { opacity: .8; }
    body.sv-on .topbar, body.sv-on .layers, body.sv-on .ficha, body.sv-on .servidor { display: none !important; }
    @media (max-width: 640px) { .sv-peg { bottom: 392px; right: 10px; } .sv-help { display: none; } }
  `;
  document.head.append(style);
  const peg = document.createElement('button');
  peg.className = 'sv-peg';
  peg.title = 'Arraste o boneco até uma rua para caminhar';
  peg.setAttribute('aria-label', peg.title);
  peg.innerHTML = PEGMAN;
  document.body.append(peg);
  const bar = document.createElement('div');
  bar.className = 'sv-bar';
  bar.hidden = true;
  bar.innerHTML = `<button type="button" data-sair>← Voltar ao mapa</button>
    <span class="sv-tipo" role="group" aria-label="Tipo de avatar">Avatar:
      ${Object.entries(AVATAR_TYPES).map(([k, t]) => `<button type="button" data-tipo="${k}">${t.label}</button>`).join('')}</span>
    <span class="sv-help">W A S D ou setas para andar · Shift corre · Espaço pula · clique na rua ou na calçada para ir até lá · clique num imóvel para entrar · arraste para olhar</span>`;
  document.body.append(bar);
  bar.querySelector('[data-sair]').addEventListener('click', () => exit());
  const markType = (t) => bar.querySelectorAll('[data-tipo]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tipo === t)));
  markType(getAvatarType());
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tipo]');
    if (!b) return;
    setAvatarType(b.dataset.tipo);
    markType(b.dataset.tipo);
    loadAvatar(b.dataset.tipo).catch(() => say('O avatar não carregou.'));
  });
  let tip = null;
  const say = (text, ms = 1800) => {
    tip?.remove();
    tip = document.createElement('div');
    tip.className = 'sv-tip';
    tip.textContent = text;
    document.body.append(tip);
    const mine = tip;
    if (ms) setTimeout(() => mine.remove(), ms);
  };

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.2, 2.2, 32),
    new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.85, depthTest: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 10;
  ring.visible = false;
  scene.add(ring);

  // ---------- Calçada: grade em volta do avatar, desenhada como contorno (marching squares) ----------
  const tileMat = new THREE.MeshStandardMaterial({
    color: 0xeeeae2,
    roughness: 0.9,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const tiles = new THREE.Mesh(new THREE.BufferGeometry(), tileMat);
  tiles.receiveShadow = true;
  tiles.frustumCulled = false;
  tiles.visible = false;
  scene.add(tiles);
  // Postes e árvores ao longo da calçada (mobiliario.js); ocupam a célula, e o avatar contorna.
  const furniture = createFurniture(THREE, scene);
  // Pontos de ônibus no meio-fio (onibus.js, fase 3).
  const busStops = createBusStops(THREE, scene);
  let busStopCount = 0;
  // Faixas de pedestre nos cruzamentos (faixas.js), tiradas da mesma grade.
  const crosswalks = createCrosswalks(THREE, scene);
  let crosswalkCounts = null;
  let furnitureCounts = null;
  const boxHit = new THREE.Vector3();
  /**
   * Caixas dos prédios a até 120 m: os objetos de `blockers()` com mais de 2 m de altura. A caixa é a do
   * próprio prédio (orientada): um prédio girado não cobre as ruas em volta, como a caixa alinhada aos eixos.
   */
  const refreshBoxes = (x, z) => {
    const out = [];
    const size = new THREE.Vector3();
    const rel = new THREE.Matrix4();
    for (const root of blockers()) {
      if (!root) continue;
      for (const o of root.isLOD || root.isMesh ? [root] : root.children) {
        const world = new THREE.Box3().setFromObject(o);
        // Peças baixas não seguram a câmera, a não ser as marcadas (o telhado do mercado).
        if (world.isEmpty() || (world.getSize(size).y < 2 && !o.userData.blocker)) continue;
        const dx = Math.max(world.min.x - x, 0, x - world.max.x), dz = Math.max(world.min.z - z, 0, z - world.max.z);
        if (Math.hypot(dx, dz) >= 120) continue;
        o.updateWorldMatrix(true, true);
        const inv = o.matrixWorld.clone().invert();
        const box = new THREE.Box3();
        o.traverse((m) => {
          if (!m.isMesh) return;
          if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
          box.union(m.geometry.boundingBox.clone().applyMatrix4(rel.multiplyMatrices(inv, m.matrixWorld)));
        });
        if (!box.isEmpty()) out.push({ box, inv, world: o.matrixWorld.clone() });
      }
    }
    boxes = out;
  };
  const probe = new THREE.Vector3();
  const insideBox = (x, z) =>
    boxes.some(({ box, inv }) => {
      probe.set(x, (box.min.y + box.max.y) / 2, z).applyMatrix4(inv);
      return probe.x >= box.min.x && probe.x <= box.max.x && probe.z >= box.min.z && probe.z <= box.max.z;
    });
  const rebuildWalk = (x, z) => {
    const t0 = performance.now();
    refreshBoxes(x, z);
    walk = buildSidewalkGrid(index.isRoad, x, z, insideBox);
    const m = sidewalkMesh(walk, index.y + SIDEWALK.curb, index.y);
    tiles.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
    tiles.geometry = g;
    tiles.visible = true;
    walk.triangles = m.triangles;
    crosswalkCounts = crosswalks.rebuild(walk, index.y);
    furnitureCounts = furniture.rebuild(walk, index.y + SIDEWALK.curb);
    busStopCount = busStops.rebuild(walk, index.y + SIDEWALK.curb);
    walk.ms = Math.round(performance.now() - t0);
  };
  /**
   * Chão onde o avatar pode pisar: rua ou calçada (a calçada só existe perto do avatar). A célula de rua da
   * grade (centro na rua) também vale: sem isso, sobrava uma fresta entre o polígono da rua e a primeira
   * célula de calçada, onde o avatar empacava.
   */
  const isWalkable = (x, z) => {
    if (index.isRoad(x, z)) return true;
    const k = walk?.at(x, z);
    return k === 1 || k === 2 || extraWalkable(x, z);
  };
  /** Altura do chão no ponto: a calçada fica no alto do meio-fio. */
  const floorAt = (x, z) => extraFloor(x, z) ?? index.y + (walk?.at(x, z) === 2 ? SIDEWALK.curb : 0);

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const groundAt = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    ground.constant = -(index?.y ?? 0);
    return ray.ray.intersectPlane(ground, new THREE.Vector3());
  };
  const ensureIndex = () => {
    if (!index) {
      const t0 = performance.now();
      index = buildRoadIndex(roads);
      console.info(`street view: ${index.triangles} triângulos de rua indexados em ${Math.round(performance.now() - t0)} ms`);
    }
    return index;
  };

  // ---------- Arrastar o boneco ----------
  let ghost = null;
  peg.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (active || ghost) return; // um arrasto por vez
    ensureIndex();
    ghost = document.createElement('div');
    ghost.className = 'sv-ghost';
    ghost.innerHTML = PEGMAN;
    document.body.append(ghost);
    roads.material.color.set(0x3b82f6); // as ruas ficam azuis, como no Google
    say('Solte o boneco numa rua (azul)', 0);
    moveGhost(e);
  });
  const moveGhost = (e) => {
    if (!ghost) return;
    ghost.style.left = `${e.clientX}px`;
    ghost.style.top = `${e.clientY}px`;
    const p = groundAt(e.clientX, e.clientY);
    ring.visible = !!p;
    if (p) {
      const ok = index.isRoad(p.x, p.z);
      ring.position.set(p.x, index.y + 0.3, p.z);
      const s = Math.max(1, camera.position.distanceTo(p) / 120);
      ring.scale.setScalar(s);
      ring.material.color.set(ok ? 0x22c55e : 0xef4444);
    }
  };
  // Na janela inteira: o boneco é solto sobre o mapa, fora do botão.
  addEventListener('pointermove', moveGhost);
  addEventListener('pointercancel', () => drop(null));
  addEventListener('pointerup', (e) => drop(e));
  function drop(e) {
    if (!ghost) return;
    ghost.remove();
    ghost = null;
    tip?.remove();
    ring.visible = false;
    roads.material.color.copy(roadColor);
    const p = e && groundAt(e.clientX, e.clientY);
    if (p && index.isRoad(p.x, p.z)) enter(p);
    else say('Aqui não é rua. Solte o boneco numa rua azul.');
  }

  // ---------- Avatar: Man ou Woman da Universal Animation Library (avatar.js) ----------
  let inst = null; // { body, mixer, play, type, source }
  let loading = null;
  const loadAvatar = (type = getAvatarType()) => {
    if (inst?.type === type) return Promise.resolve(inst);
    loading = (async () => {
      const assets = await loadAvatarAssets(loadGltf, type);
      if (inst?.type === assets.type) return inst;
      if (inst) {
        inst.mixer.stopAllAction();
        avatar.obj.remove(inst.body);
      }
      inst = makeAvatar(THREE, assets);
      avatar.obj.add(inst.body);
      Object.assign(avatar, { model: assets.model, clips: assets.clips, source: assets.source, type: assets.type, mixer: inst.mixer });
      inst.play('idle', 0);
      return inst;
    })();
    return loading;
  };
  const play = (name) => inst?.play(name);

  // A rua mais longa a partir do ponto: o avatar começa olhando para ela.
  const bestHeading = (x, z) => {
    let best = 0, bestLen = -1;
    for (let i = 0; i < 16; i++) {
      const h = (i / 16) * Math.PI * 2;
      let len = 0;
      while (len < 60 && index.isRoad(x + Math.sin(h) * (len + 1), z + Math.cos(h) * (len + 1))) len++;
      if (len > bestLen) { bestLen = len; best = h; }
    }
    return best;
  };

  async function enter(p) {
    active = true;
    saved = { pos: camera.position.clone(), target: controls.target.clone(), near: camera.near, far: camera.far, fov: camera.fov };
    controls.enabled = false;
    document.body.classList.add('sv-on');
    peg.hidden = true;
    bar.hidden = false;
    roads.material.color.copy(roadColor);
    avatar.obj.position.set(p.x, index.y, p.z);
    avatar.heading = bestHeading(p.x, p.z);
    avatar.obj.rotation.y = avatar.heading;
    avatar.target = null;
    view.yaw = avatar.heading;
    view.pitch = 0.12;
    camera.near = 0.1;
    camera.far = 4000;
    camera.fov = 60;
    camera.updateProjectionMatrix();
    avatar.obj.visible = true;
    jump.vy = 0;
    jump.air = false;
    rebuildWalk(p.x, p.z);
    await loadAvatar().catch((err) => { console.error(err); say('O avatar não carregou.'); });
  }

  function exit() {
    if (!active) return;
    active = false;
    avatar.obj.visible = false;
    tiles.visible = false;
    furniture.hide();
    busStops.hide();
    crosswalks.hide();
    camera.position.copy(saved.pos);
    controls.target.copy(saved.target);
    Object.assign(camera, { near: saved.near, far: saved.far, fov: saved.fov });
    camera.updateProjectionMatrix();
    controls.enabled = true;
    document.body.classList.remove('sv-on');
    peg.hidden = false;
    bar.hidden = true;
    keys.clear();
  }

  // ---------- Controles no chão ----------
  addEventListener('keydown', (e) => {
    if (!active || e.target.closest?.('input, textarea, select')) return;
    if (e.key === 'Escape') return exit();
    if (e.key === ' ' && !jump.air) {
      jump.vy = JUMP.speed;
      jump.air = true;
      inst?.playOnce('jumpStart', () => jump.air && play('jump'), 0.1);
    }
    keys.add(e.key.toLowerCase());
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(e.key.toLowerCase())) e.preventDefault();
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => keys.clear());
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!active) return;
    drag = { x: e.clientX, y: e.clientY, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!active || !drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    drag.x = e.clientX;
    drag.y = e.clientY;
    view.yaw -= dx * 0.005;
    view.pitch = THREE.MathUtils.clamp(view.pitch + dy * 0.004, -0.35, 1.2);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!active || !drag) return;
    const click = !drag.moved;
    drag = null;
    if (!click) return;
    const p = groundAt(e.clientX, e.clientY);
    if (p && isWalkable(p.x, p.z)) walkTo(p.x, p.z);
    // Fora da rua e da calçada: talvez um imóvel para entrar.
    else if (!(p && onPlaceClick?.(p))) say('Só dá para caminhar pelas ruas e calçadas.');
  });
  canvas.addEventListener('wheel', (e) => {
    if (!active) return;
    e.preventDefault();
    view.dist = THREE.MathUtils.clamp(view.dist * (e.deltaY > 0 ? 1.12 : 0.89), CAM.minDist, CAM.maxDist);
  }, { passive: false });

  // Um passo de (dx, dz): anda se o destino é rua; senão, desliza ao longo da borda.
  const step = (dx, dz) => {
    const o = avatar.obj.position;
    if (isWalkable(o.x + dx, o.z + dz)) { o.x += dx; o.z += dz; return true; }
    if (Math.abs(dx) > 1e-4 && isWalkable(o.x + dx, o.z)) { o.x += dx; return true; }
    if (Math.abs(dz) > 1e-4 && isWalkable(o.x, o.z + dz)) { o.z += dz; return true; }
    return false;
  };

  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const jump = { vy: 0, air: false, landing: false };
  const turn = { on: false };
  const camRay = new THREE.Ray();
  const localRay = new THREE.Ray();
  function tick(dt) {
    if (!active) return false;
    dt = Math.min(dt, 0.1);
    // No ônibus (viagem.js): o avatar, escondido, vai junto com ele; o teclado e o clique não andam.
    if (ride) {
      const p = ride();
      if (p) {
        avatar.obj.position.x = p.x;
        avatar.obj.position.z = p.z;
        avatar.heading = p.heading;
        view.yaw += Math.atan2(Math.sin(p.heading - view.yaw), Math.cos(p.heading - view.yaw)) * Math.min(1, dt * 1.5);
      }
      keys.clear();
      avatar.target = null;
      avatar.path = [];
    }
    const run = keys.has('shift');
    let fwd = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
    const side = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    let dirX = 0, dirZ = 0;
    if (fwd || side) {
      avatar.target = null;
      avatar.path = [];
      // Para frente é para onde a câmera olha.
      dirX = Math.sin(view.yaw) * fwd + Math.sin(view.yaw - Math.PI / 2) * side;
      dirZ = Math.cos(view.yaw) * fwd + Math.cos(view.yaw - Math.PI / 2) * side;
    } else if (avatar.target) {
      dirX = avatar.target.x - avatar.obj.position.x;
      dirZ = avatar.target.z - avatar.obj.position.z;
      if (Math.hypot(dirX, dirZ) < 0.3) {
        // Chegou no ponto: segue para o próximo do caminho, ou para.
        avatar.target = avatar.path.shift() ?? null;
        dirX = avatar.target ? avatar.target.x - avatar.obj.position.x : 0;
        dirZ = avatar.target ? avatar.target.z - avatar.obj.position.z : 0;
      }
      fwd = 1;
    }
    const len = Math.hypot(dirX, dirZ);
    let moving = false;
    if (len > 0) {
      const speed = run ? SPEED.run : SPEED.walk;
      const want = Math.atan2(dirX, dirZ);
      const diff = Math.atan2(Math.sin(want - avatar.heading), Math.cos(want - avatar.heading));
      // Virada no lugar: parado e mandado para trás ou para o lado (mais de 100°), o avatar gira antes de
      // sair andando, em vez de deslizar de costas enquanto vira.
      if (!turn.on && avatar.speed === 0 && !jump.air && Math.abs(diff) > TURN.start) turn.on = true;
      if (turn.on) {
        const a = Math.sign(diff) * Math.min(Math.abs(diff), TURN.rate * dt);
        avatar.heading += a;
        if (Math.abs(diff - a) < TURN.done) turn.on = false;
      } else {
        moving = step((dirX / len) * speed * dt, (dirZ / len) * speed * dt);
        if (!moving) {
          avatar.target = null;
          avatar.path = [];
        }
        avatar.heading += diff * Math.min(1, dt * 10);
      }
      avatar.obj.rotation.y = avatar.heading;
      // A câmera acompanha devagar quando o avatar vai até um ponto clicado.
      if (!keys.size && avatar.target) view.yaw += Math.atan2(Math.sin(avatar.heading - view.yaw), Math.cos(avatar.heading - view.yaw)) * Math.min(1, dt * 1.5);
    }
    avatar.speed = moving ? (run ? SPEED.run : SPEED.walk) : 0;
    // Calçada nova quando o avatar se afasta do centro da grade.
    const o = avatar.obj.position;
    if (!walk || Math.hypot(o.x - walk.cx, o.z - walk.cz) > SIDEWALK.rebuildAt) rebuildWalk(o.x, o.z);
    // Chão: rua ou meio-fio; no ar, a gravidade.
    const floor = floorAt(o.x, o.z);
    if (jump.air) {
      jump.vy -= JUMP.gravity * dt;
      o.y += jump.vy * dt;
      if (o.y <= floor && jump.vy < 0) {
        o.y = floor;
        jump.air = false;
        jump.vy = 0;
        jump.landing = true;
        inst?.playOnce('jumpLand', () => { jump.landing = false; }, 0.08);
      }
    } else {
      // Sobe e desce o meio-fio sem degrau seco.
      o.y += (floor - o.y) * Math.min(1, dt * 18);
    }
    if (len === 0) turn.on = false;
    if (!jump.air && !(jump.landing && !moving)) {
      jump.landing = false;
      // Na virada, os pés acompanham: o clipe de andar, mais devagar.
      play(turn.on ? 'walk' : moving ? (run ? 'run' : 'walk') : 'idle');
      const w = inst?.actions?.walk;
      if (w) w.timeScale = turn.on ? 0.7 : 1;
    }
    avatar.mixer?.update(dt);

    // Câmera em terceira pessoa, atrás e acima do avatar.
    const head = tmp.copy(avatar.obj.position);
    head.y += CAM.height;
    const back = view.dist * Math.cos(view.pitch);
    camera.position.set(head.x - Math.sin(view.yaw) * back, head.y + view.dist * Math.sin(view.pitch), head.z - Math.cos(view.yaw) * back);
    // A câmera não atravessa a parede: para um pouco antes do primeiro prédio entre a cabeça e ela.
    if (boxes.length) {
      const dir = tmp2.copy(camera.position).sub(head);
      const want = dir.length();
      camRay.set(head, dir.normalize());
      let near = want;
      for (const { box, inv, world } of boxes) {
        // No espaço do prédio: a caixa dele, girada junto.
        localRay.copy(camRay).applyMatrix4(inv);
        if (box.containsPoint(localRay.origin)) continue;
        const hit = localRay.intersectBox(box, boxHit);
        if (hit) near = Math.min(near, hit.applyMatrix4(world).distanceTo(head));
      }
      if (near < want) camera.position.copy(head).addScaledVector(dir, Math.max(0.6, near - 0.3));
    }
    if (camera.position.y < index.y + 0.4) camera.position.y = index.y + 0.4;
    camera.lookAt(head);
    controls.target.copy(head);
    return true;
  }

  return {
    tick,
    active: () => active,
    enterAt: (x, z) => { ensureIndex(); if (!index.isRoad(x, z)) return false; enter(new THREE.Vector3(x, index.y, z)); return true; },
    /** O ponto de rua mais perto de (x, z), até `max` metros. */
    nearestRoad: (x, z, max = 250) => {
      ensureIndex();
      for (let r = 0; r <= max; r += 2) {
        const n = Math.max(1, Math.ceil((2 * Math.PI * r) / 2));
        for (let k = 0; k < n; k++) {
          const px = x + Math.cos((k / n) * Math.PI * 2) * r, pz = z + Math.sin((k / n) * Math.PI * 2) * r;
          if (index.isRoad(px, pz)) return { x: px, z: pz };
        }
      }
      return null;
    },
    position: () => avatar.obj.position.clone(),
    /** Para onde o corpo do avatar está virado e a velocidade agora (m/s): o multiplayer manda isso aos outros. */
    bodyHeading: () => avatar.heading,
    speed: () => avatar.speed,
    /** Altura do chão das ruas. */
    groundY: () => index?.y ?? 0,
    /** Modelo e clipes de um tipo de avatar (`man`, `woman`), para desenhar os outros jogadores. */
    avatarAssets: (type) => loadAvatarAssets(loadGltf, type),
    /** Um corpo a mais com os assets dados (pedestres.js). */
    makeAvatarFrom: (assets) => makeAvatar(THREE, assets),
    /** A grade da calçada em volta do avatar (null antes de entrar). */
    walkGrid: () => walk,
    /** Altura do chão no ponto (rua, meio-fio ou salão). */
    floorAt: (x, z) => (index ? floorAt(x, z) : 0),
    /** O tipo de avatar escolhido neste navegador. */
    avatarType: () => getAvatarType(),
    heading: () => view.yaw,
    say,
    exit,
    /** Gira a câmera (e o "para frente") para o rumo `yaw` e, se vier, a inclinação `pitch`, em radianos. */
    look: (yaw, pitch) => {
      view.yaw = yaw;
      if (pitch !== undefined) view.pitch = THREE.MathUtils.clamp(pitch, -0.35, 1.2);
    },
    isRoad: (x, z) => ensureIndex().isRoad(x, z),
    /** Rua ou calçada perto do avatar. */
    isWalkable: (x, z) => !!index && isWalkable(x, z),
    /** Anda até (x, z) contornando obstáculos (o mesmo do clique). Devolve os pontos do caminho. */
    walkTo: (x, z) => (index ? walkTo(x, z) : null),
    /** Embarca: o avatar some e segue `follow()` ({x, z, heading}); a câmera se afasta para ver o ônibus. */
    startRide: (follow) => {
      ride = follow;
      avatar.obj.visible = false;
      rideDist = view.dist;
      view.dist = Math.max(view.dist, 13);
    },
    /** Desce em (x, z), no chão andável. */
    endRide: (x, z) => {
      ride = null;
      avatar.obj.visible = true;
      if (rideDist !== null) view.dist = rideDist;
      rideDist = null;
      avatar.obj.position.set(x, floorAt(x, z), z);
    },
    riding: () => !!ride,
    /** A grade da calçada em uso (testes e medição): células de calçada e o tempo da última montagem. */
    sidewalk: () => (walk ? { cells: walk.sidewalk, triangles: walk.triangles, ms: walk.ms, cx: walk.cx, cz: walk.cz } : null),
    /** Prédios que a câmera e a calçada levam em conta agora. */
    blockerCount: () => boxes.length,
    jumping: () => jump.air,
    /** Girando no lugar agora (virada antes de sair andando). */
    turning: () => turn.on,
    /** Postes e árvores em volta do avatar agora. */
    furniture: () => furnitureCounts,
    /** Os pontos de ônibus em volta do avatar (onibus.js). */
    busStops: () => (busStopCount ? busStops.list() : []),
    /** Faixas de pedestre em volta do avatar agora (contagem e a lista, com centro, rumo e largura). */
    crosswalks: () => (crosswalkCounts ? { ...crosswalkCounts, list: crosswalks.list() } : null),
    /** Desenha (ou não) as listras das faixas de pedestre; com o kit de ruas, as peças trazem as delas. */
    drawCrosswalks: (on) => crosswalks.setDrawn(on),
    /** À noite, as luminárias dos postes acendem (ceu.js). */
    setNight: (on) => furniture.setNight(on),
    avatar,
  };
}
