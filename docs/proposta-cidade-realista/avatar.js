// Avatar do jogo: manequins da Universal Animation Library (Quaternius, CC0).
// Os arquivos saem de tools/scc-builder/bin/avatar-pack.js para assets/avatar/.
//
// - Man: o manequim masculino, com os clipes do jogo.
// - Woman: o manequim feminino, que toca os mesmos clipes (mesmo esqueleto).
//
// A escolha fica neste navegador (localStorage) e vale para o street view, o
// interior e o que os outros jogadores veem (o realtime leva o tipo).
// Se os arquivos não carregarem, cai no RobotExpressive (CC0) do three.js.
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const BASE = new URL('./assets/avatar/', import.meta.url).href;
const ROBOT = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/models/gltf/RobotExpressive/RobotExpressive.glb';
const KEY = 'scc-avatar-tipo';
export const AVATAR_HEIGHT = 1.75;

export const AVATAR_TYPES = {
  man: { label: 'Man', file: 'avatar-man.glb' },
  woman: { label: 'Woman', file: 'avatar-woman.glb' },
};
export const isAvatarType = (t) => Object.hasOwn(AVATAR_TYPES, t);

/** Nomes antigos que ainda podem estar salvos no navegador. */
const OLD_NAMES = { human: 'woman' };

export function getAvatarType() {
  try {
    const saved = localStorage.getItem(KEY);
    const t = OLD_NAMES[saved] ?? saved;
    return isAvatarType(t) ? t : 'man';
  } catch {
    return 'man';
  }
}

export function setAvatarType(t) {
  if (!isAvatarType(t)) return;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // Sem armazenamento (aba anônima): vale só nesta página.
  }
}

/** Clipes por papel: rua (idle, walk, run) e interior (sit, interact, talk, pickUp). Nomes da UAL e do robô. */
export function clipsByRole(clips) {
  const find = (...names) => clips.find((c) => names.some((n) => (n instanceof RegExp ? n.test(c.name) : c.name === n)));
  return {
    idle: find('Idle_Loop', 'Idle', /idle/i),
    walk: find('Walk_Loop', 'Walking', /^walk/i),
    run: find('Jog_Fwd_Loop', 'Running', /jog|run/i),
    sprint: find('Sprint_Loop'),
    sitEnter: find('Sitting_Enter'),
    sit: find('Sitting_Idle_Loop', 'Sitting'),
    sitExit: find('Sitting_Exit'),
    interact: find('Interact'),
    pickUp: find('PickUp_Table'),
    talk: find('Idle_Talking_Loop'),
    jumpStart: find('Jump_Start'),
    jump: find('Jump_Loop'),
    jumpLand: find('Jump_Land'),
  };
}

const cache = new Map();

/**
 * Modelo e clipes do tipo pedido. `loadGltf(url)` é o loader da página (com o
 * meshopt). Cada tipo carrega uma vez; os clipes vêm sempre do Man.
 */
export function loadAvatarAssets(loadGltf, type = getAvatarType()) {
  const t = isAvatarType(type) ? type : 'man';
  if (!cache.has(t)) {
    cache.set(
      t,
      (async () => {
        try {
          const man = await loadGltf(BASE + AVATAR_TYPES.man.file);
          const model = t === 'man' ? man.scene : (await loadGltf(BASE + AVATAR_TYPES[t].file)).scene;
          return { type: t, model, clips: man.animations, source: `Universal Animation Library (${AVATAR_TYPES[t].label})` };
        } catch (error) {
          console.warn('avatar: UAL não carregou, usando o RobotExpressive', error);
          const robot = await loadGltf(ROBOT);
          return { type: t, model: robot.scene, clips: robot.animations, source: 'RobotExpressive' };
        }
      })(),
    );
  }
  return cache.get(t);
}

/**
 * Uma instância do avatar (clone do modelo, para vários jogadores na mesma cena),
 * na altura do jogo, com o mixer e as ações por papel.
 */
export function makeAvatar(THREE, assets) {
  const body = SkeletonUtils.clone(assets.model);
  body.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(body);
  body.scale.multiplyScalar(AVATAR_HEIGHT / (bb.max.y - bb.min.y));
  body.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false; // a caixa do mesh com esqueleto não acompanha a animação
    }
  });
  const mixer = new THREE.AnimationMixer(body);
  const actions = {};
  for (const [role, clip] of Object.entries(clipsByRole(assets.clips))) if (clip) actions[role] = mixer.clipAction(clip);
  let current = null;
  let onDone = null;
  /** Troca de animação com transição; `walk` e `run` caem no que existir. */
  const play = (role, fade = 0.2) => {
    const a = actions[role] ?? (role === 'run' ? actions.walk : null) ?? actions.idle;
    if (!a || a === current) return;
    onDone = null;
    a.setLoop(THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = false;
    a.reset().fadeIn(fade).play();
    current?.fadeOut(fade);
    current = a;
  };
  /**
   * Toca um clipe uma vez (sentar, levantar, interagir) e, no fim, chama `then`
   * (que em geral passa para um clipe em laço). Sem o clipe, chama `then` direto.
   */
  const playOnce = (role, then, fade = 0.2) => {
    const a = actions[role];
    if (!a) return then?.();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.reset().fadeIn(fade).play();
    if (current !== a) current?.fadeOut(fade);
    current = a;
    onDone = { action: a, then };
  };
  mixer.addEventListener('finished', (e) => {
    if (!onDone || e.action !== onDone.action) return;
    const { then } = onDone;
    onDone = null;
    then?.();
  });
  return { body, mixer, actions, play, playOnce, current: () => current, type: assets.type, source: assets.source };
}
