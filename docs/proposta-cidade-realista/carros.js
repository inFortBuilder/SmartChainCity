// Trânsito nas ruas (fase 3 do mundo aberto, docs/desenvolvimento/mundo-aberto-terceira-pessoa.md).
//
// Carros do cliente, não jogadores: cada navegador sorteia os seus. Eles andam pelas faixas do grafo das ruas
// (vias.js, sobre ruas-grafo.js), como no trânsito de verdade:
// - mão direita: cada trecho tem uma faixa em cada sentido, à direita de quem anda, e o carro segue a
//   geometria da faixa (não há como ir na contramão nem sair da faixa);
// - no cruzamento, escolhe a saída com antecedência (reto é o mais provável) e passa numa curva até a faixa
//   nova; volta pelo mesmo trecho só no fim de rua;
// - um carro por vez no cruzamento: quem chega primeiro entra, e os outros esperam 1 m antes do fim da faixa
//   (os que vêm atrás na mesma faixa podem seguir junto). Isso também evita a sobreposição de quem cruza;
// - distância: o IDM (vias.js) guarda 2,5 m mais 1,2 s de viagem do carro da frente e freia suave; colado
//   (menos de 0,5 m), o carro não anda;
// - o sinal fechado (semaforos.js), o ponto de ônibus, quem atravessa na faixa (pedestres.js), o avatar na rua
//   e o carro do jogador estacionado entram como obstáculos parados;
// - quando o grafo é refeito (a cada 60 m do avatar), cada carro passa para a faixa nova em que está.
// Nascem numa faixa de rua de 5 m ou mais, entre 30 e 85 m do avatar, longe dos outros, e somem a 110 m ou na
// borda da grade. O carro é procedural, de cor sorteada. A quantidade segue o FPS, como os pedestres.
//
// Ônibus: com 3 carros ou mais, um é ônibus (11 m). Com um ponto de ônibus (onibus.js) à frente, freia até a
// parada (`bay`) e fica 7 s com a porta aberta; quem espera no ponto embarca (pedestres.js). Com o avatar
// dentro (viagem.js), ele não sai da cena (na borda, dá a volta).
//
// As funções `drive`, `mustYield`, `reach`, `roadHeading` e `rightOf` (o guia pelo meio-fio de antes) ficam
// para o carro do jogador (carro-jogo.js) e para os testes.
//
// PREMISSAS: até 10 carros, 7 a 10 m/s (25 a 36 km/h), faixa e IDM como em vias.js; um ônibus
// de 11 m a 8 m/s, 7 s parado no ponto, frenagem de 1,5 m/s² até ele.

import { along, buildLanes, chooseNext, connector, idm } from './vias.js';

export const CARS = {
  max: 10,
  min: 2,
  start: 6,
  near: 30,
  spawn: 85,
  despawn: 110,
  speed: [7, 10],
  lane: 1.8,
  minWidth: 5,
  /** m: alcance dos bigodes (direita e frente). */
  side: 8,
  front: 14,
  /** Preferência pela direita: até `ahead` m à frente, de 1 a `side` m à direita; trava desfeita em `wait` s. */
  yield: { ahead: 14, side: 12, wait: 4, go: 3, signal: 25 },
  /** Travado só por carros: depois de `after` s parado, sai (ou o ônibus com o avatar passa por `ghost` s). */
  stuck: { after: 8, ghost: 3 },
  /** m: distância de frenagem atrás de outro carro ou do avatar. */
  gap: 9,
  /** rad/s por metro de erro na faixa, amortecimento (rad/s por m/s de erro) e a virada máxima. */
  gain: 0.5,
  damp: 0.6,
  turn: 1.4,
  /** m além da faixa: a direita mais longe que isso é uma abertura (cruzamento ou rua que sai). */
  openAt: 2.5,
  fpsLow: 45,
  fpsHigh: 55,
  /** Ônibus: meio comprimento (m), velocidade (m/s), tempo parado (s), frenagem até o ponto (m/s²). */
  bus: { half: 5.5, speed: 8, dwell: 7, brake: 1.5, minCars: 3 },
};

