import fs from 'node:fs/promises';
import path from 'node:path';

import { ConversionError, importOptional } from './errors.js';

/**
 * @typedef {object} MeshData
 * @property {string} name
 * @property {Float32Array} positions
 * @property {Float32Array|null} normals
 * @property {Float32Array|null} uvs
 * @property {Uint32Array|null} indices
 * @property {[number,number,number]} color
 */

/** Formatos que conseguimos ler puramente em Node, sem DOM nem binário externo. */
export const NATIVE_FORMATS = ['obj', 'stl', 'ply'];

/** Formatos já em glTF — tratados diretamente pelo gltf-transform. */
export const GLTF_FORMATS = ['glb', 'gltf'];

/** Formatos que exigem um conversor externo instalado. */
export const EXTERNAL_FORMATS = ['fbx', 'dae'];

/**
 * Ângulo de quebra (60°) usado para decidir entre aresta suave e aresta viva
 * quando precisamos recalcular normais. Preserva quinas de paredes e lajes
 * sem arredondar superfícies curvas.
 */
export const DEFAULT_CREASE_ANGLE = Math.PI / 3;

export function detectFormat(filePath) {
  return path.extname(filePath).replace('.', '').toLowerCase();
}

/**
 * Lê OBJ, STL ou PLY e devolve geometria bruta pronta para virar glTF.
 *
 * Os loaders do Three.js usados aqui são parsers puros (sem `document`,
 * sem `Image`), portanto rodam em Node sem polyfill de DOM.
 *
 * @param {string} filePath
 * @param {string} format
 * @returns {Promise<MeshData[]>}
 */
export async function importNativeMeshes(filePath, format) {
  const buffer = await fs.readFile(filePath);
  const THREE = await importOptional('three', 'ler geometria 3D');
  const utils = await importOptional(
    'three/examples/jsm/utils/BufferGeometryUtils.js',
    'normalizar a topologia da malha'
  );

  const baseName = path.basename(filePath);

  switch (format) {
    case 'obj': {
      const object = await parseObj(buffer);
      return fromObject3D(object, utils, baseName);
    }
    case 'stl': {
      const geometry = await parseStl(buffer);
      return [fromGeometry(geometry, utils, baseName, [0.78, 0.78, 0.78])];
    }
    case 'ply': {
      const geometry = await parsePly(buffer);
      return [fromGeometry(geometry, utils, baseName, [0.55, 0.6, 0.65])];
    }
    default:
      void THREE;
      throw new ConversionError(
        'unsupported_format',
        `Formato "${format}" não é lido nativamente.`
      );
  }
}

async function parseObj(buffer) {
  const { OBJLoader } = await importOptional(
    'three/examples/jsm/loaders/OBJLoader.js',
    'ler arquivos .obj'
  );
  return new OBJLoader().parse(buffer.toString('utf8'));
}

async function parseStl(buffer) {
  const { STLLoader } = await importOptional(
    'three/examples/jsm/loaders/STLLoader.js',
    'ler arquivos .stl'
  );
  return new STLLoader().parse(toArrayBuffer(buffer));
}

async function parsePly(buffer) {
  const { PLYLoader } = await importOptional(
    'three/examples/jsm/loaders/PLYLoader.js',
    'ler arquivos .ply'
  );
  return new PLYLoader().parse(toArrayBuffer(buffer));
}

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

/**
 * Achata um Object3D em uma lista de MeshData, aplicando a matriz mundial
 * de cada mesh (o glTF resultante fica com hierarquia plana e previsível).
 */
function fromObject3D(root, utils, fallbackName) {
  root.updateMatrixWorld(true);

  /** @type {MeshData[]} */
  const meshes = [];
  let index = 0;

  root.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;

    const geometry = child.geometry.clone();
    geometry.applyMatrix4(child.matrixWorld);

    const material = Array.isArray(child.material) ? child.material[0] : child.material;
    const color = material?.color
      ? [material.color.r, material.color.g, material.color.b]
      : [0.8, 0.8, 0.8];

    meshes.push(fromGeometry(geometry, utils, child.name || `${fallbackName}_${index++}`, color));
  });

  if (meshes.length === 0) {
    throw new ConversionError(
      'empty_model',
      'O arquivo foi lido, mas não contém nenhuma malha com geometria.'
    );
  }

  return meshes;
}

