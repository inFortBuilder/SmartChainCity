import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  DeleteCommand,
  IsolateCommand,
  ShowAllCommand,
  VisibilityCommand,
  countTriangles,
  exportPreview,
  groupByMaterial,
  isEffectivelyVisible,
  listBlocks,
  pruneInvisible,
} from '../src/utils/sceneEditor.js';
import { History } from '../src/utils/history.js';

/** Cena parecida com um estande: raiz → blocos nomeados → malhas. */
function estande() {
  const raiz = new THREE.Group();
  raiz.name = 'Estande';

  const nomes = ['Paredes', 'Mobiliario', 'Vegetacao'];

  for (const nome of nomes) {
    const bloco = new THREE.Group();
    bloco.name = nome;

    // Um material por bloco, compartilhado pelas malhas — é assim que os
    // exportadores de arquitetura organizam a cena.
    const material = new THREE.MeshStandardMaterial({ name: `${nome}_Mat` });

    for (let i = 0; i < 2; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
      mesh.name = `${nome}_${i}`;
      bloco.add(mesh);
    }

    raiz.add(bloco);
  }

  return raiz;
}

describe('countTriangles', () => {
  it('soma os triângulos da subárvore', () => {
    // BoxGeometry = 12 triângulos; 6 malhas na cena.
    expect(countTriangles(estande())).toBe(72);
  });

  it('conta apenas o bloco pedido', () => {
    const raiz = estande();

    expect(countTriangles(raiz.children[0])).toBe(24);
  });

  it('devolve zero para grupo vazio', () => {
    expect(countTriangles(new THREE.Group())).toBe(0);
  });
});

describe('isEffectivelyVisible', () => {
  it('considera a cadeia de pais', () => {
    const raiz = estande();
    const bloco = raiz.children[0];
    const mesh = bloco.children[0];

    expect(isEffectivelyVisible(mesh)).toBe(true);

    // A malha continua "visible", mas o pai oculto a esconde na tela.
    bloco.visible = false;

    expect(mesh.visible).toBe(true);
    expect(isEffectivelyVisible(mesh)).toBe(false);
  });
});

describe('listBlocks', () => {
  it('lista os blocos de primeiro nível com métricas', () => {
    const blocos = listBlocks(estande());

    expect(blocos).toHaveLength(3);
    expect(blocos[0].nome).toBe('Paredes');
    expect(blocos[0].malhas).toBe(2);
    expect(blocos[0].triangulos).toBe(24);
  });

  it('desce um nível quando a raiz tem um único filho', () => {
    // Loaders costumam envolver tudo em um wrapper; listar o wrapper
    // sozinho não ajudaria ninguém.
    const wrapper = new THREE.Group();
    wrapper.add(estande());

    expect(listBlocks(wrapper)).toHaveLength(3);
  });

  it('devolve lista vazia sem raiz', () => {
    expect(listBlocks(null)).toEqual([]);
  });
});

describe('groupByMaterial', () => {
  it('agrupa as malhas por material e ordena por peso', () => {
    const grupos = groupByMaterial(estande());

    expect(grupos).toHaveLength(3);
    expect(grupos[0].meshes).toHaveLength(2);
    expect(grupos[0].triangulos).toBeGreaterThanOrEqual(grupos[1].triangulos);
  });

  it('marca como oculto quando nenhuma malha está visível', () => {
    const raiz = estande();
    for (const mesh of raiz.children[0].children) {
      mesh.visible = false;
    }

    const grupo = groupByMaterial(raiz).find((g) => g.nome === 'Paredes_Mat');

    expect(grupo.visivel).toBe(false);
  });
});

describe('VisibilityCommand', () => {
  it('oculta e restaura', () => {
    const raiz = estande();
    const alvos = [raiz.children[0], raiz.children[1]];

    const comando = new VisibilityCommand(alvos, false);
    comando.execute();

    expect(alvos.every((o) => !o.visible)).toBe(true);

    comando.undo();
    expect(alvos.every((o) => o.visible)).toBe(true);
  });

  it('preserva o estado anterior de cada objeto', () => {
    const raiz = estande();
    raiz.children[0].visible = false;

    const comando = new VisibilityCommand([raiz.children[0], raiz.children[1]], true);
    comando.execute();
    comando.undo();

    // O primeiro já estava oculto e precisa continuar oculto.
    expect(raiz.children[0].visible).toBe(false);
    expect(raiz.children[1].visible).toBe(true);
  });
});

