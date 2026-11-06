// Cidade real convertida pelo tools/scc-builder/bin/city-import.js. O modelo
// fica em .local/, fora do repositório, até a licença ser confirmada.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

import { createGestao } from './gestao.js';

const BASE = '../../.local/cidades/pittsburg';
const $ = (s) => document.querySelector(s);
const fmt = new Intl.NumberFormat('pt-BR');

const canvas = $('#scene');
// A cidade tem 34 km: sem depth logarítmico, as camadas planas piscam de longe.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
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
// Lote de bairro que ainda não abriu: existe no mapa, mas não está à venda.
const LOCKED_COLOR = 0xaab2bd;
const LOT_CELL = 150;
let lots = null;
let lotToggle = null;
let lotsPromise = null;
let gestao = null;
let shownLot = null;

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

async function loadLots() {
  const [meta, buffer] = await Promise.all([
    fetch(`${BASE}/lotes.json`).then((r) => r.json()),
    fetch(`${BASE}/lotes.bin`).then((r) => r.arrayBuffer()),
  ]);
  const n = meta.pontos;
  const count = meta.resumo.total;
  const polygons = new Float32Array(buffer, 0, count * n * 2);
  const areas = new Float32Array(buffer, polygons.byteLength, count);
  const zones = new Uint8Array(buffer, polygons.byteLength + areas.byteLength, count);
  const vacant = new Uint8Array(buffer, polygons.byteLength + areas.byteLength + count, count);
  const districtOffset = polygons.byteLength + areas.byteLength + 2 * count;
  const district = buffer.byteLength >= districtOffset + 2 * count ? new Uint16Array(buffer, districtOffset, count) : null;
  // Venda por bairro (doc 03 §5): só os primeiros abrem; o resto espera a vez.
  const openCount = meta.liberacao?.abertos_no_inicio ?? Infinity;
  const isOpen = (i) => !district || district[i] < openCount;
  lots = {
    n, count, polygons, areas, zones, vacant, district, isOpen,
    openCount, bairros: meta.bairros ?? [], liberacao: meta.liberacao,
    zonas: meta.zonas, resumo: meta.resumo, grid: new Map(),
  };
  let forSale = 0;

  const vertices = new Float32Array(count * n * 3);
  const colors = new Float32Array(count * n * 3);
  const index = new Uint32Array(count * n * 2);
  const fill = [];
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const open = isOpen(i);
    if (vacant[i] && open) forSale++;
    color.set(vacant[i] ? (open ? VACANT_COLOR : LOCKED_COLOR) : ZONE_COLORS[zones[i]]);
    const ring = lotRing(i);
    let cx = 0;
    let cz = 0;
    ring.forEach(([x, z], k) => {
      const v = i * n + k;
      vertices.set([x, 3, z], v * 3);
      colors.set([color.r, color.g, color.b], v * 3);
      index[v * 2] = v;
      index[v * 2 + 1] = i * n + ((k + 1) % n);
      cx += x / n;
      cz += z / n;
      if (vacant[i] && open && k >= 2) fill.push(i * n, v - 1, v);
    });
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        const near = `${Math.floor(cx / LOT_CELL) + a},${Math.floor(cz / LOT_CELL) + b}`;
        if (!lots.grid.has(near)) lots.grid.set(near, []);
        lots.grid.get(near).push(i);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true }));
  lines.frustumCulled = false;

  const fillGeometry = new THREE.BufferGeometry();
  fillGeometry.setAttribute('position', geometry.getAttribute('position'));
  fillGeometry.setIndex(fill);
  const areasMesh = new THREE.Mesh(
    fillGeometry,
    new THREE.MeshBasicMaterial({ color: VACANT_COLOR, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }),
  );
  areasMesh.frustumCulled = false;

  lotLayer.add(lines, areasMesh);
  lots.forSale = forSale;
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
  gestao?.decorateLot(i, ficha);
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
  gestao = createGestao({
    THREE, scene, camera, controls, fmt,
    getLots: () => lots, lotRing, lotAt, showLot, currentLot: () => shownLot,
    loadGlb: (buffer) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, ''),
  });
  window.__pittsburg = { scene, camera, controls, renderer, buildings, pick, showBuilding, pickLot, showLot, getLots: () => lots, gestao };
} catch (error) {
  console.error(error);
  $('[data-aviso]').innerHTML = `<div class="glass">Cidade não encontrada. Gere com:<br><code>node tools/scc-builder/bin/city-import.js Pittsburg.obj .local/cidades/pittsburg</code></div>`;
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setAnimationLoop(() => {
  gestao?.tick();
  controls.update();
  renderer.render(scene, camera);
});
