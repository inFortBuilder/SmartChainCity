import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/** Confere os arquivos do seed antes de irem para o Strapi: o que quebraria a carga ou o jogo. */
const read = (file) => JSON.parse(readFileSync(new URL(`../seed/${file}`, import.meta.url), 'utf8'));
const unique = (list, key, what) => {
  const seen = new Set();
  for (const x of list) {
    const k = key(x);
    assert.ok(!seen.has(k), `${what} repetido: ${k}`);
    seen.add(k);
  }
};
const attribute = (n) => Number.isInteger(n) && n >= -10 && n <= 10;

test('raridades: as quatro, com a faixa de ganho que as profissões respeitam', () => {
  const rarities = read('raridades.json').raridades;
  assert.deepEqual(rarities.map((r) => r.code), ['common', 'rare', 'epic', 'legendary']);
  const range = Object.fromEntries(rarities.map((r) => [r.code, r]));
  for (const p of read('profissoes.json').profissoes) {
    const r = range[p.rarity];
    assert.ok(p.tokens >= r.baseMin && p.tokens <= r.baseMax, `${p.code} fora da faixa ${r.baseMin}–${r.baseMax}`);
  }
});

test('atividades: códigos únicos, grupo e efeitos dentro da escala dos atributos', () => {
  const list = read('atividades.json').atividades;
  assert.ok(list.length > 0);
  unique(list, (a) => a.code, 'atividade');
  for (const a of list) {
    for (const k of ['energy', 'health', 'happiness', 'food', 'hygiene']) assert.ok(attribute(a[k]), `${a.code}.${k}`);
  }
});

test('alimentos: códigos únicos, pacote e efeitos válidos', () => {
  const list = read('alimentos.json').alimentos;
  unique(list, (f) => f.code, 'alimento');
  for (const f of list) {
    assert.ok(attribute(f.energy) && attribute(f.health), f.code);
    assert.ok(Number.isInteger(f.pack) && f.pack >= 1, f.code);
    if (f.farmLevel !== undefined) assert.ok([1, 2, 3].includes(f.farmLevel), f.code);
  }
});

test('multiplicadores: um por atributo e nível, e não diminuem quando o nível sobe', () => {
  const list = read('multiplicadores.json').multiplicadores;
  unique(list, (m) => `${m.attribute}:${m.level}`, 'multiplicador');
  const by = Object.groupBy(list, (m) => m.attribute);
  assert.deepEqual(Object.keys(by).sort(), ['experience', 'happiness', 'health', 'pet']);
  for (const [attr, rows] of Object.entries(by)) {
    const sorted = rows.toSorted((a, b) => a.level - b.level);
    for (let k = 1; k < sorted.length; k++) assert.ok(sorted[k].factor >= sorted[k - 1].factor, `${attr} nível ${sorted[k].level}`);
  }
});

test('imóveis: códigos únicos, níveis 1–3 em ordem e upgrade de um tipo que existe', () => {
  const list = read('imoveis.json').imoveis;
  unique(list, (p) => p.code, 'imóvel');
  const codes = new Set(list.map((p) => p.code));
  for (const p of list) {
    assert.ok(['residential', 'commercial', 'industrial', 'rural'].includes(p.zone), p.code);
    assert.ok(['always', 'events'].includes(p.availability), p.code);
    assert.deepEqual(p.levels.map((l) => l.level), [1, 2, 3].slice(0, p.levels.length), p.code);
    if (p.upgradesFrom) assert.ok(codes.has(p.upgradesFrom), `${p.code} sobe de ${p.upgradesFrom}, que não existe`);
  }
});
