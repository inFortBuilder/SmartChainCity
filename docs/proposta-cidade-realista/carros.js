// Trânsito nas ruas (fase 3 do mundo aberto, docs/desenvolvimento/mundo-aberto-terceira-pessoa.md).
//
// Carros do cliente, não jogadores: cada navegador sorteia os seus. O OSM da cidade só traz o polígono
// das ruas (sem a linha do meio), então o carro se guia pelo próprio chão, como quem dirige olhando o
// meio-fio:
// - mão direita: um "bigode" para a direita mede a distância até o fim da rua, e o carro corrige o rumo
//   para ficar a `lane` metros dele (o meio da faixa da direita);
// - quando a direita abre (mais de `openAt` m além da faixa: cruzamento ou rua que sai), sorteia: segue reto até a direita fechar de novo,
//   ou entra à direita;
// - quando a frente fecha (fim da rua, T), vira para o lado que tem mais rua;
// - freia atrás de outro carro e para na frente do avatar, se ele estiver na rua, e do pedestre que
//   atravessa na faixa (`walkers()`, de pedestres.js);
// - no semáforo (semaforos.js), para antes da faixa no vermelho, e no amarelo se ainda dá (mais de 4 m).
// Nascem numa rua de pelo menos 5 m de largura, entre 30 m e 70 m do avatar, e somem a 90 m.
// O carro é uma peça procedural (carroceria, cabine, rodas, faróis), de cor sorteada, até haver o modelo
// CC0 do SCC Kit. A quantidade segue o FPS, como os pedestres.
//
// Ônibus: com 3 carros ou mais, um deles é ônibus (11 m). Ele anda como os carros e, com um ponto de
// ônibus (onibus.js) à frente na faixa dele, freia até a parada (`bay`) e fica 7 s com a porta aberta;
// quem espera no ponto embarca (pedestres.js). Depois segue, e não para de novo no mesmo ponto.
//
// PREMISSAS: até 10 carros, 7 a 10 m/s (25 a 36 km/h), faixa a 1,8 m do meio-fio da direita; um ônibus
// de 11 m a 8 m/s, 7 s parado no ponto, frenagem de 1,5 m/s² até ele.

