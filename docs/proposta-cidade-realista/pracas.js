// Praças no street view (mundo aberto, docs/desenvolvimento/mundo-aberto-terceira-pessoa.md): chão andável
// fora da rua e da calçada, com piso de pedra, árvores, bancos e um chafariz.
//
// - A praça sai de um conjunto de lotes que não estão à venda (hoje, os do Centro Administrativo: a Praça da
//   Prefeitura, onde a cidade faz os eventos). O chão é o dos lotes mais o recuo até a rua (até 9 m), menos a
//   rua, os lotes de outros donos e o prédio (o retângulo dele, com 1,5 m de folga).
// - Grade de 0,5 m, montada uma vez quando o avatar chega a 450 m. O piso fica na altura do meio-fio, então
//   sai-se da calçada para a praça sem degrau.
// - Chafariz no ponto mais longe das bordas (se couber), uma árvore por quadrado de 10 m do mundo (sorteio
//   fixo pela posição) e um banco ao lado de cerca de metade delas. Árvore, banco e chafariz ocupam o chão:
//   o avatar contorna.
// - Ao entrar, o nome da praça aparece. Ela é destino do GPS (minimapa.js).
//
// PREMISSAS: recuo de até 9 m; folga de 1,5 m do prédio; árvore a cada 10 m, a 3 m da borda; chafariz se o
// ponto mais livre tiver 7 m até a borda.

import { cellHash } from './mobiliario.js';

// curb: a altura do meio-fio (SIDEWALK.curb em streetview.js), para o piso emendar com a calçada.
export const PLAZA = { curb: 0.15, cell: 0.5, reach: 9, holeMargin: 1.5, treeEvery: 10, treeClear: 3, fountainMin: 7, fountainMax: 5, buildWithin: 450, benchShare: 0.55 };

function insidePolygon(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[j];
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

/** Dentro do retângulo do prédio (girado como ele, `rotation.y = -angle`), com folga. */
export function insideHole(x, z, h, margin = PLAZA.holeMargin) {
  if (!h) return false;
  const dx = x - h.x, dz = z - h.z, c = Math.cos(h.angle), s = Math.sin(h.angle);
  const lx = dx * c + dz * s, lz = -dx * s + dz * c;
  return Math.abs(lx) <= h.w / 2 + margin && Math.abs(lz) <= h.d / 2 + margin;
}

/** Distância (em células) até a semente mais perto (`seed[k] = 1`), por chanfro em duas passadas. */
export function chamfer(seed, nx, nz) {
  const d = new Float32Array(nx * nz);
  for (let k = 0; k < d.length; k++) d[k] = seed[k] ? 0 : 1e9;
  const D = Math.SQRT2;
  for (let r = 0; r < nz; r++) {
    for (let c = 0; c < nx; c++) {
      const k = r * nx + c;
      let v = d[k];
      if (c > 0) v = Math.min(v, d[k - 1] + 1);
      if (r > 0) {
        v = Math.min(v, d[k - nx] + 1);
        if (c > 0) v = Math.min(v, d[k - nx - 1] + D);
        if (c < nx - 1) v = Math.min(v, d[k - nx + 1] + D);
      }
      d[k] = v;
    }
  }
  for (let r = nz - 1; r >= 0; r--) {
    for (let c = nx - 1; c >= 0; c--) {
      const k = r * nx + c;
      let v = d[k];
      if (c < nx - 1) v = Math.min(v, d[k + 1] + 1);
      if (r < nz - 1) {
        v = Math.min(v, d[k + nx] + 1);
        if (c < nx - 1) v = Math.min(v, d[k + nx + 1] + D);
        if (c > 0) v = Math.min(v, d[k + nx - 1] + D);
      }
      d[k] = v;
    }
  }
  return d;
}

/**
 * A grade da praça: `mask` 1 = chão, 2 = chão ocupado (árvore, banco, chafariz), 0 = fora; `edge` = distância
 * (em células) até a borda do chão. `rings`: os lotes ([[x, z], …]); `others`: os lotes vizinhos, de outros donos (o recuo não entra neles); `hole`: o prédio {x, z, angle, w, d}.
 */
export function buildPlazaGrid({ rings, hole = null, isRoad = () => false, others = [] }, o = PLAZA) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const ring of rings) {
    for (const [x, z] of ring) {
      minX = Math.min(minX, x); minZ = Math.min(minZ, z); maxX = Math.max(maxX, x); maxZ = Math.max(maxZ, z);
    }
  }
  const cell = o.cell;
  const x0 = Math.floor((minX - o.reach - 1) / cell) * cell, z0 = Math.floor((minZ - o.reach - 1) / cell) * cell;
  const nx = Math.ceil((maxX + o.reach + 1 - x0) / cell), nz = Math.ceil((maxZ + o.reach + 1 - z0) / cell);
  // Cada lote só nas células da caixa dele.
  const raster = (list, out) => {
    for (const ring of list) {
      let a = Infinity, b = Infinity, e = -Infinity, f = -Infinity;
      for (const [x, z] of ring) { a = Math.min(a, x); b = Math.min(b, z); e = Math.max(e, x); f = Math.max(f, z); }
      const c0 = Math.max(0, Math.floor((a - x0) / cell)), c1 = Math.min(nx - 1, Math.floor((e - x0) / cell));
      const r0 = Math.max(0, Math.floor((b - z0) / cell)), r1 = Math.min(nz - 1, Math.floor((f - z0) / cell));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          if (!out[r * nx + c] && insidePolygon(x0 + (c + 0.5) * cell, z0 + (r + 0.5) * cell, ring)) out[r * nx + c] = 1;
        }
      }
    }
  };
  const inLot = new Uint8Array(nx * nz);
  raster(rings, inLot);
  const taken = new Uint8Array(nx * nz);
  raster(others, taken);
  const fromLot = chamfer(inLot, nx, nz);
  const reach = o.reach / cell;
  const mask = new Uint8Array(nx * nz);
  for (let r = 0; r < nz; r++) {
    const z = z0 + (r + 0.5) * cell;
    for (let c = 0; c < nx; c++) {
      const k = r * nx + c;
      if (!inLot[k] && fromLot[k] > reach) continue;
      const x = x0 + (c + 0.5) * cell;
      if (insideHole(x, z, hole, o.holeMargin) || isRoad(x, z)) continue;
      if (!inLot[k] && taken[k]) continue;
      mask[k] = 1;
    }
  }
  const outside = new Uint8Array(nx * nz);
  for (let k = 0; k < mask.length; k++) outside[k] = mask[k] ? 0 : 1;
  const edge = chamfer(outside, nx, nz);
  const index = (x, z) => {
    const c = Math.floor((x - x0) / cell), r = Math.floor((z - z0) / cell);
    return c < 0 || r < 0 || c >= nx || r >= nz ? -1 : r * nx + c;
  };
  const at = (x, z) => {
    const k = index(x, z);
    return k < 0 ? 0 : mask[k];
  };
  const center = (k) => ({ x: x0 + ((k % nx) + 0.5) * cell, z: z0 + (Math.floor(k / nx) + 0.5) * cell });
  let floor = 0;
  for (const v of mask) floor += v ? 1 : 0;
  return { x0, z0, nx, nz, cell, mask, edge, index, at, center, area: floor * cell * cell };
}

