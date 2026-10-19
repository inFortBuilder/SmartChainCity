import * as THREE from 'three';

import { materialsOf } from './materials.js';
import { t } from '../i18n/index.js';

/**
 * Reparo de materiais pós-importação.
 *
 * Exportadores de arquitetura produzem materiais que o Three.js interpreta
 * ao pé da letra e o resultado fica errado na tela. Os três casos que
 * aparecem em praticamente todo arquivo de Lumion, SketchUp e Revit:
 *
 * 1. TRANSPARÊNCIA ESPÚRIA DO COLLADA
 *    A spec do COLLADA define opacidade por `<transparent opaque="...">`
 *    combinado com `<transparency>`. Com `opaque="A_ONE"` o ColladaLoader
 *    calcula `opacity = alpha × transparency`. SketchUp e Lumion escrevem
 *    `<transparency>0</transparency>` querendo dizer "sem transparência",
 *    mas pela fórmula isso vira `opacity = 0` — o modelo inteiro fica
 *    invisível. É o motivo clássico de "meu DAE abriu transparente".
 *
 * 2. FACE ÚNICA EM PAREDES SEM ESPESSURA
 *    Arquitetura é modelada com superfícies de espessura zero. Com
 *    backface culling, olhar a parede pelo lado de dentro atravessa o
 *    modelo. Precisa de DoubleSide.
 *
 * 3. TEXTURAS SEM colorSpace
 *    Um mapa de cor carregado sem `SRGBColorSpace` renderiza lavado e
 *    claro demais sob tone mapping ACES.
 */

/** Abaixo disto consideramos que a opacidade é lixo do exportador. */
const OPACITY_SUSPEITA = 0.02;

/** Mapas que representam COR e precisam de sRGB. Os demais são lineares. */
const MAPAS_DE_COR = ['map', 'emissiveMap', 'specularMap', 'sheenColorMap'];

/**
 * @typedef {object} RelatorioReparo
 * @property {number} materiais
 * @property {number} transparenciaCorrigida
 * @property {number} doubleSideAplicado
 * @property {number} texturasCorrigidas
 * @property {string[]} avisos
 */

/**
 * Repara os materiais de um objeto importado, no lugar.
 *
 * @param {THREE.Object3D} root
 * @param {object} [options]
 * @param {string} [options.format] extensão de origem, ajusta a heurística
 * @param {boolean} [options.forceDoubleSide]
 * @param {boolean} [options.fixTransparency]
 * @returns {RelatorioReparo}
 */
export function repairMaterials(root, options = {}) {
  const relatorio = {
    materiais: 0,
    transparenciaCorrigida: 0,
    doubleSideAplicado: 0,
    texturasCorrigidas: 0,
    avisos: [],
  };

  if (!root) return relatorio;

  const format = (options.format ?? '').toLowerCase();

  // DAE e FBX são os que trazem transparência quebrada. glTF tem a
  // semântica de alpha bem definida na spec e não deve ser mexido.
  const corrigirTransparencia = options.fixTransparency ?? ['dae', 'fbx', 'obj'].includes(format);

  // Arquitetura vem de superfícies sem espessura; malhas de impressão 3D
  // (STL/PLY) são sólidos fechados e não precisam.
  const aplicarDoubleSide =
    options.forceDoubleSide ?? ['dae', 'fbx', 'obj', 'gltf', 'glb'].includes(format);

  const vistos = new Set();

  root.traverse((child) => {
    if (!child.isMesh) return;

    for (const material of materialsOf(child)) {
      if (vistos.has(material)) continue;
      vistos.add(material);
      relatorio.materiais++;

      if (corrigirTransparencia) {
        repararTransparencia(material, relatorio);
      }

      if (aplicarDoubleSide && material.side !== THREE.DoubleSide) {
        material.side = THREE.DoubleSide;
        relatorio.doubleSideAplicado++;
      }

      repararTexturas(material, relatorio);

      // Emissivo branco herdado do exportador faz tudo brilhar.
      if (material.emissive && material.emissive.getHex() === 0xffffff) {
        material.emissive.setHex(0x000000);
        relatorio.avisos.push('Emissivo branco neutralizado.');
      }

      material.needsUpdate = true;
    }
  });

  if (relatorio.transparenciaCorrigida > 0) {
    relatorio.avisos.push(
      t(
        '^1 material(is) vinham com opacidade zero (bug conhecido de exportação Collada) e foram tornados opacos.',
        relatorio.transparenciaCorrigida
      )
    );
  }

  return relatorio;
}

/**
 * Detecta e corrige o material invisível.
 *
 * Só mexemos quando a opacidade é praticamente zero E não há mapa de alpha
 * — vidro de verdade costuma vir entre 0,1 e 0,8, e esse a gente preserva.
 *
 * @param {THREE.Material} material
 * @param {RelatorioReparo} relatorio
 */
