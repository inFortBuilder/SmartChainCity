import * as THREE from 'three';

/**
 * Gestão de materiais do editor.
 *
 * Dois problemas da v1 resolvidos aqui:
 *
 * 1. `child.material` pode ser um ARRAY (multi-material) — comum em modelos
 *    do Revit e do 3ds Max. A v1 assumia objeto único e lançava TypeError,
 *    derrubando o painel PBR inteiro.
 *
 * 2. Os modos wireframe/raio-X mutavam `opacity` e `transparent` sem guardar
 *    o valor anterior, então voltar para "shaded" deixava o modelo 40%
 *    transparente para sempre.
 */

const SNAPSHOT_KEY = '__c3dOriginalState';

/**
 * Normaliza `mesh.material` para uma lista.
 * @param {THREE.Mesh} mesh
 * @returns {THREE.Material[]}
 */
export function materialsOf(mesh) {
  if (!mesh?.material) return [];

  return Array.isArray(mesh.material) ? mesh.material.filter(Boolean) : [mesh.material];
}

/**
 * Coleta os materiais únicos de uma subárvore, com as malhas que os usam.
 *
 * @param {THREE.Object3D} root
 * @returns {Array<{material: THREE.Material, meshes: THREE.Mesh[], name: string}>}
 */
export function collectMaterials(root) {
  /** @type {Map<THREE.Material, {material: THREE.Material, meshes: THREE.Mesh[], name: string}>} */
  const map = new Map();
  if (!root) return [];

  root.traverse((child) => {
    if (!child.isMesh) return;

    for (const material of materialsOf(child)) {
      const entry = map.get(material);
      if (entry) {
        entry.meshes.push(child);
      } else {
        map.set(material, {
          material,
          meshes: [child],
          name: material.name || `Material ${map.size + 1}`,
        });
      }
    }
  });

  return [...map.values()];
}

/**
 * Guarda o estado visual original de um material, uma única vez.
 * @param {THREE.Material} material
 */
export function snapshot(material) {
  if (material.userData?.[SNAPSHOT_KEY]) return;

  material.userData = material.userData ?? {};
  material.userData[SNAPSHOT_KEY] = {
    opacity: material.opacity,
    transparent: material.transparent,
    wireframe: material.wireframe ?? false,
    depthWrite: material.depthWrite,
    side: material.side,
    color: material.color?.getHex?.(),
  };
}

/**
 * Restaura o estado guardado por `snapshot`.
 * @param {THREE.Material} material
 */
export function restore(material) {
  const saved = material.userData?.[SNAPSHOT_KEY];
  if (!saved) return;

  material.opacity = saved.opacity;
  material.transparent = saved.transparent;
  material.wireframe = saved.wireframe;
  material.depthWrite = saved.depthWrite;
  material.side = saved.side;
  if (saved.color !== undefined && material.color) {
    material.color.setHex(saved.color);
  }
  material.needsUpdate = true;
}

/**
 * Aplica propriedades PBR a um conjunto de materiais, com validação de tipo.
 *
 * @param {THREE.Material[]} materials
 * @param {Record<string, unknown>} properties
 */
export function applyProperties(materials, properties) {
  for (const material of materials) {
    if (!material) continue;
    snapshot(material);

    if (properties.color !== undefined && material.color) {
      material.color.set(properties.color);
    }
    if (properties.emissive !== undefined && material.emissive) {
      material.emissive.set(properties.emissive);
    }

    for (const key of ['roughness', 'metalness', 'emissiveIntensity']) {
      if (properties[key] === undefined) continue;
      const value = Number.parseFloat(String(properties[key]));
      if (Number.isFinite(value) && key in material) {
        material[key] = value;
      }
    }

    if (properties.wireframe !== undefined && 'wireframe' in material) {
      material.wireframe = Boolean(properties.wireframe);
    }

    if (properties.opacity !== undefined) {
      const opacity = Number.parseFloat(String(properties.opacity));
      if (Number.isFinite(opacity)) {
        material.opacity = THREE.MathUtils.clamp(opacity, 0, 1);
        material.transparent = material.opacity < 1;
        material.depthWrite = material.opacity >= 1;
      }
    }

    if (properties.side !== undefined) {
      material.side = properties.side;
    }

    material.needsUpdate = true;
  }
}

/** Modos de visualização suportados. */
export const RENDER_MODES = ['shaded', 'wireframe', 'xray'];

/**
 * Alterna o modo de visualização de forma REVERSÍVEL.
 *
 * @param {THREE.Object3D} root
 * @param {'shaded'|'wireframe'|'xray'} mode
 */
export function setRenderMode(root, mode) {
  if (!root) return;

  root.traverse((child) => {
    if (!child.isMesh) return;

    for (const material of materialsOf(child)) {
      snapshot(material);
      restore(material); // sempre parte do estado original

      if (mode === 'wireframe') {
        material.wireframe = true;
      } else if (mode === 'xray') {
        material.transparent = true;
        material.opacity = 0.35;
        material.depthWrite = false;
        material.side = THREE.DoubleSide;
      }

      material.needsUpdate = true;
    }
  });
}

/**
 * Descrição legível de um material, para a lista da UI.
 * @param {THREE.Material} material
 */
export function describeMaterial(material) {
  return {
    name: material.name || material.type,
    type: material.type,
    color: material.color ? `#${material.color.getHexString()}` : null,
    roughness: typeof material.roughness === 'number' ? material.roughness : null,
    metalness: typeof material.metalness === 'number' ? material.metalness : null,
    opacity: material.opacity,
    transparent: material.transparent,
    hasTexture: Boolean(material.map),
  };
}
