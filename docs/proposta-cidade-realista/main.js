// Protótipo — Smart Chain City em formato de cidade real.
// Quadras irregulares (ruas inclinadas, como num traçado real), lotes com área em m²,
// edifícios PBR e o fluxo do construtor: GLB do SCC Builder (Convert3D) → validação
// no lote → unidades → publicação. Tudo é demonstração no navegador; nada vai para a rede.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const $ = (s) => document.querySelector(s);
const fmt = new Intl.NumberFormat('pt-BR');
const fmt1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

// ---------- Aleatório com semente (a cidade é sempre a mesma) ----------
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261018);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const range = (a, b) => a + rnd() * (b - a);

// ---------- Renderer, cena, câmera ----------
const canvas = $('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.55;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe0ef, 650, 2600);
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 1, 50000);
camera.position.set(-380, 300, 420);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 40;
controls.maxDistance = 1400;

// ---------- Céu físico + sol + ambiente para reflexos PBR ----------
const sky = new Sky();
sky.scale.setScalar(20000); // dentro do "far" da câmera, senão o céu é cortado
const su = sky.material.uniforms;
su.turbidity.value = 2.2; su.rayleigh.value = 2.4; su.mieCoefficient.value = 0.004; su.mieDirectionalG.value = 0.78;
scene.add(sky);

const sun = new THREE.DirectionalLight(0xffffff, 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const sc = sun.shadow.camera;
sc.left = -480; sc.right = 480; sc.top = 480; sc.bottom = -480; sc.near = 10; sc.far = 2200;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xdbeafe, 0x4a4136, 0.9);
scene.add(hemi);

const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
let envRT = null;
const sunDir = new THREE.Vector3();
function setTimeOfDay(hour) {
  // elevação: 0° às 6h e 18h, ~62° ao meio-dia; azimute varre de leste a oeste
  const t = (hour - 6) / 12;
  const elev = Math.max(-4, Math.sin(Math.PI * t) * 62);
  const azim = 100 + t * 160;
  const phi = THREE.MathUtils.degToRad(90 - elev);
  const theta = THREE.MathUtils.degToRad(azim);
  sunDir.setFromSphericalCoords(1, phi, theta);
  su.sunPosition.value.copy(sunDir);
  sun.position.copy(sunDir).multiplyScalar(1200);
  const day = THREE.MathUtils.clamp(elev / 25, 0, 1);
  sun.intensity = 0.2 + 3.0 * day;
  sun.color.setHSL(0.09 + 0.04 * day, 0.75 - 0.35 * day, 0.6 + 0.3 * day);
  hemi.intensity = 0.25 + 0.75 * day;
  renderer.toneMappingExposure = 0.3 + 0.32 * day;
  // a névoa combina com o horizonte do céu
  scene.fog.color.setHSL(0.58, 0.45, 0.28 + 0.52 * day);
  if (envRT) envRT.dispose();
  envScene.add(sky);                       // o céu vai para uma cena só dele para gerar o mapa de ambiente
  envRT = pmrem.fromScene(envScene);
  scene.add(sky);
  scene.environment = envRT.texture;
  windowsGlow.forEach((m) => { m.emissiveIntensity = 1.4 * (1 - day); });
}

// ---------- Materiais ----------
const M = {
  asphalt: new THREE.MeshStandardMaterial({ color: 0x2f3237, roughness: 0.92 }),
  sidewalk: new THREE.MeshStandardMaterial({ color: 0xb9b6ad, roughness: 0.85 }),
  lotGrass: new THREE.MeshStandardMaterial({ color: 0x6f9a4a, roughness: 0.95 }),
  lotDirt: new THREE.MeshStandardMaterial({ color: 0x9b8a6d, roughness: 1 }),
  park: new THREE.MeshStandardMaterial({ color: 0x4f8d3a, roughness: 0.95 }),
  marking: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 }),
  yellow: new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.6 }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 1 }),
  leaves: new THREE.MeshStandardMaterial({ color: 0x3f7d32, roughness: 0.9 }),
  roof: new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.8 }),
};
const glassPalette = [0x4f7fa8, 0x3d6a8f, 0x6b9bb5, 0x4b736f, 0x7387a3, 0x2f4a66];
const wallPalette = [0xd9d2c5, 0xcdbfae, 0xe6e1d8, 0xb9a48b, 0xc9cfd6, 0xa97e64];
const windowsGlow = [];
function glassMat(color) {
  const m = new THREE.MeshPhysicalMaterial({
    color, metalness: 0.15, roughness: 0.06, envMapIntensity: 1.6, clearcoat: 1, clearcoatRoughness: 0.05,
    emissive: new THREE.Color(0xffc98a), emissiveIntensity: 0,
  });
  windowsGlow.push(m);
  return m;
}
const wallMat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.82 });

// ---------- Traçado: ruas horizontais e ruas inclinadas (quadras irregulares) ----------
const H = [-300, -190, -80, 0, 80, 190, 300];      // z das ruas horizontais (z=0 é a avenida)
const HW = [14, 14, 14, 30, 14, 14, 14];           // largura
const SLOPE = 0.16;                                 // inclinação das ruas "verticais": x = a + SLOPE·z
const V = [-330, -215, -100, 15, 125, 240, 350];
const VW = [14, 14, 14, 22, 14, 14, 14];           // a de índice 3 é um bulevar
const CURB = 4.5;                                   // calçada
const vx = (i, z, side) => V[i] + SLOPE * z + side * (VW[i] / 2 + CURB);

const lots = [];      // { id, corners[4], area, zone, status, price, block, mesh, building }
const blocks = [];
const pickables = [];
const lerp2 = (a, b, t) => new THREE.Vector2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);

function polyArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a.x * b.y - b.x * a.y; }
  return Math.abs(s) / 2;
}
const centroid = (pts) => pts.reduce((c, p) => c.add(p.clone()), new THREE.Vector2()).multiplyScalar(1 / pts.length);
function pointInPoly(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function shrink(pts, d) {
  const c = centroid(pts);
  return pts.map((p) => { const v = p.clone().sub(c); const L = v.length(); return c.clone().add(v.multiplyScalar(Math.max(0.2, (L - d) / L))); });
}
// Polígono no plano XZ (Vector2 x→x, y→z) → malha extrudada em Y
function extrude(pts, h, y0 = 0) {
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}

function zoneOf(c) {
  const d = Math.hypot(c.x, c.y * 1.15);
  return d < 170 ? 'comercial' : d < 300 ? 'misto' : 'residencial';
}
const ZONES = {
  comercial:   { label: 'Comercial central', maxH: 160, far: 6, base: 62, setback: 3 },
  misto:       { label: 'Uso misto',         maxH: 60,  far: 3.5, base: 34, setback: 3 },
  residencial: { label: 'Residencial',       maxH: 15,  far: 1.4, base: 16, setback: 4 },
  // Megaempreendimento: superquadra remembrada (4 quadras + ruas internas viram praça), 1 por região
  especial:    { label: 'Superquadra-marco', maxH: 320, far: 4, base: 0, setback: 8 },
};

function buildLayout() {
  for (let i = 0; i < V.length - 1; i++) {
    for (let j = 0; j < H.length - 1; j++) {
      const zt = H[j] + HW[j] / 2 + CURB, zb = H[j + 1] - HW[j + 1] / 2 - CURB;
      const c = [
        new THREE.Vector2(vx(i, zt, 1), zt), new THREE.Vector2(vx(i + 1, zt, -1), zt),
        new THREE.Vector2(vx(i + 1, zb, -1), zb), new THREE.Vector2(vx(i, zb, 1), zb),
      ];
      const outer = [ // calçada até o meio-fio
        new THREE.Vector2(V[i] + SLOPE * (zt - CURB) + VW[i] / 2, zt - CURB), new THREE.Vector2(V[i + 1] + SLOPE * (zt - CURB) - VW[i + 1] / 2, zt - CURB),
        new THREE.Vector2(V[i + 1] + SLOPE * (zb + CURB) - VW[i + 1] / 2, zb + CURB), new THREE.Vector2(V[i] + SLOPE * (zb + CURB) + VW[i] / 2, zb + CURB),
      ];
      const block = { i, j, corners: c, outer, park: (i === 1 && j === 4) || (i === 4 && j === 1) };
      blocks.push(block);
      const sw = new THREE.Mesh(extrude(outer, 0.18), M.sidewalk);
      sw.receiveShadow = true; scene.add(sw);
      if (block.park) {
        const p = new THREE.Mesh(extrude(c, 0.25, 0.18), M.park); p.receiveShadow = true; scene.add(p);
        const lot = addLot(c, block, 'park'); lot.status = 'park';
        for (let k = 0; k < 40; k++) {
          const u = range(0.08, 0.92), v = range(0.1, 0.9);
          trees.push(lerp2(lerp2(c[0], c[1], u), lerp2(c[3], c[2], u), v));
        }
        continue;
      }
      const width = c[0].distanceTo(c[1]);
      const cols = Math.max(2, Math.min(5, Math.round(width / 32)));
      const rows = 2;
      const cuts = [0];
      for (let k = 1; k < cols; k++) cuts.push(k / cols + range(-0.06, 0.06));
      cuts.push(1);
      for (let r = 0; r < rows; r++) {
        for (let k = 0; k < cols; k++) {
          const u0 = cuts[k], u1 = cuts[k + 1], v0 = r / rows, v1 = (r + 1) / rows;
          const P = (u, v) => lerp2(lerp2(c[0], c[1], u), lerp2(c[3], c[2], u), v);
          addLot([P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)], block);
        }
      }
      // árvores na calçada (frente e fundo da quadra)
      for (const [a, b] of [[outer[0], outer[1]], [outer[3], outer[2]]]) {
        const n = Math.floor(a.distanceTo(b) / 14);
        for (let k = 1; k < n; k++) trees.push(lerp2(lerp2(a, b, k / n), centroid(c), 0.018));
      }
    }
  }
}

let lotSeq = 0;
function addLot(corners, block, kind) {
  const c = centroid(corners);
  const zone = zoneOf(c);
  const area = polyArea(corners);
  const id = `A1-${String(++lotSeq).padStart(3, '0')}`;
  const r = rnd();
  const status = kind === 'park' ? 'park' : r < 0.62 ? 'built' : r < 0.78 ? 'sale-city' : r < 0.88 ? 'sale-player' : 'empty';
  const pricePerM2 = { comercial: 9.5, misto: 5.2, residencial: 2.6 }[zone];
  const lot = { id, corners, centroid: c, area, zone, status, price: Math.round(area * pricePerM2 / 10) * 10, block, owner: status === 'built' ? pick(['Construtora Atlas', 'Grupo Vértice', 'Player #10422', 'Incorporadora Sol', 'Player #20871']) : status === 'sale-player' ? 'Player #' + Math.floor(range(10000, 99999)) : 'Prefeitura' };
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
  const mesh = new THREE.Mesh(extrude(shrink(corners, 0.6), 0.05, 0.45), mat);
  mesh.userData.lot = lot;
  lot.mesh = mesh;
  scene.add(mesh);
  pickables.push(mesh);
  if (status !== 'park') {
    const ground = new THREE.Mesh(extrude(shrink(corners, 0.3), 0.2, 0.18), status === 'built' ? M.sidewalk : rnd() < 0.5 ? M.lotGrass : M.lotDirt);
    ground.receiveShadow = true; scene.add(ground);
  }
  lots.push(lot);
  return lot;
}

// ---------- Edifícios procedurais (a cidade "dos outros") ----------
function makeBuilding(lot) {
  const z = ZONES[lot.zone];
  const foot = shrink(lot.corners, lot.zone === 'residencial' ? 4 : 3);
  const footArea = polyArea(foot);
  const group = new THREE.Group();
  let height;
  if (lot.zone === 'residencial') {
    height = range(6.5, 11);
    const walls = new THREE.Mesh(extrude(shrink(foot, 1.5), height), wallMat(pick(wallPalette)));
    const roof = new THREE.Mesh(extrude(shrink(foot, 0.6), 0.6, height), M.roof);
    const win = new THREE.Mesh(extrude(shrink(foot, 1.45), 1.4, height * 0.55), glassMat(pick(glassPalette)));
    group.add(walls, roof, win);
  } else {
    const floorH = 3.4;
    height = Math.min(z.maxH, z.base * range(0.45, 1.6) * (lot.area > 1400 ? 1.2 : 1));
    const floors = Math.max(3, Math.round(height / floorH));
    height = floors * floorH;
    const tower = lot.zone === 'comercial' && rnd() < 0.7;
    const podiumH = tower ? floorH * 3 : 0;
    const coreFoot = tower ? shrink(foot, Math.sqrt(footArea) * 0.18) : foot;
    const glass = glassMat(pick(glassPalette));
    const wall = wallMat(pick(wallPalette));
    if (tower) group.add(new THREE.Mesh(extrude(foot, podiumH), wall));
    const core = new THREE.Mesh(extrude(shrink(coreFoot, 0.25), height - podiumH, podiumH), glass);
    // faixas de laje por andar, unidas numa geometria só (poucas draw calls)
    const bandH = tower ? 0.35 : 1.1;
    const bands = [];
    for (let f = 1; f <= floors; f++) {
      const y = podiumH + (f * floorH) - bandH;
      if (y >= height) break;
      bands.push(extrude(coreFoot, bandH, y));
    }
    if (bands.length) group.add(new THREE.Mesh(mergeGeometries(bands), tower ? new THREE.MeshStandardMaterial({ color: 0xe8edf2, roughness: 0.4, metalness: 0.3 }) : wall));
    group.add(core);
    group.add(new THREE.Mesh(extrude(shrink(coreFoot, 3), 2.4, height), M.roof)); // casa de máquinas
  }
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.lot = lot; pickables.push(o); } });
  scene.add(group);
  lot.building = { group, height, procedural: true };
}

