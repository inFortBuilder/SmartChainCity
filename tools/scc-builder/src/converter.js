import * as THREE from 'three';
import JSZip from 'jszip';

import { AssetBundle } from './utils/assets.js';
import { disposeObject3D } from './utils/dispose.js';
import { ParseCancelled, parseClient } from './utils/parseClient.js';
import { repairMaterials, sanitizeForExport, upgradeToPBR } from './utils/materialRepair.js';
import { temOrientacao } from './utils/formatAdvice.js';
import { pruneInvisible } from './utils/sceneEditor.js';
import { t } from './i18n/index.js';

/**
 * Carregamento e exportação de formatos 3D.
 *
 * Mudanças em relação à v1:
 *  A7  loaders carregados sob demanda com import() dinâmico — o bundle
 *      inicial deixa de embutir FBX/DAE/PLY que a maioria dos usuários
 *      nunca aciona.
 *  F5  assets externos (.mtl, .bin, texturas) resolvidos via AssetBundle,
 *      então OBJ e glTF deixam de carregar cinza e sem textura.
 *  F12 progresso reportado durante o parsing.
 */

/** Formatos aceitos na importação. */
export const IMPORT_FORMATS = ['glb', 'gltf', 'obj', 'stl', 'ply', 'fbx', 'dae'];

/** Formatos aceitos na exportação. */
export const EXPORT_FORMATS = ['glb', 'gltf', 'obj', 'stl', 'ply'];

export const ACCEPT_ATTRIBUTE = IMPORT_FORMATS.map((ext) => `.${ext}`).join(',');

/**
 * Decodificadores WASM. Hospedados em CDN por padrão; para uso offline,
 * copie-os para public/ e aponte estas constantes para o caminho local.
 */
export const DRACO_DECODER_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/';
export const KTX2_TRANSCODER_PATH = 'https://unpkg.com/three@0.170.0/examples/jsm/libs/basis/';

export class ModelConverter {
  constructor() {
    /** @type {Map<string, unknown>} cache de loaders já importados */
    this.loaderCache = new Map();
  }

  /**
   * Carrega um modelo 3D.
   *
   * @param {File} file arquivo principal
   * @param {object} [options]
   * @param {File[]} [options.companions] arquivos auxiliares (.mtl, .bin, texturas)
   * @param {(missing: string) => void} [options.onMissingAsset]
   * @param {(percent: number, stage: string) => void} [options.onProgress]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<{object: THREE.Object3D, bundle: AssetBundle, missing: string[]}>}
   */
  async loadModel(file, options = {}) {
    const ext = extensionOf(file.name);

    if (!IMPORT_FORMATS.includes(ext)) {
      // .rvt, .skp, .max… são proprietários e não têm leitor público.
      // Sinalizamos com um código para a UI mostrar o passo a passo de
      // exportação em vez de um "não suportado" seco.
      const erro = new Error(
        temOrientacao(ext)
          ? t('O formato ".^1" precisa ser exportado antes de ser importado.', ext)
          : t('Formato ".^1" não suportado. Aceitos: ^2.', ext, IMPORT_FORMATS.join(', '))
      );
      erro.code = temOrientacao(ext) ? 'formato_nativo' : 'formato_desconhecido';
      erro.extension = ext;

      throw erro;
    }

    const bundle = new AssetBundle([file, ...(options.companions ?? [])]);
    /** @type {string[]} */
    const missing = [];

    const manager = bundle.createManager((url) => {
      missing.push(url);
      options.onMissingAsset?.(url);
    });

    const object = await this.#parse(file, ext, manager, bundle, options);

    if (!object) {
      throw new Error(t('Não foi possível interpretar o arquivo "^1".', file.name));
    }

    object.name = object.name || file.name;

    // Loaders de DAE/OBJ produzem MeshPhongMaterial, que ignora o
    // environment map PBR da cena — o modelo fica chapado ao lado de um GLB.
    const convertidos = ['dae', 'obj', 'fbx'].includes(ext) ? upgradeToPBR(object) : 0;

    // Corrige transparência espúria, face única e colorSpace das texturas.
    const reparo = repairMaterials(object, { format: ext });
    reparo.materiaisConvertidos = convertidos;

    return { object, bundle, missing, reparo };
  }

