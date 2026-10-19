import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import en from '../src/i18n/en.js';
import es from '../src/i18n/es.js';
import { idioma, t } from '../src/i18n/index.js';

/**
 * Todo texto de tela tem tradução em inglês e espanhol.
 *
 * Lê o código como texto: cada t('…') de src/ e cada data-t* do index.html
 * é uma chave, e as duas precisam estar em en.js e es.js. A chave tem de
 * ser um literal só — t(variavel) ou t('a' + 'b') este teste não enxerga.
 */

const raiz = fileURLToPath(new URL('..', import.meta.url));

function arquivos(pasta) {
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) return nome === 'i18n' ? [] : arquivos(caminho);
    return caminho.endsWith('.js') ? [caminho] : [];
  });
}

function desescapar(texto) {
  return texto.replace(/\\(.)/g, (_, c) => ({ n: '\n', t: '\t' })[c] ?? c);
}

function decodificarHtml(texto) {
  return texto
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** @returns {Map<string, string>} chave => onde aparece */
function chavesDoCodigo() {
  const chaves = new Map();
  const literal = /(?<![\w.$])t\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`([^`$]*)`)/gs;

  for (const arquivo of arquivos(join(raiz, 'src'))) {
    const codigo = readFileSync(arquivo, 'utf8');
    for (const m of codigo.matchAll(literal)) {
      chaves.set(desescapar(m[1] ?? m[2] ?? m[3]), relative(raiz, arquivo));
    }
  }

  const html = readFileSync(join(raiz, 'index.html'), 'utf8');
  for (const m of html.matchAll(/data-t(?:-html|-title|-aria|-placeholder)?="([^"]*)"/g)) {
    chaves.set(decodificarHtml(m[1]), 'index.html');
  }

  return chaves;
}

const parametros = (texto) => (texto.match(/\^\d/g) ?? []).sort().join(',');

describe('tradução do editor', () => {
  const chaves = chavesDoCodigo();

  it('encontra os textos de tela', () => {
    expect(chaves.size).toBeGreaterThan(400);
  });

  for (const [nome, dicionario] of [
    ['en', en],
    ['es', es],
  ]) {
    it(`todo texto tem tradução em ${nome}`, () => {
      const faltando = [...chaves]
        .filter(([chave]) => !dicionario[chave])
        .map(([chave, onde]) => `${onde}: ${chave}`);

      expect(faltando).toEqual([]);
    });

    it(`a tradução em ${nome} tem os mesmos ^1..^4`, () => {
      const diferentes = Object.entries(dicionario)
        .filter(([chave, valor]) => parametros(chave) !== parametros(valor))
        .map(([chave]) => chave);

      expect(diferentes).toEqual([]);
    });

    it(`${nome} não guarda texto que saiu da tela`, () => {
      const sobrando = Object.keys(dicionario).filter((chave) => !chaves.has(chave));

      expect(sobrando).toEqual([]);
    });
  }

  it('nos testes o idioma é português, e t() troca os parâmetros', () => {
    expect(idioma).toBe('pt');
    expect(t('Carregando ^1', 'casa.glb')).toBe('Carregando casa.glb');
    expect(t('^1 de ^2 malhas têm UV (^3%). A triplanar cobre as demais.', 3, 4, 75)).toBe(
      '3 de 4 malhas têm UV (75%). A triplanar cobre as demais.'
    );
  });

  it('um $& no parâmetro não vira padrão do replace', () => {
    expect(t('Carregando ^1', 'a$&b')).toBe('Carregando a$&b');
  });
});