export const CARS = {
  max: 10,
  min: 2,
  start: 6,
  near: 30,
  spawn: 70,
  despawn: 90,
  speed: [7, 10],
  lane: 1.8,
  minWidth: 5,
  /** m: alcance dos bigodes (direita e frente). */
  side: 8,
  front: 14,
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

export function createTraffic({ THREE, scene, streetView, walkers = () => [], stops = () => streetView.busStops?.() ?? [], signals = () => [], opt = CARS, rand = Math.random }) {
  const group = new THREE.Group();
  group.name = 'transito';
  scene.add(group);
  const P = parts(THREE);
  const paints = PAINT.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.5 }));
  const cars = [];
  let target = opt.start;
  const fps = { frames: 0, time: 0, value: 60 };
  const stats = { spawned: 0, removed: 0, brakes: 0, straight: 0, turnsRight: 0, yields: 0, busStops: 0, redStops: 0 };
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

  function spawn(a, bus = false) {
    for (let t = 0; t < 30; t++) {
      const ang = rand() * Math.PI * 2;
      const d = opt.near + rand() * (opt.spawn - opt.near);
      const x = a.x + Math.sin(ang) * d, z = a.z + Math.cos(ang) * d;
      if (!isRoad(x, z)) continue;
      let h = roadHeading(isRoad, x, z);
      const width = reach(isRoad, x, z, h + Math.PI / 2, 20) + reach(isRoad, x, z, h - Math.PI / 2, 20);
      if (width < opt.minWidth) continue;
      if (rand() < 0.5) h += Math.PI;
      // Para a faixa da direita: anda de lado até ficar a `lane` m do meio-fio.
      const dR = reach(isRoad, x, z, rightOf(h), 20);
      const shift = dR - opt.lane;
      const px = x + Math.sin(rightOf(h)) * shift, pz = z + Math.cos(rightOf(h)) * shift;
      if (!isRoad(px, pz)) continue;
      if (cars.some((c) => Math.hypot(c.x - px, c.z - pz) < opt.gap * 1.5)) continue;
      const obj = bus ? busModel() : model();
      const cruise = bus ? opt.bus.speed : opt.speed[0] + rand() * (opt.speed[1] - opt.speed[0]);
      const car = { obj, bus, half: bus ? opt.bus.half : 2.1, x: px, z: pz, heading: h, speed: 0, cruise, opening: false, straight: false, dwell: 0 };
      obj.position.set(px, streetView.groundY(), pz);
      obj.rotation.y = h;
      group.add(obj);
      cars.push(car);
      stats.spawned++;
      return true;
    }
    return false;
  }

  function remove(i) {
    const [car] = cars.splice(i, 1);
    group.remove(car.obj);
    stats.removed++;
  }

  /** Alguém na frente (até `gap` m, numa faixa de 1,4 m para carros, 2,6 m para o avatar e 4,5 m para quem atravessa): o carro freia. */
  function blockedAhead(car, a) {
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    // `extra`: o comprimento a mais (o ônibus é mais longo que o carro de 4,2 m).
    const ahead = (x, z, r, extra = car.half - 2.1) => {
      const dx = x - car.x, dz = z - car.z;
      const along = dx * fx + dz * fz;
      return along > 0 && along < opt.gap + extra && Math.abs(dx * fz - dz * fx) < r;
    };
    // O avatar na rua: faixa larga (o carro corrige a faixa e não pode escapar dele) e parada firme a menos de 5 m.
    if (isRoad(a.x, a.z)) {
      const dx = a.x - car.x, dz = a.z - car.z;
      if (ahead(a.x, a.z, 2.6) || (dx * fx + dz * fz > 0 && Math.hypot(dx, dz) < 5)) return true;
    }
    // Pedestre atravessando: para se ele está em qualquer ponto da rua à frente (4,5 m para cada lado),
    // não só na faixa do carro, porque ele vai cruzar as duas.
    if (walkers().some((w) => ahead(w.x, w.z, 4.5))) {
      car.yielding = true;
      return true;
    }
    return cars.some((o) => o !== car && ahead(o.x, o.z, 1.4, car.half + o.half - 4.2));
  }

  /**
   * Semáforo à frente: a velocidade máxima para parar antes da faixa (vermelho, ou amarelo com mais de 4 m
   * até a linha), ou Infinity. Só conta a faixa que o carro vai cruzar (a rua dele, até 25 m).
   */
  function signalSpeed(c) {
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    let best = Infinity;
    c.redLight = false;
    for (const s of signals()) {
      if (s.state === 'green') continue;
      // A faixa atravessa a rua do carro: o rumo dele é perpendicular à travessia.
      if (Math.abs(fx * s.dir[0] + fz * s.dir[1]) > 0.5) continue;
      const dx = s.x - c.x, dz = s.z - c.z;
      const along = dx * fx + dz * fz;
      if (along < 0 || along > 25) continue;
      if (Math.abs(dx * fz - dz * fx) > s.width / 2 + 0.5) continue;
      const line = along - s.depth / 2 - 1 - c.half;
      if (line < -0.5) continue; // já passou da linha: segue
      if (s.state === 'yellow' && line < 4) continue;
      c.redLight = true;
      best = Math.min(best, Math.sqrt(2 * 3 * Math.max(0, line)));
    }
    return best;
  }

  /** Ônibus: velocidade máxima para parar no ponto à frente, ou parado no ponto. */
  function busSpeed(c, dt) {
    if (c.dwell > 0) {
      c.dwell -= dt;
      if (c.dwell <= 0) c.lastStop = c.stopKey;
      return 0;
    }
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    let best = Infinity;
    for (const s of stops()) {
      if (s.key === c.lastStop) continue;
      const dx = s.bay.x - c.x, dz = s.bay.z - c.z;
      const along = dx * fx + dz * fz;
      const lat = Math.abs(dx * fz - dz * fx);
      if (along < -0.5 || along > 35 || lat > 2.5) continue;
      if (along < 0.6) {
        c.dwell = opt.bus.dwell;
        c.stopKey = s.key;
        stats.busStops++;
        return 0;
      }
      best = Math.min(best, Math.sqrt(2 * opt.bus.brake * Math.max(0, along - 0.3)));
    }
    return best;
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

  function update(dt) {
    const on = streetView.active();
    group.visible = on;
    if (!on || !dt) return;
    adapt(dt);
    const a = streetView.position();
    for (let i = cars.length - 1; i >= 0; i--) {
      const c = cars[i];
      if (Math.hypot(c.x - a.x, c.z - a.z) > opt.despawn || !isRoad(c.x, c.z) || cars.length > target) remove(i);
    }
    // Com 3 carros ou mais, um é ônibus.
    if (cars.length < target) spawn(a, target >= opt.bus.minCars && !cars.some((c) => c.bus));
    for (const c of cars) {
      const wasOpen = c.opening;
      drive(isRoad, c, dt, opt, () => rand() < 0.5);
      if (c.opening && !wasOpen) stats[c.straight ? 'straight' : 'turnsRight']++;
      const wasYielding = c.yielding;
      c.yielding = false;
      const stop = blockedAhead(c, a);
      if (c.yielding && !wasYielding) stats.yields++;
      if (stop && c.speed > 1) stats.brakes++;
      // Acelera devagar e freia forte.
      let want = stop ? 0 : c.cruise;
      if (c.bus) want = Math.min(want, busSpeed(c, dt));
      const wasRed = c.redLight;
      want = Math.min(want, signalSpeed(c));
      if (c.redLight && !wasRed) stats.redStops++;
      c.speed += (want - c.speed) * Math.min(1, dt * (want < c.speed ? 4 : 0.8));
      c.x += Math.sin(c.heading) * c.speed * dt;
      c.z += Math.cos(c.heading) * c.speed * dt;
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
      stats: { ...stats },
      cars: cars.map((c) => ({ x: c.x, z: c.z, heading: c.heading, speed: c.speed, bus: c.bus, dwelling: c.dwell > 0, red: !!c.redLight, onRoad: isRoad(c.x, c.z), right: reach(isRoad, c.x, c.z, rightOf(c.heading), opt.side) })),
    }),
    setTarget: (n) => { target = Math.max(0, Math.min(opt.max, n)); },
    /** Para testes: põe o ônibus em (x, z) com o rumo dado (tira o que houver). */
    placeBus: (x, z, heading) => {
      for (let i = cars.length - 1; i >= 0; i--) if (cars[i].bus) remove(i);
      const obj = busModel();
      cars.push({ obj, bus: true, half: opt.bus.half, x, z, heading, speed: opt.bus.speed, cruise: opt.bus.speed, opening: false, straight: false, dwell: 0 });
      obj.position.set(x, streetView.groundY(), z);
      obj.rotation.y = heading;
      group.add(obj);
    },
    /** Onde estão os carros e a que velocidade (os pedestres esperam no meio-fio). */
    positions: () => cars.map((c) => ({ x: c.x, z: c.z, speed: c.speed })),
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
