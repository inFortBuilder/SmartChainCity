import * as THREE from 'three';

import { Command } from './history.js';
import { t } from '../i18n/index.js';
import { countTriangles } from './sceneEditor.js';
import { materialsOf } from './materials.js';

/**
 * Camadas (layers).
 *
 * CAD e BIM organizam o projeto em camadas — "Paredes", "Esquadrias",
 * "Mobiliário". Ao exportar para FBX ou DAE essa estrutura costuma se
 * perder: sobra uma lista plana de malhas, às vezes com o nome da camada
 * embutido no nome do objeto (`Parede_Externa_01`, `MOB-cadeira-03`).
 *
 * Aqui a camada é reconstruída a partir do que sobrou. Três estratégias,
 * porque nenhuma serve para todos os arquivos:
 *
 * - NOME: usa o prefixo antes do primeiro separador. Funciona quando o
 *   exportador preservou a nomenclatura do CAD — o melhor caso.
 * - MATERIAL: agrupa pelo material. Funciona sempre, e em arquitetura o
 *   material quase sempre corresponde a um sistema construtivo.
 * - HIERARQUIA: usa o grupo pai. Funciona quando o arquivo já veio
 *   organizado em grupos.
 */

export const LAYER_MODES = ['nome', 'material', 'hierarquia'];