/**
 * Normaliza a topologia antes de exportar.
 *
 * Por que isso importa: OBJ e STL chegam quase sempre NÃO indexados e com
 * normais por face — cada triângulo repete seus 3 vértices com normais
 * distintas. Nesse estado o `weld` do glTF não consegue mesclar nada, e
 * sem malha indexada o `simplify` e o Draco ficam inertes (medido: 97.200
 * cantos viravam 95.714 vértices, ou seja, ~0% de fusão).
 *
 * A correção: mesclar por posição (ignorando as normais por face) e então
 * recalcular normais respeitando um ângulo de quebra, o que preserva as
 * quinas vivas da arquitetura e suaviza as superfícies curvas.
 *
 * @param {import('three').BufferGeometry} geometry
 * @param {*} utils BufferGeometryUtils
 * @param {string} name
 * @param {[number,number,number]} color
 * @param {number} creaseAngle
 * @returns {MeshData}
 */
function fromGeometry(geometry, utils, name, color, creaseAngle = DEFAULT_CREASE_ANGLE) {
  if (!geometry.getAttribute('position')) {
    throw new ConversionError('empty_model', `A malha "${name}" não possui atributo de posição.`);
  }

  let normalized = geometry;

  if (shouldRebuildNormals(geometry)) {
    // Descarta normais por face para que a fusão compare apenas posição/UV.
    normalized = geometry.clone();
    normalized.deleteAttribute('normal');

    try {
      normalized = utils.mergeVertices(normalized);
    } catch {
      // Geometria exótica: segue sem indexar em vez de abortar a conversão.
    }

    try {
      normalized = utils.toCreasedNormals(normalized, creaseAngle);
    } catch {
      normalized.computeVertexNormals();
    }
  } else if (!geometry.getAttribute('normal')) {
    normalized = geometry.clone();
    normalized.computeVertexNormals();
  }

  const position = normalized.getAttribute('position');
  const normal = normalized.getAttribute('normal');
  const uv = normalized.getAttribute('uv');
  const index = normalized.getIndex();

  return {
    name,
    positions: new Float32Array(position.array),
    normals: normal ? new Float32Array(normal.array) : null,
    uvs: uv ? new Float32Array(uv.array) : null,
    indices: index ? new Uint32Array(index.array) : null,
    color,
  };
}

/**
 * Detecta normais por face: geometria não indexada em que os três vértices
 * de cada triângulo compartilham exatamente a mesma normal. É o padrão de
 * STL e de OBJ sem `vn`, e não carrega informação além da própria face.
 *
 * @param {import('three').BufferGeometry} geometry
 */
export function shouldRebuildNormals(geometry) {
  if (geometry.getIndex()) return false;

  const normal = geometry.getAttribute('normal');
  if (!normal) return true;

  const array = normal.array;
  const triangles = Math.floor(array.length / 9);
  if (triangles === 0) return false;

  // Amostragem: até 200 triângulos distribuídos pela malha.
  const step = Math.max(1, Math.floor(triangles / 200));

  for (let t = 0; t < triangles; t += step) {
    const o = t * 9;
    for (let c = 1; c < 3; c++) {
      for (let k = 0; k < 3; k++) {
        if (Math.abs(array[o + k] - array[o + c * 3 + k]) > 1e-6) {
          return false; // já há normais suavizadas — preserva o original
        }
      }
    }
  }

  return true;
}

/**
 * Conta triângulos de uma lista de MeshData.
 * @param {MeshData[]} meshes
 */
export function countTriangles(meshes) {
  return meshes.reduce((total, mesh) => {
    const count = mesh.indices ? mesh.indices.length : mesh.positions.length / 3;
    return total + Math.floor(count / 3);
  }, 0);
}
