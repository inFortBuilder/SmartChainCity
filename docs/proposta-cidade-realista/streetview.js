// Street view: o jogador arrasta o boneco do canto da tela até uma rua e passa a
// caminhar com o avatar no nível do chão, só pelas ruas (como o Street View do
// Google). A área de caminhada é a própria camada `roads` da cidade (OSM): um
// índice em grade dos triângulos das ruas responde "este ponto é rua?".
//
// Avatar: o personagem e as animações da Universal Animation Library
// (Quaternius, CC0) quando estão em .local/animacoes/ual/ (fora do repositório,
// ver docs/desenvolvimento/street-view.md); sem eles, o RobotExpressive (CC0) do
// repositório do three.js.
//
// Fica para depois: clicar num escritório ou numa residência (do jogador ou de
// quem o convidou) para entrar no interior (spike do escritório, ADR-0015).

const CELL = 32; // m por célula do índice
const SPEED = { walk: 1.5, run: 4.2 }; // m/s
const CAM = { dist: 4.5, minDist: 2, maxDist: 14, height: 1.6 };
const AVATAR_HEIGHT = 1.75;
const UAL = '../../.local/animacoes/ual';
const ROBOT = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/models/gltf/RobotExpressive/RobotExpressive.glb';

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

export function createStreetView({ THREE, scene, camera, controls, canvas, roads, loadGltf, onPlaceClick }) {
  let index = null;
  let active = false;
  let saved = null;
  const avatar = { obj: new THREE.Group(), mixer: null, actions: {}, current: null, heading: 0, target: null, speed: 0, model: null, clips: [] };
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
  bar.innerHTML = '<button type="button">← Voltar ao mapa</button><span class="sv-help">W A S D ou setas para andar · Shift corre · clique na rua para ir até lá · arraste para olhar</span>';
  document.body.append(bar);
  bar.querySelector('button').addEventListener('click', () => exit());
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

  // ---------- Avatar ----------
  let loading = null;
  const loadAvatar = () => (loading ??= (async () => {
    let model = null;
    let clips = [];
    try {
      // Universal Animation Library (CC0), se baixada para .local/animacoes/ual/.
      const [person, anims] = await Promise.all([loadGltf(`${UAL}/personagem.glb`), loadGltf(`${UAL}/animacoes.glb`)]);
      model = person.scene;
      clips = [...anims.animations, ...person.animations];
      avatar.source = 'Universal Animation Library';
    } catch {
      const robot = await loadGltf(ROBOT);
      model = robot.scene;
      clips = robot.animations;
      avatar.source = 'RobotExpressive';
    }
    const bb = new THREE.Box3().setFromObject(model);
    model.scale.setScalar(AVATAR_HEIGHT / (bb.max.y - bb.min.y));
    model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    avatar.obj.add(model);
    avatar.model = model;
    avatar.clips = clips;
    avatar.mixer = new THREE.AnimationMixer(model);
    const find = (...res) => clips.find((c) => res.some((re) => re.test(c.name)));
    const idle = find(/^idle$/i, /idle/i);
    const walk = find(/^walk(ing)?$/i, /walk(?!.*back)/i);
    const run = find(/^(running|run|jog)$/i, /jog|run|sprint/i);
    for (const [k, clip] of Object.entries({ idle, walk, run })) if (clip) avatar.actions[k] = avatar.mixer.clipAction(clip);
    play('idle');
  })());
  const play = (name) => {
    const a = avatar.actions[name] ?? avatar.actions.walk ?? avatar.actions.idle;
    if (!a || a === avatar.current) return;
    a.reset().fadeIn(0.2).play();
    avatar.current?.fadeOut(0.2);
    avatar.current = a;
  };

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
    await loadAvatar().catch((err) => { console.error(err); say('O avatar não carregou.'); });
  }

  function exit() {
    if (!active) return;
    active = false;
    avatar.obj.visible = false;
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
    if (p && index.isRoad(p.x, p.z)) avatar.target = p;
    // Fora da rua: talvez um imóvel para entrar.
    else if (!(p && onPlaceClick?.(p))) say('Só dá para caminhar pelas ruas.');
  });
  canvas.addEventListener('wheel', (e) => {
    if (!active) return;
    e.preventDefault();
    view.dist = THREE.MathUtils.clamp(view.dist * (e.deltaY > 0 ? 1.12 : 0.89), CAM.minDist, CAM.maxDist);
  }, { passive: false });

  // Um passo de (dx, dz): anda se o destino é rua; senão, desliza ao longo da borda.
  const step = (dx, dz) => {
    const o = avatar.obj.position;
    if (index.isRoad(o.x + dx, o.z + dz)) { o.x += dx; o.z += dz; return true; }
    if (Math.abs(dx) > 1e-4 && index.isRoad(o.x + dx, o.z)) { o.x += dx; return true; }
    if (Math.abs(dz) > 1e-4 && index.isRoad(o.x, o.z + dz)) { o.z += dz; return true; }
    return false;
  };

  const tmp = new THREE.Vector3();
  function tick(dt) {
    if (!active) return false;
    dt = Math.min(dt, 0.1);
    const run = keys.has('shift');
    let fwd = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
    const side = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    let dirX = 0, dirZ = 0;
    if (fwd || side) {
      avatar.target = null;
      // Para frente é para onde a câmera olha.
      dirX = Math.sin(view.yaw) * fwd + Math.sin(view.yaw - Math.PI / 2) * side;
      dirZ = Math.cos(view.yaw) * fwd + Math.cos(view.yaw - Math.PI / 2) * side;
    } else if (avatar.target) {
      dirX = avatar.target.x - avatar.obj.position.x;
      dirZ = avatar.target.z - avatar.obj.position.z;
      if (Math.hypot(dirX, dirZ) < 0.3) { avatar.target = null; dirX = dirZ = 0; }
      fwd = 1;
    }
    const len = Math.hypot(dirX, dirZ);
    let moving = false;
    if (len > 0) {
      const speed = run ? SPEED.run : SPEED.walk;
      moving = step((dirX / len) * speed * dt, (dirZ / len) * speed * dt);
      if (!moving) avatar.target = null;
      const want = Math.atan2(dirX, dirZ);
      const diff = Math.atan2(Math.sin(want - avatar.heading), Math.cos(want - avatar.heading));
      avatar.heading += diff * Math.min(1, dt * 10);
      avatar.obj.rotation.y = avatar.heading;
      // A câmera acompanha devagar quando o avatar vai até um ponto clicado.
      if (!keys.size && avatar.target) view.yaw += Math.atan2(Math.sin(avatar.heading - view.yaw), Math.cos(avatar.heading - view.yaw)) * Math.min(1, dt * 1.5);
    }
    avatar.speed = moving ? (run ? SPEED.run : SPEED.walk) : 0;
    play(moving ? (run ? 'run' : 'walk') : 'idle');
    avatar.mixer?.update(dt);

    // Câmera em terceira pessoa, atrás e acima do avatar.
    const head = tmp.copy(avatar.obj.position);
    head.y += CAM.height;
    const back = view.dist * Math.cos(view.pitch);
    camera.position.set(head.x - Math.sin(view.yaw) * back, head.y + view.dist * Math.sin(view.pitch), head.z - Math.cos(view.yaw) * back);
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
    /** O modelo e os clipes do avatar (carrega se preciso), para desenhar os outros jogadores. */
    avatarTemplate: async () => {
      await loadAvatar();
      return { model: avatar.model, clips: avatar.clips };
    },
    heading: () => view.yaw,
    say,
    exit,
    /** Gira a câmera (e o "para frente") para o rumo `yaw` e, se vier, a inclinação `pitch`, em radianos. */
    look: (yaw, pitch) => {
      view.yaw = yaw;
      if (pitch !== undefined) view.pitch = THREE.MathUtils.clamp(pitch, -0.35, 1.2);
    },
    isRoad: (x, z) => ensureIndex().isRoad(x, z),
    avatar,
  };
}
