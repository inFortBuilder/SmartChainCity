/**
 * Parser de argumentos de linha de comando, sem dependências externas.
 */

/** @typedef {{input:string|null, output:string|null, format:string, optimize:string, scale:number, flipAxis:boolean, preset:string|null, json:boolean, quiet:boolean, help:boolean}} CliOptions */

export const OPTIMIZE_LEVELS = ['none', 'balanced', 'aggressive'];
export const OUTPUT_FORMATS = ['glb', 'gltf'];
/** Presets de saída. "scc": Y-up, metros, Meshopt, LOD1/LOD2 e modelo.meta.json. */
export const CLI_PRESETS = ['scc'];

const DEFAULTS = {
  input: null,
  output: null,
  format: 'glb',
  optimize: 'balanced',
  scale: 1.0,
  flipAxis: false,
  preset: null,
  json: false,
  quiet: false,
  help: false,
};

/**
 * @param {string[]} argv
 * @returns {CliOptions}
 */
export function parseArgs(argv) {
  const options = { ...DEFAULTS };

  const requireValue = (flag, value) => {
    if (value === undefined || value.startsWith('-')) {
      throw new Error(`A opção ${flag} exige um valor.`);
    }
    return value;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    switch (arg) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '-i':
      case '--input':
        options.input = requireValue(arg, argv[++i]);
        break;
      case '-o':
      case '--output':
        options.output = requireValue(arg, argv[++i]);
        break;
      case '-f':
      case '--format':
        options.format = requireValue(arg, argv[++i]).toLowerCase();
        break;
      case '--optimize':
        options.optimize = requireValue(arg, argv[++i]).toLowerCase();
        break;
      case '--scale':
        options.scale = Number.parseFloat(requireValue(arg, argv[++i]));
        break;
      case '--flip-axis':
        options.flipAxis = true;
        break;
      case '--preset':
        options.preset = requireValue(arg, argv[++i]).toLowerCase();
        break;
      case '--json':
        options.json = true;
        break;
      case '-q':
      case '--quiet':
        options.quiet = true;
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Opção desconhecida: ${arg}`);
        }
        if (options.input === null) {
          options.input = arg;
        }
    }
  }

  return options;
}

/**
 * Valida as opções e devolve a lista de problemas encontrados.
 * @param {CliOptions} options
 * @returns {string[]}
 */
export function validateOptions(options) {
  const errors = [];

  if (!options.input) {
    errors.push('O caminho de entrada é obrigatório (-i/--input).');
  }
  if (!OUTPUT_FORMATS.includes(options.format)) {
    errors.push(
      `Formato de saída inválido "${options.format}". Aceitos: ${OUTPUT_FORMATS.join(', ')}.`
    );
  }
  if (!OPTIMIZE_LEVELS.includes(options.optimize)) {
    errors.push(
      `Nível de otimização inválido "${options.optimize}". Aceitos: ${OPTIMIZE_LEVELS.join(', ')}.`
    );
  }
  if (!Number.isFinite(options.scale) || options.scale <= 0) {
    errors.push('--scale deve ser um número maior que zero.');
  }
  if (
    options.preset !== null &&
    options.preset !== undefined &&
    !CLI_PRESETS.includes(options.preset)
  ) {
    errors.push(`Preset inválido "${options.preset}". Aceitos: ${CLI_PRESETS.join(', ')}.`);
  }
  if (options.preset === 'scc' && options.format !== 'glb') {
    errors.push('O preset scc gera apenas GLB (-f glb).');
  }

  return errors;
}

export const HELP_TEXT = `
SCC Builder CLI v2.0.0 — conversão de modelos 3D para glTF/GLB otimizado

Uso:
  node bin/convert.js -i <entrada> [-o <saida>] [opções]

Opções:
  -i, --input <caminho>    Arquivo de entrada (.glb .gltf .obj .stl .ply .fbx .dae)
  -o, --output <caminho>   Arquivo de saída (padrão: <entrada>.glb)
  -f, --format <formato>   glb | gltf                    (padrão: glb)
      --optimize <nivel>   none | balanced | aggressive  (padrão: balanced)
      --scale <fator>      Multiplicador de escala       (padrão: 1.0)
      --flip-axis          Converte Z-up (CAD/BIM) para Y-up (game engines)
      --preset <nome>      scc: Y-up, metros, Meshopt, LOD1/LOD2 e .meta.json
                           (a base do modelo que o validate-lot confere)
      --json               Emite o resultado como @@RESULT@@{...} no stdout
  -q, --quiet              Suprime os logs de progresso
  -h, --help               Mostra esta ajuda

Níveis de otimização:
  none         Apenas conversão de formato.
  balanced     dedup + weld + prune + join + Draco. Preserva a silhueta.
  aggressive   O do balanced + simplificação para ~50% dos triângulos
               + redimensionamento de texturas para 1024px.

Exemplos:
  node bin/convert.js -i casa.obj -o casa.glb
  node bin/convert.js -i torre.glb -o torre.glb --optimize aggressive
  node bin/convert.js -i planta.stl -o planta.glb --flip-axis --scale 0.001
  node bin/convert.js -i torre.fbx -o torre.glb --preset scc
`;
