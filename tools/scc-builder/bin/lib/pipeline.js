import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import os from 'node:os';

import { ConversionError, importOptional } from './errors.js';
import {
  EXTERNAL_FORMATS,
  GLTF_FORMATS,
  NATIVE_FORMATS,
  countTriangles,
  detectFormat,
  importNativeMeshes,
} from './mesh-import.js';
import { applyTransform, buildDocument, countDocumentTriangles } from './gltf-build.js';
import { fitTriangleBudget } from '../../src/utils/sccPlatform.js';
import { buildMeta } from './footprint.js';
import {
  SCC_LODS,
  enableDraco,
  enableMeshopt,
  optimizeDocument,
  platformDeps,
  simplifiedCopy,
} from './optimize.js';

/**
 * Conversores externos aceitos para FBX e DAE, em ordem de preferência.
 * O primeiro encontrado no PATH é usado.
 */
const EXTERNAL_CONVERTERS = [
  { bin: 'FBX2glTF', formats: ['fbx'], args: (i, o) => ['--input', i, '--output', o, '--binary'] },
  { bin: 'fbx2gltf', formats: ['fbx'], args: (i, o) => ['--input', i, '--output', o, '--binary'] },
  { bin: 'assimp', formats: ['fbx', 'dae'], args: (i, o) => ['export', i, o] },
];

/**
 * Executa a conversão completa.
 *
 * @param {object} options
 * @param {string} options.input
 * @param {string} options.output
 * @param {string} options.format
 * @param {string} options.optimize
 * @param {number} options.scale
 * @param {boolean} options.flipAxis
 * @param {'scc'|null} [options.preset] "scc": meshopt, LOD1/LOD2 e modelo.meta.json
 * @param {(message: string) => void} [options.log]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function convert(options) {
  const log = options.log ?? (() => {});
  const startedAt = Date.now();

  const inputFormat = detectFormat(options.input);
  const inputStat = await fs.stat(options.input).catch(() => null);

  if (!inputStat || !inputStat.isFile()) {
    throw new ConversionError(
      'input_not_found',
      `Arquivo de entrada não encontrado: ${options.input}`
    );
  }

  log(`entrada: ${options.input} (${inputFormat}, ${formatBytes(inputStat.size)})`);

  const io = await createIO();

  /** @type {import('@gltf-transform/core').Document} */
  let doc;
  /** @type {string[]} */
  const tempFiles = [];

  try {
    if (GLTF_FORMATS.includes(inputFormat)) {
      log('lendo glTF/GLB nativo');
      doc = await io.read(options.input);
    } else if (NATIVE_FORMATS.includes(inputFormat)) {
      log(`interpretando ${inputFormat.toUpperCase()} com os parsers do Three.js`);
      const meshes = await importNativeMeshes(options.input, inputFormat);
      log(
        `${meshes.length} malha(s), ${countTriangles(meshes).toLocaleString('pt-BR')} triângulos`
      );
      doc = await buildDocument(meshes);
    } else if (EXTERNAL_FORMATS.includes(inputFormat)) {
      const intermediate = await convertWithExternalTool(options.input, inputFormat, log);
      tempFiles.push(intermediate);
      doc = await io.read(intermediate);
    } else {
      throw new ConversionError(
        'unsupported_format',
        `Formato de entrada ".${inputFormat}" não suportado. ` +
          `Aceitos: ${[...GLTF_FORMATS, ...NATIVE_FORMATS, ...EXTERNAL_FORMATS].join(', ')}.`
      );
    }

    const trianglesBefore = countDocumentTriangles(doc);

    // O logger padrão do gltf-transform imprime cada prune no stdout, que é
    // o canal do @@RESULT@@ lido pelo PHP. Só avisos e erros.
    const { Logger } = await importOptional('@gltf-transform/core', 'ler e escrever glTF');
    doc.setLogger(new Logger(Logger.Verbosity.WARN));

    applyTransform(doc, { flipAxis: options.flipAxis, scale: options.scale });
    if (options.flipAxis) log('eixo convertido: Z-up → Y-up');
    if (options.scale !== 1) log(`escala aplicada: ${options.scale}×`);

    const { applied, skipped } = await optimizeDocument(doc, options.optimize, log);

    const scc = options.preset === 'scc';

    // Preset "scc": o LOD0 precisa caber no orçamento da plataforma (300 mil
    // triângulos). Acima disso, simplifica até o alvo de 240 mil.
    if (scc) {
      const budget = await fitTriangleBudget(doc, await platformDeps());
      if (budget.simplified) {
        log(
          `orçamento scc: ${budget.before.toLocaleString('pt-BR')} → ` +
            `${budget.after.toLocaleString('pt-BR')} triângulos`
        );
      }
    }

    const trianglesAfter = countDocumentTriangles(doc);

    await fs.mkdir(path.dirname(options.output), { recursive: true });

    // Preset "scc": LODs, meta e Meshopt no lugar do Draco. A base e os LODs
    // saem do modelo ainda sem compressão — simplificar malha comprimida
    // não funciona, e a meta precisa das posições reais.
    let sccResult = null;
    if (scc) {
      sccResult = await writeSccExtras(doc, io, options.output, trianglesAfter, log);
    }

    const dracoEnabled = scc ? false : await enableDraco(doc, options.optimize, log);
    const meshoptEnabled = scc ? await enableMeshopt(doc, log) : false;

    if (options.format === 'glb') {
      const glb = await io.writeBinary(doc);
      await fs.writeFile(options.output, glb);
    } else {
      await io.write(options.output, doc);
    }

    const outputStat = await fs.stat(options.output);

    log(`saída: ${options.output} (${formatBytes(outputStat.size)})`);

    return {
      input_format: inputFormat,
      target_format: options.format,
      input_size: inputStat.size,
      output_size: outputStat.size,
      compression_ratio: Number((1 - outputStat.size / inputStat.size).toFixed(4)),
      triangles_before: trianglesBefore,
      triangles_after: trianglesAfter,
      meshes: doc.getRoot().listMeshes().length,
      materials: doc.getRoot().listMaterials().length,
      textures: doc.getRoot().listTextures().length,
      optimize_level: options.optimize,
      optimizations_applied: applied,
      optimizations_skipped: skipped,
      draco: dracoEnabled,
      meshopt: meshoptEnabled,
      preset: scc ? 'scc' : null,
      lods: sccResult?.lods ?? [],
      meta_file: sccResult?.metaFile ?? null,
      flip_axis: options.flipAxis,
      scale: options.scale,
      duration_ms: Date.now() - startedAt,
    };
  } finally {
    await Promise.all(tempFiles.map((file) => fs.rm(file, { force: true }).catch(() => {})));
  }
}

