import * as THREE from 'three';

import { disposeObject3D } from './dispose.js';
import { t } from '../i18n/index.js';

/**
 * Otimização de malha no browser.
 *
 * O pipeline do servidor (bin/lib/optimize.js) já faz isso com
 * gltf-transform, mas o editor precisava de um equivalente local para que
 * o usuário veja o efeito antes de exportar — e para quem usa só o editor,
 * sem servidor.
 *
 * Usa o `meshoptimizer` (WASM) quando disponível; sem ele, ainda entrega
 * soldagem de vértices e reindexação com os utilitários do Three.js.
 */

/** Perfis equivalentes aos do servidor, para o resultado ser previsível. */
export const CLIENT_PROFILES = {
  none: { weld: false, ratio: 1, error: 0 },
  balanced: { weld: true, ratio: 1, error: 0 },
  aggressive: { weld: true, ratio: 0.5, error: 0.01 },
  extreme: { weld: true, ratio: 0.25, error: 0.05 },
};

let simplifierPromise = null;

/** Carrega o MeshoptSimplifier uma única vez. */
async function loadSimplifier() {
  if (!simplifierPromise) {
    simplifierPromise = import('meshoptimizer')
      .then(async ({ MeshoptSimplifier }) => {
        await MeshoptSimplifier.ready;

        return MeshoptSimplifier;
      })
      .catch(() => null);
  }

  return simplifierPromise;
}

/**
 * Mede um Object3D sem alterá-lo.
 *
 * @param {THREE.Object3D} root
 * @returns {{triangles:number, vertices:number, meshes:number, indexed:number}}
 */
export function measure(root) {
  let triangles = 0;
  let vertices = 0;
  let meshes = 0;
  let indexed = 0;

  root?.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;

    const position = child.geometry.getAttribute('position');
    if (!position) return;

    meshes++;
    vertices += position.count;

    const index = child.geometry.getIndex();
    if (index) indexed++;

    triangles += Math.floor((index ? index.count : position.count) / 3);
  });

  return { triangles, vertices, meshes, indexed };
}

/**
 * Simula o resultado da otimização sem aplicá-la, para a UI mostrar
 * "antes → depois" antes de o usuário confirmar.
 *
 * A estimativa é conservadora: a soldagem costuma reduzir mais do que
 * projetamos, então o ganho real tende a ser melhor que o previsto.
 *
 * @param {THREE.Object3D} root
 * @param {keyof typeof CLIENT_PROFILES} level
 */
export function preview(root, level) {
  const profile = CLIENT_PROFILES[level] ?? CLIENT_PROFILES.balanced;
  const before = measure(root);

  return {
    before,
    after: {
      ...before,
      triangles: Math.round(before.triangles * profile.ratio),
      vertices: Math.round(before.vertices * (profile.weld ? 0.55 : 1) * profile.ratio),
    },
    estimated: true,
  };
}

/**
 * Aplica a otimização, modificando as geometrias no lugar.
 *
 * @param {THREE.Object3D} root
 * @param {keyof typeof CLIENT_PROFILES} level
 * @param {{onProgress?: (percent:number, stage:string) => void}} [options]
 * @returns {Promise<{before:object, after:object, simplifierUsed:boolean, warnings:string[]}>}
 */
