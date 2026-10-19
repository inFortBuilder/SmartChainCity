import { describe, expect, it } from 'vitest';

import { OPTIMIZE_LEVELS, OUTPUT_FORMATS, parseArgs, validateOptions } from '../bin/lib/args.js';

describe('parseArgs', () => {
  it('usa os padrões quando só o input é informado', () => {
    const options = parseArgs(['-i', 'modelo.obj']);

    expect(options.input).toBe('modelo.obj');
    expect(options.format).toBe('glb');
    expect(options.optimize).toBe('balanced');
    expect(options.scale).toBe(1.0);
    expect(options.flipAxis).toBe(false);
  });

  it('aceita as formas curtas e longas', () => {
    const short = parseArgs(['-i', 'a.obj', '-o', 'b.glb', '-f', 'gltf']);
    const long = parseArgs(['--input', 'a.obj', '--output', 'b.glb', '--format', 'gltf']);

    expect(short).toEqual(long);
  });

  it('trata o primeiro argumento posicional como input', () => {
    expect(parseArgs(['modelo.stl']).input).toBe('modelo.stl');
  });

  it('normaliza formato e nível para minúsculas', () => {
    const options = parseArgs(['-i', 'a.obj', '-f', 'GLTF', '--optimize', 'AGGRESSIVE']);

    expect(options.format).toBe('gltf');
    expect(options.optimize).toBe('aggressive');
  });

  it('ativa as flags booleanas', () => {
    const options = parseArgs(['-i', 'a.obj', '--flip-axis', '--json', '--quiet']);

    expect(options.flipAxis).toBe(true);
    expect(options.json).toBe(true);
    expect(options.quiet).toBe(true);
  });

  it('rejeita opções desconhecidas', () => {
    expect(() => parseArgs(['--nao-existe'])).toThrow(/desconhecida/i);
  });

  it('rejeita opção sem valor', () => {
    expect(() => parseArgs(['-i'])).toThrow(/exige um valor/i);
    expect(() => parseArgs(['-i', '--json'])).toThrow(/exige um valor/i);
  });
});

describe('validateOptions', () => {
  const base = { input: 'a.obj', format: 'glb', optimize: 'balanced', scale: 1 };

  it('aceita uma configuração válida', () => {
    expect(validateOptions(base)).toEqual([]);
  });

  it('exige input', () => {
    expect(validateOptions({ ...base, input: null })).toHaveLength(1);
  });

  it('rejeita formato de saída fora da allowlist', () => {
    expect(validateOptions({ ...base, format: 'fbx' })[0]).toMatch(/Formato de saída inválido/);
  });

  it('rejeita nível de otimização inválido', () => {
    expect(validateOptions({ ...base, optimize: 'turbo' })[0]).toMatch(/otimização inválido/);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejeita escala %s', (scale) => {
    expect(validateOptions({ ...base, scale })).toHaveLength(1);
  });

  it('acumula múltiplos erros', () => {
    expect(validateOptions({ input: null, format: 'x', optimize: 'y', scale: -1 })).toHaveLength(4);
  });
});

describe('constantes', () => {
  it('expõe apenas formatos de saída realmente suportados', () => {
    expect(OUTPUT_FORMATS).toEqual(['glb', 'gltf']);
  });

  it('expõe os três níveis de otimização', () => {
    expect(OPTIMIZE_LEVELS).toEqual(['none', 'balanced', 'aggressive']);
  });
});
