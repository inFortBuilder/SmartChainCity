// Cidade real convertida pelo tools/scc-builder/bin/city-import.js. O modelo
// fica em .local/, fora do repositório, até a licença ser confirmada.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { readChunk } from '../../tools/scc-builder/bin/lib/lot-chunks.js';

import { createGestao } from './gestao.js';
import { createServidor } from './servidor.js';

const BASE = '../../.local/cidades/pittsburg';
const $ = (s) => document.querySelector(s);
const fmt = new Intl.NumberFormat('pt-BR');

const canvas = $('#scene');
const PARAMS = new URLSearchParams(location.search);
// A cidade tem 34 km: com depth comum e plano próximo fixo, as camadas planas
// piscam de longe. O depth logarítmico resolvia, mas escreve a profundidade por
// pixel e desliga o descarte antecipado, o que custa caro em placa integrada
// (spike E0.9). O padrão agora é o depth comum com o plano próximo acompanhando
// a distância da câmera (ver updateNearPlane). ?profundidade=log volta ao
// antigo; ?profundidade=reversa testa o depth reverso do three, que no r170
// ainda não desenha esta cena.
const DEPTH = ['log', 'reversa'].includes(PARAMS.get('profundidade')) ? PARAMS.get('profundidade') : 'normal';
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  logarithmicDepthBuffer: DEPTH === 'log',
  reverseDepthBuffer: DEPTH === 'reversa',
});
// Resolução adaptativa: se o quadro passa de 22 ms, a resolução cai aos poucos
// (até 0,6×) e volta a subir quando sobra folga. ?resolucao=fixa desliga.
const QUALITY = {
  max: Math.min(devicePixelRatio, 2),
  // Em tela 3× (celular), cair abaixo da metade deixa a imagem borrada demais.
  min: Math.min(Math.min(devicePixelRatio, 2), Math.max(0.6, devicePixelRatio * 0.5)),
  capped: false,
  adaptive: PARAMS.get('resolucao') !== 'fixa',
  scale: Math.min(devicePixelRatio, 2),
  depth: DEPTH,
};
renderer.setPixelRatio(QUALITY.scale);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe0ef, 9000, 42000);
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 2, 120000);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.48;
controls.minDistance = 60;
controls.maxDistance = 40000;

const sky = new Sky();
sky.scale.setScalar(100000);
sky.material.uniforms.turbidity.value = 2.2;
sky.material.uniforms.rayleigh.value = 2.4;
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(58), THREE.MathUtils.degToRad(215));
sky.material.uniforms.sunPosition.value.copy(sunDir);
// O shader do céu se põe no fundo com z = w; no depth reverso isso é a frente.
// Desenhado primeiro e sem teste de profundidade, ele fica atrás nos dois modos.
sky.material.depthTest = false;
sky.renderOrder = -1;
scene.add(sky);

const sun = new THREE.DirectionalLight(0xfff4e6, 2.6);
sun.position.copy(sunDir).multiplyScalar(1000);
scene.add(sun, new THREE.HemisphereLight(0xffffff, 0xa89f8c, 2.2));

// predios.json vira uma grade de 200 m para achar o prédio do clique sem varrer 75 mil.
const CELL = 200;
const grid = new Map();
const cellKey = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
function indexBuildings(list) {
  list.forEach((b, i) => {
    const [x0, x1] = [b.x - b.w / 2, b.x + b.w / 2];
    const [z0, z1] = [b.z - b.d / 2, b.z + b.d / 2];
    for (let x = x0; x < x1 + CELL; x += CELL) {
      for (let z = z0; z < z1 + CELL; z += CELL) {
        const k = cellKey(Math.min(x, x1), Math.min(z, z1));
        if (!grid.has(k)) grid.set(k, new Set());
        grid.get(k).add(i);
      }
    }
  });
}

let buildings = [];
const highlight = new THREE.Box3Helper(new THREE.Box3(), 0x22d3ee);
highlight.visible = false;
scene.add(highlight);

