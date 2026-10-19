import * as THREE from 'three';
import { t } from '../i18n/index.js';
import { SCC_LIMITS } from './sccPlatform.js';

/**
 * Presets de exportação por engine.
 *
 * Cada motor tem convenções próprias de eixo e de unidade. Exportar um GLB
 * "genérico" faz o modelo chegar deitado ou 100× fora de escala no destino —
 * é a queixa nº 1 de quem leva arquitetura para game engine.
 *
 * Referências de convenção:
 *  - glTF 2.0: Y-up, destro, 1 unidade = 1 metro (spec Khronos)
 *  - Unity:    Y-up, canhoto, 1 unidade = 1 metro
 *  - Unreal:   Z-up, canhoto, 1 unidade = 1 centímetro
 *  - Three.js / WebXR: Y-up, destro, 1 unidade = 1 metro
 *  - Godot 4:  Y-up, destro, 1 unidade = 1 metro
 *
 * A lateralidade (destro/canhoto) é resolvida pelo importador de cada
 * engine, então aqui tratamos apenas eixo vertical e escala — que são o
 * que de fato quebra na prática.
 */

/**
 * @typedef {object} EnginePreset
 * @property {string} label
 * @property {string} description
 * @property {'y'|'z'} upAxis
 * @property {number} unitsPerMeter
 * @property {string} format
 * @property {boolean} flipAxisFromZUp
 * @property {'meshopt'|'draco'} [compression]
 * @property {number[]} [lodRatios] fração de triângulos de cada LOD (LOD0 = 1)
 * @property {number} [maxTriangles]
 * @property {string[]} notes
 */

/**
 * Orçamento e níveis de detalhe do preset "scc" — os mesmos números do
 * validate-lot.php e do CLI (bin/lib/optimize.js), doc 13 §4.
 */
export const SCC_MAX_TRIANGLES = SCC_LIMITS.maxTriangles;
export const SCC_LOD_RATIOS = [1, ...SCC_LIMITS.lodRatios];

/** @type {Record<string, EnginePreset>} */
export const ENGINE_PRESETS = {
  scc: {
    label: 'Smart Chain City',
    description: t('Y-up, metros, Meshopt e 3 níveis de LOD.'),
    upAxis: 'y',
    unitsPerMeter: 1,
    format: 'glb',
    flipAxisFromZUp: true,
    compression: 'meshopt',
    lodRatios: SCC_LOD_RATIOS,
    maxTriangles: SCC_MAX_TRIANGLES,
    notes: [
      t('Preset dos prédios da Smart Chain City: o GLB vai direto para o lote.'),
      t('Até 300 mil triângulos por prédio; acima disso o lote recusa o modelo.'),
      t('Meshopt, LOD1/LOD2 e o contorno da base saem na conversão pelo servidor.'),
    ],
  },

  gltf: {
    label: t('glTF padrão (Khronos)'),
    description: t('Y-up, metros. Conformidade estrita com a spec glTF 2.0.'),
    upAxis: 'y',
    unitsPerMeter: 1,
    format: 'glb',
    flipAxisFromZUp: true,
    notes: [t('Base para todos os demais presets.')],
  },

  unity: {
    label: 'Unity',
    description: t('Y-up, 1 unidade = 1 metro.'),
    upAxis: 'y',
    unitsPerMeter: 1,
    format: 'glb',
    flipAxisFromZUp: true,
    notes: [
      t('Importe com o glTFast ou o UnityGLTF.'),
      t('No inspetor do modelo, mantenha Scale Factor = 1.'),
      t('Unity usa sistema canhoto; o importador espelha o eixo Z sozinho.'),
    ],
  },

  unreal: {
    label: 'Unreal Engine',
    description: t('Z-up, 1 unidade = 1 centímetro.'),
    upAxis: 'z',
    unitsPerMeter: 100,
    format: 'glb',
    flipAxisFromZUp: false,
    notes: [
      t('Unreal trabalha em centímetros: o preset multiplica a escala por 100.'),
      t('Como o Unreal é Z-up, a correção de eixo NÃO é aplicada.'),
      t('Em Import Settings, desmarque "Convert Scene Unit".'),
    ],
  },

  threejs: {
    label: 'Three.js / WebXR',
    description: t('Y-up, metros, Draco recomendado.'),
    upAxis: 'y',
    unitsPerMeter: 1,
    format: 'glb',
    flipAxisFromZUp: true,
    notes: [
      t('Use GLTFLoader com DRACOLoader para abrir a saída otimizada.'),
      t('Para WebXR, mantenha a escala em metros: 1 unidade = 1 m no mundo real.'),
    ],
  },

  godot: {
    label: 'Godot 4',
    description: 'Y-up, metros.',
    upAxis: 'y',
    unitsPerMeter: 1,
    format: 'glb',
    flipAxisFromZUp: true,
    notes: [t('Godot importa .glb nativamente; basta arrastar para o FileSystem.')],
  },

  blender: {
    label: 'Blender',
    description: t('Z-up, metros — o importador glTF do Blender já converte.'),
    upAxis: 'z',
    unitsPerMeter: 1,
    format: 'glb',
    flipAxisFromZUp: true,
    notes: [t('O add-on glTF do Blender aplica a rotação Y-up → Z-up na importação.')],
  },
};