// ---------- Ruas: asfalto, faixas, carros ----------
function buildStreets() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 760), M.asphalt); // asfalto só na área urbana
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  // chão até o horizonte (coberto pela névoa), para a câmera nunca ver "abaixo" do céu
  const far = new THREE.Mesh(new THREE.PlaneGeometry(36000, 36000), new THREE.MeshStandardMaterial({ color: 0x5d7d47, roughness: 1 }));
  far.rotation.x = -Math.PI / 2; far.position.y = -0.2; scene.add(far);

  // faixa amarela dupla na avenida e tracejado nas pistas
  const dash = new THREE.PlaneGeometry(6, 0.25); dash.rotateX(-Math.PI / 2);
  const dashes = new THREE.InstancedMesh(dash, M.marking, 400);
  let n = 0; const m4 = new THREE.Matrix4();
  for (let x = -420; x < 420 && n < 400; x += 14) {
    for (const zz of [-7.5, 7.5]) { m4.makeTranslation(x, 0.03, zz); dashes.setMatrixAt(n++, m4); }
  }
  dashes.count = n; dashes.receiveShadow = true; scene.add(dashes);
  for (const zz of [-0.35, 0.35]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(860, 0.22), M.yellow);
    line.rotation.x = -Math.PI / 2; line.position.set(0, 0.03, zz); scene.add(line);
  }
  // faixas de pedestre nos cruzamentos da avenida
  const zebraG = new THREE.PlaneGeometry(0.8, 6); zebraG.rotateX(-Math.PI / 2);
  const zebra = new THREE.InstancedMesh(zebraG, M.marking, 700);
  let zn = 0;
  for (let i = 0; i < V.length; i++) {
    for (const side of [-1, 1]) {
      const zc = side * (HW[3] / 2 - 3);
      for (let k = -6; k <= 6; k++) { m4.makeTranslation(V[i] + SLOPE * zc + k * 1.6, 0.035, zc); zebra.setMatrixAt(zn++, m4); }
    }
  }
  zebra.count = zn; scene.add(zebra);
}

const cars = [];
let carMesh;
function buildCars() {
  const g = new THREE.BoxGeometry(4.4, 1.5, 1.9); g.translate(0, 0.95, 0);
  const cab = new THREE.BoxGeometry(2.4, 0.8, 1.7); cab.translate(-0.2, 2.05, 0);
  const geo = mergeGeometries([g, cab]);
  const mat = new THREE.MeshPhysicalMaterial({ roughness: 0.25, metalness: 0.6, clearcoat: 1 });
  carMesh = new THREE.InstancedMesh(geo, mat, 70);
  carMesh.castShadow = true;
  const colors = [0xe11d48, 0xf8fafc, 0x0f172a, 0x2563eb, 0x9ca3af, 0xf59e0b, 0x16a34a];
  for (let k = 0; k < 70; k++) {
    const lane = pick([-11, -4, 4, 11]);
    cars.push({ x: range(-420, 420), z: lane, dir: lane > 0 ? -1 : 1, v: range(9, 16) });
    carMesh.setColorAt(k, new THREE.Color(pick(colors)));
  }
  scene.add(carMesh);
}
const dummy = new THREE.Object3D();
function updateCars(dt) {
  cars.forEach((c, k) => {
    c.x += c.dir * c.v * dt;
    if (c.x > 430) c.x = -430; if (c.x < -430) c.x = 430;
    dummy.position.set(c.x, 0, c.z); dummy.rotation.y = c.dir > 0 ? 0 : Math.PI; dummy.updateMatrix();
    carMesh.setMatrixAt(k, dummy.matrix);
  });
  carMesh.instanceMatrix.needsUpdate = true;
}

const trees = [];
function buildTrees() {
  const trunkG = new THREE.CylinderGeometry(0.25, 0.35, 3, 6); trunkG.translate(0, 1.5, 0);
  const crownG = new THREE.IcosahedronGeometry(2.6, 1); crownG.translate(0, 4.6, 0);
  const trunks = new THREE.InstancedMesh(trunkG, M.trunk, trees.length);
  const crowns = new THREE.InstancedMesh(crownG, M.leaves, trees.length);
  trees.forEach((p, k) => {
    const s = range(0.8, 1.35);
    dummy.position.set(p.x, 0.2, p.y); dummy.scale.setScalar(s); dummy.rotation.y = rnd() * 6; dummy.updateMatrix();
    trunks.setMatrixAt(k, dummy.matrix); crowns.setMatrixAt(k, dummy.matrix);
    crowns.setColorAt(k, new THREE.Color().setHSL(0.27 + range(-0.03, 0.03), 0.45, 0.28 + range(-0.05, 0.05)));
  });
  dummy.scale.setScalar(1);
  trunks.castShadow = crowns.castShadow = true;
  scene.add(trunks, crowns);
}

// ---------- Mapa de lotes (overlay colorido) ----------
const STATUS = {
  mine:          { color: 0x22d3ee, label: 'Seu lote' },
  'sale-city':   { color: 0xf59e0b, label: 'À venda — Prefeitura' },
  'sale-player': { color: 0xa78bfa, label: 'À venda — jogador' },
  built:         { color: 0x3b82f6, label: 'Ocupado' },
  empty:         { color: 0x94a3b8, label: 'Vazio' },
  park:          { color: 0x22c55e, label: 'Parque' },
};
let mode = 'explore';
function paintLots() {
  lots.forEach((l) => {
    const show = mode === 'lots' || (mode === 'builder' && l.status === 'mine');
    l.mesh.material.color.setHex(STATUS[l.status].color);
    l.mesh.material.opacity = show ? (l.status === 'mine' ? 0.55 : 0.42) : 0;
    l.mesh.position.y = show && l.building ? Math.min(l.building.height, 200) + 0.5 : 0;
  });
}