/** Distância (m) de (x, z) até o fim da rua na direção h, amostrada a cada 0,25 m até `max`. */
export function reach(isRoad, x, z, h, max) {
  const sx = Math.sin(h), sz = Math.cos(h);
  for (let d = 0.25; d <= max; d += 0.25) if (!isRoad(x + sx * d, z + sz * d)) return d - 0.25;
  return max;
}

/** Direita do rumo h (frente = (sin h, cos h); somar ao rumo vira à esquerda). */
export const rightOf = (h) => h - Math.PI / 2;

/**
 * Um passo de direção: devolve o novo rumo e o estado (`straight`: segue reto numa abertura à direita).
 * `choose()` sorteia, na abertura, se entra (true) ou segue reto (false).
 */
export function drive(isRoad, car, dt, opt = CARS, choose = () => Math.random() < 0.5) {
  const { x, z } = car;
  const dR = reach(isRoad, x, z, rightOf(car.heading), opt.side);
  const dF = reach(isRoad, x, z, car.heading, opt.front);
  let rate = 0;
  if (dF < 6) {
    // Fim da rua ou T: vira para o lado com mais rua.
    const dL = reach(isRoad, x, z, car.heading + Math.PI / 2, opt.side);
    rate = dL > dR ? opt.turn : -opt.turn;
    car.straight = false;
  } else if (dR > opt.lane + opt.openAt) {
    // A direita abriu: decide uma vez por abertura.
    if (car.opening !== true) {
      car.opening = true;
      car.straight = !choose();
    }
    rate = car.straight ? 0 : -opt.turn * 0.6;
  } else {
    car.opening = false;
    car.straight = false;
    // Corrige o erro da faixa, amortecido pela velocidade com que ele muda (sem ziguezague).
    const dErr = car.lastR === undefined || !dt ? 0 : (dR - car.lastR) / dt;
    rate = -opt.gain * (dR - opt.lane) - opt.damp * dErr;
  }
  car.lastR = dR;
  rate = Math.max(-opt.turn, Math.min(opt.turn, rate));
  car.heading += rate * dt;
  return { dR, dF, rate };
}

/**
 * Preferência pela direita (cruzamento sem semáforo): `car` espera se outro carro cruza o caminho dele
 * vindo pela direita, perto e indo para o caminho dele. Quem já está esperando (`giving`) e parado não
 * segura os outros (senão ninguém sai).
 */
export function mustYield(car, others, opt = CARS) {
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  for (const o of others) {
    if (o === car) continue;
    const ofx = Math.sin(o.heading), ofz = Math.cos(o.heading);
    if (Math.abs(fx * ofx + fz * ofz) > 0.5) continue; // mesma rua (ou contramão): não cruza
    const dx = o.x - car.x, dz = o.z - car.z;
    const along = dx * fx + dz * fz;
    const lat = dx * fz - dz * fx; // negativo: à direita
    if (along < -2 || along > opt.yield.ahead) continue;
    if (lat > -1 || lat < -opt.yield.side) continue;
    // Indo para a esquerda de `car`, isto é, para o caminho dele.
    if (ofx * fz - ofz * fx < 0.5) continue;
    if (o.giving && o.speed < 0.5) continue;
    return true;
  }
  return false;
}

/** Rumo ao longo da rua em (x, z): o de maior alcance para a frente e para trás (16 direções). */
export function roadHeading(isRoad, x, z, max = 30) {
  let best = 0, len = -1;
  for (let i = 0; i < 8; i++) {
    const h = (i * Math.PI) / 8;
    const l = Math.min(reach(isRoad, x, z, h, max), reach(isRoad, x, z, h + Math.PI, max));
    if (l > len) { len = l; best = h; }
  }
  return best;
}

