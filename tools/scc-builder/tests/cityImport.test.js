import { describe, expect, it } from 'vitest';

import {
  Components,
  buildingRecord,
  classifyObject,
  faceVertex,
  insideBase,
  parseMtl,
} from '../bin/lib/city-import.js';

describe('classifyObject', () => {
  it('separa as etiquetas do OSM em camadas', () => {
    expect(classifyObject('base')).toBe('ground');
    expect(classifyObject('building=y')).toBe('buildings');
    expect(classifyObject('extra_build_from_turbocg.com')).toBe('buildings');
    expect(classifyObject('highway_motorway_1')).toBe('roads');
    expect(classifyObject('railway=ab')).toBe('rail');
    expect(classifyObject('waterway_river')).toBe('water');
    expect(classifyObject('landuse=r1')).toBe('land');
  });

  it('descarta relações e linhas sem geometria de cidade', () => {
    for (const name of ['route_train', 'restriction_no_u_turn', 'power=line', 'name_16th']) {
      expect(classifyObject(name)).toBeNull();
    }
    expect(classifyObject('etiqueta_desconhecida')).toBeNull();
  });
});

describe('parseMtl', () => {
  it('lê a cor de cada material', () => {
    const text = 'newmtl roads\nKa 1 1 1\nKd 0.5 0.25 0.75\r\nnewmtl Water\nKd 0 0 1\n';
    expect(parseMtl(text)).toEqual({ roads: [0.5, 0.25, 0.75], Water: [0, 0, 1] });
  });
});

describe('faceVertex', () => {
  it('converte índices absolutos e relativos', () => {
    expect(faceVertex('5/2/1', 10)).toBe(4);
    expect(faceVertex('-1//3', 10)).toBe(9);
  });
});

describe('Components', () => {
  it('agrupa vértices ligados e separa os demais', () => {
    const c = new Components();
    c.union(1, 2);
    c.union(2, 3);
    c.union(7, 8);
    expect(c.find(1)).toBe(c.find(3));
    expect(c.find(1)).not.toBe(c.find(7));
  });
});

describe('insideBase', () => {
  it('usa o centro da face', () => {
    expect(insideBase([90, 120], [0, 0], 100)).toBe(false);
    expect(insideBase([90, 100], [0, 0], 100)).toBe(true);
  });
});

describe('buildingRecord', () => {
  it('resume a caixa e sugere andares de 3,2 m', () => {
    const box = { minX: 0, maxX: 20, minY: 0, maxY: 32, minZ: 10, maxZ: 20 };
    expect(buildingRecord(box)).toEqual({ x: 10, z: 15, w: 20, d: 10, h: 32, floors: 10 });
  });

  it('todo prédio tem ao menos um andar', () => {
    const box = { minX: 0, maxX: 1, minY: 0, maxY: 0.5, minZ: 0, maxZ: 1 };
    expect(buildingRecord(box).floors).toBe(1);
  });
});
