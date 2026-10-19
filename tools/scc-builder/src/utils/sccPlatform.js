/**
 * Limites da Smart Chain City para prédios de jogadores, e o ajuste que leva
 * qualquer modelo para dentro deles.
 *
 * Os números são os do doc 13 (§9 e §13.3) e do protótipo do mapa:
 * 40 MB por envio, LOD0 até 300 mil triângulos, LOD1 com 25% e LOD2 com 5%
 * do LOD0, texturas até 2048 px e até 8 materiais por edifício.
 *
 * Funciona no browser (WebIO, no botão "Exportar para o mapa") e no Node
 * (NodeIO, no preset scc do CLI e da API): as bibliotecas chegam por
 * parâmetro, para este módulo não puxar o gltf-transform para o bundle
 * inicial do editor.
 */

export const SCC_LIMITS = Object.freeze({
  /** Tamanho máximo de um envio ao mapa (os três LODs somados). */
  maxUploadBytes: 40 * 1024 * 1024,
  /** Orçamento do LOD0 que o validate-lot confere. */
  maxTriangles: 300000,
  /** Alvo ao simplificar: folga sob o orçamento, como no tools/scc-optimize. */
  lod0Target: 240000,
  /** LOD1 e LOD2, como fração dos triângulos do LOD0. */
  lodRatios: Object.freeze([0.25, 0.05]),
  maxTextureSize: 2048,
  maxMaterials: 8,
});

/**
 * Triângulos de um Document glTF.
 *
 * @param {import('@gltf-transform/core').Document} doc
 */
export function countDocTriangles(doc) {
  let total = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const indices = primitive.getIndices();
      const position = primitive.getAttribute('POSITION');
      total += Math.floor((indices ? indices.getCount() : (position?.getCount() ?? 0)) / 3);
    }
  }
  return total;
}

/**
 * Remove atributos que só criam costuras: sem textura, UV não serve para
 * nada e impede a simplificação de atravessar a borda entre faces.
 * Com `keepNormals` falso, tira também as normais (LOD1/LOD2: de longe o
 * sombreamento plano basta, e a malha simplifica muito mais).
 *
 * @param {import('@gltf-transform/core').Document} doc
 * @param {{keepNormals?: boolean}} [options]
 */
export function stripSeams(doc, options = {}) {
  const semTextura = doc.getRoot().listTextures().length === 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      for (const semantic of primitive.listSemantics()) {
        const uv = semantic.startsWith('TEXCOORD');
        const outro = semantic !== 'POSITION' && !uv;
        if (
          (uv && (semTextura || options.keepNormals === false)) ||
          (outro && options.keepNormals === false)
        ) {
          primitive.setAttribute(semantic, null);
        }
      }
    }
  }
}

/**
 * Leva o LOD0 para dentro do orçamento de triângulos.
 *
 * @param {import('@gltf-transform/core').Document} doc
 * @param {{fns: any, simplifier: any}} deps
 * @param {{target?: number, max?: number}} [budget]
 * @returns {Promise<{before: number, after: number, simplified: boolean}>}
 */
export async function fitTriangleBudget(doc, deps, budget = {}) {
  const target = budget.target ?? SCC_LIMITS.lod0Target;
  const max = budget.max ?? SCC_LIMITS.maxTriangles;
  const before = countDocTriangles(doc);

  if (before <= max) return { before, after: before, simplified: false };

  stripSeams(doc);
  await doc.transform(deps.fns.weld(), deps.fns.prune());

  // O erro permitido cresce até caber: o simplificador para no limite de
  // erro antes de chegar na proporção pedida.
  for (const error of [0.01, 0.05, 0.2]) {
    const atual = countDocTriangles(doc);
    if (atual <= max) break;
    await doc.transform(
      deps.fns.simplify({ simplifier: deps.simplifier, ratio: Math.min(1, target / atual), error }),
      deps.fns.prune()
    );
  }

  return { before, after: countDocTriangles(doc), simplified: true };
}

/**
 * Gera um LOD a partir do LOD0: cópia, só posições, simplificada.
 *
 * @param {import('@gltf-transform/core').Document} lod0
 * @param {number} ratio fração dos triângulos do LOD0
 * @param {{fns: any, simplifier: any}} deps
 */
