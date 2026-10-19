#!/usr/bin/env node

/**
 * SCC Builder CLI v2 — conversão real de modelos 3D para glTF/GLB otimizado.
 *
 * Diferente da v1 (que apenas imprimia "COMPLETED" sem produzir arquivo),
 * este script executa o pipeline completo:
 *   ler → normalizar eixo/escala → otimizar → comprimir → gravar
 *
 * Contrato com o PHP (api/lib/ConversionRunner.php):
 *   - código de saída 0  = sucesso
 *   - código de saída 1  = falha
 *   - com --json, imprime uma linha `@@RESULT@@{...}` no stdout
 */

import path from 'node:path';
import process from 'node:process';

import { HELP_TEXT, parseArgs, validateOptions } from './lib/args.js';
import { ConversionError } from './lib/errors.js';
import { convert } from './lib/pipeline.js';

async function main() {
  let options;

  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`Erro: ${error.message}`);
    console.error('Use --help para ver as opções.');
    process.exit(1);
  }

  if (options.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  const errors = validateOptions(options);
  if (errors.length > 0) {
    for (const error of errors) console.error(`Erro: ${error}`);
    process.exit(1);
  }

  if (!options.output) {
    const ext = path.extname(options.input);
    options.output = `${options.input.slice(0, -ext.length || undefined)}.${options.format}`;
  }

  const log = options.quiet ? () => {} : (message) => console.log(`[scc-builder] ${message}`);

  try {
    const result = await convert({ ...options, log });

    log(
      `concluído em ${result.duration_ms}ms — ` +
        `${result.triangles_before.toLocaleString('pt-BR')} → ` +
        `${result.triangles_after.toLocaleString('pt-BR')} triângulos, ` +
        `${(result.compression_ratio * 100).toFixed(1)}% menor`
    );

    if (options.json) {
      process.stdout.write(`@@RESULT@@${JSON.stringify(result)}\n`);
    }

    process.exit(0);
  } catch (error) {
    const code = error instanceof ConversionError ? error.code : 'conversion_failed';
    const message = error instanceof Error ? error.message : String(error);

    console.error(`[scc-builder] ERRO (${code}): ${message}`);

    if (options.json) {
      process.stdout.write(`@@RESULT@@${JSON.stringify({ code, message, ok: false })}\n`);
    }

    if (!(error instanceof ConversionError) && error instanceof Error && error.stack) {
      console.error(error.stack);
    }

    process.exit(1);
  }
}

main();