function repararTransparencia(material, relatorio) {
  const temMapaAlpha = Boolean(material.alphaMap || material.transmissionMap);

  if (temMapaAlpha) return;

  const opacidade = typeof material.opacity === 'number' ? material.opacity : 1;

  if (opacidade > OPACITY_SUSPEITA) {
    // Material com transparência plausível: normaliza só as flags.
    if (opacidade >= 1 && material.transparent) {
      material.transparent = false;
      material.depthWrite = true;
    }

    return;
  }

  // Opacidade zero sem mapa de alpha não é intenção de projeto: é bug.
  material.opacity = 1;
  material.transparent = false;
  material.depthWrite = true;

  // Guarda o valor original para o painel poder mostrar o que foi mexido.
  material.userData = material.userData ?? {};
  material.userData.__c3dOpacidadeOriginal = opacidade;

  relatorio.transparenciaCorrigida++;
}

/**
 * @param {THREE.Material} material
 * @param {RelatorioReparo} relatorio
 */
function repararTexturas(material, relatorio) {
  for (const slot of MAPAS_DE_COR) {
    const textura = material[slot];
    if (!textura || textura.colorSpace === THREE.SRGBColorSpace) continue;

    textura.colorSpace = THREE.SRGBColorSpace;
    textura.needsUpdate = true;
    relatorio.texturasCorrigidas++;
  }

  // Repetição: exportadores de arquitetura usam UVs fora de [0,1] para
  // ladrilhar pisos e fachadas. Sem RepeatWrapping a textura estica.
  for (const slot of [...MAPAS_DE_COR, 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
    const textura = material[slot];
    if (!textura) continue;

    if (textura.wrapS === THREE.ClampToEdgeWrapping) {
      textura.wrapS = THREE.RepeatWrapping;
      textura.wrapT = THREE.RepeatWrapping;
      textura.needsUpdate = true;
    }
  }
}

/**
 * Converte materiais legados (Phong, Lambert, Basic) para Standard.
 *
 * O ColladaLoader e o OBJLoader produzem MeshPhongMaterial, que não
 * responde ao environment map PBR da cena — o modelo fica opaco e sem
 * reflexo ao lado de um GLB. A conversão preserva cor, textura e mapas.
 *
 * @param {THREE.Object3D} root
 * @returns {number} materiais convertidos
 */
export function upgradeToPBR(root) {
  if (!root) return 0;

  let convertidos = 0;
  const cache = new Map();

  root.traverse((child) => {
    if (!child.isMesh || !child.material) return;

    const lista = materialsOf(child);
    const novos = lista.map((antigo) => {
      if (antigo.isMeshStandardMaterial || antigo.isMeshPhysicalMaterial) {
        return antigo;
      }

      if (cache.has(antigo)) return cache.get(antigo);

      const novo = new THREE.MeshStandardMaterial({
        name: antigo.name,
        color: antigo.color?.clone() ?? new THREE.Color(0xcccccc),
        map: antigo.map ?? null,
        normalMap: antigo.normalMap ?? null,
        aoMap: antigo.aoMap ?? null,
        alphaMap: antigo.alphaMap ?? null,
        emissive: antigo.emissive?.clone() ?? new THREE.Color(0x000000),
        emissiveMap: antigo.emissiveMap ?? null,
        opacity: antigo.opacity ?? 1,
        transparent: antigo.transparent ?? false,
        side: antigo.side ?? THREE.FrontSide,
        vertexColors: antigo.vertexColors ?? false,

        // Phong guarda brilho em `shininess` (0-1000). A conversão
        // aproximada para rugosidade PBR é 1 - sqrt(shininess/1000).
        roughness:
          typeof antigo.shininess === 'number'
            ? Math.min(1, Math.max(0.05, 1 - Math.sqrt(antigo.shininess / 1000)))
            : 0.75,

        // Specular colorido em Phong costuma indicar metal.
        metalness: antigo.specular && antigo.specular.getHex() > 0x808080 ? 0.6 : 0.05,
      });

      cache.set(antigo, novo);
      convertidos++;

      return novo;
    });

    child.material = Array.isArray(child.material) ? novos : novos[0];
  });

  // Libera os materiais antigos que foram substituídos.
  for (const antigo of cache.keys()) {
    antigo.dispose();
  }

  return convertidos;
}

/** Todos os slots que podem carregar uma textura em um material. */
const TODOS_OS_SLOTS = [
  'map',
  'lightMap',
  'aoMap',
  'emissiveMap',
  'bumpMap',
  'normalMap',
  'displacementMap',
  'roughnessMap',
  'metalnessMap',
  'alphaMap',
  'envMap',
  'specularMap',
  'gradientMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'transmissionMap',
  'thicknessMap',
  'specularIntensityMap',
  'specularColorMap',
  'anisotropyMap',
];

/**
 * A textura tem dados de imagem utilizáveis?
 *
 * Quando o arquivo de textura não é encontrado, o loader ainda cria o
 * objeto `THREE.Texture` e o material mantém a referência — só que
 * `texture.image` fica indefinido, ou com dimensão zero se o download
 * falhou no meio.
 *
 * @param {THREE.Texture} texture
 */
export function hasImageData(texture) {
  if (!texture) return false;

  // Texturas comprimidas (KTX2, Basis) guardam os dados em mipmaps.
  if (Array.isArray(texture.mipmaps) && texture.mipmaps.length > 0) return true;

  const image = texture.image;
  if (!image) return false;

  // HTMLImageElement que falhou continua "complete", mas com largura zero.
  if (typeof image.naturalWidth === 'number' && image.naturalWidth === 0) {
    return false;
  }

  const largura = image.width ?? image.videoWidth ?? 0;
  const altura = image.height ?? image.videoHeight ?? 0;

  return largura > 0 && altura > 0;
}

/**
 * Prepara um objeto para exportação, removendo texturas quebradas.
 *
 * Sem isto o GLTFExporter aborta com "No valid image data found. Unable to
 * process texture." — ele tenta serializar a imagem em PNG e não tem o que
 * serializar. É o que acontece quando o usuário arrasta só o `.dae` sem a
 * pasta de texturas ao lado: o modelo abre (sem textura), mas a exportação
 * quebra.
 *
 * Os materiais afetados são CLONADOS antes de serem alterados — o objeto
 * exportado é uma cópia, e mexer nos materiais compartilhados estragaria o
 * modelo que está na viewport.
 *
 * @param {THREE.Object3D} root
 * @returns {{texturasRemovidas: number, materiaisAjustados: number, slots: string[]}}
 */
export function sanitizeForExport(root) {
  const relatorio = { texturasRemovidas: 0, materiaisAjustados: 0, slots: [] };
  if (!root) return relatorio;

  /** @type {Map<THREE.Material, THREE.Material>} */
  const substituidos = new Map();

  root.traverse((child) => {
    if (!child.isMesh || !child.material) return;

    const lista = materialsOf(child);

    const novos = lista.map((material) => {
      if (substituidos.has(material)) return substituidos.get(material);

      const quebrados = TODOS_OS_SLOTS.filter(
        (slot) => material[slot] && !hasImageData(material[slot])
      );

      if (quebrados.length === 0) return material;

      const clone = material.clone();

      for (const slot of quebrados) {
        clone[slot] = null;
        relatorio.texturasRemovidas++;
        if (!relatorio.slots.includes(slot)) relatorio.slots.push(slot);
      }

      // Sem mapa de alpha, a flag de transparência perde o sentido.
      if (quebrados.includes('alphaMap') && clone.opacity >= 1) {
        clone.transparent = false;
        clone.depthWrite = true;
      }

      clone.needsUpdate = true;
      substituidos.set(material, clone);
      relatorio.materiaisAjustados++;

      return clone;
    });

    child.material = Array.isArray(child.material) ? novos : novos[0];
  });

  return relatorio;
}

/**
 * Diagnóstico: por que este modelo pode estar aparecendo errado?
 *
 * Usado para montar a mensagem que a UI exibe depois do import.
 *
 * @param {THREE.Object3D} root
 * @returns {{problemas: string[], estatisticas: Record<string, number>}}
 */
export function diagnose(root) {
  const problemas = [];
  const estatisticas = {
    malhas: 0,
    materiais: 0,
    semTextura: 0,
    transparentes: 0,
    invisiveis: 0,
    semUV: 0,
    faceUnica: 0,
  };

  if (!root) return { problemas, estatisticas };

  const vistos = new Set();

  root.traverse((child) => {
    if (!child.isMesh) return;

    estatisticas.malhas++;

    if (child.geometry && !child.geometry.getAttribute('uv')) {
      estatisticas.semUV++;
    }

    for (const material of materialsOf(child)) {
      if (vistos.has(material)) continue;
      vistos.add(material);

      estatisticas.materiais++;

      if (!material.map) estatisticas.semTextura++;
      if (material.transparent) estatisticas.transparentes++;
      if ((material.opacity ?? 1) <= OPACITY_SUSPEITA) estatisticas.invisiveis++;
      if (material.side === THREE.FrontSide) estatisticas.faceUnica++;
    }
  });

  if (estatisticas.invisiveis > 0) {
    problemas.push(
      t('^1 material(is) com opacidade zero — o modelo ficaria invisível.', estatisticas.invisiveis)
    );
  }

  if (estatisticas.materiais > 0 && estatisticas.semTextura === estatisticas.materiais) {
    problemas.push(
      t(
        'Nenhum material tem textura. Se o modelo deveria ter, arraste a pasta inteira (com as imagens) em vez de só o arquivo do modelo.'
      )
    );
  }

  if (estatisticas.semUV > 0 && estatisticas.semUV === estatisticas.malhas) {
    problemas.push(
      t(
        'As malhas não têm coordenadas UV — texturas não podem ser aplicadas. Reexporte marcando a opção de exportar mapeamento de textura.'
      )
    );
  }

  return { problemas, estatisticas };
}
