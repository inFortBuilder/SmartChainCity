// Cidade real convertida pelo tools/scc-builder/bin/city-import.js. O modelo
// fica em .local/, fora do repositório, até a licença ser confirmada.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

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
  if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) showBuilding(pick(e));
});

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

// O centro de massa dos prédios é onde a cidade está de fato; a base é quase toda vazia.
function frameCity(list) {
  const xs = list.map((b) => b.x).sort((a, b) => a - b);
  const zs = list.map((b) => b.z).sort((a, b) => a - b);
  const cx = xs[xs.length >> 1];
  const cz = zs[zs.length >> 1];
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
  scene.add(gltf.scene);
  frameCity(buildings);
  $('[data-resumo]').textContent = `${fmt.format(data.resumo.predios)} prédios · ${fmt.format(data.resumo.base_m / 1000)} km de base · ${fmt.format(data.resumo.glb_mb)} MB`;
  $('[data-aviso]').remove();
  window.__pittsburg = { scene, camera, controls, renderer, buildings, pick, showBuilding };
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
  controls.update();
  renderer.render(scene, camera);
});
