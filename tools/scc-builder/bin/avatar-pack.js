#!/usr/bin/env node
/**
 * Pacote do avatar do jogo a partir da Universal Animation Library (Quaternius, CC0).
 *
 *   node bin/avatar-pack.js <UAL-Man> <UAL-Woman> <pasta-de-saída>
 *
 * - avatar-man.glb: o manequim masculino do UAL1 com só os clipes que o jogo usa.
 * - avatar-woman.glb: o manequim feminino (sem clipes; o cliente toca os do man,
 *   porque os dois têm o mesmo esqueleto e os mesmos nomes de ossos).
 *
 * Usa a versão sem root motion (Standard): quem move o avatar é o jogo. As
 * malhas e as animações saem comprimidas com meshopt (o mapa já tem o decoder).
 */
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

/** Clipes do jogo: rua (parado, andar, trotar, correr) e interior (sentar, interagir, conversar). */
export const CLIPS = [
  'Idle_Loop',
  'Walk_Loop',
  'Jog_Fwd_Loop',
  'Sprint_Loop',
  'Sitting_Enter',
  'Sitting_Idle_Loop',
  'Sitting_Exit',
  'Interact',
  'Idle_Talking_Loop',
];

const [manDir, womanDir, outDir] = process.argv.slice(2);
if (!manDir || !womanDir || !outDir) {
  console.error('Uso: node bin/avatar-pack.js <UAL-Man> <UAL-Woman> <pasta-de-saída>');
  process.exit(1);
}

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
mkdirSync(outDir, { recursive: true });

async function pack(src, dst, keepClips) {
  const doc = await io.read(src);
  for (const a of doc.getRoot().listAnimations()) {
    if (!keepClips.includes(a.getName())) a.dispose();
  }
  const missing = keepClips.filter((n) => !doc.getRoot().listAnimations().some((a) => a.getName() === n));
  if (missing.length) throw new Error(`${src}: faltam os clipes ${missing.join(', ')}`);
  await doc.transform(resample(), prune(), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(dst, doc);
  const kb = (f) => `${Math.round(statSync(f).size / 1024)} KB`;
  console.log(`${dst}: ${kb(src)} → ${kb(dst)}, ${doc.getRoot().listAnimations().length} clipes`);
}

await pack(join(manDir, 'Unreal-Godot', 'UAL1_Standard.glb'), join(outDir, 'avatar-man.glb'), CLIPS);
await pack(join(womanDir, 'Female Mannequin', 'Unreal-Godot', 'Mannequin_F.glb'), join(outDir, 'avatar-woman.glb'), []);
copyFileSync(join(manDir, 'License.txt'), join(outDir, 'LICENSE-UAL.txt'));
