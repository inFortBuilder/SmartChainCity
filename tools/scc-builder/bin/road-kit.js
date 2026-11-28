#!/usr/bin/env node
/**
 * Kit de ruas do street view a partir do "modular kit city build v2" (FBX de terceiros).
 *
 *   node bin/road-kit.js <kit.fbx> <pasta-das-texturas> <pasta-de-saída>
 *
 * Gera, na pasta de saída (use .local/rouds/: a licença do kit não está confirmada e nada dele vai para o
 * repositório):
 * - kit-ruas.glb: só as peças de bin/lib/road-kit.js, cada uma num nó com o código dela, normalizada
 *   (metros, centro na origem, chão em y = 0, comprimento em z), com o atlas do kit reduzido a 4096 px;
 * - kit-ruas.json: as medidas de cada peça, para o street view encaixar as peças nas ruas.
 *
 * O FBX é lido com o FBXLoader do three, no Node: as imagens não carregam (só a geometria e os UVs), e o
 * atlas entra pelo sharp.
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { Document, NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';

import { ROAD_PIECES, flipV, normalizePositions, rotateNormals } from './lib/road-kit.js';

const [fbxPath, texDir, outDir] = process.argv.slice(2);
if (!fbxPath || !texDir || !outDir) {
  console.error('Uso: node bin/road-kit.js <kit.fbx> <pasta-das-texturas> <pasta-de-saída>');
  process.exit(1);
}

// O FBXLoader pede um <img> para as texturas: aqui nenhuma carrega.
const noop = () => {};
globalThis.self ??= globalThis;
globalThis.window ??= globalThis;
globalThis.document ??= {
  createElementNS: () => ({ addEventListener: noop, removeEventListener: noop, style: {} }),
};
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');

const buf = readFileSync(fbxPath);
const fbx = new FBXLoader().parse(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  ''
);
fbx.scale.setScalar(0.01); // centímetros → metros
fbx.updateMatrixWorld(true);

const doc = new Document();
const bin = doc.createBuffer();
const atlas = await sharp(join(texDir, 'modularkit.png'), { limitInputPixels: false })
  .resize(4096, 4096, { fit: 'inside' })
  .jpeg({ quality: 85 })
  .toBuffer();
const tex = doc.createTexture('atlas').setImage(atlas).setMimeType('image/jpeg');
const mat = doc
  .createMaterial('kit-ruas')
  .setBaseColorTexture(tex)
  .setMetallicFactor(0)
  .setRoughnessFactor(0.85);
const scene = doc.createScene('kit-ruas');
const manifest = {
  source: 'modular kit city build v2 (FBX de terceiros, licença a confirmar)',
  pieces: {},
};

/** As peças com o nome dado, no mundo (em metros), juntadas: posições, normais e UVs. */
function worldGeometry(names) {
  const pos = [],
    nor = [],
    uv = [];
  for (const name of names) {
    const obj = fbx.getObjectByName(name);
    if (!obj?.isMesh) throw new Error(`${name} não está no FBX`);
    const g = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry.clone();
    g.applyMatrix4(obj.matrixWorld);
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    uv.push(...g.attributes.uv.array);
  }
  return {
    position: new Float32Array(pos),
    normal: new Float32Array(nor),
    uv: new Float32Array(uv),
  };
}

for (const [code, names] of Object.entries(ROAD_PIECES)) {
  const list = [].concat(names);
  const g = worldGeometry(list);
  const { positions, size, rotated } = normalizePositions(g.position);
  const normals = rotateNormals(g.normal, rotated);
  const prim = doc
    .createPrimitive()
    .setMaterial(mat)
    .setAttribute(
      'POSITION',
      doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(bin)
    )
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(normals).setBuffer(bin))
    .setAttribute(
      'TEXCOORD_0',
      doc.createAccessor().setType('VEC2').setArray(flipV(g.uv)).setBuffer(bin)
    );
  scene.addChild(doc.createNode(code).setMesh(doc.createMesh(code).addPrimitive(prim)));
  manifest.pieces[code] = { ...size, triangles: positions.length / 9, from: list };
}

mkdirSync(outDir, { recursive: true });
const glb = join(outDir, 'kit-ruas.glb');
await new NodeIO().write(glb, doc);
writeFileSync(join(outDir, 'kit-ruas.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(
  `${glb}: ${Math.round(statSync(glb).size / 1024)} KB, ${Object.keys(manifest.pieces).length} peças`
);
for (const [code, p] of Object.entries(manifest.pieces))
  console.log(`  ${code}: ${p.w} × ${p.l} m, altura ${p.h} m, ${p.triangles} triângulos`);