// Desce pelo raio até a altura dos prédios: testar a malha de 500 mil faces travaria o clique.
function pick(event) {
  const ndc = new THREE.Vector2((event.clientX / innerWidth) * 2 - 1, -(event.clientY / innerHeight) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const { origin, direction } = ray.ray;
  if (direction.y >= 0) return null;
  const top = Math.min(origin.y, 95);
  const steps = 240;
  for (let s = 0; s <= steps; s++) {
    const y = top * (1 - s / steps);
    const t = (y - origin.y) / direction.y;
    const x = origin.x + direction.x * t;
    const z = origin.z + direction.z * t;
    for (const i of grid.get(cellKey(x, z)) ?? []) {
      const b = buildings[i];
      if (y <= b.h && Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2) return b;
    }
  }
  return null;
}

function showBuilding(b) {
  const ficha = $('[data-ficha]');
  if (!b) {
    ficha.hidden = true;
    highlight.visible = false;
    return;
  }
  highlight.box.min.set(b.x - b.w / 2, 0, b.z - b.d / 2);
  highlight.box.max.set(b.x + b.w / 2, b.h, b.z + b.d / 2);
  highlight.visible = true;
  ficha.hidden = false;
  ficha.innerHTML = `<h2>Prédio</h2><dl>
    <dt>Altura</dt><dd>${fmt.format(b.h)} m</dd>
    <dt>Andares sugeridos</dt><dd>${b.floors}</dd>
    <dt>Base</dt><dd>${fmt.format(b.w)} × ${fmt.format(b.d)} m</dd>
    <dt>Área da caixa</dt><dd>${fmt.format(Math.round(b.w * b.d))} m²</dd>
    <dt>Posição</dt><dd>${fmt.format(b.x)}, ${fmt.format(b.z)}</dd></dl>`;
}

let down = null;
canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) >= 5) return;
  if (lotLayer.visible) showLot(pickLot(e));
  else showBuilding(pick(e));
});

// ---------- Lotes ----------
// Polígonos fixos de N pontos num binário: 100 mil lotes em JSON pesariam 40 MB.
const ZONE_COLORS = [0x60a5fa, 0xf59e0b, 0xf472b6];
const VACANT_COLOR = 0x8ddc0e;
const CIVIC_COLOR = 0xfacc15;
// Lote de bairro que ainda não abriu: existe no mapa, mas não está à venda.
const LOCKED_COLOR = 0xaab2bd;
const LOT_CELL = 150;
let lots = null;
let lotToggle = null;
let lotsPromise = null;
let gestao = null;
let shownLot = null;
let servidor = null;

function lotPoint(i, k) {
  const at = (i * lots.n + k) * 2;
  return [lots.polygons[at], lots.polygons[at + 1]];
}

function lotRing(i) {
  return Array.from({ length: lots.n }, (_, k) => lotPoint(i, k));
}