/**
 * Caminho de um arquivo lateral: modelo.glb → modelo-lod1.glb, modelo.meta.json.
 *
 * @param {string} output
 * @param {string} suffix ex.: '-lod1.glb' ou '.meta.json'
 */
export function sidecarPath(output, suffix) {
  const ext = path.extname(output);
  return `${output.slice(0, output.length - ext.length)}${suffix}`;
}

/**
 * Grava os LODs e o modelo.meta.json do preset "scc".
 *
 * Um LOD que falhe (sem meshoptimizer, malha degenerada) é registrado e
 * pulado: o GLB principal continua valendo.
 *
 * @param {import('@gltf-transform/core').Document} doc
 * @param {import('@gltf-transform/core').NodeIO} io
 * @param {string} output
 * @param {number} triangles
 * @param {(message: string) => void} log
 */
async function writeSccExtras(doc, io, output, triangles, log) {
  const lods = [];

  for (const lod of SCC_LODS) {
    try {
      const copy = await simplifiedCopy(doc, lod);
      await enableMeshopt(copy, () => {});
      const file = sidecarPath(output, `-lod${lod.level}.glb`);
      await fs.writeFile(file, await io.writeBinary(copy));
      const lodTriangles = countDocumentTriangles(copy);
      lods.push({
        level: lod.level,
        ratio: lod.ratio,
        triangles: lodTriangles,
        file: path.basename(file),
      });
      log(`LOD${lod.level}: ${lodTriangles.toLocaleString('pt-BR')} triângulos`);
    } catch (error) {
      log(`LOD${lod.level} ignorado (${error instanceof Error ? error.message : error})`);
    }
  }

  const metaFile = sidecarPath(output, '.meta.json');
  const meta = buildMeta(doc, { triangles, lods });
  await fs.writeFile(metaFile, JSON.stringify(meta));
  log(`meta: base com ${meta.footprint.points.length} pontos, altura ${meta.height_m} m`);

  return { lods, metaFile: path.basename(metaFile) };
}