describe('DeleteCommand', () => {
  it('remove e repõe na posição original', () => {
    const raiz = estande();
    const meio = raiz.children[1];

    const comando = new DeleteCommand([meio]);
    comando.execute();

    expect(raiz.children).toHaveLength(2);
    expect(raiz.children.includes(meio)).toBe(false);

    comando.undo();

    expect(raiz.children).toHaveLength(3);
    // O bloco volta ao índice 1, não para o fim da lista.
    expect(raiz.children[1]).toBe(meio);
  });

  it('restaura vários blocos na ordem correta', () => {
    const raiz = estande();
    const originais = [...raiz.children];

    const comando = new DeleteCommand([raiz.children[0], raiz.children[2]]);
    comando.execute();

    expect(raiz.children).toHaveLength(1);

    comando.undo();

    expect(raiz.children).toEqual(originais);
  });

  it('integra com o histórico', () => {
    const raiz = estande();
    const history = new History();

    history.push(new DeleteCommand([raiz.children[0]]));
    expect(raiz.children).toHaveLength(2);

    history.undo();
    expect(raiz.children).toHaveLength(3);

    history.redo();
    expect(raiz.children).toHaveLength(2);
  });
});

describe('IsolateCommand', () => {
  it('mostra só o alvo e seus ancestrais', () => {
    const raiz = estande();
    const alvo = raiz.children[1];

    new IsolateCommand(raiz, [alvo]).execute();

    expect(alvo.visible).toBe(true);
    expect(alvo.children.every((m) => m.visible)).toBe(true);
    expect(raiz.children[0].visible).toBe(false);
    expect(raiz.children[2].visible).toBe(false);
    // A raiz precisa continuar visível, senão o alvo some junto.
    expect(raiz.visible).toBe(true);
  });

  it('restaura a visibilidade anterior', () => {
    const raiz = estande();
    raiz.children[2].visible = false;

    const comando = new IsolateCommand(raiz, [raiz.children[0]]);
    comando.execute();
    comando.undo();

    expect(raiz.children[0].visible).toBe(true);
    expect(raiz.children[1].visible).toBe(true);
    expect(raiz.children[2].visible).toBe(false);
  });
});

describe('ShowAllCommand', () => {
  it('torna tudo visível e desfaz', () => {
    const raiz = estande();
    raiz.children[0].visible = false;
    raiz.children[1].children[0].visible = false;

    const comando = new ShowAllCommand(raiz);
    comando.execute();

    let todosVisiveis = true;
    raiz.traverse((n) => {
      if (!n.visible) todosVisiveis = false;
    });
    expect(todosVisiveis).toBe(true);

    comando.undo();
    expect(raiz.children[0].visible).toBe(false);
    expect(raiz.children[1].children[0].visible).toBe(false);
  });
});

describe('pruneInvisible', () => {
  it('remove os blocos ocultos da cópia', () => {
    const raiz = estande();
    raiz.children[0].visible = false;

    const relatorio = pruneInvisible(raiz);

    expect(relatorio.removidos).toBe(1);
    expect(relatorio.triangulosRemovidos).toBe(24);
    expect(raiz.children).toHaveLength(2);
  });

  it('não remove nada quando tudo está visível', () => {
    expect(pruneInvisible(estande()).removidos).toBe(0);
  });

  it('remove malhas ocultas dentro de blocos visíveis', () => {
    const raiz = estande();
    raiz.children[0].children[0].visible = false;

    const relatorio = pruneInvisible(raiz);

    expect(relatorio.removidos).toBe(1);
    expect(raiz.children[0].children).toHaveLength(1);
  });

  it('preserva a raiz mesmo se marcada como oculta', () => {
    const raiz = estande();
    raiz.visible = false;

    pruneInvisible(raiz);

    expect(raiz.children.length).toBeGreaterThan(0);
  });

  it('lida com raiz nula', () => {
    expect(pruneInvisible(null).removidos).toBe(0);
  });
});

describe('exportPreview', () => {
  it('separa triângulos visíveis dos ocultos', () => {
    const raiz = estande();
    raiz.children[0].visible = false;

    const resumo = exportPreview(raiz);

    expect(resumo.visiveis).toBe(4);
    expect(resumo.ocultos).toBe(2);
    expect(resumo.triangulosVisiveis).toBe(48);
    expect(resumo.triangulosOcultos).toBe(24);
  });

  it('considera a herança de visibilidade do pai', () => {
    const raiz = estande();
    // As malhas seguem visible=true; quem oculta é o grupo pai.
    raiz.children[1].visible = false;

    expect(exportPreview(raiz).ocultos).toBe(2);
  });

  it('devolve zeros para cena vazia', () => {
    expect(exportPreview(new THREE.Group()).visiveis).toBe(0);
  });
});
