import * as THREE from 'three';
import { locale, t } from '../i18n/index.js';

/**
 * Divisão de malhas.
 *
 * O problema concreto: um `.dae` do Lumion costuma chegar com tudo em
 * poucas malhas gigantes e nomes inúteis (`Mesh`, `Mesh`, `Mesh`). Não dá
 * para ocultar só as cadeiras, nem aplicar material só no piso, porque
 * cadeira e piso são o mesmo objeto para o viewer.
 *
 * Três estratégias, da mais útil para a mais simples:
 *
 * 1. COMPONENTES CONECTADOS — separa ilhas de geometria. Cada cadeira, cada
 *    mesa, cada peça solta vira um objeto próprio. É o que resolve o caso
 *    acima, e o mais caro de calcular.
 * 2. GRUPOS DE MATERIAL — separa uma malha multi-material em uma malha por
 *    material. Barato e exato.
 * 3. FATIAMENTO ESPACIAL — divide por posição no eixo escolhido. Último
 *    recurso quando a geometria é uma casca contínua (uma fachada inteira).
 */

/** Acima disto, a divisão por conectividade é pesada demais para a UI. */
export const LIMITE_TRIANGULOS = 400_000;

/**
 * Union-find com compressão de caminho e união por tamanho.
 *
 * A operação é praticamente O(1) amortizado — indispensável aqui, já que
 * uma malha de estande tem centenas de milhares de arestas para unir.
 */
class UnionFind {
  constructor(tamanho) {
    this.pai = new Int32Array(tamanho);
    this.peso = new Int32Array(tamanho).fill(1);

    for (let i = 0; i < tamanho; i++) this.pai[i] = i;
  }

  find(x) {
    let raiz = x;
    while (this.pai[raiz] !== raiz) raiz = this.pai[raiz];

    // Compressão: aponta todo o caminho direto para a raiz.
    while (this.pai[x] !== raiz) {
      const proximo = this.pai[x];
      this.pai[x] = raiz;
      x = proximo;
    }

    return raiz;
  }

  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;

    // Anexa a árvore menor à maior, para manter a profundidade baixa.
    if (this.peso[ra] < this.peso[rb]) {
      this.pai[ra] = rb;
      this.peso[rb] += this.peso[ra];
    } else {
      this.pai[rb] = ra;
      this.peso[ra] += this.peso[rb];
    }

    return true;
  }
}

/**
 * Mapeia vértices coincidentes para um índice único.
 *
 * Necessário porque OBJ e DAE frequentemente chegam não indexados: cada
 * triângulo repete seus três vértices. Sem soldar por posição, todo
 * triângulo pareceria uma ilha isolada e a divisão devolveria 85 mil
 * "componentes".
 *
 * @param {THREE.BufferAttribute} position
 * @param {number} tolerancia
 * @returns {Int32Array} índice canônico de cada vértice
 */
function mapearVerticesCoincidentes(position, tolerancia = 1e-4) {
  const total = position.count;
  const canonico = new Int32Array(total);
  const mapa = new Map();

  // Quantiza a posição: vértices dentro da tolerância caem na mesma chave.
  const inverso = 1 / tolerancia;

  for (let i = 0; i < total; i++) {
    const x = Math.round(position.getX(i) * inverso);
    const y = Math.round(position.getY(i) * inverso);
    const z = Math.round(position.getZ(i) * inverso);

    const chave = `${x},${y},${z}`;
    const existente = mapa.get(chave);

    if (existente === undefined) {
      mapa.set(chave, i);
      canonico[i] = i;
    } else {
      canonico[i] = existente;
    }
  }

  return canonico;
}

/**
 * Separa a geometria em componentes conectados.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {{tolerancia?: number, minTriangulos?: number}} [options]
 * @returns {THREE.BufferGeometry[]} uma geometria por componente
 */
export function splitByConnectivity(geometry, options = {}) {
  const position = geometry.getAttribute('position');
  if (!position) return [];

  const tolerancia = options.tolerancia ?? 1e-4;
  const minTriangulos = options.minTriangulos ?? 1;

  const index = geometry.getIndex();
  const totalTriangulos = Math.floor((index ? index.count : position.count) / 3);

  if (totalTriangulos === 0) return [];

  const canonico = mapearVerticesCoincidentes(position, tolerancia);
  const uf = new UnionFind(position.count);

  // Une os três vértices de cada triângulo: se compartilham posição com
  // outro triângulo, ambos caem no mesmo componente.
  const indiceDe = (t, offset) => (index ? index.getX(t * 3 + offset) : t * 3 + offset);

  for (let t = 0; t < totalTriangulos; t++) {
    const a = canonico[indiceDe(t, 0)];
    const b = canonico[indiceDe(t, 1)];
    const c = canonico[indiceDe(t, 2)];

    uf.union(a, b);
    uf.union(b, c);
  }

  // Agrupa os triângulos pelo componente da sua raiz.
  /** @type {Map<number, number[]>} */
  const componentes = new Map();

  for (let t = 0; t < totalTriangulos; t++) {
    const raiz = uf.find(canonico[indiceDe(t, 0)]);

    let lista = componentes.get(raiz);
    if (!lista) {
      lista = [];
      componentes.set(raiz, lista);
    }
    lista.push(t);
  }

  // Um único componente significa que a malha já era indivisível.
  if (componentes.size <= 1) return [];

  const resultado = [];

  for (const triangulos of componentes.values()) {
    if (triangulos.length < minTriangulos) continue;

    resultado.push(extrairTriangulos(geometry, triangulos, index));
  }

  // Maiores primeiro: a lista fica mais útil na árvore.
  resultado.sort((a, b) => contarTriangulos(b) - contarTriangulos(a));

  return resultado;
}