// contorno do lote em destaque
const outline = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff }));
outline.visible = false; scene.add(outline);
function showOutline(lot, color = 0xffffff) {
  if (!lot) { outline.visible = false; return; }
  const y = 0.7;
  outline.geometry.setFromPoints(lot.corners.map((p) => new THREE.Vector3(p.x, y, p.y)));
  outline.material.color.setHex(color);
  outline.visible = true;
}

// ---------- Seu lote ----------
let myLot;
function chooseMyLot() {
  const candidates = lots.filter((l) => l.zone === 'comercial' && l.status !== 'park' && l.area > 1300 && l.area < 2600)
    .sort((a, b) => a.centroid.length() - b.centroid.length());
  myLot = candidates[2] || candidates[0];
  if (myLot.building) { scene.remove(myLot.building.group); myLot.building = null; }
  myLot.status = 'mine';
  myLot.owner = 'Construtora Horizonte (você)';
}

// ---------- Interação: hover, clique, inspetor ----------
const ray = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hovered = null;
let selectedFloor = null;
canvas.addEventListener('pointermove', (e) => {
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hit = ray.intersectObjects(pickables, false)[0];
  const lot = hit?.object.userData.lot || null;
  if (lot !== hovered) { hovered = lot; showOutline(lot, lot ? (lot.status === 'mine' ? 0x22d3ee : 0xffffff) : 0); canvas.style.cursor = lot ? 'pointer' : 'default'; }
});
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  if (published && floorBoxes.length) {
    const fh = ray.intersectObjects(floorBoxes, false)[0];
    if (fh) { openFloor(fh.object.userData.floor); return; }
  }
  const hit = ray.intersectObjects(pickables, false)[0];
  if (hit) openLot(hit.object.userData.lot);
});

const inspector = $('[data-inspector]');
const ib = $('[data-inspector-body]');
$('[data-close]').addEventListener('click', () => { inspector.hidden = true; clearFloorHighlight(); });

function openLot(lot) {
  const z = ZONES[lot.zone] || { label: 'Parque', maxH: 0, far: 0 };
  const st = STATUS[lot.status];
  const b = lot.building;
  let actions = '';
  if (lot.status === 'sale-city' || lot.status === 'sale-player') actions = `<button class="btn btn--primary" data-act="buy">Comprar lote · ${fmt.format(lot.price)} SCITY</button>`;
  if (lot.status === 'mine') actions = `<button class="btn btn--primary" data-act="build">${published ? 'Ver unidades' : 'Construir aqui'}</button>`;
  ib.innerHTML = `
    <p class="eyebrow">Lote ${lot.id}</p>
    <h2>${b && !b.procedural ? b.name : lot.status === 'park' ? 'Parque público' : b ? 'Edifício existente' : 'Terreno'}</h2>
    <span class="tag ${lot.status.startsWith('sale') ? 'tag--sale' : lot.status === 'mine' ? 'tag--mine' : ''}">${st.label}</span>
    <span class="tag">${z.label}</span>
    <dl class="facts">
      <div><dt>Área do lote</dt><dd>${fmt.format(Math.round(lot.area))} m²</dd></div>
      <div><dt>Gabarito máximo</dt><dd>${z.maxH ? z.maxH + ' m' : '—'}</dd></div>
      <div><dt>Coef. aproveitamento</dt><dd>${z.far || '—'}</dd></div>
      <div><dt>Dono</dt><dd>${lot.owner}</dd></div>
      ${b ? `<div><dt>Altura</dt><dd>${fmt1.format(b.height)} m</dd></div>` : ''}
      ${lot.status.startsWith('sale') ? `<div><dt>Preço</dt><dd>${fmt.format(lot.price)} SCITY</dd></div>` : ''}
      <div><dt>Centro do lote</dt><dd>${Math.round(lot.centroid.x)}, ${Math.round(lot.centroid.y)}</dd></div>
    </dl>
    ${actions}`;
  inspector.hidden = false;
  ib.querySelector('[data-act="build"]')?.addEventListener('click', () => setMode('builder'));
  ib.querySelector('[data-act="buy"]')?.addEventListener('click', () => toast('Compra simulada: no jogo, assina a cotação da Prefeitura e chama LandNFT.buyPrimary().'));
}

// ---------- Câmera: voo suave ----------
let fly = null;
function flyTo(target, distance = 220, height = 150) {
  const dir = camera.position.clone().sub(controls.target).setY(0).normalize();
  fly = {
    t: 0, fromPos: camera.position.clone(), fromTarget: controls.target.clone(),
    toTarget: target.clone(), toPos: target.clone().add(dir.multiplyScalar(distance)).setY(height),
  };
}
function updateFly(dt) {
  if (!fly) return;
  fly.t = Math.min(1, fly.t + dt / 1.4);
  const e = fly.t < 0.5 ? 4 * fly.t ** 3 : 1 - (-2 * fly.t + 2) ** 3 / 2;
  camera.position.lerpVectors(fly.fromPos, fly.toPos, e);
  controls.target.lerpVectors(fly.fromTarget, fly.toTarget, e);
  if (fly.t >= 1) fly = null;
}

