import { Command } from './history.js';
import { disposeObject3D } from './dispose.js';
import { materialsOf } from './materials.js';
import { t } from '../i18n/index.js';

/**
 * Edição de blocos da cena.
 *
 * Um estande de feira exportado do Lumion chega com mobiliário, vegetação,
 * pessoas e luminárias que raramente devem ir para a engine. Antes disso o
 * único caminho era voltar ao software de origem e reexportar.
 *
 * Aqui o usuário oculta ou exclui blocos direto na árvore, e a exportação
 * respeita as escolhas — em todos os formatos, não só glTF.
 *
 * Tudo passa pelo histórico: nada é destrutivo sem Ctrl+Z.
 */

/**
 * Conta os triângulos de uma subárvore.
 * @param {object} object Object3D
 */
export function countTriangles(object) {
  let total = 0;

  object?.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;

    const index = child.geometry.getIndex();
    const position = child.geometry.getAttribute('position');
    if (!position) return;

    total += Math.floor((index ? index.count : position.count) / 3);
  });

  return total;
}

/**
 * O objeto está visível considerando toda a cadeia de pais?
 *
 * `object.visible` é local: um nó marcado como visível dentro de um grupo
 * oculto continua invisível na tela — e é assim que a exportação precisa
 * enxergá-lo.
 *
 * @param {object} object
 */
export function isEffectivelyVisible(object) {
  let atual = object;

  while (atual) {
    if (!atual.visible) return false;
    atual = atual.parent;
  }

  return true;
}

/**
 * Lista os blocos de primeiro nível — o que o usuário entende por "bloco".
 *
 * Em vez de despejar 5 mil malhas, agrupamos pelos filhos diretos da raiz,
 * que normalmente correspondem aos objetos nomeados no software de origem.
 *
 * @param {object} root
 * @returns {Array<{object: object, nome: string, malhas: number, triangulos: number, visivel: boolean}>}
 */
export function listBlocks(root) {
  if (!root) return [];

  const filhos = root.children ?? [];
  const alvo = filhos.length === 1 && (filhos[0].children?.length ?? 0) > 0 ? filhos[0] : root;

  return (alvo.children ?? []).map((child) => {
    let malhas = 0;
    child.traverse((n) => {
      if (n.isMesh) malhas++;
    });

    return {
      object: child,
      nome: child.name || child.type,
      malhas,
      triangulos: countTriangles(child),
      visivel: child.visible,
    };
  });
}

/**
 * Agrupa as malhas por material.
 *
 * É o corte mais útil em arquitetura: "esconder tudo que usa o material
 * Vegetação" costuma ser mais rápido do que caçar os objetos na árvore.
 *
 * @param {object} root
 * @returns {Array<{material: object, nome: string, meshes: object[], triangulos: number, visivel: boolean}>}
 */
export function groupByMaterial(root) {
  /** @type {Map<object, {material: object, nome: string, meshes: object[], triangulos: number}>} */
  const mapa = new Map();
  if (!root) return [];

  root.traverse((child) => {
    if (!child.isMesh) return;

    for (const material of materialsOf(child)) {
      let entrada = mapa.get(material);

      if (!entrada) {
        entrada = {
          material,
          nome: material.name || `Material ${mapa.size + 1}`,
          meshes: [],
          triangulos: 0,
        };
        mapa.set(material, entrada);
      }

      entrada.meshes.push(child);
      entrada.triangulos += countTriangles(child);
    }
  });

  return [...mapa.values()]
    .map((entrada) => ({
      ...entrada,
      visivel: entrada.meshes.some((mesh) => mesh.visible),
    }))
    .sort((a, b) => b.triangulos - a.triangulos);
}

// ── Comandos ─────────────────────────────────────────────────────────────

/** Ocultar ou mostrar um conjunto de objetos. */
export class VisibilityCommand extends Command {
  /**
   * @param {object[]} objects
   * @param {boolean} visible
   * @param {string} [rotulo]
   */
  constructor(objects, visible, rotulo) {
    super(
      rotulo ?? (visible ? t('Mostrar ^1', alvoDe(objects)) : t('Ocultar ^1', alvoDe(objects)))
    );

    this.objects = objects;
    this.visible = visible;
    this.anterior = objects.map((object) => object.visible);
  }

  execute() {
    for (const object of this.objects) {
      object.visible = this.visible;
    }
  }

  undo() {
    this.objects.forEach((object, i) => {
      object.visible = this.anterior[i];
    });
  }
}

/**
 * Excluir objetos da cena.
 *
 * Guardamos pai e índice para que o desfazer reponha cada bloco na posição
 * original da hierarquia, não no fim da lista. Os recursos de GPU só são
 * liberados quando o comando sai do histórico — antes disso o objeto
 * precisa continuar íntegro para o Ctrl+Z.
 */
