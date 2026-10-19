/**
 * Ajuste do modelo ao mapa, no browser.
 *
 * Carrega o gltf-transform e o meshoptimizer sob demanda (só quem clica em
 * "Exportar para o mapa" paga esse download) e roda o mesmo ajuste do
 * servidor: buildPlatformPackage de sccPlatform.js.
 */
import { buildPlatformPackage } from './sccPlatform.js';

let depsPromise = null;

async function carregarDeps() {
  const [
    { WebIO },
    { ALL_EXTENSIONS },
    fns,
    { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder },
  ] = await Promise.all([
    import('@gltf-transform/core'),
    import('@gltf-transform/extensions'),
    import('@gltf-transform/functions'),
    import('meshoptimizer'),
  ]);

  await Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready, MeshoptDecoder.ready]);

  const io = new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });

  return { io, fns, simplifier: MeshoptSimplifier, encoder: MeshoptEncoder };
}

/**
 * Reduz no canvas as texturas maiores que `maxSize`, mantendo o formato.
 *
 * @param {import('@gltf-transform/core').Document} doc
 * @param {number} maxSize
 * @returns {Promise<number>} quantas foram reduzidas
 */
export async function resizeTexturesInBrowser(doc, maxSize) {
  let reduzidas = 0;

  for (const texture of doc.getRoot().listTextures()) {
    const image = texture.getImage();
    const mime = texture.getMimeType() || 'image/png';
    if (!image || !/^image\/(png|jpeg|webp)$/.test(mime)) continue;

    const bitmap = await createImageBitmap(new Blob([image], { type: mime }));
    const maior = Math.max(bitmap.width, bitmap.height);
    if (maior <= maxSize) {
      bitmap.close?.();
      continue;
    }

    const escala = maxSize / maior;
    const w = Math.max(1, Math.round(bitmap.width * escala));
    const h = Math.max(1, Math.round(bitmap.height * escala));
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await canvas.convertToBlob({ type: mime, quality: 0.85 });
    texture.setImage(new Uint8Array(await blob.arrayBuffer()));
    reduzidas++;
  }

  return reduzidas;
}

/**
 * GLB exportado pelo editor → pacote LOD0/1/2 dentro dos limites do mapa.
 *
 * @param {Blob} glbBlob
 * @param {(etapa: {attempt: number, total: number}) => void} [onStep]
 */
export async function preparePackageForMap(glbBlob, onStep) {
  depsPromise ??= carregarDeps();
  const deps = await depsPromise;
  const glb = new Uint8Array(await glbBlob.arrayBuffer());

  return buildPlatformPackage(glb, { ...deps, resizeTextures: resizeTexturesInBrowser, onStep });
}