/** Peças do carro, compartilhadas: carroceria, cabine, roda e farol. */
function parts(THREE) {
  const body = new THREE.BoxGeometry(1.8, 0.7, 4.2);
  body.translate(0, 0.65, 0);
  const cabin = new THREE.BoxGeometry(1.6, 0.6, 2.1);
  cabin.translate(0, 1.3, -0.2);
  const wheel = new THREE.CylinderGeometry(0.34, 0.34, 0.25, 14);
  wheel.rotateZ(Math.PI / 2);
  const lamp = new THREE.BoxGeometry(0.35, 0.15, 0.05);
  const busBody = new THREE.BoxGeometry(2.5, 2.5, 11);
  busBody.translate(0, 1.6, 0);
  const busGlass = new THREE.BoxGeometry(2.54, 0.8, 10.2);
  busGlass.translate(0, 2.15, 0.1);
  return {
    body, cabin, wheel, lamp, busBody, busGlass,
    busPaint: new THREE.MeshStandardMaterial({ color: 0x2a7f62, roughness: 0.4, metalness: 0.3 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1b2633, roughness: 0.15, metalness: 0.6 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }),
    front: new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2c0, emissiveIntensity: 0.6 }),
    back: new THREE.MeshStandardMaterial({ color: 0xa01010, emissive: 0x700000, emissiveIntensity: 0.5 }),
  };
}

const PAINT = [0xe8e8e8, 0x1d1d1f, 0x8a8f96, 0xb3202a, 0x234a8c, 0x2d6a4f, 0xd8b23a, 0x5a3a2a];