/** Onde vão o chafariz, as árvores e os bancos (sorteio fixo pela posição no mundo). */
export function placePlaza(grid, o = PLAZA) {
  const { mask, edge, cell } = grid;
  let best = -1, bk = -1;
  for (let k = 0; k < mask.length; k++) if (mask[k] === 1 && edge[k] > best) { best = edge[k]; bk = k; }
  const fountain = bk >= 0 && best * cell >= o.fountainMin ? { ...grid.center(bk), r: Math.min(o.fountainMax, best * cell - 3) } : null;
  const squares = new Map();
  for (let k = 0; k < mask.length; k++) {
    if (mask[k] !== 1 || edge[k] * cell < o.treeClear) continue;
    const p = grid.center(k);
    if (fountain && Math.hypot(p.x - fountain.x, p.z - fountain.z) < fountain.r + 4) continue;
    const key = `${Math.floor(p.x / o.treeEvery)},${Math.floor(p.z / o.treeEvery)}`;
    const h = cellHash(Math.round(p.x / cell), Math.round(p.z / cell));
    const cur = squares.get(key);
    if (!cur || h < cur.h) squares.set(key, { ...p, h });
  }
  const trees = [...squares.values()];
  const benches = [];
  for (const t of trees) {
    if (t.h * 1000 % 1 > o.benchShare) continue;
    const a = t.h * Math.PI * 2;
    const b = { x: t.x + Math.sin(a) * 1.8, z: t.z + Math.cos(a) * 1.8, yaw: a + Math.PI / 2 };
    const k = grid.index(b.x, b.z);
    if (k >= 0 && mask[k] === 1 && edge[k] * cell >= 1.5) benches.push(b);
  }
  return { fountain, trees, benches };
}

