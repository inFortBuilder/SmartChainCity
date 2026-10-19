import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  MATERIAL_PRESETS,
  UV_MODES,
  analyzeUVs,
  generateUVs,
  generateUVsForObject,
  presetList,
} from '../src/utils/texturing.js';

/** Caixa 2×2×2 centrada na origem, sem UV. */
function caixaSemUV(largura = 2, altura = 2, profundidade = 2) {
  const geometria = new THREE.BoxGeometry(largura, altura, profundidade);
  geometria.deleteAttribute('uv');

  return geometria;
}

function cenaSemUV(quantidade = 3) {
  const grupo = new THREE.Group();

  for (let i = 0; i < quantidade; i++) {
    grupo.add(new THREE.Mesh(caixaSemUV(), new THREE.MeshStandardMaterial()));
  }

  return grupo;
}

describe('analyzeUVs', () => {
  it('detecta ausência total de UV', () => {
    const resultado = analyzeUVs(cenaSemUV(3));

    expect(resultado.total).toBe(3);
    expect(resultado.comUV).toBe(0);
    expect(resultado.semUV).toBe(3);
    expect(resultado.cobertura).toBe(0);
  });

  it('detecta cobertura total', () => {
    const grupo = new THREE.Group();
    grupo.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));

    const resultado = analyzeUVs(grupo);

    expect(resultado.comUV).toBe(1);
    expect(resultado.cobertura).toBe(1);
  });

  it('calcula cobertura parcial', () => {
    // O caso real: exportações mistas, parte com UV, parte sem.
    const grupo = cenaSemUV(3);
    grupo.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));

    const resultado = analyzeUVs(grupo);

    expect(resultado.total).toBe(4);
    expect(resultado.comUV).toBe(1);
    expect(resultado.cobertura).toBeCloseTo(0.25, 5);
  });

  it('lida com raiz nula', () => {
    expect(analyzeUVs(null).total).toBe(0);
  });
});

describe('generateUVs', () => {
  it.each(UV_MODES)('gera o atributo uv no modo %s', (modo) => {
    const geometria = caixaSemUV();

    expect(geometria.getAttribute('uv')).toBeUndefined();
    expect(generateUVs(geometria, modo)).toBe(true);

    const uv = geometria.getAttribute('uv');
    expect(uv).toBeDefined();
    expect(uv.itemSize).toBe(2);
    // Um par (u,v) por vértice.
    expect(uv.count).toBe(geometria.getAttribute('position').count);
  });

  it('produz UVs normalizadas em [0,1] com escala 1', () => {
    const geometria = caixaSemUV();
    generateUVs(geometria, 'box', 1);

    const uv = geometria.getAttribute('uv').array;

    for (const valor of uv) {
      expect(valor).toBeGreaterThanOrEqual(0);
      expect(valor).toBeLessThanOrEqual(1);
    }
  });

  it('multiplica pela escala informada', () => {
    const geometria = caixaSemUV();
    generateUVs(geometria, 'planar', 4);

    const uv = geometria.getAttribute('uv').array;

    expect(Math.max(...uv)).toBeCloseTo(4, 4);
  });

  it('não quebra em geometria plana (dimensão zero)', () => {
    // Um piso tem altura zero; dividir pelo tamanho do eixo daria NaN.
    const geometria = new THREE.PlaneGeometry(4, 4);
    geometria.deleteAttribute('uv');
    geometria.rotateX(-Math.PI / 2);

    expect(generateUVs(geometria, 'box')).toBe(true);

    const uv = geometria.getAttribute('uv').array;
    expect([...uv].every(Number.isFinite)).toBe(true);
  });

  it('a projeção cúbica distribui melhor que a planar em caixas', () => {
    // Na planar, as laterais verticais colapsam (todos os vértices de uma
    // face compartilham o mesmo par u,v) e a textura estica. Na cúbica,
    // cada face usa os eixos alinhados à sua normal.
    const planar = caixaSemUV();
    const cubica = caixaSemUV();

    generateUVs(planar, 'planar');
    generateUVs(cubica, 'box');

    const unicos = (geo) =>
      new Set([...geo.getAttribute('uv').array].map((v) => v.toFixed(4))).size;

    expect(unicos(cubica)).toBeGreaterThanOrEqual(unicos(planar));
  });

  it('recusa modo desconhecido', () => {
    expect(generateUVs(caixaSemUV(), 'inexistente')).toBe(false);
  });

  it('recusa geometria sem posição', () => {
    expect(generateUVs(new THREE.BufferGeometry(), 'box')).toBe(false);
  });

  it('cilíndrica mantém v proporcional à altura', () => {
    const geometria = new THREE.CylinderGeometry(1, 1, 4, 16);
    geometria.deleteAttribute('uv');

    generateUVs(geometria, 'cylindrical');

    const uv = geometria.getAttribute('uv').array;
    const vs = [];
    for (let i = 1; i < uv.length; i += 2) vs.push(uv[i]);

    // A base fica em v≈0 e o topo em v≈1.
    expect(Math.min(...vs)).toBeCloseTo(0, 3);
    expect(Math.max(...vs)).toBeCloseTo(1, 3);
  });
});