// ---------- Modos ----------
function setMode(m) {
  mode = m;
  document.querySelectorAll('.modes button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === m)));
  $('[data-legend]').hidden = m !== 'lots';
  $('[data-builder]').hidden = m !== 'builder';
  if (m === 'builder') {
    inspector.hidden = true;
    flyTo(new THREE.Vector3(myLot.centroid.x, 35, myLot.centroid.y), 230, 230);
    renderLotStep();
  }
  if (m === 'lots') { flyTo(new THREE.Vector3(0, 0, 0), 520, 620); }
  paintLots();
}
document.querySelectorAll('.modes button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

// ---------- Fluxo do construtor ----------
let model = null;        // { group, raw, triangles, name, source }
let published = false;
const floorBoxes = [];
const stepEl = (n) => document.querySelector(`[data-step="${n}"]`);
const setStep = (n, state) => { stepEl(n).classList.toggle('is-done', state === 'done'); stepEl(n).classList.toggle('is-error', state === 'error'); };

function renderLotStep() {
  const z = ZONES[myLot.zone];
  $('[data-lot-summary]').innerHTML = `<b>${myLot.id}</b> · ${fmt.format(Math.round(myLot.area))} m² · ${z.label}<br>Gabarito ${z.maxH} m · recuo ${z.setback} m · coef. ${z.far} (até ${fmt.format(Math.round(myLot.area * z.far))} m² construídos)`
    + (myLot.mega ? `<br><span class="muted">Exige comprar os ${myLot.mega.lots} lotes da superquadra (${fmt.format(myLot.mega.cost)} SCITY), leilão da Prefeitura e alvará especial. Máx. 1 por região.</span>` : '');
  $('[data-mega]').textContent = myLot.mega ? 'Voltar ao lote simples' : 'Megaempreendimento (superquadra)';
  setStep(1, 'done');
}

// ---------- Megaempreendimento: remembramento de 4 quadras numa superquadra-marco ----------
let simpleLot = null;
const megaHidden = [];
function toggleMega() {
  if (!myLot.mega) {
    simpleLot = myLot;
    const b = simpleLot.block;
    const quad = [[b.i, b.j], [b.i + 1, b.j], [b.i + 1, b.j + 1], [b.i, b.j + 1]]
      .map(([i, j]) => blocks.find((k) => k.i === i && k.j === j)).filter(Boolean);
    const tl = quad[0], tr = quad[1] || quad[0], br = quad[2] || tr, bl = quad[3] || tl;
    const corners = [tl.corners[0], tr.corners[1], br.corners[2], bl.corners[3]];
    // lotes e prédios dentro da superquadra saem; as ruas internas viram praça
    let cost = 0, n = 0;
    lots.forEach((l) => {
      if (!pointInPoly(l.centroid, corners) || l.status === 'park') return;
      n++; if (l !== simpleLot) cost += l.price;
      if (l.building?.group) { scene.remove(l.building.group); megaHidden.push(l); }
      l.mesh.visible = false;
    });
    const plaza = new THREE.Mesh(extrude(corners, 0.32, 0.2), M.sidewalk);
    plaza.receiveShadow = true; scene.add(plaza);
    const c = centroid(corners);
    const mega = { id: `A1-SQ${b.i}${b.j}`, corners, centroid: c, area: polyArea(corners), zone: 'especial', status: 'mine', price: 0, block: b, owner: 'Construtora Horizonte (você)', mega: { lots: n, cost, plaza } };
    const mat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.4, depthWrite: false });
    mega.mesh = new THREE.Mesh(extrude(shrink(corners, 0.6), 0.05, 0.6), mat);
    mega.mesh.userData.lot = mega;
    scene.add(mega.mesh); pickables.push(mega.mesh); lots.push(mega);
    myLot = mega;
    flyTo(new THREE.Vector3(c.x, 60, c.y), 520, 420);
  } else {
    const mega = myLot;
    scene.remove(mega.mesh, mega.mega.plaza);
    lots.splice(lots.indexOf(mega), 1); pickables.splice(pickables.indexOf(mega.mesh), 1);
    megaHidden.splice(0).forEach((l) => scene.add(l.building.group));
    lots.forEach((l) => { l.mesh.visible = true; });
    myLot = simpleLot;
    flyTo(new THREE.Vector3(myLot.centroid.x, 35, myLot.centroid.y), 230, 230);
  }
  if (model) { model.group.traverse((o) => { if (o.isMesh) o.userData.lot = myLot; }); applyTransform(); }
  renderLotStep();
  paintLots();
}

// triângulos e pontos da base contando instâncias (EXT_mesh_gpu_instancing) e só o LOD0
const lodRoot = (root) => (root.isLOD ? root.levels[0].object : root);
function countTris(root) {
  let t = 0;
  lodRoot(root).traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry; const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
    t += n * (o.isInstancedMesh ? o.count : 1);
  });
  return Math.round(t);
}

// Torre exemplo: o que sairia do SCC Builder (Convert3D) para este lote
function sampleTower() {
  const foot = shrink(myLot.corners, 9);
  const c = centroid(foot);
  const local = foot.map((p) => p.clone().sub(c));
  const g = new THREE.Group();
  const floors = 24, fh = 3.2;
  const facade = new THREE.MeshPhysicalMaterial({ color: 0x9cc3d5, metalness: 0.2, roughness: 0.04, clearcoat: 1, envMapIntensity: 1.8 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf1f1ec, roughness: 0.55 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x9a6a43, roughness: 0.7 });
  g.add(new THREE.Mesh(extrude(local, fh * 2), new THREE.MeshPhysicalMaterial({ color: 0x2b3a46, metalness: 0.5, roughness: 0.2, clearcoat: 1 })));
  g.add(new THREE.Mesh(extrude(shrink(local, 2.2), fh * floors - fh * 2, fh * 2), facade));
  const slabs = [], fins = [];
  for (let f = 2; f <= floors; f++) {
    slabs.push(extrude(shrink(local, f % 2 ? 1.2 : 0.4), 0.32, f * fh));          // varandas alternadas
    if (f % 2 === 0) fins.push(extrude(shrink(local, 1.0), 0.9, f * fh + 0.32));    // guarda-corpo
  }
  g.add(new THREE.Mesh(mergeGeometries(slabs), white));
  g.add(new THREE.Mesh(mergeGeometries(fins), new THREE.MeshPhysicalMaterial({ color: 0xdfeaf0, transmission: 0.6, roughness: 0.05, thickness: 0.2, transparent: true, opacity: 0.6 })));
  g.add(new THREE.Mesh(extrude(shrink(local, 7), 4, floors * fh), wood));             // coroamento
  let tri = 0; g.traverse((o) => { if (o.isMesh) tri += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3; });
  return { group: g, triangles: Math.round(tri), name: 'Residencial Aurora', source: 'Exemplo gerado (equivale a um GLB do SCC Builder)' };
}

function placeModel(m) {
  if (model) scene.remove(model.holder);
  clearFloors();
  published = false; setStep(5); $('[data-publish]').disabled = true;
  const holder = new THREE.Group();
  holder.add(m.group);
  m.holder = holder;
  m.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.lot = myLot; } });
  model = m;
  scene.add(holder);
  applyTransform();
  $('[data-model-info]').textContent = `${m.name} · ${fmt.format(m.triangles)} triângulos · ${m.source}`;
  setStep(2, 'done');
  validate();
}

