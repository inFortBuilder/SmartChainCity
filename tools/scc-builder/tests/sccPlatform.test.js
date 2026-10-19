import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as fns from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  SCC_LIMITS,
  buildPlatformPackage,
  countDocTriangles,
  fitTriangleBudget,
  makeLod,
  stripSeams,
} from '../src/utils/sccPlatform.js';

let deps;

beforeAll(async () => {
  await Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });
  deps = { io, fns, simplifier: MeshoptSimplifier, encoder: MeshoptEncoder };
});

/**
 * Fachada 20 × 80 m em grade N × N (2·N² triângulos), indexada, com UV.
 * Grade plana simplifica bem: dá para conferir o orçamento sem modelo real.
 */
function gridDocument(n = 60) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const pos = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      pos.push((20 * i) / n - 10, (80 * j) / n, Math.sin(i * 0.7) * 0.5);
      uv.push(i / n, j / n);
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a = i * (n + 1) + j;
      const b = a + n + 1;
      idx.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }
  const prim = doc
    .createPrimitive()
    .setAttribute(
      'POSITION',
      doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer)
    )
    .setAttribute(
      'TEXCOORD_0',
      doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buffer)
    )
    .setIndices(
      doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(buffer)
    )
    .setMaterial(doc.createMaterial('concreto'));
  doc.createScene().addChild(doc.createNode('torre').setMesh(doc.createMesh().addPrimitive(prim)));
  return doc;
}

describe('SCC_LIMITS', () => {
  it('segue o doc 13 §9 e §13.3', () => {
    expect(SCC_LIMITS.maxUploadBytes).toBe(40 * 1024 * 1024);
    expect(SCC_LIMITS.maxTriangles).toBe(300000);
    expect(SCC_LIMITS.lodRatios).toEqual([0.25, 0.05]);
    expect(SCC_LIMITS.maxTextureSize).toBe(2048);
    expect(SCC_LIMITS.maxMaterials).toBe(8);
  });
});

describe('stripSeams', () => {
  it('tira UV sem textura no LOD0 e tudo menos a posição nos LODs', () => {
    const doc = gridDocument(4);
    stripSeams(doc);
    const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
    expect(prim.listSemantics()).toEqual(['POSITION']);

    const outro = gridDocument(4);
    stripSeams(outro, { keepNormals: false });
    expect(outro.getRoot().listMeshes()[0].listPrimitives()[0].listSemantics()).toEqual([
      'POSITION',
    ]);
  });
});

describe('fitTriangleBudget', () => {
  it('não mexe em modelo dentro do orçamento', async () => {
    const doc = gridDocument(10);
    const r = await fitTriangleBudget(doc, deps);
    expect(r).toEqual({ before: 200, after: 200, simplified: false });
  });

  it('simplifica acima do orçamento até caber', async () => {
    const doc = gridDocument(60); // 7.200 triângulos
    const r = await fitTriangleBudget(doc, deps, { target: 1000, max: 1500 });
    expect(r.simplified).toBe(true);
    expect(r.before).toBe(7200);
    expect(r.after).toBeLessThanOrEqual(1500);
    expect(countDocTriangles(doc)).toBe(r.after);
  });
});

describe('makeLod', () => {
  it('gera uma cópia menor sem mexer no LOD0', async () => {
    const lod0 = gridDocument(40);
    const antes = countDocTriangles(lod0);
    const lod1 = await makeLod(lod0, 0.25, deps);
    expect(countDocTriangles(lod0)).toBe(antes);
    expect(countDocTriangles(lod1)).toBeLessThanOrEqual(Math.ceil(antes * 0.25) + 2);
  });
});

describe('buildPlatformPackage', () => {
  it('entrega LOD0/1/2 com Meshopt, dentro do orçamento e do tamanho', async () => {
    const glb = await deps.io.writeBinary(gridDocument(60));
    const passos = [];
    const pacote = await buildPlatformPackage(
      glb,
      { ...deps, onStep: (p) => passos.push(p) },
      { lod0Target: 1000, maxTriangles: 1500 }
    );

    expect(pacote.files.map((f) => f.level)).toEqual([0, 1, 2]);
    expect(pacote.files[0].triangles).toBeLessThanOrEqual(1500);
    expect(pacote.files[1].triangles).toBeLessThan(pacote.files[0].triangles);
    expect(pacote.files[2].triangles).toBeLessThan(pacote.files[1].triangles);
    expect(pacote.report.trianglesBefore).toBe(7200);
    expect(pacote.report.totalBytes).toBe(pacote.files.reduce((s, f) => s + f.bytes.byteLength, 0));
    expect(passos[0]).toEqual({ attempt: 1, total: 4 });

    // O GLB sai com Meshopt e o mapa consegue ler de volta.
    const lido = await deps.io.readBinary(pacote.files[0].bytes);
    expect(
      lido
        .getRoot()
        .listExtensionsUsed()
        .map((e) => e.extensionName)
    ).toContain('EXT_meshopt_compression');
  });

  it('reduz textura grande pela função recebida', async () => {
    const glb = await deps.io.writeBinary(gridDocument(4));
    const chamadas = [];
    const pacote = await buildPlatformPackage(glb, {
      ...deps,
      resizeTextures: async (_doc, max) => {
        chamadas.push(max);
        return 2;
      },
    });
    expect(chamadas).toEqual([2048]);
    expect(pacote.report.texturesResized).toBe(2);
  });

  it('avisa quando passa de 8 materiais', async () => {
    const doc = gridDocument(4);
    const mesh = doc.getRoot().listMeshes()[0];
    const base = mesh.listPrimitives()[0];
    for (let i = 0; i < 9; i++)
      mesh.addPrimitive(
        base
          .clone()
          .setMaterial(doc.createMaterial(`m${i}`).setBaseColorFactor([i / 10, 0.5, 0.5, 1]))
      );
    const pacote = await buildPlatformPackage(await deps.io.writeBinary(doc), deps);
    expect(pacote.report.warnings).toEqual([{ code: 'materials', value: 10, max: 8 }]);
  });

  it('recusa quando nem a última tentativa cabe no tamanho', async () => {
    const glb = await deps.io.writeBinary(gridDocument(20));
    await expect(buildPlatformPackage(glb, deps, { maxUploadBytes: 100 })).rejects.toMatchObject({
      code: 'too_large_for_platform',
      report: { attempt: 4 },
    });
  });
});
