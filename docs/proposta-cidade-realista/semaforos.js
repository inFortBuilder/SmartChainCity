// Semáforos nos cruzamentos do street view (fase 3 do mundo aberto, docs/desenvolvimento/mundo-aberto-terceira-pessoa.md).
//
// Cruzamento = duas ou mais faixas de pedestre (faixas.js) a menos de 22 m umas das outras. Cada faixa é
// uma chegada ("braço"); os braços se dividem em dois grupos pelo rumo da rua (o do primeiro braço e os
// que ficam a menos de 30° dele, e os outros). Os grupos se alternam num ciclo de 33 s:
//
//   grupo 1 verde 12 s → amarelo 3 s → todos no vermelho 1,5 s → grupo 2 verde 12 s → amarelo 3 s → 1,5 s
//
// O ciclo de cada cruzamento começa num ponto sorteado pela posição dele (os cruzamentos não abrem juntos).
// - Carro (carros.js): no vermelho, para antes da faixa; no amarelo, para se ainda dá (mais de 4 m).
// - Pedestre (pedestres.js): atravessa a faixa quando os carros daquele braço estão no vermelho.
// Cada ponta de faixa tem um poste com as três luzes viradas para quem chega.
// Faixa sem cruzamento (sozinha) continua sem semáforo: vale a regra de olhar os carros.
//
// PREMISSAS: cruzamento com faixas a menos de 22 m; ciclo de 33 s (12 + 3 + 1,5 por grupo); grupos por 30°.

import { cellHash } from './mobiliario.js';

export const SIGNALS = { cluster: 22, green: 12, yellow: 3, allRed: 1.5, sameAxis: Math.PI / 6 };

/** Duração do ciclo inteiro (dois grupos). */
export const cycleOf = (o = SIGNALS) => 2 * (o.green + o.yellow + o.allRed);

/** Cor do grupo (0 ou 1) no tempo `t` do ciclo do cruzamento. */
export function lightAt(group, t, o = SIGNALS) {
  const half = o.green + o.yellow + o.allRed;
  const local = (((t - group * half) % cycleOf(o)) + cycleOf(o)) % cycleOf(o);
  if (local < o.green) return 'green';
  if (local < o.green + o.yellow) return 'yellow';
  return 'red';
}

/** Chave da faixa, a mesma de pedestres.js (posição com 1 casa). */
export const crosswalkKey = (f) => `${f.x.toFixed(1)},${f.z.toFixed(1)}`;

/**
 * Cruzamentos a partir das faixas: grupos de 2 ou mais faixas a menos de `cluster` m. Cada braço ganha o
 * grupo de fase (0 ou 1) pelo rumo da rua, e o cruzamento o deslocamento do ciclo (sorteio fixo).
 */
export function buildJunctions(list, o = SIGNALS) {
  const left = list.map((f) => ({ ...f, key: crosswalkKey(f) }));
  const out = [];
  while (left.length) {
    const seed = left.shift();
    const arms = [seed];
    for (let grew = true; grew; ) {
      grew = false;
      for (let i = left.length - 1; i >= 0; i--) {
        if (arms.some((a) => Math.hypot(a.x - left[i].x, a.z - left[i].z) < o.cluster)) {
          arms.push(left.splice(i, 1)[0]);
          grew = true;
        }
      }
    }
    if (arms.length < 2) continue;
    // Rumo da rua de cada braço: perpendicular à travessia, sem sentido (módulo 180°).
    const axis = (a) => ((Math.atan2(-a.dir[1], a.dir[0]) % Math.PI) + Math.PI) % Math.PI;
    const a0 = axis(arms[0]);
    for (const a of arms) {
      const d = Math.abs(axis(a) - a0);
      a.group = Math.min(d, Math.PI - d) < o.sameAxis ? 0 : 1;
    }
    const cx = arms.reduce((s, a) => s + a.x, 0) / arms.length;
    const cz = arms.reduce((s, a) => s + a.z, 0) / arms.length;
    const key = `${Math.round(cx / 5)},${Math.round(cz / 5)}`;
    const offset = cellHash(Math.round(cx / 5), Math.round(cz / 5)) * cycleOf(o);
    out.push({ key, x: cx, z: cz, offset, arms });
  }
  return out;
}

