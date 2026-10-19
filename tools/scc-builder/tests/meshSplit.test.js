import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  LIMITE_TRIANGULOS,
  SPLIT_MODES,
  previewSplit,
  splitByConnectivity,
  splitBySlices,
  splitMesh,
} from '../src/utils/meshSplit.js';

/** Une várias geometrias em uma só, sem indexação — como um DAE do Lumion. */
function juntar(...geometrias) {
  const posicoes = [];
  const normais = [];

  for (const geometria of geometrias) {
    const naoIndexada = geometria.index ? geometria.toNonIndexed() : geometria;
    posicoes.push(...naoIndexada.getAttribute('position').array);

    const normal = naoIndexada.getAttribute('normal');
    if (normal) normais.push(...normal.array);
  }

  const resultado = new THREE.BufferGeometry();
  resultado.setAttribute('position', new THREE.Float32BufferAttribute(posicoes, 3));
  if (normais.length === posicoes.length) {
    resultado.setAttribute('normal', new THREE.Float32BufferAttribute(normais, 3));
  }

  return resultado;
}

function caixaEm(x, y, z, tamanho = 1) {
  const geometria = new THREE.BoxGeometry(tamanho, tamanho, tamanho);
  geometria.translate(x, y, z);

  return geometria;
}

function contarTris(geometry) {
  const index = geometry.getIndex();
  const position = geometry.getAttribute('position');

  return Math.floor((index ? index.count : position.count) / 3);
}

describe('splitByConnectivity', () => {
  it('separa três caixas distantes em três componentes', () => {
    // O caso do estande: várias cadeiras numa malha só.
    const juntas = juntar(caixaEm(0, 0, 0), caixaEm(10, 0, 0), caixaEm(20, 0, 0));

    const partes = splitByConnectivity(juntas);

    expect(partes).toHaveLength(3);
    for (const parte of partes) {
      expect(contarTris(parte)).toBe(12);
    }
  });

  it('mantém peças que se tocam como um componente só', () => {
    // Duas caixas compartilhando face: geometricamente é uma peça.
    const coladas = juntar(caixaEm(0, 0, 0), caixaEm(1, 0, 0));

    expect(splitByConnectivity(coladas)).toHaveLength(0);
  });

  it('devolve vazio quando a malha já é indivisível', () => {
    expect(splitByConnectivity(caixaEm(0, 0, 0))).toHaveLength(0);
  });

  it('preserva o total de triângulos', () => {
    const juntas = juntar(caixaEm(0, 0, 0), caixaEm(5, 0, 0), caixaEm(0, 5, 0));
    const total = contarTris(juntas);

    const soma = splitByConnectivity(juntas).reduce((acc, parte) => acc + contarTris(parte), 0);

    expect(soma).toBe(total);
  });

  it('preserva os atributos de normal', () => {
    const partes = splitByConnectivity(juntar(caixaEm(0, 0, 0), caixaEm(9, 0, 0)));

    for (const parte of partes) {
      expect(parte.getAttribute('normal')).toBeDefined();
      expect(parte.getAttribute('normal').count).toBe(parte.getAttribute('position').count);
    }
  });

  it('ordena do maior para o menor', () => {
    const partes = splitByConnectivity(
      juntar(
        caixaEm(0, 0, 0, 1),
        caixaEm(20, 0, 0, 1),
        new THREE.TetrahedronGeometry(1).translate(40, 0, 0)
      )
    );

    for (let i = 1; i < partes.length; i++) {
      expect(contarTris(partes[i - 1])).toBeGreaterThanOrEqual(contarTris(partes[i]));
    }
  });

  it('descarta componentes abaixo do mínimo', () => {
    const juntas = juntar(caixaEm(0, 0, 0), caixaEm(30, 0, 0));

    // Cada caixa tem 12 triângulos; exigindo 20, nada sobra.
    expect(splitByConnectivity(juntas, { minTriangulos: 20 })).toHaveLength(0);
  });

  it('lida com geometria sem posição', () => {
    expect(splitByConnectivity(new THREE.BufferGeometry())).toEqual([]);
  });

  it('funciona com geometria indexada', () => {
    const a = caixaEm(0, 0, 0);
    const b = caixaEm(15, 0, 0);
    const juntas = juntar(a, b);

    // Indexa deduplicando: o resultado precisa continuar separável.
    expect(splitByConnectivity(juntas).length).toBe(2);
  });
});

