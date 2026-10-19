/**
 * Worker de parsing de geometria.
 *
 * F12 da auditoria: `FBXLoader.parse()` de um arquivo de 200 MB congelava a
 * aba inteira — o spinner nem chegava a pintar, não havia progresso e não
 * havia como cancelar.
 *
 * Escopo deliberado: aqui rodam apenas OBJ, STL e PLY. Esses três loaders do
 * Three.js são parsers puros (sem `document`, sem `Image`) e são justamente
 * os que passam mais tempo mastigando texto/binário. GLTF, FBX e DAE
 * precisam resolver texturas e dependem de APIs do browser que não existem
 * em worker — esses seguem na main thread, com yield entre etapas.
 *
 * O resultado volta como typed arrays transferíveis: zero cópia entre worker
 * e main thread.
 */

import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { t } from '../i18n/index.js';

/** Jobs cancelados pelo cliente. */
const cancelled = new Set();

self.addEventListener('message', async (event) => {
  const { type, id } = event.data;

  if (type === 'cancel') {
    cancelled.add(id);

    return;
  }

  if (type !== 'parse') return;

  const { buffer, format, name } = event.data;

  try {
    report(id, 5, 'lendo arquivo');

    if (cancelled.has(id)) return finish(id, 'cancelled');

    const meshes = parse(buffer, format, name, (percent, stage) => {
      report(id, percent, stage);
    });

    if (cancelled.has(id)) return finish(id, 'cancelled');

    report(id, 95, 'transferindo geometria');

    // Coleta os ArrayBuffers para transferir sem cópia.
    const transferables = [];
    for (const mesh of meshes) {
      for (const key of ['positions', 'normals', 'uvs', 'colors', 'indices']) {
        if (mesh[key]) transferables.push(mesh[key].buffer);
      }
    }

    self.postMessage({ type: 'done', id, meshes }, transferables);
  } catch (error) {
    self.postMessage({
      type: 'error',
      id,
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    cancelled.delete(id);
  }
});

function report(id, percent, stage) {
  self.postMessage({ type: 'progress', id, percent, stage });
}

function finish(id, status) {
  self.postMessage({ type: status, id });
}

/**
 * @returns {Array<{name:string, positions:Float32Array, normals:Float32Array|null,
 *                  uvs:Float32Array|null, colors:Float32Array|null,
 *                  indices:Uint32Array|null, color:[number,number,number]|null}>}
 */
function parse(buffer, format, name, onProgress) {
  onProgress(20, t('interpretando geometria'));

  switch (format) {
    case 'obj': {
      const text = new TextDecoder().decode(buffer);
      onProgress(35, t('lendo vértices'));
      const object = new OBJLoader().parse(text);
      onProgress(80, t('extraindo malhas'));

      return flatten(object, name);
    }

    case 'stl': {
      const geometry = new STLLoader().parse(buffer);
      onProgress(80, t('extraindo malhas'));

      return [serialize(geometry, name, [0.6, 0.63, 0.67])];
    }

    case 'ply': {
      const geometry = new PLYLoader().parse(buffer);
      geometry.computeVertexNormals();
      onProgress(80, t('extraindo malhas'));

      return [serialize(geometry, name, [0.55, 0.65, 0.72])];
    }

    default:
      throw new Error(t('O worker não processa o formato ".^1".', format));
  }
}

function flatten(root, fallbackName) {
  root.updateMatrixWorld(true);

  const result = [];
  let index = 0;

  root.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;

    const geometry = child.geometry.clone();
    geometry.applyMatrix4(child.matrixWorld);

    const material = Array.isArray(child.material) ? child.material[0] : child.material;
    const color = material?.color ? [material.color.r, material.color.g, material.color.b] : null;

    result.push(serialize(geometry, child.name || `${fallbackName}_${index++}`, color));
  });

  if (result.length === 0) {
    throw new Error(t('O arquivo foi lido, mas não contém nenhuma malha com geometria.'));
  }

  return result;
}

function serialize(geometry, name, color) {
  const position = geometry.getAttribute('position');

  if (!position) {
    throw new Error(t('A malha "^1" não possui atributo de posição.', name));
  }

  if (!geometry.getAttribute('normal')) {
    geometry.computeVertexNormals();
  }

  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  const vertexColor = geometry.getAttribute('color');
  const index = geometry.getIndex();

  return {
    name,
    color,
    positions: new Float32Array(position.array),
    normals: normal ? new Float32Array(normal.array) : null,
    uvs: uv ? new Float32Array(uv.array) : null,
    colors: vertexColor ? new Float32Array(vertexColor.array) : null,
    indices: index ? new Uint32Array(index.array) : null,
  };
}