/** Marca o chão ocupado (2) em volta de cada peça: círculos {x, z, r}. */
export function occupy(grid, circles) {
  const { cell, nx, nz, mask } = grid;
  for (const { x, z, r } of circles) {
    const c0 = Math.floor((x - r - grid.x0) / cell), c1 = Math.floor((x + r - grid.x0) / cell);
    const r0 = Math.floor((z - r - grid.z0) / cell), r1 = Math.floor((z + r - grid.z0) / cell);
    for (let rr = Math.max(0, r0); rr <= Math.min(nz - 1, r1); rr++) {
      for (let cc = Math.max(0, c0); cc <= Math.min(nx - 1, c1); cc++) {
        const k = rr * nx + cc, p = grid.center(k);
        if (mask[k] && Math.hypot(p.x - x, p.z - z) <= r) mask[k] = 2;
      }
    }
  }
}

function pavingTexture(THREE) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#7d7b78';
  g.fillRect(0, 0, 256, 256);
  // Pedras de 64 px (1 m) em fiadas desencontradas.
  for (let row = 0; row < 4; row++) {
    for (let col = -1; col < 4; col++) {
      const x = col * 64 + (row % 2) * 32, y = row * 64;
      const t = cellHash(row * 7 + 3, col + 11);
      const v = 150 + Math.round(t * 24);
      g.fillStyle = `rgb(${v},${v - 2},${v - 6})`;
      g.fillRect(x + 2, y + 2, 60, 60);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** O piso: uma tira por sequência de células de chão em cada linha da grade. */
function floorGeometry(THREE, grid, y) {
  const { nx, nz, cell, x0, z0, mask } = grid;
  const pos = [], uv = [], idx = [];
  for (let r = 0; r < nz; r++) {
    let c = 0;
    while (c < nx) {
      if (!mask[r * nx + c]) { c++; continue; }
      const start = c;
      while (c < nx && mask[r * nx + c]) c++;
      const xa = x0 + start * cell, xb = x0 + c * cell, za = z0 + r * cell, zb = za + cell;
      const v = pos.length / 3;
      pos.push(xa, y, za, xb, y, za, xb, y, zb, xa, y, zb);
      uv.push(xa, za, xb, za, xb, zb, xa, zb);
      idx.push(v, v + 2, v + 1, v, v + 3, v + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setIndex(idx);
  return geo;
}

/**
 * As praças da cidade. `list()` devolve as definições {id, name, rings, hole, center: [x, z], otherLot}; cada
 * uma é montada quando o avatar chega perto.
 */
export function createPlazas({ THREE, scene, streetView, list = () => [], opt = PLAZA }) {
  const group = new THREE.Group();
  group.name = 'pracas';
  group.visible = false;
  scene.add(group);
  const built = new Map(); // id → {def, grid, parts, ms}
  let paving = null;
  let inside = null;
  const mat = {
    bark: new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 1 }),
    leaves: new THREE.MeshStandardMaterial({ color: 0x4a7a35, roughness: 0.9, flatShading: true }),
    wood: new THREE.MeshStandardMaterial({ color: 0x8a5a32, roughness: 0.8 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x2f3338, roughness: 0.5, metalness: 0.6 }),
    stone: new THREE.MeshStandardMaterial({ color: 0xb9b3a7, roughness: 0.85 }),
    water: new THREE.MeshStandardMaterial({ color: 0x3f7fa6, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 }),
  };

  function instanced(geo, material, items, place) {
    const im = new THREE.InstancedMesh(geo, material, Math.max(1, items.length));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), s = new THREE.Vector3();
    items.forEach((it, i) => {
      const { y, yaw, scale } = place(it);
      q.setFromAxisAngle(up, yaw);
      m4.compose(p.set(it.x, y, it.z), q, s.set(scale, scale, scale));
      im.setMatrixAt(i, m4);
    });
    im.count = items.length;
    im.castShadow = true;
    im.receiveShadow = true;
    return im;
  }

  function build(def) {
    const t0 = performance.now();
    const grid = buildPlazaGrid({ rings: def.rings, hole: def.hole, isRoad: (x, z) => streetView.isRoad(x, z), others: def.others?.() ?? [] }, opt);
    const items = placePlaza(grid, opt);
    occupy(grid, [
      ...items.trees.map((t) => ({ x: t.x, z: t.z, r: 0.45 })),
      ...items.benches.map((b) => ({ x: b.x, z: b.z, r: 0.8 })),
      ...(items.fountain ? [{ x: items.fountain.x, z: items.fountain.z, r: items.fountain.r + 0.3 }] : []),
    ]);
    const y = streetView.groundY() + opt.curb;
    paving ??= pavingTexture(THREE);
    const g = new THREE.Group();
    g.name = def.id;
    const floor = new THREE.Mesh(floorGeometry(THREE, grid, y + 0.012), new THREE.MeshStandardMaterial({ map: paving, roughness: 0.9 }));
    floor.receiveShadow = true;
    g.add(floor);
    const treeScale = (t) => 0.9 + (t.h * 37 % 1) * 0.5;
    g.add(instanced(new THREE.CylinderGeometry(0.14, 0.22, 3.6, 7).translate(0, 1.8, 0), mat.bark, items.trees, (t) => ({ y, yaw: t.h * 6.28, scale: treeScale(t) })));
    g.add(instanced(new THREE.IcosahedronGeometry(2.1, 1).translate(0, 5.4, 0), mat.leaves, items.trees, (t) => ({ y, yaw: t.h * 6.28, scale: treeScale(t) })));
    // Banco: assento e encosto de madeira sobre dois pés de ferro.
    g.add(instanced(new THREE.BoxGeometry(1.6, 0.06, 0.42).translate(0, 0.45, 0), mat.wood, items.benches, (b) => ({ y, yaw: b.yaw, scale: 1 })));
    g.add(instanced(new THREE.BoxGeometry(1.6, 0.36, 0.05).translate(0, 0.72, -0.2), mat.wood, items.benches, (b) => ({ y, yaw: b.yaw, scale: 1 })));
    g.add(instanced(new THREE.BoxGeometry(1.4, 0.45, 0.36).translate(0, 0.22, 0), mat.iron, items.benches, (b) => ({ y, yaw: b.yaw, scale: 1 })));
    if (items.fountain) {
      const f = items.fountain;
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(f.r, f.r + 0.15, 0.55, 40, 1, true), mat.stone);
      basin.position.set(f.x, y + 0.275, f.z);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(f.r, 0.18, 8, 48).rotateX(Math.PI / 2), mat.stone);
      rim.position.set(f.x, y + 0.55, f.z);
      const water = new THREE.Mesh(new THREE.CircleGeometry(f.r - 0.05, 40).rotateX(-Math.PI / 2), mat.water);
      water.position.set(f.x, y + 0.42, f.z);
      const column = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 2.2, 16).translate(0, 1.1, 0), mat.stone);
      column.position.set(f.x, y, f.z);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 0.4, 0.4, 24), mat.stone);
      bowl.position.set(f.x, y + 2.3, f.z);
      for (const m of [basin, rim, column, bowl]) { m.castShadow = true; m.receiveShadow = true; }
      g.add(basin, rim, water, column, bowl);
    }
    group.add(g);
    // O ponto do GPS: o chão livre mais perto do centro da praça.
    let gk = -1, gd = Infinity;
    for (let k = 0; k < grid.mask.length; k++) {
      if (grid.mask[k] !== 1 || grid.edge[k] * grid.cell < 2) continue;
      const p = grid.center(k);
      const d = Math.hypot(p.x - def.center[0], p.z - def.center[1]);
      if (d < gd) { gd = d; gk = k; }
    }
    const gps = gk >= 0 ? grid.center(gk) : { x: def.center[0], z: def.center[1] };
    built.set(def.id, { def, grid, items, group: g, gps, ms: Math.round(performance.now() - t0) });
  }

  const walkable = (x, z) => {
    for (const b of built.values()) if (b.grid.at(x, z) === 1) return true;
    return false;
  };

  return {
    group,
    walkable,
    floorAt: (x, z) => (walkable(x, z) ? streetView.groundY() + opt.curb : null),
    update() {
      const on = streetView.active();
      group.visible = on;
      if (!on) { inside = null; return; }
      const p = streetView.position();
      for (const def of list()) {
        if (!built.has(def.id) && Math.hypot(p.x - def.center[0], p.z - def.center[1]) < opt.buildWithin) build(def);
      }
      // Ao pisar na praça, o nome dela.
      let here = null;
      for (const b of built.values()) if (b.grid.at(p.x, p.z)) here = b.def;
      if (here && inside !== here.id) streetView.say(`🌳 ${here.name}`, 2500);
      inside = here?.id ?? null;
    },
    /** Destinos do GPS: as praças (montadas ou não). */
    places: () => list().map((def) => {
      const b = built.get(def.id);
      return { id: def.id, label: def.name, x: b?.gps.x ?? def.center[0], z: b?.gps.z ?? def.center[1] };
    }),
    debug: () => ({
      inside,
      plazas: [...built.values()].map((b) => ({ id: b.def.id, area: Math.round(b.grid.area), trees: b.items.trees.length, benches: b.items.benches.length, fountain: b.items.fountain, gps: b.gps, ms: b.ms })),
    }),
  };
}
