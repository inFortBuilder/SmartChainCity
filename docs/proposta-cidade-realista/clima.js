// Clima no street view (mundo aberto, docs/desenvolvimento/mundo-aberto-terceira-pessoa.md): sol, nublado,
// chuva ou neblina, por cima do céu pela hora (ceu.js).
//
// O mesmo para todos os jogadores, sem servidor: o dia da cidade (fuso de Brasília) se divide em blocos de 3 h,
// e cada bloco sorteia o clima por uma semente fixa (a data e o bloco). Quem tem o mesmo relógio vê o mesmo
// tempo. `?clima=sol|nublado|chuva|neblina` força um, para testar.
// - Nublado: céu mais turvo, sol a 45%, céu a 85%.
// - Chuva: céu escuro (sol a 25%), neblina perto (de 30 a 380 m), gotas caindo em volta da câmera e o som da
//   chuva (sons.js).
// - Neblina: visibilidade curta (de 15 a 200 m), sol a 55%.
// No mapa visto de cima, o clima sai (o céu do mapa é o de sempre).
//
// PREMISSAS: blocos de 3 h; sol 50%, nublado 25%, chuva 15%, neblina 10%; 2.500 gotas num cubo de 60 m.

import { CITY_UTC_OFFSET_MIN, cityHour } from './ceu.js';

export const WEATHERS = {
  sol: { label: 'Sol', chance: 0.5, sun: 1, sky: 1, exposure: 1, turbidity: 2.2, rayleigh: 2.4, fog: null, rain: 0 },
  nublado: { label: 'Nublado', chance: 0.25, sun: 0.45, sky: 0.85, exposure: 0.92, turbidity: 10, rayleigh: 1, fog: null, rain: 0 },
  chuva: { label: 'Chuva', chance: 0.15, sun: 0.25, sky: 0.6, exposure: 0.8, turbidity: 18, rayleigh: 0.6, fog: { near: 30, far: 380, color: [0.42, 0.45, 0.5] }, rain: 1 },
  neblina: { label: 'Neblina', chance: 0.1, sun: 0.55, sky: 0.9, exposure: 0.9, turbidity: 14, rayleigh: 0.8, fog: { near: 15, far: 200, color: [0.78, 0.8, 0.82] }, rain: 0 },
};
export const BLOCK_HOURS = 3;

/** Sorteio de 0 a 1 por um texto (FNV-1a), o mesmo em qualquer navegador. */
export function seeded(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // Mistura final, para blocos vizinhos não saírem parecidos.
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** O dia da cidade (AAAA-MM-DD, no fuso de Brasília). */
export function cityDate(now = new Date()) {
  return new Date(now.getTime() + CITY_UTC_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

/** O clima do bloco de 3 h em que cai `hour` no dia `date` (ou o de ?clima=). */
export function weatherAt(date, hour, params = new URLSearchParams(globalThis.location?.search ?? '')) {
  const forced = params.get('clima');
  if (forced && WEATHERS[forced]) return forced;
  const block = Math.floor(hour / BLOCK_HOURS);
  let r = seeded(`${date}#${block}`);
  for (const [code, w] of Object.entries(WEATHERS)) {
    if ((r -= w.chance) < 0) return code;
  }
  return 'sol';
}

export function createWeather({ THREE, scene, camera, streetView, sky, sounds = () => null, opt = { drops: 2500, box: 60, speed: 12 } }) {
  // Gotas: segmentos curtos num cubo em volta da câmera, que descem e voltam ao topo.
  const pos = new Float32Array(opt.drops * 6);
  const seed = new Float32Array(opt.drops * 3);
  for (let i = 0; i < opt.drops; i++) {
    seed[i * 3] = (Math.random() - 0.5) * opt.box;
    seed[i * 3 + 1] = Math.random() * opt.box;
    seed[i * 3 + 2] = (Math.random() - 0.5) * opt.box;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xaab4c0, transparent: true, opacity: 0.55, fog: false }));
  rain.frustumCulled = false;
  rain.visible = false;
  rain.name = 'chuva';
  scene.add(rain);
  let fall = 0;
  let current = null;
  let base = null; // a neblina e o céu antes do clima (para voltar)
  const stats = { applied: 0 };

  /** Aplica o clima por cima da luz da hora (`l`, de ceu.js), nos objetos da cena. */
  function apply({ sun, hemi, renderer }, l) {
    const code = weatherAt(cityDate(), cityHour());
    const w = WEATHERS[code];
    base ??= { near: scene.fog.near, far: scene.fog.far, turbidity: sky.material.uniforms.turbidity.value, rayleigh: sky.material.uniforms.rayleigh.value };
    sun.intensity *= w.sun;
    hemi.intensity *= w.sky;
    renderer.toneMappingExposure *= w.exposure;
    sky.material.uniforms.turbidity.value = w.turbidity;
    sky.material.uniforms.rayleigh.value = w.rayleigh;
    if (w.fog) {
      scene.fog.near = w.fog.near;
      scene.fog.far = w.fog.far;
      // À noite, a neblina escurece junto com o céu.
      const k = l.night ? 0.25 : 1;
      scene.fog.color.setRGB(w.fog.color[0] * k, w.fog.color[1] * k, w.fog.color[2] * k);
    } else {
      scene.fog.near = base.near;
      scene.fog.far = base.far;
    }
    rain.visible = w.rain > 0;
    sounds()?.setRain?.(w.rain);
    current = code;
    stats.applied++;
    return code;
  }

  /** Volta ao céu do mapa (sem clima). */
  function clear() {
    if (!base) return;
    scene.fog.near = base.near;
    scene.fog.far = base.far;
    sky.material.uniforms.turbidity.value = base.turbidity;
    sky.material.uniforms.rayleigh.value = base.rayleigh;
    rain.visible = false;
    sounds()?.setRain?.(0);
    current = null;
  }

  /** A chuva cai em volta da câmera (a cada quadro). */
  function update(dt) {
    if (!rain.visible || !streetView.active()) return;
    fall = (fall + opt.speed * dt) % opt.box;
    const c = camera.position;
    for (let i = 0; i < opt.drops; i++) {
      const x = c.x + seed[i * 3], z = c.z + seed[i * 3 + 2];
      let y = seed[i * 3 + 1] - fall;
      if (y < 0) y += opt.box;
      const top = c.y - opt.box / 2 + y;
      pos.set([x, top, z, x + 0.05, top - 0.6, z], i * 6);
    }
    geo.attributes.position.needsUpdate = true;
  }

  return {
    apply,
    clear,
    update,
    /** O clima de agora (código e rótulo), ou null fora do street view. */
    current: () => (current ? { code: current, label: WEATHERS[current].label } : null),
    debug: () => ({ current, rain: rain.visible, fog: { near: scene.fog.near, far: scene.fog.far }, ...stats }),
  };
}