describe('generateUVsForObject', () => {
  it('processa todas as malhas', () => {
    const grupo = cenaSemUV(4);

    expect(generateUVsForObject(grupo, 'box', 1)).toBe(4);
    expect(analyzeUVs(grupo).semUV).toBe(0);
  });

  it('escala pelo tamanho real de cada malha', () => {
    // Uma parede de 10 m e um pilar de 1 m precisam de contagens de
    // repetição diferentes, senão o ladrilho sai com escalas visivelmente
    // distintas entre as peças.
    const grupo = new THREE.Group();
    const grande = new THREE.Mesh(caixaSemUV(10, 10, 10), new THREE.MeshStandardMaterial());
    const pequeno = new THREE.Mesh(caixaSemUV(1, 1, 1), new THREE.MeshStandardMaterial());
    grupo.add(grande, pequeno);

    generateUVsForObject(grupo, 'box', 1);

    const maxUV = (mesh) => Math.max(...mesh.geometry.getAttribute('uv').array);

    // 1 metro por repetição: a peça de 10 m recebe ~10× mais repetições.
    expect(maxUV(grande)).toBeCloseTo(10, 1);
    expect(maxUV(pequeno)).toBeCloseTo(1, 1);
  });

  it('devolve zero para cena vazia', () => {
    expect(generateUVsForObject(new THREE.Group(), 'box')).toBe(0);
  });

  it('lida com raiz nula', () => {
    expect(generateUVsForObject(null, 'box')).toBe(0);
  });
});

describe('MATERIAL_PRESETS', () => {
  it('define os campos obrigatórios em todos os presets', () => {
    for (const [chave, preset] of Object.entries(MATERIAL_PRESETS)) {
      expect(preset.label, chave).toBeTruthy();
      expect(typeof preset.color, chave).toBe('number');
      expect(preset.roughness, chave).toBeGreaterThanOrEqual(0);
      expect(preset.roughness, chave).toBeLessThanOrEqual(1);
      expect(preset.metalness, chave).toBeGreaterThanOrEqual(0);
      expect(preset.metalness, chave).toBeLessThanOrEqual(1);
    }
  });

  it('segue a convenção PBR: metais têm metalness alta', () => {
    expect(MATERIAL_PRESETS.aco.metalness).toBeGreaterThan(0.8);
    expect(MATERIAL_PRESETS.aluminio.metalness).toBeGreaterThan(0.8);
  });

  it('dielétricos têm metalness zero', () => {
    for (const chave of ['concreto', 'madeira', 'vidro', 'carpete', 'tijolo']) {
      expect(MATERIAL_PRESETS[chave].metalness, chave).toBe(0);
    }
  });

  it('superfícies foscas têm rugosidade alta', () => {
    expect(MATERIAL_PRESETS.concreto.roughness).toBeGreaterThan(0.8);
    expect(MATERIAL_PRESETS.carpete.roughness).toBeGreaterThan(0.9);
  });

  it('vidro é transparente', () => {
    expect(MATERIAL_PRESETS.vidro.transparent).toBe(true);
    expect(MATERIAL_PRESETS.vidro.opacity).toBeLessThan(1);
  });

  it('presetList devolve uma entrada por preset', () => {
    expect(presetList()).toHaveLength(Object.keys(MATERIAL_PRESETS).length);
    expect(presetList()[0]).toHaveProperty('value');
    expect(presetList()[0]).toHaveProperty('label');
  });
});