export async function makeLod(lod0, ratio, deps) {
  const copy = deps.fns.cloneDocument(lod0);
  stripSeams(copy, { keepNormals: false });
  await copy.transform(deps.fns.weld(), deps.fns.prune());
  await copy.transform(
    deps.fns.simplify({ simplifier: deps.simplifier, ratio, error: ratio >= 0.2 ? 0.02 : 0.08 }),
    deps.fns.prune()
  );
  return copy;
}

/**
 * Do GLB exportado pelo editor ao pacote que o mapa aceita: LOD0/1/2
 * comprimidos com Meshopt, somando no máximo 40 MB.
 *
 * Se passar do tamanho, tenta de novo com texturas menores e, depois, com
 * menos triângulos — sempre a partir do original, para não acumular perda.
 *
 * @param {Uint8Array} glb
 * @param {object} deps
 * @param {any} deps.io WebIO/NodeIO com ALL_EXTENSIONS e o encoder Meshopt registrados
 * @param {any} deps.fns @gltf-transform/functions
 * @param {any} deps.simplifier MeshoptSimplifier pronto
 * @param {any} deps.encoder MeshoptEncoder pronto
 * @param {(doc: any, maxSize: number) => Promise<number>} [deps.resizeTextures] devolve quantas reduziu
 * @param {(etapa: {attempt: number, total: number}) => void} [deps.onStep]
 * @param {Partial<typeof SCC_LIMITS>} [limits]
 */
export async function buildPlatformPackage(glb, deps, limits = {}) {
  const L = { ...SCC_LIMITS, ...limits };
  const step = deps.onStep ?? (() => {});
  const tentativas = [
    { texture: L.maxTextureSize, target: L.lod0Target },
    { texture: Math.min(1024, L.maxTextureSize), target: L.lod0Target },
    { texture: 512, target: Math.round(L.lod0Target / 2) },
    { texture: 256, target: Math.round(L.lod0Target / 4) },
  ];

  let ultimo = null;

  for (let i = 0; i < tentativas.length; i++) {
    const t = tentativas[i];
    step({ attempt: i + 1, total: tentativas.length });

    const lod0 = await deps.io.readBinary(glb);
    await lod0.transform(
      deps.fns.dedup(),
      deps.fns.flatten(),
      deps.fns.join(),
      deps.fns.weld(),
      deps.fns.prune()
    );

    const texturasReduzidas = deps.resizeTextures ? await deps.resizeTextures(lod0, t.texture) : 0;
    const budget = await fitTriangleBudget(lod0, deps, {
      target: t.target,
      max: Math.min(L.maxTriangles, Math.round(t.target * 1.25)),
    });

    const docs = [lod0];
    for (const ratio of L.lodRatios) docs.push(await makeLod(lod0, ratio, deps));

    const files = [];
    for (let level = 0; level < docs.length; level++) {
      const doc = docs[level];
      const triangles = countDocTriangles(doc);
      await doc.transform(
        deps.fns.quantize(),
        deps.fns.meshopt({ encoder: deps.encoder, level: 'medium' })
      );
      files.push({ level, triangles, bytes: await deps.io.writeBinary(doc) });
    }

    const total = files.reduce((s, f) => s + f.bytes.byteLength, 0);
    const materiais = lod0.getRoot().listMaterials().length;
    const avisos = [];
    if (materiais > L.maxMaterials)
      avisos.push({ code: 'materials', value: materiais, max: L.maxMaterials });

    ultimo = {
      files,
      report: {
        trianglesBefore: budget.before,
        trianglesAfter: files[0].triangles,
        simplified: budget.simplified,
        textureMax: t.texture,
        texturesResized: texturasReduzidas,
        totalBytes: total,
        sourceBytes: glb.byteLength,
        materials: materiais,
        attempt: i + 1,
        warnings: avisos,
      },
    };

    if (total <= L.maxUploadBytes && files[0].triangles <= L.maxTriangles) return ultimo;
  }

  const erro = new Error('modelo_grande_demais');
  erro.code = 'too_large_for_platform';
  erro.report = ultimo?.report;
  throw erro;
}
