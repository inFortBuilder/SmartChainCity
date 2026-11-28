// O próprio carro no street view (fase 4 do mundo aberto, docs/desenvolvimento/mundo-aberto-terceira-pessoa.md).
//
// 1. "Meu carro" na barra chama o carro da conta (o primeiro em dia, de GET /v1/vehicles): ele aparece
//    estacionado na faixa da direita da rua mais perto do avatar.
// 2. Perto dele (3 m), "E Dirigir". Como é dinheiro, o 1º E confirma e o 2º, em 4 s, paga: o game-core
//    (POST /v1/avatars/:id/drive) confere a habilitação e o carro em dia e cobra o combustível da saída
//    (2 THALER, o mesmo do deslocamento de carro do turno). Sem a cobrança aceita, ninguém dirige.
// 3. Dirigindo (arcade): W acelera, S freia e dá ré, A e D viram (modelo de bicicleta: a virada cresce
//    com a velocidade). A velocidade máxima é a do modelo (Hatch 50 km/h, Sedã 70, Superesportivo 90).
//    O carro só anda na rua: a frente fora dela para o carro. Para atrás de outro carro e na frente de quem
//    atravessa. A câmera vai atrás do carro (7 m).
// 4. E de novo: sai do carro, na calçada do lado direito, e o carro fica estacionado ali.
//
// PREMISSAS: aceleração de 4 m/s², freio de 8 m/s², ré até 4 m/s, esterço de até 0,5 rad (35% dele a 20 m/s)
// com entre-eixos de 2,6 m, parada a 3,5 m de outro carro; embarque a 3 m.

import { reach, rightOf, roadHeading } from './carros.js';

export const DRIVE = { accel: 4, brake: 8, drag: 1.5, reverse: 4, steer: 0.5, wheelbase: 2.6, gap: 3.5, reach: 3, confirmMs: 4000, lane: 1.8, camDist: 7 };
/** Velocidade máxima (m/s) pelo modelo: o atributo `speed` do game-core em km/h. */
export const MAX_SPEED = { hatch: 50 / 3.6, sedan: 70 / 3.6, super: 90 / 3.6 };
const PAINT = { hatch: 0xc0392b, sedan: 0x1f3a93, super: 0xf1c40f };

const ERRORS = {
  insufficient_thaler: 'THALER insuficiente para o combustível.',
  no_license: 'Sem habilitação: faça a autoescola.',
  in_driving_school: 'Ainda na autoescola.',
  vehicle_unavailable: 'O carro não pode rodar agora (IPVA, quebra ou vida útil).',
  no_session: 'Entre no jogo e pegue um avatar para dirigir.',
  in_hospital: 'Internado: sem dirigir.',
  resting: 'O avatar está dormindo.',
};

/**
 * Um passo de direção (puro, para os testes): devolve {x, z, heading, speed, bumped}. `input`: {fwd, back,
 * left, right} em booleanos; `free(x, z)` diz se o ponto é rua; `blocked` freia (carro ou pedestre à frente).
 */
export function driveStep(car, input, dt, free, max, blocked = false, o = DRIVE) {
  let { x, z, heading, speed } = car;
  if (blocked && speed > 0) speed = Math.max(0, speed - o.brake * 2 * dt);
  else if (input.fwd) speed = Math.min(max, speed + o.accel * dt);
  else if (input.back) speed = speed > 0 ? Math.max(0, speed - o.brake * dt) : Math.max(-o.reverse, speed - o.accel * dt);
  else speed = Math.sign(speed) * Math.max(0, Math.abs(speed) - o.drag * dt);
  if (blocked && speed > 0) speed = 0;
  const steer = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  // Menos esterço com mais velocidade (até 35% dele), para o carro não ficar arisco na reta.
  const lock = o.steer * Math.max(0.35, 1 - Math.abs(speed) / 30);
  heading += (speed / o.wheelbase) * Math.tan(steer * lock) * dt;
  const nx = x + Math.sin(heading) * speed * dt, nz = z + Math.cos(heading) * speed * dt;
  // A frente (ou a traseira, na ré) precisa estar na rua.
  const tip = speed >= 0 ? 2.1 : -2.1;
  if (!free(nx + Math.sin(heading) * tip, nz + Math.cos(heading) * tip) || !free(nx, nz)) return { x, z, heading, speed: 0, bumped: Math.abs(speed) > 1 };
  return { x: nx, z: nz, heading, speed, bumped: false };
}

