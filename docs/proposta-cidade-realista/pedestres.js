// Pedestres nas calçadas (fase 3 do mundo aberto, docs/desenvolvimento/mundo-aberto-terceira-pessoa.md).
//
// Gente do cliente, não jogadores: cada navegador sorteia os seus, e eles não vão pelo realtime.
// - Nascem numa célula de calçada da grade do street view (tipo 2), entre 12 m e 35 m do avatar,
//   fora da vista curta, e somem passando de 45 m (ou quando a grade é refeita e ficam fora dela).
// - Andam em linha reta pela calçada. Se o chão 0,9 m à frente não é calçada, ou se há alguém perto
//   (outro pedestre ou o avatar), viram: tentam ±30°, ±60°… até 180°, o menor ângulo que dá. Às vezes
//   param uns segundos, e às vezes conversam parados.
// - O corpo é o manequim da UAL (Man ou Woman, sorteado) com a cor da roupa sorteada.
// - A quantidade segue o FPS: abaixo de 45, tira 4 (até 4); acima de 55, põe 2 (até 24).
// - Na ponta de uma faixa de pedestre (faixas.js), metade atravessa: espera no meio-fio até não haver
//   carro andando a menos de 12 m da faixa (desiste depois de 8 s) e cruza em linha reta até a outra
//   calçada. Enquanto atravessa, os carros param para ele (carros.js, `walkers`).
//
// PREMISSAS: até 24 pedestres, 1,1 a 1,5 m/s, raio de 12 a 35 m, somem a 45 m, FPS alvo de 45 a 55;
// metade atravessa na faixa, rua livre de carros a 12 m, espera de até 8 s.

export const PEDS = {
  max: 24,
  min: 4,
  start: 12,
  near: 12,
  spawn: 35,
  despawn: 45,
  speed: [1.1, 1.5],
  look: 0.9,
  personal: 0.9,
  fpsLow: 45,
  fpsHigh: 55,
  /** Chance por segundo de parar (e de conversar, entre os que param). */
  stop: 0.04,
  talk: 0.3,
  /** Travessia: chance na ponta da faixa, alcance da ponta (m), carro perto (m) e espera máxima (s). */
  cross: 0.5,
  crossReach: 1.2,
  carClear: 12,
  crossWait: 8,
};

/** Cores de roupa (tons de tecido, sem o roxo do manequim). */
const CLOTHES = [0x3b5b8c, 0x8c3b3b, 0x3b7a57, 0x6b6b6b, 0xc9a227, 0x2f2f3a, 0xb36b2e, 0x7a4e8c, 0xd9d4c7, 0x4d7f9a];

/**
 * Para onde virar: o rumo (rad) mais perto do atual em que o ponto `look` metros à frente é livre,
 * ou null se nenhum dá. `free(x, z)` diz se o ponto é calçada sem ninguém.
 */
export function steer(free, x, z, heading, look = PEDS.look, side = 1) {
  for (let i = 0; i <= 6; i++) {
    for (const s of i === 0 || i === 6 ? [1] : [side, -side]) {
      const h = heading + s * i * (Math.PI / 6);
      if (free(x + Math.sin(h) * look, z + Math.cos(h) * look)) return h;
    }
  }
  return null;
}

/** Uma célula de calçada sorteada entre `near` e `far` metros de (ax, az), ou null. */
export function pickSidewalk(walk, ax, az, near, far, rand = Math.random, tries = 60) {
  for (let t = 0; t < tries; t++) {
    const a = rand() * Math.PI * 2;
    const d = near + rand() * (far - near);
    const x = ax + Math.sin(a) * d, z = az + Math.cos(a) * d;
    if (walk.at(x, z) === 2) return { x, z };
  }
  return null;
}

/**
 * Pontas das faixas: as duas calçadas de cada lado (meia largura da rua + 0,7 m do centro), só as que caem
 * na calçada. `key` identifica a faixa.
 */
export function crosswalkEnds(list, walk) {
  const out = [];
  for (const f of list) {
    const half = f.width / 2 + 0.7;
    const a = { x: f.x - f.dir[0] * half, z: f.z - f.dir[1] * half };
    const b = { x: f.x + f.dir[0] * half, z: f.z + f.dir[1] * half };
    if (walk.at(a.x, a.z) !== 2 || walk.at(b.x, b.z) !== 2) continue;
    out.push({ key: `${f.x.toFixed(1)},${f.z.toFixed(1)}`, x: f.x, z: f.z, dir: f.dir, depth: f.depth, a, b });
  }
  return out;
}

