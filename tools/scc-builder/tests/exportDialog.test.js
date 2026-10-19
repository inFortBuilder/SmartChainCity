import { describe, expect, it } from 'vitest';

import { sanitizeFileName, validateFileName } from '../src/ui/exportDialog.js';

describe('sanitizeFileName', () => {
  it('preserva um nome já válido', () => {
    expect(sanitizeFileName('estande_geosol')).toBe('estande_geosol');
  });

  it('substitui os caracteres proibidos pelo sistema de arquivos', () => {
    expect(sanitizeFileName('proj:eto/final*v2')).toBe('proj_eto_final_v2');
  });

  it('troca espaços por underscore', () => {
    // Espaço funciona no Windows, mas atrapalha em URL e linha de comando.
    expect(sanitizeFileName('Estande GEOSOL 2026')).toBe('Estande_GEOSOL_2026');
  });

  it('remove ponto e underscore no fim — o Windows descarta ponto final', () => {
    expect(sanitizeFileName('modelo...')).toBe('modelo');
    expect(sanitizeFileName('modelo   ')).toBe('modelo');
  });

  it('substitui caracteres de controle', () => {
    expect(sanitizeFileName('mo\u0000de\u001flo')).toBe('mo_de_lo');
  });

  it('cai em "modelo" quando o nome fica vazio', () => {
    expect(sanitizeFileName('')).toBe('modelo');
    expect(sanitizeFileName('   ')).toBe('modelo');
    expect(sanitizeFileName('...')).toBe('modelo');
  });

  it('escapa nomes reservados do Windows', () => {
    // "CON.glb" não pode ser criado no Windows, em nenhuma pasta.
    expect(sanitizeFileName('CON')).toBe('CON_arquivo');
    expect(sanitizeFileName('lpt1')).toBe('lpt1_arquivo');
  });

  it('não confunde nome reservado com prefixo', () => {
    expect(sanitizeFileName('CONCRETO')).toBe('CONCRETO');
  });

  it('limita o comprimento', () => {
    expect(sanitizeFileName('a'.repeat(300))).toHaveLength(120);
  });

  it('lida com null e undefined', () => {
    expect(sanitizeFileName(null)).toBe('modelo');
    expect(sanitizeFileName(undefined)).toBe('modelo');
  });

  it('preserva acentos e hífen', () => {
    expect(sanitizeFileName('projeto-são-paulo')).toBe('projeto-são-paulo');
  });
});

describe('validateFileName', () => {
  it('aceita nome válido', () => {
    expect(validateFileName('estande_v2')).toBeNull();
  });

  it('recusa nome vazio', () => {
    expect(validateFileName('')).toMatch(/Informe um nome/);
    expect(validateFileName('   ')).toMatch(/Informe um nome/);
  });

  it('recusa caracteres proibidos', () => {
    expect(validateFileName('proj/eto')).toMatch(/Evite os caracteres/);
    expect(validateFileName('a\u0001b')).toMatch(/Evite os caracteres/);
    expect(validateFileName('a:b')).toMatch(/Evite os caracteres/);
  });

  it('recusa nome reservado', () => {
    expect(validateFileName('NUL')).toMatch(/reservado/);
  });

  it('recusa nome longo demais', () => {
    expect(validateFileName('a'.repeat(200))).toMatch(/longo demais/);
  });

  it('é consistente com sanitizeFileName', () => {
    // Todo nome que passa pelo saneamento precisa ser aceito na validação.
    for (const bruto of ['proj:eto', 'CON', '   ', 'a'.repeat(300), 'ok_nome']) {
      expect(validateFileName(sanitizeFileName(bruto))).toBeNull();
    }
  });
});
