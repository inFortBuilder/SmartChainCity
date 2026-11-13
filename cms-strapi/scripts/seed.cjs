/**
 * Carrega o catálogo do seed (gerado do GDD) no Strapi e publica.
 * Idempotente: profissão que já existe (pelo código) é atualizada, não duplicada.
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

async function main() {

const catalog = JSON.parse(readFileSync(path.join(__dirname, '..', 'seed', 'profissoes.json'), 'utf8'));

const app = await createStrapi(await compileStrapi()).load();
app.log.level = 'error';
const jobs = app.documents('api::job.job');

let created = 0;
let updated = 0;
for (const p of catalog.profissoes) {
  const data = {
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
    conferir: p.conferir ?? null,
  };
  const existing = await jobs.findFirst({ filters: { code: p.code } });
  if (existing) {
    await jobs.update({ documentId: existing.documentId, data, status: 'published' });
    updated++;
  } else {
    await jobs.create({ data, status: 'published' });
    created++;
  }
}

console.log(`Catálogo: ${created} profissões criadas, ${updated} atualizadas e publicadas.`);
await app.destroy();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