/**
 * NodeIO configurado com as extensões e os codecs disponíveis.
 */
async function createIO() {
  const { NodeIO } = await importOptional('@gltf-transform/core', 'ler e escrever glTF');
  const extensions = await importOptional('@gltf-transform/extensions', 'suportar extensões glTF');

  const io = new NodeIO().registerExtensions(extensions.ALL_EXTENSIONS);

  // Codecs Draco: sem eles o arquivo ainda é gerado, apenas sem compressão.
  try {
    const draco3d = (await import('draco3dgltf')).default ?? (await import('draco3dgltf'));
    io.registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule(),
    });
  } catch {
    // segue sem Draco
  }

  // Codecs Meshopt (EXT_meshopt_compression)
  try {
    const { MeshoptDecoder, MeshoptEncoder } = await import('meshoptimizer');
    await MeshoptDecoder.ready;
    await MeshoptEncoder.ready;
    io.registerDependencies({
      'meshopt.decoder': MeshoptDecoder,
      'meshopt.encoder': MeshoptEncoder,
    });
  } catch {
    // segue sem Meshopt
  }

  return io;
}

/**
 * FBX e DAE exigem um conversor externo. Não fingimos suportá-los:
 * ou a ferramenta existe, ou o erro é explícito e acionável.
 *
 * @param {string} input
 * @param {string} format
 * @param {(m: string) => void} log
 * @returns {Promise<string>} caminho do .glb intermediário
 */
async function convertWithExternalTool(input, format, log) {
  const converter = await findConverter(format);

  if (!converter) {
    const names = EXTERNAL_CONVERTERS.filter((c) => c.formats.includes(format))
      .map((c) => c.bin)
      .join(' ou ');

    throw new ConversionError(
      'external_converter_missing',
      `Arquivos .${format} exigem um conversor externo (${names}), que não foi encontrado no PATH. ` +
        'Instale o FBX2glTF (https://github.com/facebookincubator/FBX2glTF/releases) ou o Assimp ' +
        '(https://github.com/assimp/assimp) e reinicie o servidor. ' +
        'Alternativa: exporte o modelo diretamente como .glb, .obj ou .dae na origem.',
      { format, candidates: names }
    );
  }

  const outFile = path.join(
    os.tmpdir(),
    `c3d_${Date.now()}_${Math.random().toString(36).slice(2)}.glb`
  );

  log(`convertendo ${format.toUpperCase()} com ${converter.bin}`);

  await run(converter.bin, converter.args(input, outFile));

  const stat = await fs.stat(outFile).catch(() => null);
  if (!stat || stat.size === 0) {
    throw new ConversionError(
      'external_converter_failed',
      `${converter.bin} terminou sem produzir um arquivo válido.`
    );
  }

  return outFile;
}

async function findConverter(format) {
  for (const converter of EXTERNAL_CONVERTERS) {
    if (!converter.formats.includes(format)) continue;
    if (await isOnPath(converter.bin)) return converter;
  }
  return null;
}

function isOnPath(bin) {
  return new Promise((resolve) => {
    const probe = spawn(process.platform === 'win32' ? 'where' : 'which', [bin], {
      stdio: 'ignore',
      shell: false,
    });
    probe.on('error', () => resolve(false));
    probe.on('close', (code) => resolve(code === 0));
  });
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) =>
      reject(
        new ConversionError(
          'external_converter_failed',
          `Falha ao executar ${bin}: ${error.message}`
        )
      )
    );

    child.on('close', (code) => {
      if (code === 0) return resolve(undefined);
      reject(
        new ConversionError(
          'external_converter_failed',
          `${bin} retornou código ${code}. ${stderr.trim().slice(0, 500)}`
        )
      );
    });
  });
}

export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}