function applyTransform() {
  if (!model) return;
  const s = Number($('[data-units]').value);
  const rot = THREE.MathUtils.degToRad(Number($('[data-rotate]').value));
  const g = model.group;
  // mede no espaço do "holder" sem rotação: é essa caixa que precisa caber no lote
  model.holder.position.set(0, 0, 0);
  model.holder.rotation.set(0, 0, 0);
  g.scale.setScalar(s);
  g.position.set(0, 0, 0);
  model.holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(lodRoot(g)); // só o LOD0 define o tamanho
  const center = box.getCenter(new THREE.Vector3());
  g.position.set(-center.x, -box.min.y, -center.z);  // centraliza e apoia no chão
  model.localBox = box.clone().translate(new THREE.Vector3(-center.x, -box.min.y, -center.z));
  model.holder.position.set(myLot.centroid.x, 0.4, myLot.centroid.y);
  model.holder.rotation.y = rot;
  model.holder.updateMatrixWorld(true);
  validate();
}

function validate() {
  if (!model) return false;
  const z = ZONES[myLot.zone];
  model.holder.updateMatrixWorld(true);
  const lb = model.localBox;
  const height = lb.max.y - lb.min.y;
  // projeção real do modelo no chão: todos os vértices (amostrados) em XZ, no mundo.
  // Cabe no lote se todos estão dentro do polígono com recuo da zona; a área vem do contorno convexo.
  const pts = footprintPoints(model.group);
  const allowed = shrink(myLot.corners, z.setback);
  const outside = pts.filter((p) => !pointInPoly(p, allowed)).length;
  const fits = outside === 0;
  const footprint = polyArea(convexHull(pts));
  const floorH = Number($('[data-floor-h]').value);
  const floors = Math.max(1, Math.floor(height / floorH));
  // o corte é caro (centenas de milhares de triângulos × andares): guarda por pé-direito e escala
  const areaKey = `${floorH}|${$('[data-units]').value}`;
  model.areaCache ??= {};
  const areas = (model.areaCache[areaKey] ??= floorAreas(model.group, floorH, model.holder.position.y));
  const gfa = areas.reduce((s, a) => s + a, 0) * 0.85; // 85% da área bruta de cada andar é privativa/útil
  const typicalFloor = areas.length ? [...areas].sort((a, b) => a - b)[Math.floor(areas.length / 2)] : footprint; // mediana
  const maxGfa = myLot.area * z.far;
  const outorga = Math.max(0, Math.round((gfa - maxGfa) * 2.5)); // taxa por m² acima do coeficiente
  const budget = myLot.zone === 'especial' ? 450000 : 300000;
  const checks = [
    { ok: height > 2 && height < 400, txt: `Escala plausível (altura ${fmt1.format(height)} m)`, hint: 'Ajuste a unidade do arquivo.' },
    { ok: fits, txt: `Cabe no lote respeitando o recuo de ${z.setback} m`, hint: 'Gire ou reduza o modelo.' },
    { ok: height <= z.maxH, txt: `Altura dentro do gabarito (${z.maxH} m)` },
    gfa <= maxGfa
      ? { ok: true, txt: `Área construída ${fmt.format(Math.round(gfa))} m² dentro do coeficiente ${z.far} (${fmt.format(Math.round(maxGfa))} m²)` }
      : { ok: false, warn: true, txt: `Área construída ${fmt.format(Math.round(gfa))} m² passa do coeficiente ${z.far} (${fmt.format(Math.round(maxGfa))} m²): exige outorga onerosa de ${fmt.format(outorga)} SCITY à Prefeitura` },
    ...(fits ? [] : [{ ok: false, txt: `${fmt.format(outside)} de ${fmt.format(pts.length)} pontos da base fora da área edificável`, hint: 'Gire ou reduza o modelo.' }]),
    // torre-marco tem orçamento maior, mas exige os 3 LODs (a cidade só desenha o LOD0 de perto)
    { ok: model.triangles <= budget, txt: `Orçamento de polígonos do LOD0 (${fmt.format(model.triangles)} de ${fmt.format(budget)}${myLot.zone === 'especial' ? ', torre-marco' : ''})`, hint: 'Simplifique no SCC Builder.' },
    { ok: model.triangles <= 150000 || (model.lods || 1) >= 3, txt: `LODs: ${model.lods || 1} nível(is)${model.triangles > 150000 ? ' (acima de 150 mil triângulos exige LOD0, LOD1 e LOD2)' : ''}`, hint: 'Envie os arquivos -lod0, -lod1 e -lod2 juntos.' },
    { ok: true, txt: 'Formato GLB, Y para cima, metros (preset SCC)' },
  ];
  $('[data-checks]').innerHTML = checks.map((c) => `<li class="${c.ok ? 'pass' : c.warn ? 'warn' : 'fail'}">${c.txt}${!c.ok && c.hint ? ` — ${c.hint}` : ''}</li>`).join('');
  const valid = checks.every((c) => c.ok || c.warn);
  setStep(3, valid ? 'done' : 'error');
  model.metrics = { height, footprint: typicalFloor, floors, gfa, valid, outorga };
  computeUnits();
  return valid;
}

