/**
 * Lê a seção 4.5 do GDD original ("Atividades extras") e gera o catálogo de
 * atividades: transporte, pets, educação, alimentação, lazer, hospital,
 * academia, lojas, moradia e higiene. É o seed do tipo `activity` do Strapi
 * (trilha do CMS, passos 4 e 5).
 *
 *   node cms-strapi/scripts/gdd-atividades.mjs gdd.txt cms-strapi/seed/atividades.json
 *
 * O GDD só dá a direção de cada efeito ("+felicidade, -energia"), sem número.
 * O leitor grava 1 ou -1 e anota para o game designer definir o valor. Pela
 * planilha, a UI do jogo mostra só a direção (doc 02 §2.4).
 */
import { readFileSync, writeFileSync } from 'node:fs';

/** Subseção do GDD → grupo do catálogo. */
const GROUPS = {
  1: 'transportes',
  2: 'pets',
  3: 'educacao',
  4: 'alimentacao',
  5: 'parque',
  6: 'ginasio',
  7: 'galeria',
  8: 'hospital',
  9: 'academia',
  10: 'lojas',
  11: 'moradia',
  12: 'higiene',
};

/** Palavra do GDD → atributo do avatar (doc 02 §2.3). */
const ATTRIBUTES = {
  energia: 'energy',
  saude: 'health',
  felicidade: 'happiness',
  alimentacao: 'food',
  higiene: 'hygiene',
};

const fold = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const slug = (s) =>
  fold(s)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

function cleanLines(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^\d+$/.test(l) && !/^Este documento é de propriedade/.test(l) && !/^=== página/.test(l));
}

/** "(+felicidade, - energia, +saúde)" → { happiness: 1, energy: -1, health: 1 } */
function readDirections(inside) {
  const out = { energy: 0, health: 0, happiness: 0, food: 0, hygiene: 0 };
  for (const part of inside.split(',')) {
    const m = /^([+-])\s*(\d+)?\s*(\p{L}+)/u.exec(part.replace(/\s+/g, ' ').trim());
    if (!m) continue;
    const attribute = ATTRIBUTES[fold(m[3])];
    if (!attribute) throw new Error(`Atributo desconhecido: "${m[3]}"`);
    out[attribute] = (m[1] === '-' ? -1 : 1) * Number(m[2] ?? 1);
  }
  return out;
}

export function parseActivities(text) {
  const lines = cleanLines(text);
  // O sumário tem "4.5 Atividades extras 112"; o capítulo é a linha sem número.
  const start = lines.findIndex((l) => /^4\.5 Atividades extras$/.test(l));
  const end = lines.findIndex((l, k) => k > start && /^5\. Eventos semanais/.test(l));
  if (start < 0 || end < 0) throw new Error('Seção 4.5 não encontrada no texto.');

  const activities = [];
  const codes = new Set();
  let group = null;
  let item = null;
  const flush = () => {
    if (item === null || !group) return;
    // Os efeitos ficam no último parêntese: "Ir aos lugares (Ginásio, escola, trabalho) (-energia)".
    const open = item.lastIndexOf('(');
    const label = (open >= 0 ? item.slice(0, open) : item).replace(/\s+/g, ' ').trim();
    const inside = open >= 0 ? item.slice(open + 1, item.lastIndexOf(')') > open ? item.lastIndexOf(')') : undefined) : '';
    const name = label.charAt(0).toUpperCase() + label.slice(1);
    let code = `${group}_${slug(label)}`;
    // "Tomar banho" aparece na academia e na higiene; o código leva o grupo, então não repete.
    for (let n = 2; codes.has(code); n++) code = `${group}_${slug(label)}_${n}`;
    codes.add(code);
    activities.push({ code, label: name, group, ...readDirections(inside) });
    item = null;
  };

  for (let k = start + 1; k < end; k++) {
    const line = lines[k];
    const head = /^4\.5\.(\d+)\s/.exec(line);
    if (head) {
      flush();
      group = GROUPS[head[1]];
      if (!group) throw new Error(`Subseção sem grupo: "${line}"`);
      continue;
    }
    if (line.startsWith('- ')) {
      flush();
      item = line.slice(2);
    } else if (item !== null) {
      item += ` ${line}`;
    }
  }
  flush();
  return activities;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/').replace(/^\//, '')}`) {
  const [input, output] = process.argv.slice(2);
  const activities = parseActivities(readFileSync(input, 'utf8'));
  const catalog = {
    fonte: 'GDD original (FGV Jr.), seção 4.5 — Atividades extras',
    gerado_por: 'cms-strapi/scripts/gdd-atividades.mjs',
    unidades: {
      efeitos: 'pontos no atributo do avatar (0–10). O GDD só dá a direção: 1 e -1 são provisórios, para o game designer definir',
    },
    atividades: activities,
  };
  writeFileSync(output, `${JSON.stringify(catalog, null, 2)}\n`);
  const by = activities.reduce((m, a) => ({ ...m, [a.group]: (m[a.group] ?? 0) + 1 }), {});
  console.log(`${activities.length} atividades`, by);
}