/**
 * O carro do modelo (`hatch`, `sedan`, `super`), procedural: carroceria na cor do modelo, cabine, rodas e
 * faróis. O mesmo para o carro do jogador e para o dos outros jogadores (multiplayer.js).
 */
export function carMesh(THREE, model) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: PAINT[model] ?? 0x888888, roughness: 0.3, metalness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1b2633, roughness: 0.15, metalness: 0.6 });
  const tire = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
  g.add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 4.2).translate(0, 0.65, 0), paint), new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 2.1).translate(0, 1.3, -0.2), glass));
  const wheel = new THREE.CylinderGeometry(0.34, 0.34, 0.25, 14).rotateZ(Math.PI / 2);
  for (const [wx, wz] of [[-0.85, 1.35], [0.85, 1.35], [-0.85, -1.35], [0.85, -1.35]]) {
    const w = new THREE.Mesh(wheel, tire);
    w.position.set(wx, 0.34, wz);
    g.add(w);
  }
  const lamp = new THREE.BoxGeometry(0.35, 0.15, 0.05);
  for (const s of [-0.6, 0.6]) {
    const f = new THREE.Mesh(lamp, new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2c0, emissiveIntensity: 0.6 }));
    f.position.set(s, 0.75, 2.11);
    const b = new THREE.Mesh(lamp, new THREE.MeshStandardMaterial({ color: 0xa01010, emissive: 0x700000, emissiveIntensity: 0.5 }));
    b.position.set(s, 0.8, -2.11);
    g.add(f, b);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export function createPlayerCar({ THREE, scene, streetView, servidor, cars = () => [], walkers = () => [], opt = DRIVE }) {
  const style = document.createElement('style');
  style.textContent = `
    .cj-prompt { position: fixed; left: 50%; bottom: 110px; transform: translateX(-50%); z-index: 8; padding: 9px 16px; border-radius: 999px;
      background: rgba(15,23,42,.9); color: #fff; font: 600 14px system-ui, sans-serif; display: flex; gap: 10px; align-items: center; max-width: calc(100vw - 32px); }
    .cj-prompt[hidden] { display: none; }
    .cj-prompt kbd { background: #38bdf8; color: #0b1220; border-radius: 6px; padding: 2px 8px; font: 800 13px system-ui, sans-serif; }
    .cj-prompt button { border: 0; border-radius: 8px; padding: 5px 10px; font-weight: 700; cursor: pointer; }
    .cj-prompt.confirma { outline: 2px solid #38bdf8; }
    @media (max-width: 640px) { .cj-prompt { bottom: 440px; } }
  `;
  document.head.append(style);
  const prompt = document.createElement('div');
  prompt.className = 'cj-prompt';
  prompt.hidden = true;
  document.body.append(prompt);
  const callBtn = document.createElement('button');
  callBtn.type = 'button';
  callBtn.dataset.meuCarro = '';
  callBtn.textContent = 'Meu carro';
  callBtn.style.whiteSpace = 'nowrap';
  callBtn.hidden = true;
  document.querySelector('.sv-bar')?.append(callBtn);

  let fuel = 200n;
  servidor.routineCatalog?.().then((c) => { if (c?.drive_fuel) fuel = BigInt(c.drive_fuel); }).catch(() => {});
  /** O carro da conta em dia (do servidor) e o estado na cena. */
  let vehicle = null;
  let car = null; // { obj, x, z, heading, speed, max }
  let state = 'parked'; // parked | paying | driving
  let armed = 0;
  let msg = null, msgUntil = 0;
  const keys = new Set();
  const stats = { calls: 0, drives: 0, refused: 0, bumps: 0, stops: 0, meters: 0, maxSpeed: 0 };
  const flash = (t, ms = 2800) => { msg = t; msgUntil = performance.now() + ms; };
  const thaler = (c) => (Number(c) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const isRoad = (x, z) => streetView.isRoad(x, z);

  function mesh(model) {
    const g = carMesh(THREE, model);
    g.name = 'meu-carro';
    return g;
  }


  /** O primeiro carro da conta que pode rodar. */
  const okVehicle = () => (servidor.myCars?.() ?? []).find((v) => v.state === 'ok') ?? null;

  /** Chama o carro: estacionado na faixa da direita da rua mais perto. */
  function call() {
    vehicle = okVehicle();
    if (!vehicle) return flash('A conta não tem carro em dia (agência no painel).');
    const a = streetView.position();
    const r = streetView.nearestRoad(a.x, a.z, 40);
    if (!r) return flash('Sem rua perto para estacionar.');
    let h = roadHeading(isRoad, r.x, r.z);
    // Do lado do avatar: a direita do rumo aponta para a calçada em que ele está.
    const right = rightOf(h);
    if ((a.x - r.x) * Math.sin(right) + (a.z - r.z) * Math.cos(right) < 0) h += Math.PI;
    const dR = reach(isRoad, r.x, r.z, rightOf(h), 20);
    const shift = dR - opt.lane;
    const x = r.x + Math.sin(rightOf(h)) * shift, z = r.z + Math.cos(rightOf(h)) * shift;
    if (car) scene.remove(car.obj);
    car = { obj: mesh(vehicle.model), x, z, heading: h, speed: 0, max: MAX_SPEED[vehicle.model] ?? 14 };
    car.obj.position.set(x, streetView.groundY(), z);
    car.obj.rotation.y = h;
    scene.add(car.obj);
    state = 'parked';
    stats.calls++;
    flash(`${vehicle.label} estacionado aqui.`);
  }
  callBtn.addEventListener('click', () => call());

  async function act() {
    if (!car) return;
    if (state === 'driving') return getOut();
    if (state !== 'parked' || !near()) return;
    if (performance.now() - armed > opt.confirmMs) {
      armed = performance.now();
      return;
    }
    armed = 0;
    state = 'paying';
    try {
      await servidor.avatarPost('drive', { vehicle: vehicle.id });
      state = 'driving';
      stats.drives++;
      streetView.startRide(() => ({ x: car.x, z: car.z, heading: car.heading }), opt.camDist);
      flash(`Combustível: −${thaler(fuel)} THALER.`);
      servidor.refresh?.();
    } catch (e) {
      state = 'parked';
      stats.refused++;
      flash(ERRORS[e.code] ?? e.message);
    }
  }

  function getOut() {
    car.speed = 0;
    state = 'parked';
    // Na calçada do lado direito, ou rente ao carro se não houver.
    const r = rightOf(car.heading);
    let at = { x: car.x, z: car.z };
    for (const d of [3, 4, 2.5, 5]) {
      const x = car.x + Math.sin(r) * d, z = car.z + Math.cos(r) * d;
      if (streetView.isWalkable(x, z) && !isRoad(x, z)) { at = { x, z }; break; }
    }
    streetView.endRide(at.x, at.z);
    flash('Carro estacionado.');
  }

  const near = () => {
    if (!car) return false;
    const a = streetView.position();
    return Math.hypot(a.x - car.x, a.z - car.z) < opt.reach + 2.1;
  };

  const KEYMAP = { w: 'fwd', arrowup: 'fwd', s: 'back', arrowdown: 'back', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right' };
  addEventListener('keydown', (e) => {
    if (!streetView.active() || e.target.closest?.('input, textarea, select')) return;
    const k = e.key.toLowerCase();
    if (k === 'e' && car && (state === 'driving' || near())) act();
    if (KEYMAP[k]) keys.add(KEYMAP[k]);
  });
  addEventListener('keyup', (e) => {
    const k = KEYMAP[e.key.toLowerCase()];
    if (k) keys.delete(k);
  });

  /** Alguém na frente do carro: outro carro (3,5 m) ou quem atravessa (3 m), numa faixa de 1,6 m. */
  function blocked() {
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    const ahead = (x, z, gap) => {
      const dx = x - car.x, dz = z - car.z, along = dx * fx + dz * fz;
      return along > 0 && along < gap + 2.1 && Math.abs(dx * fz - dz * fx) < 1.6;
    };
    return cars().some((c) => ahead(c.x, c.z, opt.gap + (c.bus ? 3.4 : 0))) || walkers().some((w) => ahead(w.x, w.z, 3));
  }

  function render() {
    const now = performance.now();
    if (msg && now > msgUntil) msg = null;
    if (state === 'driving') {
      prompt.hidden = false;
      prompt.classList.remove('confirma');
      prompt.innerHTML = `<kbd>E</kbd><span>Sair do carro · W/S acelera e freia · A/D vira · ${Math.round(Math.abs(car.speed) * 3.6)} km/h${msg ? ` · ${msg}` : ''}</span>`;
      return;
    }
    if (msg) {
      prompt.hidden = false;
      prompt.classList.remove('confirma');
      prompt.innerHTML = `<span>${msg}</span>`;
      return;
    }
    if (state !== 'parked' || !near()) {
      prompt.hidden = true;
      return;
    }
    const confirming = now - armed < opt.confirmMs;
    prompt.hidden = false;
    prompt.classList.toggle('confirma', confirming);
    prompt.innerHTML = `<kbd>E</kbd><span>${confirming ? 'Confirmar: combustível' : `${vehicle.label}: combustível`} · ${thaler(fuel)} THALER</span><button type="button">${confirming ? 'Confirmar' : 'Dirigir'}</button>`;
    prompt.querySelector('button').onclick = () => act();
  }

  function update(dt) {
    const on = streetView.active();
    callBtn.hidden = !on || !okVehicle() || state === 'driving';
    if (car) car.obj.visible = on;
    if (!on) {
      prompt.hidden = true;
      return;
    }
    if (state === 'driving' && dt) {
      const b = blocked();
      const before = { x: car.x, z: car.z };
      const next = driveStep(car, { fwd: keys.has('fwd'), back: keys.has('back'), left: keys.has('left'), right: keys.has('right') }, Math.min(dt, 0.1), isRoad, car.max, b, opt);
      if (next.bumped) stats.bumps++;
      if (b && car.speed > 1 && next.speed === 0) stats.stops++;
      Object.assign(car, next);
      stats.meters += Math.hypot(car.x - before.x, car.z - before.z);
      stats.maxSpeed = Math.max(stats.maxSpeed, Math.abs(car.speed));
      car.obj.position.set(car.x, streetView.groundY(), car.z);
      car.obj.rotation.y = car.heading;
    }
    render();
  }

  return {
    update,
    /** O carro do jogador para os outros sistemas (sons, minimapa), ou null. */
    position: () => (car ? { x: car.x, z: car.z, speed: car.speed, bus: false, heading: car.heading } : null),
    /** O modelo do carro chamado (para o realtime), ou null. */
    model: () => vehicle?.model ?? null,
    driving: () => state === 'driving',
    debug: () => ({ state, vehicle: vehicle && { id: vehicle.id, model: vehicle.model }, car: car && { x: +car.x.toFixed(1), z: +car.z.toFixed(1), speed: +car.speed.toFixed(1), onRoad: isRoad(car.x, car.z) }, near: near(), ...stats, meters: Math.round(stats.meters), maxSpeed: +(stats.maxSpeed * 3.6).toFixed(0) }),
    /** Para testes: o botão, o E e as teclas. */
    call,
    press: () => act(),
    hold: (k, on = true) => (on ? keys.add(k) : keys.delete(k)),
  };
}