describe('splitBySlices', () => {
  it('divide uma caixa alta em fatias', () => {
    const alta = new THREE.BoxGeometry(1, 8, 1);

    const fatias = splitBySlices(alta, 'y', 4);

    expect(fatias.length).toBeGreaterThan(1);
    expect(fatias.length).toBeLessThanOrEqual(4);
  });

  it('preserva o total de triângulos', () => {
    const geometria = new THREE.BoxGeometry(1, 8, 1);
    const total = contarTris(geometria);

    const soma = splitBySlices(geometria, 'y', 4).reduce(
      (acc, fatia) => acc + contarTris(fatia),
      0
    );

    expect(soma).toBe(total);
  });

  it('recusa geometria plana no eixo escolhido', () => {
    // Um piso tem altura zero: fatiar em Y não faz sentido.
    const plano = new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2);

    expect(splitBySlices(plano, 'y', 4)).toEqual([]);
  });

  it('recusa menos de duas fatias', () => {
    expect(splitBySlices(new THREE.BoxGeometry(1, 8, 1), 'y', 1)).toEqual([]);
  });
});

describe('previewSplit', () => {
  it('conta os componentes sem construir geometria', () => {
    const mesh = new THREE.Mesh(
      juntar(caixaEm(0, 0, 0), caixaEm(10, 0, 0), caixaEm(20, 0, 0)),
      new THREE.MeshStandardMaterial()
    );

    const resultado = previewSplit(mesh);

    expect(resultado.componentes).toBe(3);
    expect(resultado.triangulos).toBe(36);
    expect(resultado.viavel).toBe(true);
  });

  it('sinaliza inviabilidade sem malha', () => {
    expect(previewSplit(null).viavel).toBe(false);
  });
});

describe('splitMesh', () => {
  it('devolve as partes como malhas com material herdado', () => {
    const material = new THREE.MeshStandardMaterial({ name: 'Aço' });
    const mesh = new THREE.Mesh(juntar(caixaEm(0, 0, 0), caixaEm(12, 0, 0)), material);
    mesh.name = 'Estrutura';

    const { partes, motivo } = splitMesh(mesh, { modo: 'conectividade' });

    expect(motivo).toBeNull();
    expect(partes).toHaveLength(2);
    expect(partes[0].material).toBe(material);
    expect(partes[0].name).toMatch(/^Estrutura_parte\d{3}$/);
  });

  it('herda a transformação da malha original', () => {
    const mesh = new THREE.Mesh(juntar(caixaEm(0, 0, 0), caixaEm(12, 0, 0)));
    mesh.position.set(5, 2, -3);
    mesh.scale.setScalar(2);

    const { partes } = splitMesh(mesh);

    expect(partes[0].position.toArray()).toEqual([5, 2, -3]);
    expect(partes[0].scale.x).toBe(2);
  });

  it('explica quando a malha é uma peça única', () => {
    const { partes, motivo } = splitMesh(new THREE.Mesh(caixaEm(0, 0, 0)));

    expect(partes).toHaveLength(0);
    expect(motivo).toMatch(/peça única/);
  });

  it('recusa objeto que não é malha', () => {
    const { motivo } = splitMesh(new THREE.Group());

    expect(motivo).toMatch(/não é uma malha/);
  });

  it('divide por fatias quando pedido', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 8, 1));
    const { partes } = splitMesh(mesh, { modo: 'fatias', eixo: 'y', fatias: 4 });

    expect(partes.length).toBeGreaterThan(1);
    expect(partes[0].name).toMatch(/_fatia\d{3}$/);
  });

  it('explica quando não há grupos de material', () => {
    const mesh = new THREE.Mesh(caixaEm(0, 0, 0), new THREE.MeshStandardMaterial());
    const { motivo } = splitMesh(mesh, { modo: 'material' });

    expect(motivo).toMatch(/grupos de material/);
  });
});

describe('constantes', () => {
  it('expõe os três modos de divisão', () => {
    expect(SPLIT_MODES).toEqual(['conectividade', 'material', 'fatias']);
  });

  it('define um limite de segurança para a análise', () => {
    expect(LIMITE_TRIANGULOS).toBeGreaterThan(100_000);
  });
});