function insidePolygon(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[j];
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

// Lotes por bairro (spike E0.9, ADR-0009): o mapa baixa só os bairros perto da
// câmera. Os arrays têm o tamanho da cidade e cada bloco preenche os seus ids,
// então o número do lote (PIT-000001…) não muda para a ficha nem para a gestão.
const STREAM_RADIUS = 1800;
const STREAM_PARALLEL = 4;

async function loadLots() {
  const [meta, districtBuffer, civic] = await Promise.all([
    fetch(`${BASE}/lotes.json`).then((r) => r.json()),
    fetch(`${BASE}/lotes-bairros.bin`).then((r) => (r.ok ? r.arrayBuffer() : null)),
    // Prédio público no centro (tools/scc-builder/bin/city-civic.js); opcional.
    fetch(`${BASE}/civico.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  if (meta.blocos?.formato !== 1 || !districtBuffer) {
    throw new Error('Lotes sem blocos por bairro: rode node tools/scc-builder/bin/city-chunks.js .local/cidades/pittsburg');
  }
  const n = meta.pontos;
  const count = meta.resumo.total;
  const district = new Uint16Array(districtBuffer);
  // Venda por bairro (doc 03 §5): só os primeiros abrem; o resto espera a vez.
  const openCount = meta.liberacao?.abertos_no_inicio ?? Infinity;
  const isOpen = (i) => district[i] < openCount;
  const civicLots = new Set(civic?.lotes ?? []);
  lots = {
    n, count, district, isOpen, openCount,
    polygons: new Float32Array(count * n * 2),
    areas: new Float32Array(count),
    zones: new Uint8Array(count),
    vacant: new Uint8Array(count),
    bairros: meta.bairros ?? [], liberacao: meta.liberacao,
    zonas: meta.zonas, resumo: meta.resumo, grid: new Map(),
    civic, civicLots,
    blocos: meta.blocos.bairros, arquivo: meta.blocos.arquivo,
    loaded: new Map(), pending: 0, bytes: districtBuffer.byteLength,
  };
  // À venda: vagos dos bairros abertos, menos os da Prefeitura.
  lots.forSale =
    lots.blocos.filter((b) => b.bairro < openCount).reduce((s, b) => s + b.vagos, 0) -
    [...civicLots].filter((i) => isOpen(i)).length;
  // Os bairros abertos vêm primeiro: é onde o jogador compra.
  await Promise.all(lots.blocos.filter((b) => b.bairro < openCount).map((b) => loadBairro(b.bairro)));
}

function loadBairro(order) {
  if (!lots.loaded.has(order)) {
    lots.pending++;
    const url = `${BASE}/${lots.arquivo.replace('{bairro}', order)}`;
    lots.loaded.set(
      order,
      fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`${url}: ${r.status}`);
          return r.arrayBuffer();
        })
        .then((buffer) => {
          lots.bytes += buffer.byteLength;
          addChunk(readChunk(buffer, lots.n));
        })
        .finally(() => {
          lots.pending--;
        }),
    );
  }
  return lots.loaded.get(order);
}

/** Garante que os bairros destes lotes já chegaram (lotes da gestão, da Prefeitura). */
function loadLotsFor(ids) {
  const orders = new Set([...ids].map((i) => lots.district[i]));
  return Promise.all([...orders].map(loadBairro));
}

function addChunk(c) {
  const { n } = lots;
  const k = c.ids.length;
  const vertices = new Float32Array(k * n * 3);
  const colors = new Float32Array(k * n * 3);
  const index = new Uint32Array(k * n * 2);
  const fill = [];
  const civicFill = [];
  const color = new THREE.Color();
  c.ids.forEach((i, j) => {
    lots.polygons.set(c.polygons.subarray(j * n * 2, (j + 1) * n * 2), i * n * 2);
    lots.areas[i] = c.areas[j];
    lots.zones[i] = c.zones[j];
    const isCivic = lots.civicLots.has(i);
    // Os lotes do Centro Administrativo são da Prefeitura: saem da venda.
    lots.vacant[i] = isCivic ? 0 : c.vacant[j];
    const open = lots.isOpen(i);
    const vacant = lots.vacant[i];
    color.set(isCivic ? CIVIC_COLOR : vacant ? (open ? VACANT_COLOR : LOCKED_COLOR) : ZONE_COLORS[lots.zones[i]]);
    let cx = 0;
    let cz = 0;
    for (let p = 0; p < n; p++) {
      const x = c.polygons[(j * n + p) * 2];
      const z = c.polygons[(j * n + p) * 2 + 1];
      const v = j * n + p;
      vertices.set([x, 3, z], v * 3);
      colors.set([color.r, color.g, color.b], v * 3);
      index[v * 2] = v;
      index[v * 2 + 1] = j * n + ((p + 1) % n);
      cx += x / n;
      cz += z / n;
      if (vacant && open && p >= 2) fill.push(j * n, v - 1, v);
      if (isCivic && p >= 2) civicFill.push(j * n, v - 1, v);
    }
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        const near = `${Math.floor(cx / LOT_CELL) + a},${Math.floor(cz / LOT_CELL) + b}`;
        if (!lots.grid.has(near)) lots.grid.set(near, []);
        lots.grid.get(near).push(i);
      }
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  const lines = new THREE.LineSegments(geometry, LINE_MATERIAL);
  const parts = [lines];
  for (const [list, material] of [[fill, VACANT_MATERIAL], [civicFill, CIVIC_MATERIAL]]) {
    if (!list.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', geometry.getAttribute('position'));
    g.setIndex(list);
    g.boundingSphere = geometry.boundingSphere;
    parts.push(new THREE.Mesh(g, material));
  }
  lotLayer.add(...parts);
}

const LINE_MATERIAL = new THREE.LineBasicMaterial({ vertexColors: true });
const VACANT_MATERIAL = new THREE.MeshBasicMaterial({ color: VACANT_COLOR, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
const CIVIC_MATERIAL = new THREE.MeshBasicMaterial({ color: CIVIC_COLOR, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });

/** Pede os bairros cuja caixa está perto do alvo da câmera; de longe, o raio cresce. */
function streamLots() {
  if (!lots) return;
  const t = controls.target;
  const radius = Math.min(6000, Math.max(STREAM_RADIUS, camera.position.distanceTo(t) * 1.2));
  const wanted = lots.blocos
    .filter((b) => !lots.loaded.has(b.bairro))
    .map((b) => {
      const [x0, z0, x1, z1] = b.bbox;
      const dx = Math.max(x0 - t.x, 0, t.x - x1);
      const dz = Math.max(z0 - t.z, 0, t.z - z1);
      return { order: b.bairro, d: Math.hypot(dx, dz) };
    })
    .filter((b) => b.d <= radius)
    .sort((a, b) => a.d - b.d);
  for (const b of wanted.slice(0, Math.max(0, STREAM_PARALLEL - lots.pending))) loadBairro(b.order);
}

const lotLayer = new THREE.Group();
lotLayer.visible = false;
scene.add(lotLayer);
const lotOutline = new THREE.LineLoop(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: 0xffffff }),
);
lotOutline.frustumCulled = false;
lotOutline.visible = false;
scene.add(lotOutline);

function pickLot(event) {
  if (!lots) return null;
  const ndc = new THREE.Vector2((event.clientX / innerWidth) * 2 - 1, -(event.clientY / innerHeight) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const { origin, direction } = ray.ray;
  if (direction.y >= 0) return null;
  const t = -origin.y / direction.y;
  const x = origin.x + direction.x * t;
  const z = origin.z + direction.z * t;
  const key = `${Math.floor(x / LOT_CELL)},${Math.floor(z / LOT_CELL)}`;
  return (lots.grid.get(key) ?? []).find((i) => insidePolygon(x, z, lotRing(i))) ?? null;
}

function lotAt(x, z) {
  if (!lots) return null;
  const key = `${Math.floor(x / LOT_CELL)},${Math.floor(z / LOT_CELL)}`;
  return (lots.grid.get(key) ?? []).find((i) => insidePolygon(x, z, lotRing(i))) ?? null;
}

function showLot(i) {
  const ficha = $('[data-ficha]');
  shownLot = i;
  if (i === null) {
    ficha.hidden = true;
    lotOutline.visible = false;
    return;
  }
  const ring = lotRing(i);
  lotOutline.geometry.setFromPoints(ring.map(([x, z]) => new THREE.Vector3(x, 4, z)));
  lotOutline.visible = true;
  highlight.visible = false;

  if (lots.civicLots.has(i)) {
    const c = lots.civic;
    const [w, h, d] = c.modelo.tamanho_m;
    ficha.hidden = false;
    ficha.innerHTML = `<h2>🏛️ ${c.nome}</h2><dl>
      <dt>Situação</dt><dd>Prefeitura · não está à venda</dd>
      <dt>Lote</dt><dd>PIT-${String(i + 1).padStart(6, '0')}</dd>
      <dt>Terreno</dt><dd>${c.lotes.length} lotes unidos</dd>
      <dt>Prédio</dt><dd>${fmt.format(Math.round(w))} × ${fmt.format(Math.round(d))} m, ${fmt.format(Math.round(h))} m</dd>
      <dt>Do centro</dt><dd>${fmt.format(c.distancia_do_centro_m)} m</dd></dl>
      <p class="muted" style="font-size:12px;margin:10px 0 0">Sede do governo da cidade, no centro. Os lotes dele saíram da venda.</p>`;
    return;
  }
  const zone = lots.zonas[lots.zones[i]];
  const area = lots.areas[i];
  const free = lots.vacant[i] === 1;
  const open = lots.isOpen(i);
  const order = lots.district ? lots.district[i] : null;
  const total = lots.bairros.length;
  const status = !free ? 'Ocupado' : open ? 'À venda' : 'Bairro ainda fechado';
  const limiar = Math.round((lots.liberacao?.limiar ?? 0.7) * 100);
  const bairro =
    order === null
      ? ''
      : `<dt>Bairro</dt><dd>${order + 1} de ${total}</dd>` +
        (open ? '' : `<dt>Abre em</dt><dd>${order + 1 - lots.openCount}ª fase</dd>`);
  ficha.hidden = false;
  ficha.innerHTML = `<h2>Lote PIT-${String(i + 1).padStart(6, '0')}</h2><dl>
    <dt>Situação</dt><dd>${status}</dd>${bairro}
    <dt>Zona</dt><dd>${zone.label}</dd>
    <dt>Área</dt><dd>${fmt.format(Math.round(area))} m²</dd>
    <dt>Gabarito</dt><dd>${zone.max_height_m} m</dd>
    <dt>Coeficiente</dt><dd>${fmt.format(zone.far)}</dd>
    <dt>Recuo</dt><dd>${zone.setback_m} m</dd>
    <dt>Área construível</dt><dd>${fmt.format(Math.round(area * zone.far))} m²</dd>
    <dt>Preço</dt><dd>${fmt.format(Math.round(area * zone.price))} SCITY</dd></dl>
    ${free && !open ? `<p class="muted" style="font-size:12px;margin:10px 0 0">Cada bairro abre quando os já abertos passam de ${limiar}% vendidos, do centro para fora.</p>` : ''}`;
  // Com login, a situação real vem do world; a compra simulada da gestão sai de cena.
  const servidorAtivo = servidor?.decorateLot(i, ficha) ?? false;
  gestao?.decorateLot(i, ficha, servidorAtivo);
}

async function loadCivic() {
  const c = lots?.civic;
  if (!c) return;
  await loadLotsFor(c.lotes);
  const lod = progressiveBuilding(c.modelo.lods.map((f) => `${BASE}/${f}`), c.centro, c.angulo);
  await lod.ready;

  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'btn btn--ghost';
  go.style.cssText = 'width:100%;margin-top:10px';
  go.textContent = `🏛️ Ir ao ${c.nome}`;
  go.addEventListener('click', () => {
    controls.target.set(c.centro[0], 110, c.centro[1]);
    camera.position.set(c.centro[0] + 520, 330, c.centro[1] + 520);
    showLot(c.lotes[0]);
  });
  $('[data-layers]').after(go);
  return lod;
}

// ---------- Prédio com LOD progressivo ----------
// Chega primeiro o LOD mais leve (o último da lista); os mais detalhados só são
// baixados quando a câmera se aproxima. Vale para o Centro Administrativo e
// para os prédios de jogadores (teste dos 20 prédios do spike).
const LOD_DISTANCES = [0, 600, 1800];
const LOD_FETCH_AT = 2500;
const progressive = [];
const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const gltfCache = new Map();
const MERGE = PARAMS.get('juntar') !== 'nao';
const loadScene = (url) => {
  if (!gltfCache.has(url)) gltfCache.set(url, gltfLoader.loadAsync(url).then((g) => (MERGE ? mergeByMaterial(g.scene) : g.scene)));
  return gltfCache.get(url).then((root) => root.clone());
};

/** Atributos quantizados (meshopt) viram Float32: a matriz do nó entra no vértice ao juntar. */
function toFloatAttributes(geometry) {
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geometry.attributes)) {
    const n = attr.count;
    const size = attr.itemSize;
    const array = new Float32Array(n * size);
    const get = [attr.getX, attr.getY, attr.getZ, attr.getW];
    for (let i = 0; i < n; i++) for (let c = 0; c < size; c++) array[i * size + c] = get[c].call(attr, i);
    out.setAttribute(name, new THREE.BufferAttribute(array, size));
  }
  if (geometry.index) out.setIndex(Array.from(geometry.index.array));
  return out;
}

/**
 * Junta as malhas de um prédio por material: o prédio de teste tem ~34 malhas,
 * e cada uma é uma chamada de desenho. Malha instanciada fica como está.
 * ?juntar=nao desliga, para comparar no spike.
 */
function mergeByMaterial(root) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  const keep = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material) || o.morphTargetInfluences) {
      keep.push(o);
      return;
    }
    const g = o.geometry;
    const key = `${o.material.uuid}|${Object.keys(g.attributes).sort().join(',')}|${g.index ? 'i' : 'n'}`;
    if (!groups.has(key)) groups.set(key, { material: o.material, meshes: [] });
    groups.get(key).meshes.push(o);
  });
  const out = new THREE.Group();
  for (const { material, meshes } of groups.values()) {
    const merged = mergeGeometries(meshes.map((m) => toFloatAttributes(m.geometry).applyMatrix4(m.matrixWorld)), false);
    if (merged) out.add(new THREE.Mesh(merged, material));
    else meshes.forEach((m) => keep.push(m));
  }
  for (const o of keep) {
    o.matrixWorld.decompose(o.position, o.quaternion, o.scale);
    out.add(o);
  }
  return out;
}

function progressiveBuilding(files, [x, z], angle) {
  const lod = new THREE.LOD();
  lod.position.set(x, 3, z);
  lod.rotation.y = -angle;
  scene.add(lod);
  const levels = files.map((url, k) => ({ url, distance: LOD_DISTANCES[k] ?? LOD_DISTANCES.at(-1), object: null }));
  const coarsest = levels.at(-1);
  const show = () => {
    const have = levels.filter((l) => l.object);
    lod.levels.splice(0).forEach((l) => lod.remove(l.object));
    // O mais leve que já chegou cobre de 0 até o próximo nível que ainda falta.
    have.forEach((l, k) => lod.addLevel(l.object, k === 0 ? 0 : l.distance));
  };
  const load = (level) =>
    (level.loading ??= loadScene(level.url).then((obj) => {
      obj.traverse((o) => {
        if (o.isMesh) o.castShadow = o.receiveShadow = true;
      });
      level.object = obj;
      show();
    }));
  lod.ready = load(coarsest);
  lod.upgrade = () => Promise.all(levels.map(load));
  lod.levelsLoaded = () => levels.filter((l) => l.object).length;
  progressive.push(lod);
  return lod;
}

function streamBuildings() {
  for (const lod of progressive) {
    if (lod.upgraded) continue;
    if (camera.position.distanceTo(lod.position) < LOD_FETCH_AT) {
      lod.upgraded = true;
      lod.upgrade();
    }
  }
}

function setupLotToggle() {
  const label = document.createElement('label');
  label.innerHTML = '<input type="checkbox" data-lotes> Lotes';
  lotToggle = label.querySelector('input');
  label.querySelector('input').addEventListener('change', async (e) => {
    const on = e.target.checked;
    if (on) await ensureLots(label);
    lotLayer.visible = on;
    if (!on) showLot(null);
  });
  $('[data-layers]').append(label);
}

// Uma carga só, compartilhada pela camada e pela gestão.
function ensureLots(label) {
  lotsPromise ??= (async () => {
    if (label) label.style.opacity = 0.5;
    await loadLots();
    if (label) label.style.opacity = 1;
    {
      const abertos = Math.min(lots.openCount, lots.bairros.length || 1);
      $('[data-resumo]').textContent += lots.bairros.length
        ? ` · ${fmt.format(lots.resumo.total)} lotes em ${lots.bairros.length} bairros · ${abertos} aberto, ${fmt.format(lots.forSale)} à venda`
        : ` · ${fmt.format(lots.resumo.total)} lotes, ${fmt.format(lots.resumo.vazios)} à venda`;
    }
  })();
  return lotsPromise;
}

const LABELS = { buildings: 'Prédios', roads: 'Ruas', water: 'Água', land: 'Uso do solo', rail: 'Ferrovias', ground: 'Terreno' };
const TUNE = {
  buildings: { roughness: 0.75, color: 0xdfe5ee },
  water: { roughness: 0.25, metalness: 0.1, color: 0x8fc7ea },
  roads: { roughness: 0.95, color: 0xffffff },
  land: { roughness: 1, color: 0xffffff },
  ground: { roughness: 1, color: 0xffffff },
  rail: { roughness: 0.8, color: 0xffffff },
};

function setupLayers(root) {
  const box = $('[data-layers]');
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    const key = o.parent?.name in TUNE ? o.parent.name : o.name.replace(/_\d+$/, '');
    const t = TUNE[key];
    if (t) { o.material.roughness = t.roughness; o.material.metalness = t.metalness ?? 0; o.material.color.set(t.color); }
    o.material.flatShading = true;
    o.material.side = THREE.DoubleSide;
  });
  for (const key of Object.keys(LABELS)) {
    const node = root.getObjectByName(key);
    if (!node) continue;
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" checked> ${LABELS[key]}`;
    label.querySelector('input').addEventListener('change', (e) => { node.visible = e.target.checked; });
    box.append(label);
  }
}

// O centro da mancha urbana vem do conversor; a base de 34 km é quase toda vazia.
function frameCity([cx, cz]) {
  controls.target.set(cx, 0, cz);
  camera.position.set(cx - 2200, 2000, cz + 2600);
  controls.update();
}

try {
  const [gltf, data] = await Promise.all([
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${BASE}/cidade.glb`),
    fetch(`${BASE}/predios.json`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
  ]);
  buildings = data.predios;
  indexBuildings(buildings);
  setupLayers(gltf.scene);
  setupLotToggle();
  scene.add(gltf.scene);
  frameCity(data.resumo.centro);
  // Cidade sem prédios: o que há para ver são os lotes.
  if (data.resumo.sem_predios) {
    lotToggle.checked = true;
    lotToggle.dispatchEvent(new Event('change'));
  }
  $('[data-resumo]').textContent = `${data.resumo.sem_predios ? 'Cidade sem prédios' : `${fmt.format(data.resumo.predios)} prédios`} · ${fmt.format(data.resumo.base_m / 1000)} km de base · ${fmt.format(data.resumo.glb_mb)} MB`;
  $('[data-aviso]').remove();
  // A gestão precisa dos lotes, com ou sem a camada ligada.
  await ensureLots(lotToggle.parentElement);
  const civicBuilding = await loadCivic().catch((err) => console.warn('Centro Administrativo não carregou', err));
  gestao = createGestao({
    THREE, scene, camera, controls, fmt,
    getLots: () => lots, lotRing, lotAt, showLot, currentLot: () => shownLot, loadLotsFor,
    loadGlb: (buffer) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, ''),
  });
  // Célula jogável (E1.6): login, avatar, THALER e turno pelos serviços.
  servidor = createServidor({ THREE, scene, lotRing, loadLotsFor, showLot });
  window.__pittsburg = { scene, camera, controls, renderer, buildings, pick, showBuilding, pickLot, showLot, getLots: () => lots, gestao, civicBuilding, progressiveBuilding, loadLotsFor, servidor };

  // Spike E0.9: ?spike (ou ?spike=20) mede download, FPS e 20 prédios com LOD.
  const spikeParam = new URLSearchParams(location.search).get('spike');
  if (spikeParam !== null && lots?.civic) {
    const { runSpike, measureFrames } = await import('./spike.js');
    const c = lots.civic;
    runSpike(
      {
        progressiveBuilding,
        center: c.centro,
        measureFrames: (s) => measureFrames(renderer, s),
        quality: () => ({ escala: QUALITY.scale, profundidade: QUALITY.depth, adaptativa: QUALITY.adaptive, juntar: MERGE, limiteDaTela: QUALITY.capped }),
        lookAt: (x, z, dist) => {
          controls.target.set(x, 60, z);
          camera.position.set(x + dist * 0.7, dist * 0.55, z + dist * 0.7);
        },
        gpu: () => {
          const gl = renderer.getContext();
          const ext = gl.getExtension('WEBGL_debug_renderer_info');
          return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'desconhecida';
        },
      },
      { count: Number(spikeParam) || 20, files: c.modelo.lods.map((f) => `${BASE}/${f}`) },
    );
  }
} catch (error) {
  console.error(error);
  $('[data-aviso]').innerHTML = `<div class="glass">Cidade não encontrada. Gere com:<br><code>node tools/scc-builder/bin/city-import.js Pittsburg.obj .local/cidades/pittsburg</code></div>`;
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
let lastStream = 0;
let lastFrame = 0;
const frameTimes = [];
let easy = 0;
// Uma vez por segundo, ajusta a resolução pelo tempo de quadro. Quadro cravado
// num valor (ex.: 33,3 ms com pouca variação) é o limite da tela ou do aparelho,
// como o Modo de Pouca Energia do iPhone, que trava em 30 FPS: não é
// sobrecarga, então a resolução não cai por causa dele.
function adaptResolution(now) {
  if (lastFrame) frameTimes.push(now - lastFrame);
  lastFrame = now;
  if (!QUALITY.adaptive || frameTimes.reduce((a, b) => a + b, 0) < 1000) return;
  const sorted = [...frameTimes].sort((a, b) => a - b);
  frameTimes.length = 0;
  const median = sorted[sorted.length >> 1];
  const spread = sorted[Math.floor(sorted.length * 0.9)] - sorted[Math.floor(sorted.length * 0.1)];
  QUALITY.capped = spread < 2.5 && median > 18;
  let next = QUALITY.scale;
  if (!QUALITY.capped && median > 22 && QUALITY.scale > QUALITY.min) {
    next = Math.max(QUALITY.min, QUALITY.scale * 0.85);
    easy = 0;
  } else if ((median < 17.5 || QUALITY.capped) && QUALITY.scale < QUALITY.max && ++easy >= 3) {
    next = Math.min(QUALITY.max, QUALITY.scale * 1.1);
    easy = 0;
  }
  if (next !== QUALITY.scale) {
    QUALITY.scale = next;
    renderer.setPixelRatio(next);
  }
}

// Depth comum: o plano próximo acompanha a distância da câmera ao alvo, para a
// razão longe/perto ficar pequena e as camadas planas não piscarem.
function updateNearPlane() {
  if (DEPTH !== 'normal') return;
  const near = THREE.MathUtils.clamp(camera.position.distanceTo(controls.target) * 0.05, 2, 400);
  if (Math.abs(near - camera.near) / camera.near > 0.1) {
    camera.near = near;
    camera.updateProjectionMatrix();
  }
}

renderer.setAnimationLoop((now) => {
  adaptResolution(now);
  gestao?.tick();
  controls.update();
  updateNearPlane();
  if (now - lastStream > 300) {
    lastStream = now;
    streamLots();
    streamBuildings();
  }
  renderer.render(scene, camera);
});
