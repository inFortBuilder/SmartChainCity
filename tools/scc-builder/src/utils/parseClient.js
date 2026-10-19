import * as THREE from 'three';
import { idioma, t } from '../i18n/index.js';

/**
 * Fachada do worker de parsing.
 *
 * Responsabilidades:
 *  - decidir o que vai para o worker e o que fica na main thread;
 *  - expor progresso real e cancelamento;
 *  - reconstruir BufferGeometry a partir dos typed arrays transferidos;
 *  - degradar com elegância se o browser não suportar module workers.
 */

/** Formatos que o worker processa. Os demais ficam na main thread. */
export const WORKER_FORMATS = new Set(['obj', 'stl', 'ply']);

/** Acima disso, vale a pena pagar o custo de criar o worker. */
const WORKER_MIN_BYTES = 512 * 1024;

export class ParseClient {
  constructor() {
    /** @type {Worker|null} */
    this.worker = null;
    /** @type {Map<string, {resolve:Function, reject:Function, onProgress:Function}>} */
    this.pending = new Map();
    this.supported = typeof Worker !== 'undefined';
    this.nextId = 0;
  }

  /**
   * O worker vale a pena para este arquivo?
   * @param {string} format
   * @param {number} sizeBytes
   */
  shouldUseWorker(format, sizeBytes) {
    return this.supported && WORKER_FORMATS.has(format) && sizeBytes >= WORKER_MIN_BYTES;
  }

  #ensureWorker() {
    if (this.worker) return this.worker;

    // O nome leva o idioma: no worker não há URL nem localStorage para o
    // i18n descobrir sozinho.
    this.worker = new Worker(new URL('../workers/parser.worker.js', import.meta.url), {
      type: 'module',
      name: idioma,
    });

    this.worker.addEventListener('message', (event) => {
      const { type, id } = event.data;
      const entry = this.pending.get(id);
      if (!entry) return;

      if (type === 'progress') {
        entry.onProgress?.(event.data.percent, event.data.stage);

        return;
      }

      this.pending.delete(id);

      if (type === 'done') {
        entry.resolve(event.data.meshes);
      } else if (type === 'cancelled') {
        entry.reject(new ParseCancelled());
      } else {
        entry.reject(new Error(event.data.message ?? t('Falha no worker de parsing.')));
      }
    });

    this.worker.addEventListener('error', (event) => {
      for (const entry of this.pending.values()) {
        entry.reject(new Error(t('Worker falhou: ^1', event.message)));
      }
      this.pending.clear();
      this.terminate();
    });

    return this.worker;
  }

  /**
   * Interpreta o arquivo no worker e devolve um Object3D pronto.
   *
   * @param {ArrayBuffer} buffer
   * @param {string} format
   * @param {string} name
   * @param {{onProgress?: (percent:number, stage:string) => void, signal?: AbortSignal}} [options]
   * @returns {Promise<THREE.Object3D>}
   */
  async parse(buffer, format, name, options = {}) {
    const worker = this.#ensureWorker();
    const id = `p${this.nextId++}`;

    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress: options.onProgress });
    });

    options.signal?.addEventListener('abort', () => this.cancel(id), { once: true });

    // O buffer é transferido: fica inutilizável na main thread depois disso,
    // por isso o chamador deve passar uma cópia se ainda precisar dele.
    worker.postMessage({ type: 'parse', id, buffer, format, name }, [buffer]);

    const meshes = await promise;

    return buildObject(meshes, name);
  }

  cancel(id) {
    this.worker?.postMessage({ type: 'cancel', id });
  }

  cancelAll() {
    for (const id of this.pending.keys()) {
      this.cancel(id);
    }
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}

/** Erro de cancelamento — distinguível de uma falha real. */
export class ParseCancelled extends Error {
  constructor() {
    super(t('Carregamento cancelado pelo usuário.'));
    this.name = 'ParseCancelled';
  }
}

/**
 * Reconstrói um Object3D a partir dos dados serializados pelo worker.
 *
 * @param {Array<Record<string, unknown>>} meshes
 * @param {string} name
 */
export function buildObject(meshes, name) {
  const group = new THREE.Group();
  group.name = name;

  // Deduplica materiais por cor: um OBJ com 400 grupos da mesma cor não
  // deve virar 400 materiais distintos.
  const materialCache = new Map();

  for (const data of meshes) {
    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));

    if (data.normals) {
      geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    }
    if (data.uvs) {
      geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
    }
    if (data.colors) {
      geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    }
    if (data.indices) {
      geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    }

    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const rgb = data.color ?? [0.75, 0.75, 0.75];
    const key = rgb.map((c) => c.toFixed(3)).join(',') + (data.colors ? '|vc' : '');

    let material = materialCache.get(key);
    if (!material) {
      material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(rgb[0], rgb[1], rgb[2]),
        roughness: 0.6,
        metalness: 0.05,
        vertexColors: Boolean(data.colors),
      });
      materialCache.set(key, material);
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = data.name;
    group.add(mesh);
  }

  // Uma malha única não precisa de grupo intermediário.
  if (group.children.length === 1) {
    const only = group.children[0];
    only.name = name;
    group.remove(only);

    return only;
  }

  return group;
}

/** Instância compartilhada. */
export const parseClient = new ParseClient();
