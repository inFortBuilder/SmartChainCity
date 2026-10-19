// Otimizador "preset SCC" (protótipo do que o SCC Builder fará no servidor).
// Uso: node scc-optimize.mjs <entrada.glb> <pasta-saida> [--scale 0.01] [--drop "regex de materiais"]
// Saída: <nome>-lod0.glb, -lod1.glb, -lod2.glb e <nome>.meta.json (contorno, altura, triângulos).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, instance, flatten, join, weld, prune, simplify, quantize, meshopt, getBounds } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { basename, join as pjoin } from 'node:path';

const [input, outDir] = process.argv.slice(2);
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const SCALE = Number(arg('--scale', '0.01'));
// vegetação, água, mobiliário e o plano do terreno: o jogo tem árvores e chão próprios
const DROP = new RegExp(arg('--drop', '^(Material #13|archmodels|water|09 - Default|06 - Default)'), 'i');

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const tri = (doc) => {
  let t = 0;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const inst = node.getExtension('EXT_mesh_gpu_instancing');
    const copies = inst ? (inst.getAttribute('TRANSLATION')?.getCount() ?? 1) : 1;
    for (const p of mesh.listPrimitives()) {
      const idx = p.getIndices(); const pos = p.getAttribute('POSITION');
      t += ((idx ? idx.getCount() : pos.getCount()) / 3) * copies;
    }
  }
  return Math.round(t);
};
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function load() {
  const doc = await io.read(input);
  const root = doc.getRoot();
  // 1) remove paisagismo/objetos/terreno pelo nome do material
  let removed = 0;
  for (const mesh of root.listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      const name = p.getMaterial()?.getName() ?? '';
      if (DROP.test(name)) { mesh.removePrimitive(p); p.dispose(); removed++; }
    }
    if (mesh.listPrimitives().length === 0) mesh.dispose();
  }
  // 2) centímetros → metros e base apoiada em y = 0, centrada em x/z
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const wrap = doc.createNode('SCC_Root').setScale([SCALE, SCALE, SCALE]);
  for (const child of scene.listChildren()) { scene.removeChild(child); wrap.addChild(child); }
  scene.addChild(wrap);
  const b = getBounds(scene);
  const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
  wrap.setTranslation([-cx, -b.min[1], -cz]);
  log(`removidas ${removed} primitivas (paisagismo/terreno)`);
  return doc;
}

const base = basename(input, '.glb');
mkdirSync(outDir, { recursive: true });
const t0 = Date.now();

// cópias idênticas viram instâncias; tudo é achatado, soldado e unido por material
const doc = await load();
log('triângulos após remover paisagismo:', tri(doc));
await doc.transform(dedup(), instance({ min: 2 }), flatten(), join(), weld(), prune());
const tWeld = tri(doc);
log('após dedup/instance/join/weld:', tWeld);

// LOD1/LOD2: sem normais e UVs (as costuras impedem a simplificação); o three.js usa sombreamento plano
const levels = [
  { name: 'lod0', ratio: Math.min(1, 240000 / tWeld), error: 0.003 },   // orçamento de 300 mil triângulos
  { name: 'lod1', ratio: 0.2, error: 0.02, strip: true },
  { name: 'lod2', ratio: 0.04, error: 0.08, strip: true },
];
const stripSeams = (d) => {
  for (const mesh of d.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    for (const sem of p.listSemantics()) if (sem !== 'POSITION') p.setAttribute(sem, null);
  }
};
const meta = { source: basename(input), sourceBytes: statSync(input).size, scale: SCALE, dropped: DROP.source, lods: {} };
for (const L of levels) {
  const d = L.name === 'lod0' ? doc : await (async () => { const x = await load(); await x.transform(dedup(), instance({ min: 2 }), flatten(), join(), weld(), prune()); return x; })();
  if (L.strip) { stripSeams(d); await d.transform(weld(), prune()); }
  else if (d.getRoot().listTextures().length === 0) {
    // sem texturas, UVs não servem para nada e criam costuras que impedem a simplificação
    for (const mesh of d.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) for (const s of p.listSemantics()) if (s.startsWith('TEXCOORD')) p.setAttribute(s, null);
    await d.transform(weld(), prune());
  }
  if (L.ratio < 1) await d.transform(simplify({ simplifier: MeshoptSimplifier, ratio: L.ratio, error: L.error, lockBorder: false }), prune());
  await d.transform(quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const file = pjoin(outDir, `${base}-${L.name}.glb`);
  await io.write(file, d);
  const bb = getBounds(d.getRoot().getDefaultScene() ?? d.getRoot().listScenes()[0]);
  meta.lods[L.name] = { file: basename(file), bytes: statSync(file).size, triangles: tri(d) };
  if (L.name === 'lod0') meta.bounds = { min: bb.min, max: bb.max, size: bb.max.map((v, i) => +(v - bb.min[i]).toFixed(2)) };
  log(`${L.name}: ${tri(d)} triângulos, ${(statSync(file).size / 1048576).toFixed(2)} MB`);
}
meta.seconds = Math.round((Date.now() - t0) / 1000);
writeFileSync(pjoin(outDir, `${base}.meta.json`), JSON.stringify(meta, null, 2));
log('pronto', JSON.stringify(meta.lods));
