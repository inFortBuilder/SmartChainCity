import { Document } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';

import { parseArgs, validateOptions } from '../bin/lib/args.js';
import {
  MAX_POINTS,
  buildMeta,
  convexHull,
  documentFootprint,
  polygonArea,
  transformPoint,
} from '../bin/lib/footprint.js';
import { sidecarPath } from '../bin/lib/pipeline.js';
import { ENGINE_PRESETS, SCC_MAX_TRIANGLES, resolveTransform } from '../src/utils/enginePresets.js';

/** Caixa de lx × ly × lz com a base no chão e o centro em (cx, cz). */
function boxDocument({ lx = 20, ly = 80, lz = 10, cx = 0, cz = 0, node } = {}) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const pos = [];
  for (const x of [cx - lx / 2, cx + lx / 2]) {
    for (const y of [0, ly]) {
      for (const z of [cz - lz / 2, cz + lz / 2]) pos.push(x, y, z);
    }
  }
  const position = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array(pos))
    .setBuffer(buffer);
  const mesh = doc
    .createMesh()
    .addPrimitive(doc.createPrimitive().setAttribute('POSITION', position));
  const n = doc.createNode('torre').setMesh(mesh);
  node?.(n);
  doc.createScene().addChild(n);
  return doc;
}

describe('convexHull / polygonArea', () => {
  it('descarta pontos internos e colineares', () => {
    const hull = convexHull([
      [0, 0],
      [2, 0],
      [1, 0],
      [2, 2],
      [0, 2],
      [1, 1],
    ]);
    expect(hull).toHaveLength(4);
    expect(polygonArea(hull)).toBe(4);
  });

  it('devolve o que tem quando há menos de 3 pontos', () => {
    expect(convexHull([[1, 2]])).toEqual([[1, 2]]);
  });
});

describe('transformPoint', () => {
  it('aplica translação e escala de uma matriz column-major', () => {
    const m = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 10, 0, 5, 1];
    expect(transformPoint(m, [1, 1, 1])).toEqual([12, 2, 7]);
  });
});

describe('documentFootprint', () => {
  it('projeta a base em XZ e mede a caixa no espaço do mundo', () => {
    const { points, bbox } = documentFootprint(boxDocument());
    const hull = convexHull(points);

    expect(polygonArea(hull)).toBeCloseTo(200, 6);
    expect(bbox.min).toEqual([-10, 0, -5]);
    expect(bbox.max).toEqual([10, 80, 5]);
  });

  it('considera a transformação do nó (escala de mm para m)', () => {
    const doc = boxDocument({
      lx: 20000,
      ly: 80000,
      lz: 10000,
      node: (n) => n.setScale([0.001, 0.001, 0.001]),
    });
    const { bbox } = documentFootprint(doc);
    expect(bbox.max[1]).toBeCloseTo(80, 6);
  });

  it('documento sem malha não tem base', () => {
    const doc = new Document();
    doc.createScene();
    expect(documentFootprint(doc)).toEqual({ points: [], bbox: null });
  });

  it('limita a amostra da base', () => {
    expect(MAX_POINTS).toBe(6000);
  });
});

describe('buildMeta', () => {
  it('grava o que o validate-lot.php lê', () => {
    const meta = buildMeta(boxDocument({ cx: 3 }), { triangles: 12, lods: [] });

    expect(meta.format).toBe('scc-builder.meta/1');
    expect(meta.up_axis).toBe('y');
    expect(meta.units).toBe('m');
    expect(meta.height_m).toBe(80);
    expect(meta.triangles).toBe(12);
    expect(meta.collider).toEqual({ type: 'box', min: [-7, 0, -5], max: [13, 80, 5] });
    expect(meta.footprint.area_m2).toBe(200);
    expect(meta.footprint.hull).toHaveLength(4);
    expect(meta.footprint.points.length).toBeGreaterThan(0);
  });
});

describe('sidecarPath', () => {
  it('troca a extensão pelo sufixo do arquivo lateral', () => {
    expect(sidecarPath('/x/torre.glb', '-lod1.glb')).toBe('/x/torre-lod1.glb');
    expect(sidecarPath('/x/torre.glb', '.meta.json')).toBe('/x/torre.meta.json');
  });
});

describe('CLI --preset scc', () => {
  it('aceita o preset e o normaliza', () => {
    const options = parseArgs(['-i', 'torre.fbx', '--preset', 'SCC']);
    expect(options.preset).toBe('scc');
    expect(validateOptions(options)).toEqual([]);
  });

  it('sem --preset, nada muda', () => {
    expect(parseArgs(['-i', 'a.obj']).preset).toBeNull();
  });

  it('recusa preset desconhecido e scc com gltf', () => {
    expect(validateOptions(parseArgs(['-i', 'a.obj', '--preset', 'unreal']))).toHaveLength(1);
    expect(
      validateOptions(parseArgs(['-i', 'a.obj', '--preset', 'scc', '-f', 'gltf']))
    ).toHaveLength(1);
  });
});

describe('preset de engine "scc"', () => {
  it('é Y-up, metros, Meshopt e três LODs', () => {
    const scc = ENGINE_PRESETS.scc;
    expect(scc.upAxis).toBe('y');
    expect(scc.unitsPerMeter).toBe(1);
    expect(scc.compression).toBe('meshopt');
    expect(scc.lodRatios).toHaveLength(3);
    expect(scc.maxTriangles).toBe(SCC_MAX_TRIANGLES);
    expect(SCC_MAX_TRIANGLES).toBe(300000);
  });

  it('leva um modelo Z-up em milímetros para Y-up em metros', () => {
    const result = resolveTransform({ engine: 'scc', sourceUnit: 'mm', sourceUp: 'z' });
    expect(result.scale).toBeCloseTo(0.001, 9);
    expect(result.rotationX).toBeCloseTo(-Math.PI / 2, 9);
  });
});
