/**
 * Carrega o catálogo do seed no Strapi e publica: profissões, atividades,
 * alimentos, raridades, multiplicadores e tipos de imóvel.
 * Idempotente: o que já existe (pela chave de cada tipo) é atualizado, não duplicado.
 *
 *   npm run seed            (na pasta cms-strapi, com o Postgres no ar)
 *
 * Roda o Strapi sem servidor HTTP; a publicação dispara o webhook do catálogo,
 * então o game-core no ar já recebe o aviso.
 */
// CommonJS: a build ES do @strapi/strapi não carrega no Node (importa o lodash por nome).
const { readFileSync } = require('node:fs');
const path = require('node:path');

const { compileStrapi, createStrapi } = require('@strapi/strapi');

const read = (file) => JSON.parse(readFileSync(path.join(__dirname, '..', 'seed', file), 'utf8'));
const notes = (x) => (x.conferir?.length ? x.conferir : null);

/** Cada tipo: arquivo, lista dentro dele, filtro da chave e os dados que vão para o Strapi. */
const TYPES = [
  {
    uid: 'api::job.job',
    name: 'profissões',
    list: () => read('profissoes.json').profissoes,
    key: (p) => ({ code: p.code }),
    data: (p) => ({
      code: p.code,
      label: p.label,
      rarity: p.rarity,
      tokens: p.tokens,
      minutes: p.minutes,
      tasks: p.tasks.map((t) => ({
        name: t.name,
        energy: t.energy,
        happiness: t.happiness,
        minutes: t.minutes,
        tokens: t.tokens,
      })),
      conferir: notes(p),
    }),
  },
  {
    uid: 'api::activity.activity',
    name: 'atividades',
    list: () => read('atividades.json').atividades,
    key: (a) => ({ code: a.code }),
    data: (a) => ({
      code: a.code,
      label: a.label,
      group: a.group,
      energy: a.energy,
      health: a.health,
      happiness: a.happiness,
      food: a.food,
      hygiene: a.hygiene,
      conferir: notes(a) ?? ['O GDD só dá a direção do efeito; 1 e -1 são provisórios'],
    }),
  },
  {
    uid: 'api::food.food',
    name: 'alimentos',
    list: () => read('alimentos.json').alimentos,
    key: (f) => ({ code: f.code }),
    data: (f) => ({
      code: f.code,
      label: f.label,
      group: f.group,
      energy: f.energy,
      health: f.health,
      pack: f.pack,
      farmLevel: f.farmLevel ?? null,
      price: f.price ?? null,
      conferir: notes(f),
    }),
  },
  {
    uid: 'api::rarity.rarity',
    name: 'raridades',
    list: () => read('raridades.json').raridades,
    key: (r) => ({ code: r.code }),
    data: (r) => ({ code: r.code, label: r.label, baseMin: r.baseMin, baseMax: r.baseMax, comboPriceUsd: r.comboPriceUsd }),
  },
  {
    uid: 'api::attribute-multiplier.attribute-multiplier',
    name: 'multiplicadores',
    list: () => read('multiplicadores.json').multiplicadores,
    key: (m) => ({ attribute: m.attribute, level: m.level }),
    data: (m) => ({ attribute: m.attribute, level: m.level, factor: m.factor, conferir: notes(m) }),
  },
  {
    uid: 'api::property-type.property-type',
    name: 'tipos de imóvel',
    list: () => read('imoveis.json').imoveis,
    key: (p) => ({ code: p.code }),
    data: (p) => ({
      code: p.code,
      label: p.label,
      zone: p.zone,
      lots: p.lots,
      availability: p.availability,
      upgradesFrom: p.upgradesFrom ?? null,
      description: p.description ?? null,
      price: p.price ?? null,
      buildMinutes: p.buildMinutes ?? null,
      levels: p.levels.map((l) => ({ level: l.level, maxIncome: l.maxIncome ?? null, upgradeCost: l.upgradeCost ?? null })),
      conferir: notes(p),
    }),
  },
];

async function main() {
  const only = process.argv.slice(2);
  const app = await createStrapi(await compileStrapi()).load();
  app.log.level = 'error';

  for (const type of TYPES) {
    if (only.length && !only.some((o) => type.uid.includes(o))) continue;
    const docs = app.documents(type.uid);
    let created = 0;
    let updated = 0;
    for (const item of type.list()) {
      const data = type.data(item);
      const existing = await docs.findFirst({ filters: type.key(item) });
      if (existing) {
        await docs.update({ documentId: existing.documentId, data, status: 'published' });
        updated++;
      } else {
        await docs.create({ data, status: 'published' });
        created++;
      }
    }
    console.log(`Catálogo: ${type.name}: ${created} criadas, ${updated} atualizadas e publicadas.`);
  }
  await app.destroy();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
