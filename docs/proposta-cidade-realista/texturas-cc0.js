// Texturas e luz de ambiente CC0 no street view (mundo aberto, docs/desenvolvimento/mundo-aberto-terceira-pessoa.md).
//
// Os arquivos ficam em .local/cc0/ (fora do git, baixados à mão; a origem e a licença em .local/cc0/ORIGEM.md):
// - ambientCG (CC0 1.0): Asphalt026C no asfalto do OSM, Concrete034 na calçada e no meio-fio, PavingStones092
//   no piso da praça. Cor, normal (GL) e rugosidade, em 1K, repetidas pelo mundo (UV = x e z ÷ o tamanho).
// - Poly Haven (CC0 1.0): o HDRI kloofendal_48d_partly_cloudy_puresky (1K) vira a luz de ambiente e o reflexo
//   (scene.environment, pelo PMREM). O céu visível continua o do Sky (ceu.js), que acompanha a hora e o clima;
//   a força do ambiente segue a luz do céu (de dia até 0,3, à noite quase nada). No mapa, sai.
// Sem os arquivos, nada muda (as texturas de antes ficam). ?cc0=0 desliga.
//
// PREMISSAS: asfalto a cada 4 m, concreto e pedra a cada 2,5 m; concreto (a8a49c) e pedra (c4bfba) escurecidos,
// porque são claros e estouravam com o sol e o céu fortes; ambiente a 0,3 com o céu cheio.

import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

export const CC0 = {
  base: '../../.local/cc0',
  sets: {
    asfalto: { dir: 'ambientcg-Asphalt026C', id: 'Asphalt026C', tile: 4 },
    concreto: { dir: 'ambientcg-Concrete034', id: 'Concrete034', tile: 2.5, tint: 0xa8a49c },
    pedra: { dir: 'ambientcg-PavingStones092', id: 'PavingStones092', tile: 2.5, tint: 0xc4bfba },
  },
  hdri: 'polyhaven-hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr',
  envMax: 0.3,
};

/** UV pelo mundo (x e z ÷ `tile`) para uma malha; nas paredes (normal de lado), x + z e a altura. */
export function worldUv(position, normal, tile, matrix = null, v = null) {
  const out = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    let x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    if (matrix) {
      v.set(x, y, z).applyMatrix4(matrix);
      ({ x, y, z } = v);
    }
    const wall = normal && Math.abs(normal.getY(i)) < 0.5;
    out[i * 2] = wall ? (x + z) / tile : x / tile;
    out[i * 2 + 1] = wall ? y / tile : z / tile;
  }
  return out;
}

export function createCC0({ THREE, renderer, scene, opt = CC0 }) {
  const loader = new THREE.TextureLoader();
  const sets = {};
  let env = null;
  const stats = { sets: [], env: false, missing: [] };

  const tex = (url, color) =>
    new Promise((ok, fail) => loader.load(url, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy?.() ?? 8;
      if (color) t.colorSpace = THREE.SRGBColorSpace;
      ok(t);
    }, undefined, fail));

  async function loadSet(key) {
    const s = opt.sets[key];
    const p = `${opt.base}/${s.dir}/${s.id}_1K-JPG`;
    try {
      const [map, normalMap, roughnessMap] = await Promise.all([tex(`${p}_Color.jpg`, true), tex(`${p}_NormalGL.jpg`), tex(`${p}_Roughness.jpg`)]);
      sets[key] = { map, normalMap, roughnessMap, tile: s.tile, tint: s.tint ?? 0xffffff };
      stats.sets.push(key);
    } catch {
      stats.missing.push(key);
    }
  }

  async function loadEnv() {
    try {
      const hdr = await new RGBELoader().loadAsync(`${opt.base}/${opt.hdri}`);
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const pmrem = new THREE.PMREMGenerator(renderer);
      env = pmrem.fromEquirectangular(hdr).texture;
      pmrem.dispose();
      hdr.dispose();
      stats.env = true;
    } catch {
      stats.missing.push('hdri');
    }
  }

  const ready = Promise.all([...Object.keys(opt.sets).map(loadSet), loadEnv()]);

  /** Põe o conjunto `key` num material (cor, normal e rugosidade); devolve o tamanho da repetição ou null. */
  function dress(material, key) {
    const s = sets[key];
    if (!s || !material) return null;
    Object.assign(material, { map: s.map, normalMap: s.normalMap, roughnessMap: s.roughnessMap, roughness: 1, vertexColors: false });
    material.color.set(s.tint);
    material.needsUpdate = true;
    return s.tile;
  }

  return {
    ready,
    set: (key) => sets[key] ?? null,
    dress,
    /** O asfalto do OSM com o Asphalt026C, UV pelo mundo (a malha vem quantizada: passa pela matriz dela). */
    dressRoads(roads) {
      if (!sets.asfalto || !roads) return false;
      roads.updateMatrixWorld(true);
      const g = roads.geometry;
      g.setAttribute('uv', new THREE.BufferAttribute(worldUv(g.attributes.position, null, sets.asfalto.tile, roads.matrixWorld, new THREE.Vector3()), 2));
      dress(roads.material, 'asfalto');
      roads.userData.cc0 = true; // o kit (kit-ruas.js) não troca mais a textura
      return true;
    },
    /** Liga (street view) ou tira (mapa) a luz de ambiente do HDRI; `sky` de 0 a 1 é a força do céu agora. */
    setEnv(on, sky = 1) {
      scene.environment = on && env ? env : null;
      scene.environmentIntensity = opt.envMax * Math.max(0.05, Math.min(1, sky));
    },
    debug: () => ({ ...stats, environment: !!scene.environment, intensity: scene.environmentIntensity }),
  };
}