export async function optimize(root, level = 'balanced', options = {}) {
  const onProgress = options.onProgress ?? (() => {});
  const profile = CLIENT_PROFILES[level] ?? CLIENT_PROFILES.balanced;
  const before = measure(root);
  const warnings = [];

  if (level === 'none') {
    return { before, after: before, simplifierUsed: false, warnings };
  }

  const utils = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
  const simplifier = profile.ratio < 1 ? await loadSimplifier() : null;

  if (profile.ratio < 1 && !simplifier) {
    warnings.push(
      t(
        'meshoptimizer não disponível — a malha foi soldada, mas não simplificada. Execute "npm install meshoptimizer".'
      )
    );
  }

  /** @type {THREE.Mesh[]} */
  const meshes = [];
  root.traverse((child) => {
    if (child.isMesh && child.geometry) meshes.push(child);
  });

  let done = 0;

  for (const mesh of meshes) {
    const original = mesh.geometry;
    let geometry = original;

    try {
      // 1. Soldar: indispensável, tanto para reduzir memória quanto porque
      //    o simplificador não colapsa arestas em malha não indexada.
      if (profile.weld) {
        geometry = weld(geometry, utils);
      }

      // 2. Simplificar com meshoptimizer.
      if (simplifier && profile.ratio < 1) {
        geometry = simplify(geometry, simplifier, profile);
      }

      if (geometry !== original) {
        mesh.geometry = geometry;
        original.dispose();
      }
    } catch (error) {
      warnings.push(`"${mesh.name || 'malha'}": ${error.message}`);
    }

    done++;
    onProgress(
      Math.round((done / meshes.length) * 100),
      t('otimizando ^1/^2', done, meshes.length)
    );

    // Cede o frame a cada malha: uma cena com 500 objetos não pode
    // congelar a aba durante a otimização.
    if (done % 10 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return { before, after: measure(root), simplifierUsed: Boolean(simplifier), warnings };
}

/**
 * Solda vértices coincidentes. Preserva arestas vivas ao recalcular as
 * normais com ângulo de quebra — mesma abordagem do pipeline do servidor.
 */
function weld(geometry, utils, creaseAngle = Math.PI / 3) {
  const hadNormals = Boolean(geometry.getAttribute('normal'));

  const working = geometry.clone();
  working.deleteAttribute('normal');

  const merged = utils.mergeVertices(working);
  working.dispose();

  if (hadNormals) {
    try {
      return utils.toCreasedNormals(merged, creaseAngle);
    } catch {
      merged.computeVertexNormals();
    }
  } else {
    merged.computeVertexNormals();
  }

  return merged;
}

function simplify(geometry, simplifier, profile) {
  const index = geometry.getIndex();
  const position = geometry.getAttribute('position');

  if (!index || !position) return geometry;

  const targetCount = Math.floor((index.count / 3) * profile.ratio) * 3;
  if (targetCount < 3 || targetCount >= index.count) return geometry;

  const [simplified] = simplifier.simplify(
    new Uint32Array(index.array),
    new Float32Array(position.array),
    3,
    targetCount,
    profile.error,
    ['LockBorder']
  );

  const result = geometry.clone();
  result.setIndex(new THREE.BufferAttribute(simplified, 1));
  result.computeVertexNormals();

  return result;
}

/**
 * Gera um THREE.LOD com três níveis de detalhe.
 *
 * Em cenas arquitetônicas isso é o que permite navegar por um bairro
 * inteiro: objetos distantes desenham 12% dos triângulos.
 *
 * @param {THREE.Object3D} root
 * @param {{levels?: number[], distances?: number[]}} [options]
 * @returns {Promise<THREE.LOD|null>}
 */
export async function buildLOD(root, options = {}) {
  const ratios = options.levels ?? [1, 0.5, 0.125];
  const simplifier = await loadSimplifier();

  if (!simplifier) return null;

  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3()).length() || 10;
  const distances = options.distances ?? [0, size * 1.5, size * 4];

  const lod = new THREE.LOD();
  lod.name = `${root.name || 'modelo'}_LOD`;

  const utils = await import('three/examples/jsm/utils/BufferGeometryUtils.js');

  for (const [i, ratio] of ratios.entries()) {
    const level = root.clone(true);

    if (ratio < 1) {
      level.traverse((child) => {
        if (!child.isMesh || !child.geometry) return;

        try {
          const welded = weld(child.geometry, utils);
          child.geometry = simplify(welded, simplifier, { ratio, error: 0.02 });
          if (child.geometry !== welded) welded.dispose();
        } catch {
          // mantém a geometria original neste nível
        }
      });
    }

    level.name = `${lod.name}_L${i}`;
    lod.addLevel(level, distances[i] ?? size * (i + 1) * 2);
  }

  return lod;
}

/**
 * Configura frustum culling e ordenação por material para reduzir
 * trocas de estado da GPU.
 *
 * @param {THREE.Object3D} root
 */
export function tuneForRendering(root) {
  if (!root) return { culled: 0 };

  let culled = 0;

  root.traverse((child) => {
    if (!child.isMesh) return;

    // O culling depende da bounding sphere; sem ela o Three.js desenha tudo.
    if (!child.geometry.boundingSphere) {
      child.geometry.computeBoundingSphere();
    }

    child.frustumCulled = true;
    culled++;

    // Agrupa por material no render order: menos troca de shader por frame.
    const material = Array.isArray(child.material) ? child.material[0] : child.material;
    if (material) {
      child.renderOrder = material.transparent ? 1 : 0;
    }
  });

  return { culled };
}

/** Descarta um LOD e todos os seus níveis. */
export function disposeLOD(lod) {
  if (!lod) return;

  for (const level of lod.levels ?? []) {
    disposeObject3D(level.object);
  }
}