export function createPedestrians({ THREE, scene, streetView, cars = () => [], opt = PEDS, rand = Math.random }) {
  const group = new THREE.Group();
  group.name = 'pedestres';
  scene.add(group);
  const peds = [];
  let target = opt.start;
  let assets = null;
  const fps = { frames: 0, time: 0, value: 60 };
  const stats = { spawned: 0, removed: 0, turns: 0, blocked: 0, crossed: 0, waitedCar: 0, gaveUp: 0 };
  // Pontas das faixas, refeitas a cada segundo (a grade muda quando o avatar anda).
  let ends = [];
  let endsAt = -1;
  let clock = 0;
  /** Algum carro andando perto do centro da faixa. */
  const carNear = (x, z) => cars().some((c) => c.speed > 1 && Math.hypot(c.x - x, c.z - z) < opt.carClear);
  /** A ponta de faixa ao alcance de (x, z): de onde sai e para onde vai, com um desvio lateral sorteado. */
  function endNear(x, z) {
    for (const e of ends) {
      for (const [from, to] of [[e.a, e.b], [e.b, e.a]]) {
        if (Math.hypot(from.x - x, from.z - z) > opt.crossReach) continue;
        const side = (rand() - 0.5) * (e.depth - 1);
        const px = -e.dir[1] * side, pz = e.dir[0] * side;
        return { key: e.key, cx: e.x, cz: e.z, tx: to.x + px, tz: to.z + pz, waiting: true, waited: 0 };
      }
    }
    return null;
  }
  /** Na ponta de uma faixa, decide uma vez se atravessa (metade). A faixa de onde acabou de chegar não conta. */
  function crossingStart(ped, o) {
    const near = endNear(o.x, o.z);
    if (!near) ped.tried = null;
    if (ped.lastCw && near?.key !== ped.lastCw) ped.lastCw = null;
    if (!near || near.key === ped.tried || near.key === ped.lastCw) return false;
    ped.tried = near.key;
    if (rand() >= opt.cross) return false;
    ped.cross = near;
    return true;
  }

  Promise.all(['man', 'woman'].map((t) => streetView.avatarAssets(t)))
    .then((list) => { assets = list; })
    .catch(() => { assets = null; });

  const walkGrid = () => streetView.walkGrid?.();
  const avatarPos = () => streetView.position();

  function spawn(walk, a) {
    const p = pickSidewalk(walk, a.x, a.z, opt.near, opt.spawn, rand);
    if (!p) return false;
    const inst = streetView.makeAvatarFrom(assets[rand() < 0.5 ? 0 : 1]);
    const color = new THREE.Color(CLOTHES[Math.floor(rand() * CLOTHES.length)]);
    inst.body.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      o.material.color.copy(color);
      o.castShadow = false; // sombra só do avatar: 24 corpos a mais no mapa de sombra pesam
    });
    const obj = new THREE.Group();
    obj.add(inst.body);
    obj.position.set(p.x, streetView.floorAt(p.x, p.z), p.z);
    const speed = opt.speed[0] + rand() * (opt.speed[1] - opt.speed[0]);
    const ped = { obj, inst, heading: rand() * Math.PI * 2, speed, wait: 0, talking: false, side: rand() < 0.5 ? 1 : -1 };
    obj.rotation.y = ped.heading;
    inst.play('walk', 0);
    const w = inst.actions.walk;
    if (w) {
      w.timeScale = speed / 1.5;
      w.time = rand() * w.getClip().duration; // passos fora de compasso
    }
    group.add(obj);
    peds.push(ped);
    stats.spawned++;
    return true;
  }

  function remove(i) {
    const [ped] = peds.splice(i, 1);
    group.remove(ped.obj);
    ped.obj.traverse((o) => o.isMesh && o.material.dispose());
    ped.inst.mixer.stopAllAction();
    stats.removed++;
  }

  /** Ponto livre: calçada e ninguém a menos de `personal` m (fora o próprio pedestre). */
  const freeFor = (walk, me, a) => (x, z) => {
    if (walk.at(x, z) !== 2) return false;
    if (Math.hypot(x - a.x, z - a.z) < opt.personal + 0.3) return false;
    for (const o of peds) if (o !== me && Math.hypot(x - o.obj.position.x, z - o.obj.position.z) < opt.personal) return false;
    return true;
  };

  function adapt(dt) {
    fps.frames++;
    fps.time += dt;
    if (fps.time < 2) return;
    fps.value = fps.frames / fps.time;
    fps.frames = 0;
    fps.time = 0;
    if (fps.value < opt.fpsLow) target = Math.max(opt.min, target - 4);
    else if (fps.value > opt.fpsHigh) target = Math.min(opt.max, target + 2);
  }

  function update(dt) {
    const walk = walkGrid();
    const on = streetView.active() && !!walk && !!assets;
    group.visible = on;
    if (!on || !dt) return;
    adapt(dt);
    const a = avatarPos();
    // Some quem ficou longe ou fora da grade; nasce quem falta (um por quadro, sem engasgo).
    for (let i = peds.length - 1; i >= 0; i--) {
      const p = peds[i].obj.position;
      const offWalk = !peds[i].cross && walk.at(p.x, p.z) !== 2;
      if (Math.hypot(p.x - a.x, p.z - a.z) > opt.despawn || offWalk || peds.length > target) remove(i);
    }
    if (peds.length < target) spawn(walk, a);
    clock += dt;
    if (clock - endsAt > 1) {
      endsAt = clock;
      ends = crosswalkEnds(streetView.crosswalks?.()?.list ?? [], walk);
    }

    for (const ped of peds) {
      const o = ped.obj.position;
      if (ped.cross) {
        const c = ped.cross;
        if (c.waiting) {
          // No meio-fio: atravessa quando não há carro andando perto da faixa.
          c.waited += dt;
          if (!carNear(c.cx, c.cz)) {
            c.waiting = false;
            ped.inst.play('walk');
          } else if (c.waited > opt.crossWait) {
            ped.cross = null;
            ped.lastCw = c.key;
            ped.inst.play('walk');
            stats.gaveUp++;
          } else if (c.waited <= dt) stats.waitedCar++;
        } else {
          const dx = c.tx - o.x, dz = c.tz - o.z, d = Math.hypot(dx, dz);
          if (d < 0.3) {
            ped.cross = null;
            ped.lastCw = c.key;
            stats.crossed++;
            // Na outra calçada: segue para um lado dela.
            const h = steer(freeFor(walk, ped, a), o.x, o.z, ped.heading + (ped.side * Math.PI) / 2, opt.look, ped.side);
            if (h !== null) ped.heading = h;
          } else {
            ped.heading = Math.atan2(dx, dz);
            const step = Math.min(d, ped.speed * dt);
            o.x += (dx / d) * step;
            o.z += (dz / d) * step;
          }
        }
      } else if (ped.wait > 0) {
        ped.wait -= dt;
        if (ped.wait <= 0) { ped.talking = false; ped.inst.play('walk'); }
      } else if (rand() < opt.stop * dt) {
        ped.wait = 2 + rand() * 4;
        ped.talking = rand() < opt.talk;
        ped.inst.play(ped.talking ? 'talk' : 'idle');
      } else if (crossingStart(ped, o)) {
        // Na ponta da faixa: para no meio-fio e olha o trânsito.
        ped.inst.play('idle');
      } else {
        const free = freeFor(walk, ped, a);
        const ahead = (h) => free(o.x + Math.sin(h) * opt.look, o.z + Math.cos(h) * opt.look);
        if (!ahead(ped.heading)) {
          const h = steer(free, o.x, o.z, ped.heading, opt.look, ped.side);
          if (h === null) {
            // Cercado (esquina estreita, gente em volta): espera um pouco.
            ped.wait = 0.6;
            ped.inst.play('idle');
            stats.blocked++;
          } else {
            ped.heading = h;
            stats.turns++;
          }
        }
        if (ped.wait <= 0) {
          o.x += Math.sin(ped.heading) * ped.speed * dt;
          o.z += Math.cos(ped.heading) * ped.speed * dt;
        }
      }
      // O corpo gira suave até o rumo; a altura segue o meio-fio.
      const d = Math.atan2(Math.sin(ped.heading - ped.obj.rotation.y), Math.cos(ped.heading - ped.obj.rotation.y));
      ped.obj.rotation.y += d * Math.min(1, dt * 8);
      o.y += (streetView.floorAt(o.x, o.z) - o.y) * Math.min(1, dt * 18);
      ped.inst.mixer.update(dt);
    }
  }

  return {
    group,
    update,
    /** Para testes: quantos, o alvo pelo FPS e as posições. */
    debug: () => ({
      count: peds.length,
      target,
      fps: Math.round(fps.value),
      stats: { ...stats },
      peds: peds.map((p) => ({ x: p.obj.position.x, z: p.obj.position.z, heading: p.heading, waiting: p.wait > 0, talking: p.talking, crossing: p.cross ? (p.cross.waiting ? 'curb' : 'road') : null })),
      crosswalks: ends.length,
    }),
    /** Quem está atravessando a rua agora (os carros param para eles). */
    onRoad: () => peds.filter((p) => p.cross && !p.cross.waiting).map((p) => ({ x: p.obj.position.x, z: p.obj.position.z })),
    /** Para testes: fixa o alvo (o FPS volta a mexer depois de 2 s). */
    setTarget: (n) => { target = Math.max(0, Math.min(opt.max, n)); },
  };
}
