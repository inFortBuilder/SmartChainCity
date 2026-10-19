import { SCC_LIMITS, makeLod } from '../../src/utils/sccPlatform.js';
import { importOptional } from './errors.js';

/**
 * Perfis de otimização.
 *
 * `ratio` é a fração de triângulos mantida por `simplify`.
 * `error` é o desvio máximo permitido, relativo ao tamanho do modelo.
 */
export const PROFILES = {
  none: {
    dedup: false,
    weld: false,
    prune: false,
    join: false,
    simplify: null,
    textureSize: null,
    draco: false,
  },
  balanced: {
    dedup: true,
    weld: true,
    prune: true,
    join: true,
    simplify: null,
    textureSize: 2048,
    draco: true,
  },
  aggressive: {
    dedup: true,
    weld: true,
    prune: true,
    join: true,
    simplify: { ratio: 0.5, error: 0.005 },
    textureSize: 1024,
    draco: true,
  },
};

/**
 * Aplica o perfil de otimização a um Document.
 *
 * Cada etapa é isolada: se uma dependência opcional faltar (ex.: sharp para
 * texturas), a etapa é ignorada com aviso em vez de derrubar a conversão.
 *
 * @param {import('@gltf-transform/core').Document} doc
 * @param {keyof typeof PROFILES} level
 * @param {(message: string) => void} log
 * @returns {Promise<{applied: string[], skipped: string[]}>}
 */
export async function optimizeDocument(doc, level, log = () => {}) {
  const profile = PROFILES[level] ?? PROFILES.balanced;
  const applied = [];
  const skipped = [];

  if (level === 'none') {
    return { applied, skipped };
  }

  const fns = await importOptional('@gltf-transform/functions', 'otimizar o modelo');

  /**
   * @param {string} name
   * @param {() => Promise<unknown>} run
   */
  const step = async (name, run) => {
    try {
      await run();
      applied.push(name);
      log(`otimização: ${name} aplicado`);
    } catch (error) {
      skipped.push(name);
      log(`otimização: ${name} ignorado (${error instanceof Error ? error.message : error})`);
    }
  };

  // Remove dados duplicados (acessores, materiais, texturas idênticas).
  if (profile.dedup) {
    await step('dedup', () => doc.transform(fns.dedup()));
  }

  // Solda vértices coincidentes — indispensável em malhas vindas de CAD,
  // que costumam vir totalmente não indexadas.
  if (profile.weld) {
    await step('weld', () => doc.transform(fns.weld()));
  }

  // Remove nós, materiais e acessores órfãos.
  if (profile.prune) {
    await step('prune', () => doc.transform(fns.prune()));
  }

  // Junta primitivas compatíveis: reduz draw calls drasticamente em
  // modelos arquitetônicos (centenas → dezenas).
  if (profile.join) {
    await step('join', () => doc.transform(fns.join()));
  }

  if (profile.simplify) {
    await step('simplify', async () => {
      const { MeshoptSimplifier } = await importOptional(
        'meshoptimizer',
        'simplificar a malha (nível aggressive)'
      );
      await MeshoptSimplifier.ready;
      await doc.transform(
        fns.simplify({
          simplifier: MeshoptSimplifier,
          ratio: profile.simplify.ratio,
          error: profile.simplify.error,
        })
      );
    });
  }

  if (profile.textureSize && doc.getRoot().listTextures().length > 0) {
    await step('textureCompress', async () => {
      const sharp = (await importOptional('sharp', 'redimensionar texturas')).default;
      await doc.transform(
        fns.textureCompress({
          encoder: sharp,
          targetFormat: 'webp',
          resize: [profile.textureSize, profile.textureSize],
        })
      );
    });
  }

  return { applied, skipped };
}

/**
 * Registra a extensão Draco no Document (compressão de malha).
 * Deve ser chamada ANTES de escrever o arquivo.
 *
 * @param {import('@gltf-transform/core').Document} doc
 * @param {keyof typeof PROFILES} level
 * @param {(message: string) => void} log
 * @returns {Promise<boolean>} true se o Draco foi habilitado
 */
export async function enableDraco(doc, level, log = () => {}) {
  const profile = PROFILES[level] ?? PROFILES.balanced;
  if (!profile.draco) return false;

  try {
    const { draco } = await importOptional('@gltf-transform/functions', 'comprimir com Draco');
    await doc.transform(draco());
    log('otimização: compressão Draco habilitada');
    return true;
  } catch (error) {
    log(`otimização: Draco ignorado (${error instanceof Error ? error.message : error})`);
    return false;
  }
}

/**
 * Níveis de detalhe do preset "scc": o LOD0 é o próprio modelo, já dentro
 * do orçamento; LOD1 e LOD2 são frações dele para a cidade vista de longe.
 * Os números vêm de src/utils/sccPlatform.js, o mesmo módulo que o botão
 * "Exportar para o mapa" usa no editor (doc 13 §9).
 */
export const SCC_LODS = SCC_LIMITS.lodRatios.map((ratio, i) => ({ level: i + 1, ratio }));

/** gltf-transform e o simplificador, prontos para o sccPlatform. */
export async function platformDeps() {
  const fns = await importOptional('@gltf-transform/functions', 'ajustar ao preset scc');
  const { MeshoptSimplifier } = await importOptional('meshoptimizer', 'ajustar ao preset scc');
  await MeshoptSimplifier.ready;
  return { fns, simplifier: MeshoptSimplifier };
}

/**
 * Compressão Meshopt (EXT_meshopt_compression) — a do preset "scc".
 * Decodifica mais rápido que o Draco no cliente, o que pesa quando a cidade
 * carrega dezenas de prédios de jogadores ao mesmo tempo.
 *
 * @param {import('@gltf-transform/core').Document} doc
 * @param {(message: string) => void} log
 * @returns {Promise<boolean>} true se a compressão foi aplicada
 */
export async function enableMeshopt(doc, log = () => {}) {
  try {
    const { meshopt, quantize } = await importOptional(
      '@gltf-transform/functions',
      'comprimir com Meshopt'
    );
    const { MeshoptEncoder } = await importOptional('meshoptimizer', 'comprimir com Meshopt');
    await MeshoptEncoder.ready;
    await doc.transform(quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    log('otimização: compressão Meshopt habilitada');
    return true;
  } catch (error) {
    log(`otimização: Meshopt ignorado (${error instanceof Error ? error.message : error})`);
    return false;
  }
}

/**
 * Cópia do LOD0 simplificada para um nível de LOD (só posições).
 *
 * @param {import('@gltf-transform/core').Document} doc
 * @param {{ratio:number}} lod
 * @returns {Promise<import('@gltf-transform/core').Document>}
 */
export async function simplifiedCopy(doc, lod) {
  return makeLod(doc, lod.ratio, await platformDeps());
}