/**
 * Unidade de origem do modelo, informada pelo usuário.
 * Necessária porque um DWG/Revit costuma vir em milímetros e um SketchUp
 * em polegadas — sem isso, a escala de destino é um chute.
 */
export const SOURCE_UNITS = {
  m: { label: t('Metros'), metersPerUnit: 1 },
  cm: { label: t('Centímetros'), metersPerUnit: 0.01 },
  mm: { label: t('Milímetros'), metersPerUnit: 0.001 },
  in: { label: t('Polegadas'), metersPerUnit: 0.0254 },
  ft: { label: t('Pés'), metersPerUnit: 0.3048 },
};

/**
 * Calcula a transformação necessária para levar o modelo da origem ao destino.
 *
 * @param {object} options
 * @param {keyof typeof ENGINE_PRESETS} options.engine
 * @param {keyof typeof SOURCE_UNITS} [options.sourceUnit]
 * @param {'y'|'z'} [options.sourceUp] eixo vertical do arquivo de origem
 * @returns {{scale:number, rotationX:number, preset:EnginePreset, summary:string}}
 */
export function resolveTransform(options) {
  const preset = ENGINE_PRESETS[options.engine] ?? ENGINE_PRESETS.gltf;
  const sourceUnit = SOURCE_UNITS[options.sourceUnit ?? 'm'] ?? SOURCE_UNITS.m;
  const sourceUp = options.sourceUp ?? 'y';

  // metros do modelo → unidades do destino
  const scale = sourceUnit.metersPerUnit * preset.unitsPerMeter;

  // Só rotaciona quando os eixos verticais divergem.
  let rotationX = 0;
  if (sourceUp === 'z' && preset.upAxis === 'y') {
    rotationX = -Math.PI / 2;
  } else if (sourceUp === 'y' && preset.upAxis === 'z') {
    rotationX = Math.PI / 2;
  }

  const parts = [];
  if (scale !== 1) parts.push(t('escala ×^1', formatScale(scale)));
  if (rotationX !== 0)
    parts.push(`${sourceUp.toUpperCase()}-up → ${preset.upAxis.toUpperCase()}-up`);

  return {
    scale,
    rotationX,
    preset,
    summary: parts.length > 0 ? parts.join(', ') : t('nenhuma transformação necessária'),
  };
}

/**
 * Aplica o preset a uma CÓPIA do objeto — o modelo na viewport não é alterado.
 *
 * @param {THREE.Object3D} object
 * @param {object} options ver resolveTransform
 * @returns {{object: THREE.Object3D, transform: ReturnType<typeof resolveTransform>}}
 */
export function applyPreset(object, options) {
  const transform = resolveTransform(options);

  const wrapper = new THREE.Group();
  wrapper.name = `${object.name || 'modelo'}_${options.engine}`;

  const clone = object.clone(true);
  wrapper.add(clone);

  if (transform.rotationX !== 0) {
    wrapper.rotation.x = transform.rotationX;
  }
  if (transform.scale !== 1) {
    wrapper.scale.setScalar(transform.scale);
  }

  wrapper.updateMatrixWorld(true);

  return { object: wrapper, transform };
}

/**
 * Texto de orientação para exibir junto ao preset selecionado.
 * @param {keyof typeof ENGINE_PRESETS} engine
 */
export function presetNotes(engine) {
  const preset = ENGINE_PRESETS[engine];

  return preset ? preset.notes : [];
}

function formatScale(scale) {
  if (scale >= 1) return String(Number(scale.toFixed(4)));

  return String(Number(scale.toPrecision(3)));
}

/** Opções prontas para popular um `<select>`. */
export function presetOptions() {
  return Object.entries(ENGINE_PRESETS).map(([value, preset]) => ({
    value,
    label: preset.label,
    description: preset.description,
  }));
}