function contarTriangulos(geometry) {
  const index = geometry.getIndex();
  const position = geometry.getAttribute('position');

  return Math.floor((index ? index.count : position.count) / 3);
}

/**
 * Constrói uma geometria nova com apenas os triângulos informados.
 *
 * Copia todos os atributos presentes (posição, normal, uv, cor), então a
 * peça extraída mantém a aparência original.
 */
function extrairTriangulos(origem, triangulos, index) {
  const nova = new THREE.BufferGeometry();
  const atributos = Object.keys(origem.attributes);

  const indiceDe = (t, offset) => (index ? index.getX(t * 3 + offset) : t * 3 + offset);

  for (const nome of atributos) {
    const atributo = origem.getAttribute(nome);
    const itemSize = atributo.itemSize;
    const destino = new Float32Array(triangulos.length * 3 * itemSize);

    let escrita = 0;

    for (const t of triangulos) {
      for (let canto = 0; canto < 3; canto++) {
        const origemIndice = indiceDe(t, canto);

        for (let c = 0; c < itemSize; c++) {
          destino[escrita++] = atributo.array[origemIndice * itemSize + c];
        }
      }
    }

    nova.setAttribute(nome, new THREE.BufferAttribute(destino, itemSize));
  }

  nova.computeBoundingBox();
  nova.computeBoundingSphere();

  return nova;
}

/**
 * Separa uma malha multi-material em uma malha por material.
 *
 * O glTF e o FBX guardam isso em `geometry.groups`: cada grupo aponta um
 * intervalo de índices e o material correspondente.
 *
 * @param {THREE.Mesh} mesh
 * @returns {THREE.Mesh[]}
 */
export function splitByMaterialGroups(mesh) {
  const geometry = mesh.geometry;
  const grupos = geometry.groups ?? [];

  if (grupos.length <= 1 || !Array.isArray(mesh.material)) return [];

  const index = geometry.getIndex();
  const resultado = [];

  for (const [i, grupo] of grupos.entries()) {
    const triangulos = [];
    const inicio = Math.floor(grupo.start / 3);
    const fim = inicio + Math.floor(grupo.count / 3);

    for (let t = inicio; t < fim; t++) triangulos.push(t);

    if (triangulos.length === 0) continue;

    const nova = extrairTriangulos(geometry, triangulos, index);
    const material = mesh.material[grupo.materialIndex] ?? mesh.material[0];

    const parte = new THREE.Mesh(nova, material);
    parte.name = `${mesh.name || 'Mesh'}_${material?.name || `mat${i}`}`;
    parte.position.copy(mesh.position);
    parte.quaternion.copy(mesh.quaternion);
    parte.scale.copy(mesh.scale);

    resultado.push(parte);
  }

  return resultado;
}

/**
 * Fatia a geometria por posição em um eixo.
 *
 * Serve para quebrar uma casca contínua — uma fachada inteira em uma malha
 * só — em pedaços gerenciáveis. Cada triângulo vai para a fatia do seu
 * centroide, então nenhum triângulo é cortado ao meio.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {'x'|'y'|'z'} eixo
 * @param {number} fatias
 * @returns {THREE.BufferGeometry[]}
 */
export function splitBySlices(geometry, eixo = 'y', fatias = 4) {
  const position = geometry.getAttribute('position');
  if (!position || fatias < 2) return [];

  geometry.computeBoundingBox();
  const box = geometry.boundingBox;

  const min = box.min[eixo];
  const max = box.max[eixo];
  const alcance = max - min;

  if (Math.abs(alcance) < 1e-6) return [];

  const index = geometry.getIndex();
  const totalTriangulos = Math.floor((index ? index.count : position.count) / 3);
  const indiceDe = (t, offset) => (index ? index.getX(t * 3 + offset) : t * 3 + offset);

  const componente = { x: 0, y: 1, z: 2 }[eixo];
  const baldes = Array.from({ length: fatias }, () => []);

  for (let t = 0; t < totalTriangulos; t++) {
    // Centroide decide a fatia: assim o triângulo fica inteiro em uma só.
    let soma = 0;
    for (let canto = 0; canto < 3; canto++) {
      soma += position.array[indiceDe(t, canto) * 3 + componente];
    }

    const centro = soma / 3;
    const fatia = Math.min(
      fatias - 1,
      Math.max(0, Math.floor(((centro - min) / alcance) * fatias))
    );

    baldes[fatia].push(t);
  }

  return baldes
    .filter((balde) => balde.length > 0)
    .map((balde) => extrairTriangulos(geometry, balde, index));
}