  async #parse(file, ext, manager, bundle, options = {}) {
    const onProgress = options.onProgress ?? (() => {});

    onProgress(3, t('lendo arquivo'));
    const buffer = await file.arrayBuffer();

    // F12 — arquivos grandes de geometria pura vão para o Web Worker,
    // mantendo a UI responsiva e permitindo cancelar.
    if (parseClient.shouldUseWorker(ext, buffer.byteLength) && !bundle.find('.mtl')) {
      try {
        return await parseClient.parse(buffer, ext, file.name, {
          onProgress,
          signal: options.signal,
        });
      } catch (error) {
        if (error instanceof ParseCancelled) throw error;

        // Worker indisponível ou falhou: refaz na main thread em vez de
        // deixar o usuário sem modelo.
        console.warn('[SCC Builder] Worker falhou, usando a main thread:', error);

        return this.#parseOnMainThread(
          file,
          ext,
          await file.arrayBuffer(),
          manager,
          bundle,
          onProgress
        );
      }
    }

    return this.#parseOnMainThread(file, ext, buffer, manager, bundle, onProgress);
  }

  async #parseOnMainThread(file, ext, buffer, manager, bundle, onProgress = () => {}) {
    onProgress(25, t('interpretando geometria'));

    // Cede um frame antes de bloquear: garante que o spinner apareça.
    await new Promise((resolve) => setTimeout(resolve, 0));

    switch (ext) {
      case 'glb':
      case 'gltf':
        return this.#parseGltf(ext, buffer, manager);
      case 'obj':
        return this.#parseObj(buffer, manager, bundle);
      case 'fbx': {
        const { FBXLoader } = await this.#loader('fbx');
        // resourcePath permite ao loader resolver texturas externas
        return new FBXLoader(manager).parse(buffer, './');
      }
      case 'dae': {
        const { ColladaLoader } = await this.#loader('dae');
        const text = new TextDecoder().decode(buffer);
        return new ColladaLoader(manager).parse(text, './').scene;
      }
      case 'stl': {
        const { STLLoader } = await this.#loader('stl');
        const geometry = new STLLoader().parse(buffer);
        return meshFrom(geometry, file.name, 0x9aa3ab);
      }
      case 'ply': {
        const { PLYLoader } = await this.#loader('ply');
        const geometry = new PLYLoader().parse(buffer);
        geometry.computeVertexNormals();
        return meshFrom(geometry, file.name, 0x8ba7b8);
      }
      default:
        throw new Error(t('Formato ".^1" não suportado.', ext));
    }
  }

  /**
   * F5 — GLTFLoader.parse aceita ArrayBuffer apenas para GLB binário.
   * Para .gltf (JSON) é preciso passar texto e um path base, senão o .bin
   * e as texturas externas nunca resolvem.
   */
  async #parseGltf(ext, buffer, manager) {
    const { GLTFLoader } = await this.#loader('gltf');
    const loader = new GLTFLoader(manager);

    await this.#attachCompressionLoaders(loader);

    const payload = ext === 'glb' ? buffer : new TextDecoder().decode(buffer);

    return new Promise((resolve, reject) => {
      loader.parse(
        payload,
        './',
        (gltf) => {
          gltf.scene.animations = gltf.animations ?? [];
          resolve(gltf.scene);
        },
        reject
      );
    });
  }

  /**
   * Registra DRACOLoader e KTX2Loader quando disponíveis, para abrir os
   * GLBs comprimidos que o nosso próprio pipeline de servidor produz.
   */
  async #attachCompressionLoaders(loader) {
    try {
      if (!this.dracoLoader) {
        const { DRACOLoader } = await import('three/examples/jsm/loaders/DRACOLoader.js');
        this.dracoLoader = new DRACOLoader();
        this.dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
      }
      loader.setDRACOLoader(this.dracoLoader);
    } catch {
      // GLB sem Draco continua abrindo normalmente
    }

    // KTX2 exige o renderer para detectar quais formatos de textura
    // comprimida a GPU do usuário suporta (ASTC, BC7, ETC2…).
    if (!this.renderer) return;

    try {
      if (!this.ktx2Loader) {
        const { KTX2Loader } = await import('three/examples/jsm/loaders/KTX2Loader.js');
        this.ktx2Loader = new KTX2Loader()
          .setTranscoderPath(KTX2_TRANSCODER_PATH)
          .detectSupport(this.renderer);
      }
      loader.setKTX2Loader(this.ktx2Loader);
    } catch {
      // Texturas KTX2 não decodificam, mas a geometria abre
    }
  }

  /**
   * Informa o renderer ao conversor, habilitando texturas KTX2.
   * @param {THREE.WebGLRenderer} renderer
   */
  setRenderer(renderer) {
    this.renderer = renderer;
  }

  /** Libera decodificadores WASM. */
  disposeLoaders() {
    this.dracoLoader?.dispose();
    this.ktx2Loader?.dispose();
    this.dracoLoader = null;
    this.ktx2Loader = null;
  }

  /**
   * OBJ + MTL. A v1 chamava `objLoader.parse(text)` sem MTLLoader, então
   * todo OBJ abria cinza.
   */
  async #parseObj(buffer, manager, bundle) {
    const { OBJLoader } = await this.#loader('obj');
    const loader = new OBJLoader(manager);
    const text = new TextDecoder().decode(buffer);

    const mtlMatch = text.match(/^\s*mtllib\s+(.+)$/m);
    if (mtlMatch) {
      const mtlName = mtlMatch[1].trim();
      const mtlFile = bundle.find(mtlName);

      if (mtlFile) {
        try {
          const { MTLLoader } = await import('three/examples/jsm/loaders/MTLLoader.js');
          const materials = new MTLLoader(manager).parse(await mtlFile.text(), './');
          materials.preload();
          loader.setMaterials(materials);
        } catch (error) {
          console.warn('[SCC Builder] Falha ao aplicar o .mtl:', error);
        }
      }
    }

    return loader.parse(text);
  }

  /** Import dinâmico com cache. */
  async #loader(kind) {
    if (this.loaderCache.has(kind)) {
      return this.loaderCache.get(kind);
    }

    const modules = {
      gltf: () => import('three/examples/jsm/loaders/GLTFLoader.js'),
      obj: () => import('three/examples/jsm/loaders/OBJLoader.js'),
      fbx: () => import('three/examples/jsm/loaders/FBXLoader.js'),
      dae: () => import('three/examples/jsm/loaders/ColladaLoader.js'),
      stl: () => import('three/examples/jsm/loaders/STLLoader.js'),
      ply: () => import('three/examples/jsm/loaders/PLYLoader.js'),
    };

    const module = await modules[kind]();
    this.loaderCache.set(kind, module);

    return module;
  }

  // ── Exportação ───────────────────────────────────────────────────────

  /**
   * @param {THREE.Object3D} object
   * @param {string} format
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<Blob>}
   */
  async exportModel(object, format = 'glb', options = {}) {
    if (!object) {
      throw new Error(t('Nenhum modelo carregado para exportar.'));
    }

    if (!EXPORT_FORMATS.includes(format)) {
      throw new Error(t('Formato de exportação "^1" não suportado.', format));
    }

    this.lastExportReport = null;

    // Exporta uma cópia limpa: colisores e helpers ficam de fora.
    const exportable = cloneWithoutHelpers(object);

    // Texturas que não chegaram a carregar (arquivo ausente) fazem o
    // GLTFExporter abortar com "No valid image data found". Removemos as
    // referências quebradas da CÓPIA antes de exportar.
    // Blocos ocultos não vão para o arquivo. O GLTFExporter tem
    // `onlyVisible`, mas OBJ, STL e PLY não — sem esta poda, ocultar um
    // bloco não teria efeito nesses formatos.
    const podados = pruneInvisible(exportable);

    this.lastExportReport = {
      ...sanitizeForExport(exportable),
      blocosOcultosRemovidos: podados.removidos,
      triangulosRemovidos: podados.triangulosRemovidos,
    };

    switch (format) {
      case 'glb':
      case 'gltf':
        return this.#exportGltf(exportable, format, options);
      case 'stl': {
        const { STLExporter } = await import('three/examples/jsm/exporters/STLExporter.js');
        const result = new STLExporter().parse(exportable, { binary: true });
        return new Blob([result], { type: 'model/stl' });
      }
      case 'obj': {
        const { OBJExporter } = await import('three/examples/jsm/exporters/OBJExporter.js');
        return new Blob([new OBJExporter().parse(exportable)], { type: 'text/plain' });
      }
      case 'ply': {
        const { PLYExporter } = await import('three/examples/jsm/exporters/PLYExporter.js');
        const result = new PLYExporter().parse(exportable, undefined, { binary: true });
        return new Blob([result], { type: 'application/octet-stream' });
      }
      default:
        throw new Error(t('Formato "^1" não suportado.', format));
    }
  }

  async #exportGltf(object, format, options) {
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
    const exporter = new GLTFExporter();

    const settings = {
      binary: format === 'glb',
      embedImages: true,
      onlyVisible: true,
      truncateDrawRange: true,
      maxTextureSize: 4096,
      ...options,
    };

    return new Promise((resolve, reject) => {
      exporter.parse(
        object,
        (result) => {
          if (result instanceof ArrayBuffer) {
            resolve(new Blob([result], { type: 'model/gltf-binary' }));
          } else {
            resolve(new Blob([JSON.stringify(result, null, 2)], { type: 'model/gltf+json' }));
          }
        },
        reject,
        settings
      );
    });
  }

  /**
   * Conversão em lote para um ZIP.
   *
   * @param {File[]} files
   * @param {string} targetFormat
   * @param {(done: number, total: number, name: string) => void} [onProgress]
   * @returns {Promise<{blob: Blob, succeeded: string[], failed: Array<{name: string, error: string}>}>}
   */
  async batchConvertAndZip(files, targetFormat = 'glb', onProgress = () => {}) {
    const zip = new JSZip();
    const folder = zip.folder(`scc_builder_${targetFormat}`);

    const succeeded = [];
    const failed = [];

    // Arquivos auxiliares ficam disponíveis para todos os modelos do lote.
    const companions = files.filter((file) =>
      ['mtl', 'bin', 'jpg', 'jpeg', 'png', 'webp'].includes(extensionOf(file.name))
    );
    const models = files.filter((file) => IMPORT_FORMATS.includes(extensionOf(file.name)));

    let done = 0;

    for (const file of models) {
      onProgress(done, models.length, file.name);

      let loaded = null;
      try {
        loaded = await this.loadModel(file, { companions });
        const blob = await this.exportModel(loaded.object, targetFormat);
        const base = file.name.replace(/\.[^.]+$/, '');

        folder.file(`${base}.${targetFormat}`, blob);
        succeeded.push(file.name);
      } catch (error) {
        failed.push({
          name: file.name,
          error: error instanceof Error ? error.message : String(error),
        });
        console.error(`[SCC Builder] Falha ao converter ${file.name}:`, error);
      } finally {
        // Libera imediatamente: um lote grande esgotaria a memória.
        if (loaded) {
          disposeObject3D(loaded.object);
          loaded.bundle.revoke();
        }
        done++;
        onProgress(done, models.length, file.name);
      }
    }

    if (failed.length > 0) {
      folder.file('_falhas.txt', failed.map((item) => `${item.name}: ${item.error}`).join('\n'));
    }

    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });

    return { blob, succeeded, failed };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

export function extensionOf(name) {
  return (name.split('.').pop() ?? '').toLowerCase();
}

function meshFrom(geometry, name, color) {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;

  return mesh;
}

/** Remove colisores e helpers antes de exportar. */
function cloneWithoutHelpers(object) {
  const clone = object.clone(true);

  const toRemove = [];
  clone.traverse((child) => {
    if (child.userData?.isCollider || child.isTransformControls) {
      toRemove.push(child);
    }
  });

  for (const child of toRemove) {
    child.removeFromParent();
  }

  return clone;
}
