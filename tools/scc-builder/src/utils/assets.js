import * as THREE from 'three';

/**
 * Resolução de assets externos (F5 da auditoria).
 *
 * Um OBJ referencia um .mtl, que referencia .jpg/.png. Um .gltf referencia
 * .bin e texturas. Um FBX sem "Embed Media" referencia uma pasta de texturas.
 * A v1 chamava os parsers com resourcePath vazio, então TODO modelo carregava
 * cinza e sem textura.
 *
 * Aqui montamos um LoadingManager que intercepta cada URL pedida pelo loader
 * e a redireciona para o File correspondente que o usuário arrastou, via
 * `URL.createObjectURL`.
 */
export class AssetBundle {
  /**
   * @param {File[]} files todos os arquivos soltos na dropzone
   */
  constructor(files = []) {
    /** @type {Map<string, File>} chave: nome de arquivo em minúsculas */
    this.byName = new Map();
    /** @type {Map<string, string>} chave: nome, valor: object URL */
    this.objectUrls = new Map();

    for (const file of files) {
      this.byName.set(this.#normalize(file.name), file);
      // Também indexa pelo caminho relativo, quando vem de uma pasta.
      const relative = file.webkitRelativePath;
      if (relative) {
        this.byName.set(this.#normalize(relative), file);
      }
    }
  }

  #normalize(name) {
    return name.replace(/\\/g, '/').toLowerCase();
  }

  /** Só o nome final, sem diretórios. */
  #baseName(url) {
    return this.#normalize(url).split('/').pop() ?? '';
  }

  /**
   * Localiza um arquivo pelo nome, tolerando diferenças de caminho e caixa.
   * @param {string} url
   * @returns {File|null}
   */
  find(url) {
    const normalized = this.#normalize(url);

    return this.byName.get(normalized) ?? this.byName.get(this.#baseName(url)) ?? null;
  }

  /**
   * Devolve (criando se preciso) um object URL para o arquivo pedido.
   * @param {string} url
   * @returns {string|null}
   */
  urlFor(url) {
    const file = this.find(url);
    if (!file) return null;

    const key = this.#normalize(file.name);
    let objectUrl = this.objectUrls.get(key);

    if (!objectUrl) {
      objectUrl = URL.createObjectURL(file);
      this.objectUrls.set(key, objectUrl);
    }

    return objectUrl;
  }

  /**
   * LoadingManager que redireciona as URLs para os arquivos do bundle.
   * @param {(missing: string) => void} [onMissing]
   */
  createManager(onMissing = () => {}) {
    const manager = new THREE.LoadingManager();

    manager.setURLModifier((url) => {
      // Data URIs e blobs já resolvidos passam direto.
      if (url.startsWith('data:') || url.startsWith('blob:')) return url;

      const resolved = this.urlFor(url);
      if (resolved) return resolved;

      onMissing(url);

      // Devolve a URL original: o loader falhará apenas nesse asset,
      // e não no modelo inteiro.
      return url;
    });

    return manager;
  }

  /** Lista de arquivos que não são o modelo principal. */
  companions(mainFileName) {
    const main = this.#normalize(mainFileName);

    return [...this.byName.values()].filter((file) => this.#normalize(file.name) !== main);
  }

  /** Libera todos os object URLs criados. Chame ao trocar de modelo. */
  revoke() {
    for (const url of this.objectUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.objectUrls.clear();
  }
}

/**
 * Escolhe, dentro de uma lista de arquivos, qual é o modelo principal.
 * Arquivos auxiliares (.mtl, .bin, texturas) nunca são escolhidos.
 *
 * @param {File[]} files
 * @returns {File|null}
 */
export function pickMainModel(files) {
  const priority = ['glb', 'gltf', 'fbx', 'dae', 'obj', 'stl', 'ply'];

  const withExt = files.map((file) => ({
    file,
    ext: (file.name.split('.').pop() ?? '').toLowerCase(),
  }));

  for (const ext of priority) {
    const match = withExt.find((item) => item.ext === ext);
    if (match) return match.file;
  }

  return files[0] ?? null;
}

/** Extensões que são assets de apoio, não modelos. */
export const COMPANION_EXTENSIONS = new Set([
  'mtl',
  'bin',
  'jpg',
  'jpeg',
  'png',
  'webp',
  'ktx2',
  'tga',
  'bmp',
]);

/**
 * Extrai File[] de um evento de drop, incluindo o conteúdo de pastas
 * arrastadas (quando o browser expõe a API de entries).
 *
 * @param {DataTransfer} dataTransfer
 * @returns {Promise<File[]>}
 */
export async function filesFromDrop(dataTransfer) {
  const items = [...(dataTransfer.items ?? [])];

  const entries = items
    .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
    .filter(Boolean);

  if (entries.length === 0) {
    return [...dataTransfer.files];
  }

  /** @type {File[]} */
  const files = [];
  await Promise.all(entries.map((entry) => walkEntry(entry, files)));

  return files.length > 0 ? files : [...dataTransfer.files];
}

async function walkEntry(entry, out, depth = 0) {
  if (depth > 6) return; // proteção contra estruturas patológicas

  if (entry.isFile) {
    await new Promise((resolve) => {
      entry.file((file) => {
        out.push(file);
        resolve();
      }, resolve);
    });

    return;
  }

  if (entry.isDirectory) {
    const reader = entry.createReader();
    const children = await new Promise((resolve) => {
      reader.readEntries(resolve, () => resolve([]));
    });

    await Promise.all(children.map((child) => walkEntry(child, out, depth + 1)));
  }
}