// vértices do modelo projetados no chão (no máximo ~6 mil, para não travar com modelos grandes)
function footprintPoints(root) {
  const out = [];
  const v = new THREE.Vector3();
  const im = new THREE.Matrix4(), wm = new THREE.Matrix4();
  root.updateMatrixWorld(true);
  lodRoot(root).traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    const copies = o.isInstancedMesh ? o.count : 1;
    const stride = Math.max(1, Math.floor((pos.count * copies) / 1500));
    for (let k = 0; k < copies; k++) {
      if (o.isInstancedMesh) { o.getMatrixAt(k, im); wm.multiplyMatrices(o.matrixWorld, im); } else wm.copy(o.matrixWorld);
      for (let i = k % stride; i < pos.count; i += stride) {
        v.fromBufferAttribute(pos, i).applyMatrix4(wm);
        out.push(new THREE.Vector2(v.x, v.z));
      }
    }
  });
  return out.length > 6000 ? out.filter((_, i) => i % Math.ceil(out.length / 6000) === 0) : out;
}
// Área de cada andar por corte: fatia os triângulos na metade do andar, desenha o contorno numa
// grade de 1 m e remove o que é alcançável por fora (flood fill). Sobra a planta ocupada do andar,
// mesmo com várias torres, pódio largo e malhas unidas por material.
function worldTriangles(root) {
  const out = [];
  const im = new THREE.Matrix4(), wm = new THREE.Matrix4();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  root.updateMatrixWorld(true);
  lodRoot(root).traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position, idx = o.geometry.index;
    const nTri = (idx ? idx.count : pos.count) / 3;
    const copies = o.isInstancedMesh ? o.count : 1;
    for (let k = 0; k < copies; k++) {
      if (o.isInstancedMesh) { o.getMatrixAt(k, im); wm.multiplyMatrices(o.matrixWorld, im); } else wm.copy(o.matrixWorld);
      for (let t = 0; t < nTri; t++) {
        const i0 = idx ? idx.getX(3 * t) : 3 * t, i1 = idx ? idx.getX(3 * t + 1) : 3 * t + 1, i2 = idx ? idx.getX(3 * t + 2) : 3 * t + 2;
        a.fromBufferAttribute(pos, i0).applyMatrix4(wm); b.fromBufferAttribute(pos, i1).applyMatrix4(wm); c.fromBufferAttribute(pos, i2).applyMatrix4(wm);
        out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      }
    }
  });
  return new Float32Array(out);
}
function floorAreas(root, floorH, groundY = 0) {
  const T = worldTriangles(root);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, top = -Infinity;
  for (let i = 0; i < T.length; i += 3) { minX = Math.min(minX, T[i]); maxX = Math.max(maxX, T[i]); top = Math.max(top, T[i + 1]); minZ = Math.min(minZ, T[i + 2]); maxZ = Math.max(maxZ, T[i + 2]); }
  const cell = 1, W = Math.ceil((maxX - minX) / cell) + 3, D = Math.ceil((maxZ - minZ) / cell) + 3;
  const ox = minX - cell, oz = minZ - cell;
  const areas = [];
  for (let y0 = groundY; y0 + floorH * 0.5 < top; y0 += floorH) {
    const yc = y0 + floorH / 2;
    const wall = new Uint8Array(W * D);
    const mark = (x, z) => { const i = Math.floor((x - ox) / cell), j = Math.floor((z - oz) / cell); if (i >= 0 && j >= 0 && i < W && j < D) wall[j * W + i] = 1; };
    for (let t = 0; t < T.length; t += 9) {
      const ys = [T[t + 1], T[t + 4], T[t + 7]];
      if (Math.min(...ys) > yc || Math.max(...ys) < yc) continue;
      const hits = [];
      for (const [p, q] of [[0, 3], [3, 6], [6, 0]]) {
        const ya = T[t + p + 1], yb = T[t + q + 1];
        if ((ya - yc) * (yb - yc) > 0 || ya === yb) continue;
        const s = (yc - ya) / (yb - ya);
        hits.push([T[t + p] + s * (T[t + q] - T[t + p]), T[t + p + 2] + s * (T[t + q + 2] - T[t + p + 2])]);
      }
      if (hits.length < 2) continue;
      const [[x1, z1], [x2, z2]] = hits;
      const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / (cell * 0.5)));
      for (let s = 0; s <= steps; s++) mark(x1 + ((x2 - x1) * s) / steps, z1 + ((z2 - z1) * s) / steps);
    }
    // flood fill a partir da borda: o que não for parede nem exterior é planta do andar
    const out = new Uint8Array(W * D), stack = [0];
    out[0] = 1;
    while (stack.length) {
      const k = stack.pop(), i = k % W, j = (k - i) / W;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= D) continue;
        const n = nj * W + ni; if (out[n] || wall[n]) continue;
        out[n] = 1; stack.push(n);
      }
    }
    let inside = 0; for (let k = 0; k < W * D; k++) if (!out[k]) inside++;
    areas.push(inside * cell * cell);
  }
  return areas;
}

// contorno convexo (monotone chain)
function convexHull(points) {
  const p = points.map((q) => [q.x, q.y]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return points;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1)).map(([x, y]) => new THREE.Vector2(x, y));
}

function computeUnits() {
  if (!model?.metrics) return;
  const { height, footprint } = model.metrics;
  const floorH = Number($('[data-floor-h]').value);
  const per = Math.max(1, Number($('[data-per-floor]').value));
  const ground = $('[data-ground]').value === '1';
  const priceM2 = Number($('[data-price]').value);
  const floors = Math.max(1, Math.floor(height / floorH));
  const resFloors = floors - (ground ? 1 : 0) - 1; // último andar técnico (casa de máquinas)
  const unitArea = (footprint * 0.82) / per;
  const units = Math.max(0, resFloors * per) + (ground ? 2 : 0);
  const vgv = Math.round(units * unitArea * priceM2);
  model.units = { floors, resFloors, per, ground, unitArea, priceM2, units, floorH };
  $('[data-kpis]').innerHTML = `
    <div class="kpi"><small>Andares</small><b>${floors}</b></div>
    <div class="kpi"><small>Unidades</small><b>${fmt.format(units)}</b></div>
    <div class="kpi"><small>Área por unidade</small><b>${fmt1.format(unitArea)} m²</b></div>
    <div class="kpi"><small>VGV (valor total)</small><b>${fmt.format(vgv)} SCITY</b></div>
    ${model.metrics.outorga ? `<div class="kpi" style="grid-column:1/-1"><small>Outorga onerosa (Prefeitura)</small><b>${fmt.format(model.metrics.outorga)} SCITY</b></div>` : ''}`;
  setStep(4, units > 0 ? 'done' : 'error');
  $('[data-publish]').disabled = !(model.metrics.valid && units > 0);
}

