import { describe, expect, it } from 'vitest';

import { BASE_RANGE, SEED_PROFESSIONS as PROFESSION_LIST, professionFits, professionsByRarity, validateCatalog } from '../src/domain/catalog.js';

const PROFESSIONS = professionsByRarity();

describe('catálogo de profissões (GDD, capítulo 4)', () => {
  it('tem as 44 profissões: 11 comuns, 11 raras, 14 épicas e 8 lendárias', () => {
    expect(PROFESSION_LIST).toHaveLength(44);
    expect(Object.values(PROFESSIONS).map((r) => Object.keys(r).length)).toEqual([11, 11, 14, 8]);
  });

  it('o ganho de cada profissão fica na faixa da raridade que o simulador aprovou', () => {
    for (const p of PROFESSION_LIST) {
      const [min, max] = BASE_RANGE[p.rarity];
      expect(p.tokens, p.code).toBeGreaterThanOrEqual(min);
      expect(p.tokens, p.code).toBeLessThanOrEqual(max);
    }
  });

  it('toda profissão tem tarefas com duração; os códigos são os que os avatares já usam', () => {
    for (const p of PROFESSION_LIST) expect(p.tasks.some((t) => t.minutes > 0), p.code).toBe(true);
    expect(professionFits('common', 'padeiro')).toBe(true);
    expect(professionFits('common', 'medico')).toBe(false);
    expect(PROFESSIONS.rare.confeiteiro).toBe('Confeiteiro');
  });

  it('recusa catálogo quebrado: fora da faixa, repetido ou sem tarefas', () => {
    const ok = PROFESSION_LIST[0]!;
    expect(() => validateCatalog([{ ...ok, tokens: 999 }])).toThrow(/fora da faixa/);
    expect(() => validateCatalog([ok, ok])).toThrow(/repetida/);
    expect(() => validateCatalog([{ ...ok, tasks: [] }])).toThrow(/sem tarefas/);
  });
});