export function createSignals({ THREE, scene, streetView, opt = SIGNALS }) {
  const group = new THREE.Group();
  group.name = 'semaforos';
  scene.add(group);
  const poleGeo = new THREE.CylinderGeometry(0.06, 0.08, 3.2, 8).translate(0, 1.6, 0);
  const boxGeo = new THREE.BoxGeometry(0.3, 0.85, 0.22).translate(0, 2.9, 0);
  const lampGeo = new THREE.CircleGeometry(0.09, 14);
  const dark = new THREE.MeshStandardMaterial({ color: 0x1f2226, roughness: 0.6, metalness: 0.4 });
  const COLORS = { red: 0xff2a1a, yellow: 0xffb000, green: 0x22e06a };
  let junctions = [];
  let byKey = new Map(); // chave da faixa → braço (com o cruzamento)
  let signature = '';
  let clock = 0;
  let refresh = -1;

  /** Postes: um em cada ponta da faixa, com as luzes viradas para fora do cruzamento. */
  function rebuildPoles() {
    for (const c of [...group.children]) {
      group.remove(c);
      c.traverse((o) => { if (o.isMesh && o.material !== dark) o.material.dispose(); });
    }
    for (const j of junctions) {
      for (const arm of j.arms) {
        // Luzes do braço: 3 materiais que acendem e apagam juntos nos dois postes.
        arm.lamps = Object.fromEntries(Object.entries(COLORS).map(([k, c]) => [k, new THREE.MeshStandardMaterial({ color: 0x222222, emissive: c, emissiveIntensity: 0 })]));
        const ux = -arm.dir[1], uz = arm.dir[0];
        const out = Math.sign((arm.x - j.x) * ux + (arm.z - j.z) * uz) || 1;
        const half = arm.width / 2 + 0.4;
        for (const s of [-1, 1]) {
          const pole = new THREE.Group();
          pole.position.set(arm.x + arm.dir[0] * half * s, streetView.floorAt(arm.x + arm.dir[0] * half * s, arm.z + arm.dir[1] * half * s), arm.z + arm.dir[1] * half * s);
          pole.rotation.y = Math.atan2(ux * out, uz * out);
          pole.add(new THREE.Mesh(poleGeo, dark), new THREE.Mesh(boxGeo, dark));
          [['red', 3.15], ['yellow', 2.9], ['green', 2.65]].forEach(([k, y]) => {
            const lamp = new THREE.Mesh(lampGeo, arm.lamps[k]);
            lamp.position.set(0, y, 0.115);
            pole.add(lamp);
          });
          group.add(pole);
        }
      }
    }
  }

  function update(dt) {
    const on = streetView.active();
    group.visible = on;
    if (!on) return;
    clock += dt || 0;
    if (clock - refresh > 1) {
      refresh = clock;
      const list = streetView.crosswalks?.()?.list ?? [];
      const sig = list.map(crosswalkKey).sort().join('|');
      if (sig !== signature) {
        signature = sig;
        junctions = buildJunctions(list, opt);
        byKey = new Map(junctions.flatMap((j) => j.arms.map((a) => [a.key, { arm: a, junction: j }])));
        rebuildPoles();
      }
    }
    for (const j of junctions) {
      for (const a of j.arms) {
        a.state = lightAt(a.group, clock + j.offset, opt);
        for (const k of ['red', 'yellow', 'green']) a.lamps[k].emissiveIntensity = a.state === k ? 2.2 : 0.05;
      }
    }
  }

  return {
    group,
    update,
    /** Os braços com semáforo e a cor de agora (para os carros). */
    arms: () => junctions.flatMap((j) => j.arms.map((a) => ({ key: a.key, x: a.x, z: a.z, dir: a.dir, width: a.width, depth: a.depth, state: a.state }))),
    /** A faixa tem semáforo? */
    has: (key) => byKey.has(key),
    /** Pedestre pode atravessar a faixa: os carros daquele braço estão no vermelho. */
    walkOk: (key) => byKey.get(key)?.arm.state === 'red',
    debug: () => ({ junctions: junctions.length, arms: junctions.reduce((s, j) => s + j.arms.length, 0), poles: group.children.length, list: junctions.map((j) => ({ key: j.key, arms: j.arms.map((a) => [a.group, a.state]) })) }),
  };
}