function clearFloors() { floorBoxes.forEach((b) => b.parent?.remove(b)); floorBoxes.length = 0; }
function buildFloors() {
  clearFloors();
  const { floorH, floors, per, ground, unitArea, priceM2 } = model.units;
  const lb = model.localBox;
  const w = lb.max.x - lb.min.x + 1.2, d = lb.max.z - lb.min.z + 1.2;
  const cx = (lb.min.x + lb.max.x) / 2, cz = (lb.min.z + lb.max.z) / 2;
  const floorR = mulberry32(77);
  for (let f = 0; f < floors - 1; f++) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, floorH * 0.96, d), new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0, depthWrite: false }));
    box.position.set(cx, f * floorH + floorH / 2, cz);
    const isGround = ground && f === 0;
    const n = isGround ? 2 : per;
    box.userData.floor = {
      index: f, isGround,
      units: Array.from({ length: n }, (_, k) => {
        const area = isGround ? (unitArea * per) / 2 : unitArea;
        const sold = floorR() < (isGround ? 0.2 : 0.18);
        return { code: isGround ? `Loja ${k + 1}` : `Apto ${String(f).padStart(2, '0')}${String(k + 1).padStart(2, '0')}`, area, price: Math.round(area * priceM2 * (1 + f * 0.012)), sold };
      }),
    };
    model.holder.add(box);
    floorBoxes.push(box);
  }
}
function clearFloorHighlight() { floorBoxes.forEach((b) => { b.material.opacity = 0; }); selectedFloor = null; }
function openFloor(floor) {
  clearFloorHighlight();
  const box = floorBoxes[floor.index];
  box.material.opacity = 0.35;
  selectedFloor = floor;
  const free = floor.units.filter((u) => !u.sold).length;
  ib.innerHTML = `
    <p class="eyebrow">${model.name} · Lote ${myLot.id}</p>
    <h2>${floor.isGround ? 'Térreo comercial' : `${floor.index}º andar`}</h2>
    <span class="tag tag--sale">${free} de ${floor.units.length} disponíveis</span>
    <div class="units">${floor.units.map((u, k) => `
      <div class="unit ${u.sold ? 'is-sold' : ''}">
        <span>${u.code}<br><small class="muted">${fmt1.format(u.area)} m²</small></span>
        <b>${fmt.format(u.price)} SCITY</b>
        ${u.sold ? '<span class="tag">Vendida</span>' : `<button class="btn btn--blue" data-unit="${k}">Comprar</button>`}
      </div>`).join('')}
    </div>
    <p class="muted" style="font-size:12px;margin-top:12px">Cada unidade é um NFT (UnitNFT) ligado ao NFT do edifício. O comprador pode morar, alugar ou revender no marketplace.</p>`;
  inspector.hidden = false;
  ib.querySelectorAll('[data-unit]').forEach((b) => b.addEventListener('click', () => {
    const u = floor.units[Number(b.dataset.unit)];
    u.sold = true; openFloor(floor);
    toast(`${u.code} reservada — no jogo: UnitMarket.buy(), ${fmt.format(u.price)} SCITY.`);
  }));
}

// entradas do painel
$('[data-sample]').addEventListener('click', () => placeModel(sampleTower()));
$('[data-units]').addEventListener('change', applyTransform);
$('[data-rotate]').addEventListener('input', applyTransform);
['[data-floor-h]', '[data-per-floor]', '[data-ground]', '[data-price]'].forEach((s) => $(s).addEventListener('input', () => { validate(); }));
// Aceita 1 arquivo, ou os 3 LODs do SCC Builder (nome-lod0.glb, -lod1, -lod2) de uma vez → THREE.LOD
const MAX_UPLOAD_MB = 40; // acima disso o modelo precisa passar pelo SCC Builder antes
$('[data-upload]').addEventListener('change', async (e) => {
  const files = [...e.target.files].sort((a, b) => a.name.localeCompare(b.name));
  if (!files.length) return;
  const big = files.find((f) => f.size > MAX_UPLOAD_MB * 1048576);
  if (big) {
    setStep(2, 'error');
    toast(`${big.name} tem ${(big.size / 1048576).toFixed(0)} MB. O limite no jogo é ${MAX_UPLOAD_MB} MB: otimize no SCC Builder (remova paisagismo, gere LODs).`, 6000);
    return;
  }
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/');
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);
  try {
    const scenes = await Promise.all(files.map(async (f) => (await loader.parseAsync(await f.arrayBuffer(), '')).scene));
    let group = scenes[0];
    if (scenes.length > 1) {
      group = new THREE.LOD();
      const dist = [0, 450, 1100];
      scenes.slice(0, 3).forEach((s, i) => group.addLevel(s, dist[i]));
    }
    const mb = files.reduce((s, f) => s + f.size, 0) / 1048576;
    placeModel({
      group, lods: Math.min(3, scenes.length), triangles: countTris(group),
      name: files[0].name.replace(/(-lod\d)?\.(glb|gltf)$/i, ''),
      source: `${files.length} arquivo(s), ${mb.toFixed(1)} MB${scenes.length > 1 ? ` · LOD1 ${fmt.format(countTris(scenes[1]))} · LOD2 ${fmt.format(countTris(scenes[2] || scenes[1]))} triângulos` : ''}`,
    });
  } catch (err) { setStep(2, 'error'); toast('Não foi possível ler o GLB: ' + (err?.message || err)); }
});
$('[data-publish]').addEventListener('click', () => {
  if (!model?.metrics?.valid) return;
  buildFloors();
  published = true;
  setStep(5, 'done');
  myLot.building = { group: model.holder, height: model.metrics.height, name: model.name, procedural: false };
  toast(`${model.name} publicado: ${fmt.format(model.units.units)} unidades à venda. Clique num andar para ver as unidades.`, 5200);
  $('[data-hint]').textContent = 'Clique num andar do seu edifício para ver e vender as unidades';
  openFloor(floorBoxes[Math.min(floorBoxes.length - 1, 6)].userData.floor);
});

// ---------- Utilidades de UI ----------
let toastT;
function toast(msg, ms = 3600) {
  const t = $('[data-toast]'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
}
const timeIn = $('[data-time]');
const timeOut = $('[data-time-out]');
let timePending = null;
timeIn.addEventListener('input', () => {
  const h = Number(timeIn.value);
  timeOut.textContent = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
  clearTimeout(timePending); timePending = setTimeout(() => setTimeOfDay(h), 30);
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- Montagem ----------
buildStreets();
buildLayout();
chooseMyLot();
lots.forEach((l) => { if (l.status === 'built') makeBuilding(l); });
buildTrees();
buildCars();
setTimeOfDay(Number(timeIn.value));
paintLots();

const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  updateFly(dt);
  updateCars(dt);
  if (mode === 'builder' && myLot) {
    const pulse = 0.35 + 0.2 * Math.sin(performance.now() / 380);
    if (!model) myLot.mesh.material.opacity = pulse;
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
requestAnimationFrame(() => $('[data-loading]').classList.add('is-hidden'));
// para testes automatizados (avança a câmera/carros e desenha um quadro mesmo com a aba em segundo plano)
window.__scc = {
  lots, setMode, placeModel, sampleTower, openFloor, floorBoxes, scene, renderer, camera, controls, setTimeOfDay,
  step(n = 60) { for (let k = 0; k < n; k++) { updateFly(1 / 30); updateCars(1 / 30); controls.update(); } renderer.render(scene, camera); $('[data-loading]').classList.add('is-hidden'); },
};
$('[data-mega]').addEventListener('click', toggleMega);