export function createTraffic({ THREE, scene, streetView, graph = () => null, walkers = () => [], stops = () => streetView.busStops?.() ?? [], signals = () => [], extra = () => [], opt = CARS, rand = Math.random }) {
  const group = new THREE.Group();
  group.name = 'transito';
  scene.add(group);
  const P = parts(THREE);
  const paints = PAINT.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.5 }));
  const cars = [];
  let target = opt.start;
  const fps = { frames: 0, time: 0, value: 60 };
  const stats = { spawned: 0, removed: 0, yields: 0, busStops: 0, redStops: 0, junctionWaits: 0, unstuck: 0, turns: {}, minCarGap: Infinity };
  let clock = 0;
  /** O avatar está no ônibus (viagem.js): o ônibus não sai da cena e ninguém freia pelo avatar. */
  let riding = false;
  const isRoad = (x, z) => streetView.isRoad(x, z);

  /** Ônibus: carroceria, faixa de janelas, 6 rodas e os faróis nas pontas. */
  function busModel() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(P.busBody, P.busPaint), new THREE.Mesh(P.busGlass, P.glass));
    for (const wz of [3.8, -2.6, -3.8]) {
      for (const wx of [-1.2, 1.2]) {
        const w = new THREE.Mesh(P.wheel, P.tire);
        w.position.set(wx, 0.4, wz);
        w.scale.setScalar(1.2);
        g.add(w);
      }
    }
    for (const s of [-0.8, 0.8]) {
      const f = new THREE.Mesh(P.lamp, P.front);
      f.position.set(s, 0.9, 5.51);
      const b = new THREE.Mesh(P.lamp, P.back);
      b.position.set(s, 1.0, -5.51);
      g.add(f, b);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  function model() {
    const g = new THREE.Group();
    const paint = paints[Math.floor(rand() * paints.length)];
    g.add(new THREE.Mesh(P.body, paint), new THREE.Mesh(P.cabin, P.glass));
    for (const [wx, wz] of [[-0.85, 1.35], [0.85, 1.35], [-0.85, -1.35], [0.85, -1.35]]) {
      const w = new THREE.Mesh(P.wheel, P.tire);
      w.position.set(wx, 0.34, wz);
      g.add(w);
    }
    for (const s of [-0.6, 0.6]) {
      const f = new THREE.Mesh(P.lamp, P.front);
      f.position.set(s, 0.75, 2.11);
      const b = new THREE.Mesh(P.lamp, P.back);
      b.position.set(s, 0.8, -2.11);
      g.add(f, b);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  // ---------- Faixas (vias.js) ----------
  let net = null;
  let netGraph = null;
  /** Cruzamento ocupado: chave do nó (posição) → os carros dentro, com a faixa de onde vieram. */
  const junctions = new Map();
  const nodeKey = (n) => `${Math.round(n.x)},${Math.round(n.z)}`;
  let nextId = 1;

  /** Ponto mais perto de (x, z) numa linha: {d, s} (distância e quanto andou até ele). */
  function project(pts, x, z) {
    let best = { d: Infinity, s: 0 }, run = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz, l = Math.sqrt(l2);
      const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)) : 0;
      const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
      if (d < best.d) best = { d, s: run + l * t };
      run += l;
    }
    return best;
  }

  /** A faixa do grafo de agora em que o carro está (até 3 m, no mesmo sentido), ou null. */
  function snap(x, z, heading) {
    let best = null;
    for (const l of net?.lanes ?? []) {
      const p = project(l.pts, x, z);
      if (p.d > 3) continue;
      const h = along(l.pts, p.s).h;
      if (Math.cos(h - heading) < 0.7) continue;
      if (!best || p.d < best.d) best = { lane: l, s: p.s, d: p.d };
    }
    return best;
  }

  /** Grafo novo: as faixas são refeitas, e cada carro numa faixa passa para a faixa nova dele. */
  function refreshNet() {
    const g = graph();
    if (!g || g === netGraph) return;
    netGraph = g;
    net = buildLanes(g);
    for (const c of cars) {
      if (c.conn) continue; // no meio do cruzamento: termina a curva e procura a faixa na saída
      const sn = snap(c.x, c.z, c.heading);
      if (sn) {
        c.lane = sn.lane;
        c.seg = sn.lane;
        c.s = sn.s;
        c.next = null;
      }
    }
  }

  function addCar(lane, s, bus) {
    const obj = bus ? busModel() : model();
    const cruise = bus ? opt.bus.speed : opt.speed[0] + rand() * (opt.speed[1] - opt.speed[0]);
    const p = along(lane.pts, s);
    const car = { id: nextId++, obj, bus, half: bus ? opt.bus.half : 2.1, lane, seg: lane, s, conn: null, next: null, x: p.x, z: p.z, heading: p.h, speed: cruise * 0.6, cruise, dwell: 0 };
    obj.position.set(p.x, streetView.groundY(), p.z);
    obj.rotation.y = p.h;
    group.add(obj);
    cars.push(car);
    stats.spawned++;
    return car;
  }

  /** Nasce numa faixa, entre `near` e `spawn` m do avatar, longe dos outros carros. */
  function spawn(a, bus = false) {
    const lanes = (net?.lanes ?? []).filter((l) => l.length > 12 && l.width >= opt.minWidth);
    for (let t = 0; t < 30 && lanes.length; t++) {
      const lane = lanes[Math.floor(rand() * lanes.length)];
      const s = 3 + rand() * (lane.length - 6);
      const p = along(lane.pts, s);
      const d = Math.hypot(p.x - a.x, p.z - a.z);
      if (d < opt.near || d > opt.spawn) continue;
      if (cars.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < 15)) continue;
      return addCar(lane, s, bus);
    }
    return null;
  }

  function remove(i) {
    const [car] = cars.splice(i, 1);
    if (car.junction) junctions.get(car.junction)?.delete(car);
    group.remove(car.obj);
    stats.removed++;
  }

  /** Pode entrar no cruzamento: vazio, ou só com carros que vieram da mesma faixa (a fila). */
  function junctionFree(car) {
    const node = net?.nodes.get(car.lane.to);
    if (!node || node.edges.length < 3) return true;
    const inside = junctions.get(nodeKey(node));
    if (!inside || !inside.size) return true;
    for (const o of inside) if (o.entry !== car.lane.id) return false;
    return true;
  }

  /**
   * Os obstáculos à frente, para o IDM: o carro da frente (mais perto, no caminho, até 60 m), o carro do
   * jogador estacionado, o avatar na rua, quem atravessa, o sinal fechado, o ponto de ônibus e a entrada do
   * cruzamento ocupado. Cada um dá {gap, v}; o mais exigente manda.
   */
  function accelOf(car, a) {
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    const rel = (x, z) => {
      const dx = x - car.x, dz = z - car.z;
      return { along: dx * fx + dz * fz, lat: Math.abs(dx * fz - dz * fx) };
    };
    let acc = idm(car.speed, car.cruise, Infinity, 0);
    car.carGap = Infinity;
    let minGap = Infinity;
    const take = (gap, vLead) => {
      acc = Math.min(acc, idm(car.speed, car.cruise, gap, car.speed - vLead));
      minGap = Math.min(minGap, gap);
    };
    // Pelo caminho: o da frente na mesma faixa, o que está no começo da faixa de saída (somando o que falta da
    // curva) e o da frente na mesma curva. Na curva, o da frente fica de lado do rumo e o cone abaixo não o vê.
    const exit = car.next?.lane ?? null;
    for (const o of cars) {
      if (o === car) continue;
      let d = null;
      if (!car.conn && !o.conn && o.lane === car.lane && o.s > car.s) d = o.s - car.s;
      else if (!car.conn && exit && !o.conn && o.lane === exit) d = car.lane.length - car.s + (car.nextLen ?? 8) + o.s;
      else if (car.conn && exit && !o.conn && o.lane === exit) d = car.conn.length - car.s + o.s;
      else if (car.conn && o.conn && o.connKey === car.connKey && o.s > car.s) d = o.s - car.s;
      if (d === null || d > 60) continue;
      const g = d - car.half - o.half;
      car.carGap = Math.min(car.carGap ?? Infinity, g);
      take(g, o.speed);
    }
    for (const o of cars) {
      if (o === car) continue;
      const r = rel(o.x, o.z);
      if (r.along <= 0 || r.along > 60 || r.lat > 1.8) continue;
      // Quem espera na linha de outra faixa não está no caminho (só a fila dele e a faixa de saída contam).
      if (o.waiting && o.lane !== car.lane && o.lane !== exit) continue;
      // Do da frente, conta só a velocidade no mesmo sentido (o que cruza conta como parado).
      take(r.along - car.half - o.half, Math.max(0, o.speed * Math.cos(o.heading - car.heading)));
    }
    for (const o of extra()) {
      const r = rel(o.x, o.z);
      if (r.along > 0 && r.along < 40 && r.lat < 1.8) take(r.along - car.half - 2.1, 0);
    }
    if (!riding && isRoad(a.x, a.z)) {
      const r = rel(a.x, a.z);
      if (r.along > 0 && r.along < 40 && r.lat < 2.2) take(r.along - car.half - 0.5, 0);
    }
    car.yielding = false;
    for (const w of walkers()) {
      const r = rel(w.x, w.z);
      if (r.along > 0 && r.along < 30 && r.lat < 4.5) {
        take(r.along - car.half - 1.5, 0);
        car.yielding = true;
      }
    }
    const line = signalLine(car);
    if (line !== null) take(line, 0);
    if (car.bus) {
      const stop = busGap(car);
      if (stop !== null) take(stop, 0);
    }
    // Entrada do cruzamento: com ele ocupado por quem vem de outra faixa, para 1 m antes do fim da faixa.
    car.waiting = false;
    if (!car.conn && car.next) {
      const left = car.lane.length - car.s;
      if (left < 25 && !junctionFree(car)) {
        take(left - car.half - 1, 0);
        car.waiting = true;
      }
    }
    car.gapAhead = minGap;
    return { acc, minGap };
  }

  /** Sinal à frente: a distância até a linha de parada (vermelho, ou amarelo com mais de 4 m), ou null. */
  function signalLine(c) {
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    let best = null;
    c.redLight = false;
    for (const s of signals()) {
      if (s.state === 'green') continue;
      if (Math.abs(fx * s.dir[0] + fz * s.dir[1]) > 0.5) continue;
      const dx = s.x - c.x, dz = s.z - c.z;
      const ahead = dx * fx + dz * fz;
      if (ahead < 0 || ahead > 40) continue;
      if (Math.abs(dx * fz - dz * fx) > s.width / 2 + 0.5) continue;
      const line = ahead - s.depth / 2 - 1 - c.half;
      if (line < -0.5) continue;
      if (s.state === 'yellow' && line < 4) continue;
      c.redLight = true;
      best = best === null ? line : Math.min(best, line);
    }
    return best;
  }

  /** Ônibus: a distância até a parada do ponto à frente (ou 0, parado nele), ou null. */
  function busGap(c) {
    if (c.dwell > 0) return 0;
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    let best = null;
    for (const s of stops()) {
      if (s.key === c.lastStop) continue;
      const dx = s.bay.x - c.x, dz = s.bay.z - c.z;
      const ahead = dx * fx + dz * fz;
      if (ahead < -0.5 || ahead > 40 || Math.abs(dx * fz - dz * fx) > 2.5) continue;
      if (ahead < 0.8 && c.speed < 1) {
        c.dwell = opt.bus.dwell;
        c.stopKey = s.key;
        stats.busStops++;
        return 0;
      }
      best = best === null ? Math.max(0, ahead - 0.3) : Math.min(best, ahead - 0.3);
    }
    return best;
  }

  /** Anda `ds` m pela faixa e pelo cruzamento; devolve false se o carro saiu da cena (fim da grade). */
  function advance(car, ds) {
    car.s += ds;
    for (let guard = 0; guard < 4 && car.s > car.seg.length; guard++) {
      car.s -= car.seg.length;
      if (car.conn) {
        // Saiu do cruzamento: libera e entra na faixa escolhida.
        junctions.get(car.junction)?.delete(car);
        car.junction = null;
        car.lane = car.next.lane;
        car.seg = car.lane;
        car.conn = null;
        car.next = null;
        continue;
      }
      if (!car.next) {
        // Fim da faixa sem continuação (borda da grade): sai da cena. O ônibus com o avatar volta.
        if (riding && car.bus && car.lane.reverse) {
          car.next = { lane: car.lane.reverse, turn: 'volta' };
        } else return false;
      }
      const node = net?.nodes.get(car.lane.to);
      car.conn = connector(car.lane, car.next.lane);
      car.connKey = `${car.lane.id}>${car.next.lane.id}`;
      car.seg = car.conn;
      stats.turns[car.next.turn] = (stats.turns[car.next.turn] ?? 0) + 1;
      if (node && node.edges.length >= 3) {
        car.junction = nodeKey(node);
        car.entry = car.lane.id;
        if (!junctions.has(car.junction)) junctions.set(car.junction, new Set());
        junctions.get(car.junction).add(car);
      }
    }
    const p = along(car.seg.pts, car.s);
    car.x = p.x;
    car.z = p.z;
    car.heading = p.h;
    return true;
  }

  function adapt(dt) {
    fps.frames++;
    fps.time += dt;
    if (fps.time < 2) return;
    fps.value = fps.frames / fps.time;
    fps.frames = 0;
    fps.time = 0;
    if (fps.value < opt.fpsLow) target = Math.max(opt.min, target - 2);
    else if (fps.value > opt.fpsHigh) target = Math.min(opt.max, target + 1);
  }

  /**
   * Um quadro: em passos de até 0,05 s (no máximo 10), para o IDM não passar do ponto quando o quadro é longo
   * (página em segundo plano, celular lento).
   */
  function update(dt) {
    const on = streetView.active();
    group.visible = on;
    if (!on || !dt) return;
    adapt(dt);
    const n = Math.min(10, Math.ceil(dt / 0.05));
    for (let i = 0; i < n; i++) step(Math.min(dt, 0.5) / n);
  }

  function step(dt) {
    clock += dt;
    refreshNet();
    if (!net) return;
    const a = streetView.position();
    for (let i = cars.length - 1; i >= 0; i--) {
      const c = cars[i];
      if (riding && c.bus) continue;
      // Parado dentro do cruzamento por mais de 30 s (um nó que o cruzamento um por vez não deveria deixar
      // acontecer): sai. Esperar na fila do sinal ou da entrada do cruzamento não conta.
      if (c.stuckT > 30) {
        stats.unstuck++;
        remove(i);
        continue;
      }
      if (Math.hypot(c.x - a.x, c.z - a.z) > opt.despawn || cars.length > target) remove(i);
    }
    // Com 3 carros ou mais, um é ônibus.
    if (cars.length < target) spawn(a, target >= opt.bus.minCars && !cars.some((c) => c.bus));
    for (let i = cars.length - 1; i >= 0; i--) {
      const c = cars[i];
      // Escolhe a saída do cruzamento com antecedência (a seta, e para saber se o cruzamento está livre).
      if (!c.conn && !c.next && c.lane.length - c.s < 30 && net.nodes.has(c.lane.to)) {
        const n = net.nodes.get(c.lane.to);
        c.next = n.kind === 'borda' ? null : chooseNext(net, c.lane, rand);
        c.nextLen = c.next ? connector(c.lane, c.next.lane).length : null;
      }
      if (c.dwell > 0) {
        c.dwell -= dt;
        if (c.dwell <= 0) c.lastStop = c.stopKey;
      }
      const wasRed = c.redLight, wasYielding = c.yielding, wasWaiting = c.waiting;
      const { acc, minGap } = accelOf(c, a);
      if (c.redLight && !wasRed) stats.redStops++;
      if (c.yielding && !wasYielding) stats.yields++;
      if (c.waiting && !wasWaiting) stats.junctionWaits++;
      c.speed = Math.max(0, Math.min(c.cruise, c.speed + acc * dt));
      // Perto demais do da frente (menos de 1,5 m): não anda. Nunca sobrepõe.
      if (minGap < 1.5) c.speed = 0;
      if (c.dwell > 0) c.speed = 0;
      stats.minCarGap = Math.min(stats.minCarGap, c.carGap);
      c.stuckT = c.conn && c.speed < 0.1 && !c.yielding ? (c.stuckT ?? 0) + dt : 0;
      if (!advance(c, c.speed * dt)) {
        remove(i);
        continue;
      }
      c.obj.position.set(c.x, streetView.groundY(), c.z);
      c.obj.rotation.y = c.heading;
    }
  }

  return {
    group,
    update,
    /** Para testes: quantos, o alvo pelo FPS, as contagens e cada carro. */
    debug: () => ({
      count: cars.length,
      target,
      fps: Math.round(fps.value),
      stats: { ...stats, turns: { ...stats.turns }, minCarGap: +stats.minCarGap.toFixed(2) },
      lanes: net?.lanes.length ?? 0,
      junctionsBusy: [...junctions.values()].filter((v) => v.size).length,
      cars: cars.map((c) => ({ id: c.id, x: c.x, z: c.z, heading: c.heading, speed: c.speed, bus: c.bus, dwelling: c.dwell > 0, red: !!c.redLight, waiting: !!c.waiting, inJunction: !!c.conn, lane: c.lane.id, gap: Number.isFinite(c.carGap) ? +c.carGap.toFixed(2) : null, onRoad: isRoad(c.x, c.z), right: reach(isRoad, c.x, c.z, rightOf(c.heading), opt.side) })),
    }),
    setTarget: (n) => { target = Math.max(0, Math.min(opt.max, n)); },
    /** Para testes: põe o ônibus em (x, z) com o rumo dado (tira o que houver). */
    placeBus: (x, z, heading) => {
      refreshNet();
      const sn = snap(x, z, heading);
      if (!sn) return false;
      for (let i = cars.length - 1; i >= 0; i--) if (cars[i].bus) remove(i);
      addCar(sn.lane, sn.s, true).speed = opt.bus.speed;
      return true;
    },
    /** Onde estão os carros e a que velocidade (os pedestres esperam no meio-fio). */
    positions: () => cars.map((c) => ({ x: c.x, z: c.z, speed: c.speed, bus: c.bus })),
    /** O ônibus da cena (há no máximo um): posição, rumo, se está parado, em que ponto e a porta. */
    busState: () => {
      const c = cars.find((x) => x.bus);
      if (!c) return null;
      const r = rightOf(c.heading);
      return {
        x: c.x, z: c.z, heading: c.heading, dwelling: c.dwell > 0, stopKey: c.dwell > 0 ? c.stopKey : null,
        door: { x: c.x + Math.sin(r) * 1.4 + Math.sin(c.heading) * 3.5, z: c.z + Math.cos(r) * 1.4 + Math.cos(c.heading) * 3.5 },
      };
    },
    setRiding: (on) => { riding = !!on; },
    /** Ônibus parados no ponto, com a porta (do lado da calçada, perto da frente). */
    buses: () =>
      cars
        .filter((c) => c.bus && c.dwell > 0)
        .map((c) => {
          const r = rightOf(c.heading);
          return { x: c.x, z: c.z, door: { x: c.x + Math.sin(r) * 1.4 + Math.sin(c.heading) * 3.5, z: c.z + Math.cos(r) * 1.4 + Math.cos(c.heading) * 3.5 } };
        }),
  };
}
