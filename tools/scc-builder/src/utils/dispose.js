/**
 * Liberação de recursos de GPU.
 *
 * A v1 fazia apenas `scene.remove(model)` — o JavaScript coletava o objeto,
 * mas os buffers de geometria, os shaders e as texturas continuavam alocados
 * na GPU. Carregar meia dúzia de modelos arquitetônicos grandes em sequência
 * esgotava a VRAM e derrubava o contexto WebGL.
 */

/** Todas as propriedades de material que podem conter uma textura. */
const TEXTURE_SLOTS = [
  'map',
  'lightMap',
  'aoMap',
  'emissiveMap',
  'bumpMap',
  'normalMap',
  'displacementMap',
  'roughnessMap',
  'metalnessMap',
  'alphaMap',
  'envMap',
  'specularMap',
  'gradientMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'transmissionMap',
  'thicknessMap',
  'specularIntensityMap',
  'specularColorMap',
  'anisotropyMap',
];

/**
 * @param {import('three').Material} material
 * @param {{textures:number, materials:number}} stats
 */
function disposeMaterial(material, stats) {
  if (!material || material.userData?.__c3dDisposed) return;

  for (const slot of TEXTURE_SLOTS) {
    const texture = material[slot];
    if (texture && typeof texture.dispose === 'function') {
      texture.dispose();
      stats.textures++;
      material[slot] = null;
    }
  }

  material.userData = material.userData ?? {};
  material.userData.__c3dDisposed = true;

  material.dispose();
  stats.materials++;
}

/**
 * Percorre um Object3D liberando geometrias, materiais e texturas.
 *
 * Materiais compartilhados entre várias malhas são liberados uma única vez.
 *
 * @param {import('three').Object3D|null|undefined} root
 * @returns {{geometries:number, materials:number, textures:number}}
 */
export function disposeObject3D(root) {
  const stats = { geometries: 0, materials: 0, textures: 0 };
  if (!root) return stats;

  const seenMaterials = new Set();

  root.traverse((child) => {
    if (child.geometry && typeof child.geometry.dispose === 'function') {
      child.geometry.dispose();
      stats.geometries++;
    }

    const material = child.material;
    if (!material) return;

    const list = Array.isArray(material) ? material : [material];
    for (const item of list) {
      if (!item || seenMaterials.has(item)) continue;
      seenMaterials.add(item);
      disposeMaterial(item, stats);
    }
  });

  root.removeFromParent?.();

  return stats;
}

/**
 * Remove um objeto da cena e libera seus recursos, em uma operação só.
 *
 * @param {import('three').Scene} scene
 * @param {import('three').Object3D|null} object
 */
export function removeAndDispose(scene, object) {
  if (!object) return { geometries: 0, materials: 0, textures: 0 };

  scene.remove(object);

  return disposeObject3D(object);
}

/**
 * Instantâneo do uso de memória do renderer — útil para provar, em testes
 * manuais, que não há vazamento entre carregamentos.
 *
 * @param {import('three').WebGLRenderer} renderer
 */
export function memorySnapshot(renderer) {
  const info = renderer.info;

  return {
    geometries: info.memory.geometries,
    textures: info.memory.textures,
    programs: info.programs?.length ?? 0,
    drawCalls: info.render.calls,
    triangles: info.render.triangles,
  };
}