export class DeleteCommand extends Command {
  /** @param {object[]} objects */
  constructor(objects) {
    super(t('Excluir ^1', alvoDe(objects)));

    // Guarda a posição exata na hierarquia.
    this.registros = objects.map((object) => ({
      object,
      parent: object.parent,
      index: object.parent ? object.parent.children.indexOf(object) : -1,
    }));

    this.descartado = false;
  }

  execute() {
    // Remove do fim para o começo: tirar um filho reordena os índices dos
    // seguintes, e isso corromperia a restauração.
    for (const registro of [...this.registros].sort((a, b) => b.index - a.index)) {
      registro.parent?.remove(registro.object);
    }
  }

  undo() {
    for (const registro of [...this.registros].sort((a, b) => a.index - b.index)) {
      if (!registro.parent) continue;

      registro.parent.add(registro.object);

      // `add` empilha no fim; devolvemos para o índice original.
      if (registro.index >= 0 && registro.index < registro.parent.children.length - 1) {
        const filhos = registro.parent.children;
        filhos.splice(filhos.indexOf(registro.object), 1);
        filhos.splice(registro.index, 0, registro.object);
      }
    }
  }

  /** Libera a memória. Chame só quando o comando sair do histórico. */
  dispose() {
    if (this.descartado) return;
    this.descartado = true;

    for (const registro of this.registros) {
      if (!registro.object.parent) {
        disposeObject3D(registro.object);
      }
    }
  }
}

/** Isolar: esconde tudo, menos os objetos escolhidos e seus ancestrais. */
export class IsolateCommand extends Command {
  /**
   * @param {object} root
   * @param {object[]} objects
   */
  constructor(root, objects) {
    super(t('Isolar ^1', alvoDe(objects)));

    this.root = root;
    this.objects = objects;

    // Snapshot da visibilidade de toda a cena.
    this.snapshot = [];
    root.traverse((child) => {
      this.snapshot.push({ object: child, visible: child.visible });
    });
  }

  execute() {
    const manter = new Set();

    // O objeto isolado, seus descendentes e seus ancestrais precisam
    // continuar visíveis — esconder um pai esconderia o filho junto.
    for (const object of this.objects) {
      object.traverse((child) => manter.add(child));

      let pai = object.parent;
      while (pai) {
        manter.add(pai);
        pai = pai.parent;
      }
    }

    this.root.traverse((child) => {
      child.visible = manter.has(child);
    });
  }

  undo() {
    for (const item of this.snapshot) {
      item.object.visible = item.visible;
    }
  }
}

/** Restaurar a visibilidade de toda a cena. */
export class ShowAllCommand extends Command {
  /** @param {object} root */
  constructor(root) {
    super(t('Mostrar tudo'));

    this.root = root;
    this.snapshot = [];

    root.traverse((child) => {
      this.snapshot.push({ object: child, visible: child.visible });
    });
  }

  execute() {
    this.root.traverse((child) => {
      child.visible = true;
    });
  }

  undo() {
    for (const item of this.snapshot) {
      item.object.visible = item.visible;
    }
  }
}

// ── Utilidades para a exportação ─────────────────────────────────────────

/**
 * Remove os objetos invisíveis de uma cópia da cena.
 *
 * O `GLTFExporter` respeita `onlyVisible`, mas OBJ, STL e PLY não têm essa
 * opção — sem esta poda, ocultar um bloco não teria efeito nenhum ao
 * exportar nesses formatos.
 *
 * @param {object} root cópia, nunca o modelo da viewport
 * @returns {{removidos: number, triangulosRemovidos: number}}
 */
export function pruneInvisible(root) {
  const relatorio = { removidos: 0, triangulosRemovidos: 0 };
  if (!root) return relatorio;

  /** @type {object[]} */
  const remover = [];

  root.traverse((child) => {
    if (child !== root && !child.visible) remover.push(child);
  });

  for (const object of remover) {
    // Um ancestral já removido leva o descendente junto.
    if (!object.parent) continue;

    relatorio.triangulosRemovidos += countTriangles(object);
    relatorio.removidos++;
    object.removeFromParent();
    disposeObject3D(object);
  }

  return relatorio;
}

/**
 * Estatísticas do que será exportado, considerando a visibilidade.
 * @param {object} root
 */
export function exportPreview(root) {
  let visiveis = 0;
  let ocultos = 0;
  let triangulosVisiveis = 0;
  let triangulosOcultos = 0;

  root?.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;

    const index = child.geometry.getIndex();
    const position = child.geometry.getAttribute('position');
    if (!position) return;

    const tris = Math.floor((index ? index.count : position.count) / 3);

    if (isEffectivelyVisible(child)) {
      visiveis++;
      triangulosVisiveis += tris;
    } else {
      ocultos++;
      triangulosOcultos += tris;
    }
  });

  return { visiveis, ocultos, triangulosVisiveis, triangulosOcultos };
}

function nomeDe(object) {
  return object?.name || object?.type || t('bloco');
}

/** "Parede_01" ou "3 blocos": o alvo no rótulo do histórico. */
function alvoDe(objects) {
  return objects.length === 1 ? nomeDe(objects[0]) : t('^1 blocos', objects.length);
}