/** Separadores usados pelos exportadores para compor nomes. */
const SEPARADORES = /[_\-:.#|/\\]/;

/**
 * Extrai o nome da camada a partir do nome do objeto.
 *
 * `Parede_Externa_01` → `Parede`
 * `MOB-cadeira-03`    → `MOB`
 * `Piso`              → `Piso`
 *
 * Sufixos puramente numéricos são descartados: `Mesh_012` vira `Mesh`, não
 * uma camada por número.
 *
 * @param {string} nome
 * @returns {string}
 */
export function layerFromName(nome) {
  const limpo = String(nome ?? '').trim();

  if (limpo === '') return 'Sem nome';

  const partes = limpo.split(SEPARADORES).filter((parte) => parte !== '');

  if (partes.length === 0) return 'Sem nome';

  // Um nome que é só número não identifica camada nenhuma.
  const primeiro = partes[0];
  if (/^\d+$/.test(primeiro)) return 'Sem nome';

  return primeiro;
}

/**
 * Detecta as camadas de um modelo.
 *
 * @param {THREE.Object3D} root
 * @param {'nome'|'material'|'hierarquia'} modo
 * @returns {Array<{nome: string, objetos: THREE.Object3D[], triangulos: number, visivel: boolean, cor: string|null}>}
 */
export function detectLayers(root, modo = 'nome') {
  /** @type {Map<string, {nome: string, objetos: THREE.Object3D[], triangulos: number, cor: string|null}>} */
  const mapa = new Map();

  if (!root) return [];

  root.traverse((child) => {
    if (!child.isMesh) return;

    const { chave, cor } = chaveDaCamada(child, modo, root);

    let camada = mapa.get(chave);
    if (!camada) {
      camada = { nome: chave, objetos: [], triangulos: 0, cor };
      mapa.set(chave, camada);
    }

    camada.objetos.push(child);
    camada.triangulos += countTriangles(child);
  });

  return [...mapa.values()]
    .map((camada) => ({
      ...camada,
      visivel: camada.objetos.some((objeto) => objeto.visible),
    }))
    .sort((a, b) => b.triangulos - a.triangulos);
}

function chaveDaCamada(mesh, modo, root) {
  if (modo === 'material') {
    const material = materialsOf(mesh)[0];

    return {
      chave: material?.name || 'Sem material',
      cor: material?.color ? `#${material.color.getHexString()}` : null,
    };
  }

  if (modo === 'hierarquia') {
    // O pai imediato, exceto quando é a própria raiz — nesse caso a
    // hierarquia não separa nada e caímos no nome.
    const pai = mesh.parent;

    if (pai && pai !== root) {
      return { chave: pai.name || pai.type, cor: null };
    }

    return { chave: layerFromName(mesh.name), cor: null };
  }

  return { chave: layerFromName(mesh.name), cor: null };
}

/**
 * Compara as estratégias e sugere a que separa melhor.
 *
 * "Melhor" aqui é a que produz mais de uma camada sem estilhaçar a cena:
 * 40 camadas para 45 malhas não organiza nada, é ruído.
 *
 * @param {THREE.Object3D} root
 * @returns {{modo: string, camadas: number, motivo: string}}
 */
export function suggestLayerMode(root) {
  let malhas = 0;
  root?.traverse((child) => {
    if (child.isMesh) malhas++;
  });

  if (malhas === 0) {
    return { modo: 'nome', camadas: 0, motivo: t('Nenhuma malha na cena.') };
  }

  const candidatos = LAYER_MODES.map((modo) => ({
    modo,
    camadas: detectLayers(root, modo).length,
  }));

  // Descarta o que não separa (1 camada) e o que estilhaça (quase 1:1).
  const limiteEstilhaco = Math.max(2, malhas * 0.8);

  const viaveis = candidatos.filter((item) => item.camadas > 1 && item.camadas <= limiteEstilhaco);

  if (viaveis.length === 0) {
    const porMaterial = candidatos.find((item) => item.modo === 'material');

    return {
      modo: 'material',
      camadas: porMaterial?.camadas ?? 1,
      motivo: t(
        'Os nomes das malhas não indicam camadas. Agrupar por material é o caminho mais confiável neste arquivo.'
      ),
    };
  }

  // Entre os viáveis, o que gera menos camadas costuma ser o mais legível.
  const melhor = viaveis.sort((a, b) => a.camadas - b.camadas)[0];

  const explicacoes = {
    nome: t('Os nomes das malhas seguem uma convenção de camadas.'),
    material: t('O material identifica bem os sistemas construtivos.'),
    hierarquia: t('O arquivo já veio organizado em grupos.'),
  };

  return {
    modo: melhor.modo,
    camadas: melhor.camadas,
    motivo: explicacoes[melhor.modo],
  };
}

/**
 * Reorganiza a cena em grupos, um por camada.
 *
 * Diferente de apenas listar: aqui a hierarquia é de fato reescrita, então
 * a árvore, a exportação e o editor de blocos passam a enxergar as camadas
 * como estrutura real.
 */
export class OrganizeInLayersCommand extends Command {
  /**
   * @param {THREE.Object3D} root
   * @param {'nome'|'material'|'hierarquia'} modo
   */
  constructor(root, modo) {
    const camadas = detectLayers(root, modo);

    const nomesModo = { nome: t('nome'), material: t('material'), hierarquia: t('hierarquia') };

    super(t('Organizar em ^1 camada(s) por ^2', camadas.length, nomesModo[modo] ?? modo));

    this.root = root;
    this.modo = modo;
    this.camadas = camadas;

    // Guarda a posição original de cada malha para o desfazer.
    this.original = [];
    root.traverse((child) => {
      if (child.isMesh) {
        this.original.push({
          objeto: child,
          pai: child.parent,
          indice: child.parent ? child.parent.children.indexOf(child) : -1,
        });
      }
    });

    this.grupos = [];
  }

  execute() {
    this.grupos = [];

    for (const camada of this.camadas) {
      const grupo = new THREE.Group();
      grupo.name = camada.nome;
      grupo.userData.__layer = true;

      // `add` já remove do pai anterior; a ordem dentro da camada segue a
      // ordem de descoberta, que é a da cena original.
      for (const objeto of camada.objetos) {
        grupo.add(objeto);
      }

      this.root.add(grupo);
      this.grupos.push(grupo);
    }
  }

  undo() {
    // Devolve cada malha ao pai e ao índice originais.
    for (const registro of [...this.original].sort((a, b) => a.indice - b.indice)) {
      if (!registro.pai) continue;

      registro.pai.add(registro.objeto);

      const filhos = registro.pai.children;
      if (registro.indice >= 0 && registro.indice < filhos.length - 1) {
        filhos.splice(filhos.indexOf(registro.objeto), 1);
        filhos.splice(registro.indice, 0, registro.objeto);
      }
    }

    for (const grupo of this.grupos) {
      grupo.removeFromParent();
    }

    this.grupos = [];
  }
}

/**
 * Renomeia uma camada — e, com ela, o grupo correspondente na cena.
 */
export class RenameLayerCommand extends Command {
  /**
   * @param {THREE.Object3D} grupo
   * @param {string} novoNome
   */
  constructor(grupo, novoNome) {
    super(t('Renomear camada para "^1"', novoNome));

    this.grupo = grupo;
    this.novoNome = novoNome;
    this.anterior = grupo.name;
  }

  execute() {
    this.grupo.name = this.novoNome;
  }

  undo() {
    this.grupo.name = this.anterior;
  }
}

/**
 * Substitui uma malha pelas partes resultantes da divisão.
 *
 * As partes entram na posição que a original ocupava, preservando a ordem
 * da árvore. O desfazer devolve a malha inteira.
 */
export class SplitMeshCommand extends Command {
  /**
   * @param {THREE.Mesh} original
   * @param {THREE.Mesh[]} partes
   */
  constructor(original, partes) {
    super(t('Dividir ^1 em ^2 partes', original.name || t('malha'), partes.length));

    this.original = original;
    this.partes = partes;
    this.pai = original.parent;
    this.indice = this.pai ? this.pai.children.indexOf(original) : -1;
  }

  execute() {
    if (!this.pai) return;

    this.pai.remove(this.original);

    for (const parte of this.partes) {
      this.pai.add(parte);
    }
  }

  undo() {
    if (!this.pai) return;

    for (const parte of this.partes) {
      this.pai.remove(parte);
    }

    this.pai.add(this.original);

    const filhos = this.pai.children;
    if (this.indice >= 0 && this.indice < filhos.length - 1) {
      filhos.splice(filhos.indexOf(this.original), 1);
      filhos.splice(this.indice, 0, this.original);
    }
  }

  /** Libera as geometrias das partes descartadas. */
  dispose() {
    for (const parte of this.partes) {
      if (!parte.parent) parte.geometry?.dispose();
    }
  }
}

/**
 * A cena já está organizada em camadas?
 * @param {THREE.Object3D} root
 */
export function isOrganized(root) {
  return (root?.children ?? []).some((child) => child.userData?.__layer === true);
}

/** Lista os grupos de camada existentes na cena. */
export function existingLayers(root) {
  return (root?.children ?? []).filter((child) => child.userData?.__layer === true);
}