/** Modos de divisão disponíveis. */
export const SPLIT_MODES = ['conectividade', 'material', 'fatias'];

/**
 * Divide uma malha e devolve as partes como novos objetos.
 *
 * @param {THREE.Mesh} mesh
 * @param {{modo?: string, eixo?: 'x'|'y'|'z', fatias?: number, minTriangulos?: number}} [options]
 * @returns {{partes: THREE.Mesh[], motivo: string|null}}
 */
export function splitMesh(mesh, options = {}) {
  if (!mesh?.isMesh || !mesh.geometry) {
    return { partes: [], motivo: t('O objeto selecionado não é uma malha.') };
  }

  const modo = options.modo ?? 'conectividade';
  const triangulos = contarTriangulos(mesh.geometry);

  if (modo === 'material') {
    const partes = splitByMaterialGroups(mesh);

    return partes.length > 0
      ? { partes, motivo: null }
      : { partes: [], motivo: t('A malha não tem grupos de material para separar.') };
  }

  if (modo === 'fatias') {
    const geometrias = splitBySlices(mesh.geometry, options.eixo ?? 'y', options.fatias ?? 4);

    return geometrias.length > 1
      ? { partes: montarMalhas(geometrias, mesh, 'fatia'), motivo: null }
      : { partes: [], motivo: t('Não foi possível fatiar esta geometria.') };
  }

  if (triangulos > LIMITE_TRIANGULOS) {
    return {
      partes: [],
      motivo: t(
        'A malha tem ^1 triângulos — acima do limite de ^2 para divisão por conectividade. Simplifique antes, ou use a divisão por fatias.',
        triangulos.toLocaleString(locale),
        LIMITE_TRIANGULOS.toLocaleString(locale)
      ),
    };
  }

  const geometrias = splitByConnectivity(mesh.geometry, {
    minTriangulos: options.minTriangulos ?? 1,
  });

  if (geometrias.length === 0) {
    return {
      partes: [],
      motivo: t('A malha é uma peça única — não há ilhas de geometria para separar.'),
    };
  }

  return { partes: montarMalhas(geometrias, mesh, 'parte'), motivo: null };
}

/** Monta malhas a partir das geometrias, herdando material e transform. */
function montarMalhas(geometrias, original, prefixo) {
  const base = original.name || 'Mesh';

  return geometrias.map((geometry, i) => {
    const parte = new THREE.Mesh(geometry, original.material);
    parte.name = `${base}_${prefixo}${String(i + 1).padStart(3, '0')}`;

    parte.position.copy(original.position);
    parte.quaternion.copy(original.quaternion);
    parte.scale.copy(original.scale);
    parte.castShadow = original.castShadow;
    parte.receiveShadow = original.receiveShadow;

    return parte;
  });
}

/**
 * Estimativa de quantas partes sairiam, sem construir as geometrias.
 *
 * Usada para avisar antes de uma operação cara: dividir uma malha em 4 mil
 * pedaços deixaria a árvore inutilizável.
 *
 * @param {THREE.Mesh} mesh
 * @returns {{componentes: number, triangulos: number, viavel: boolean}}
 */
export function previewSplit(mesh) {
  const geometry = mesh?.geometry;
  const position = geometry?.getAttribute('position');

  if (!position) return { componentes: 0, triangulos: 0, viavel: false };

  const triangulos = contarTriangulos(geometry);

  if (triangulos > LIMITE_TRIANGULOS) {
    return { componentes: 0, triangulos, viavel: false };
  }

  const index = geometry.getIndex();
  const canonico = mapearVerticesCoincidentes(position);
  const uf = new UnionFind(position.count);
  const indiceDe = (t, offset) => (index ? index.getX(t * 3 + offset) : t * 3 + offset);

  for (let t = 0; t < triangulos; t++) {
    const a = canonico[indiceDe(t, 0)];
    const b = canonico[indiceDe(t, 1)];
    const c = canonico[indiceDe(t, 2)];

    uf.union(a, b);
    uf.union(b, c);
  }

  const raizes = new Set();
  for (let t = 0; t < triangulos; t++) {
    raizes.add(uf.find(canonico[indiceDe(t, 0)]));
  }

  return { componentes: raizes.size, triangulos, viavel: true };
}
