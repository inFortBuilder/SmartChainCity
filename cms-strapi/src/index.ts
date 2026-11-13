import type { Core } from '@strapi/strapi';

/** O catálogo é público no jogo: qualquer um lê as profissões publicadas. */
const PUBLIC_ACTIONS = ['api::job.job.find', 'api::job.job.findOne'];

/** Avisa o game-core a cada publicação, para o jogo mudar sem deploy (trilha do CMS, passo 6). */
const WEBHOOK_NAME = 'game-core: atualizar catálogo';
const WEBHOOK_EVENTS = ['entry.publish', 'entry.unpublish', 'entry.delete'];

async function allowPublicRead(strapi: Core.Strapi) {
  const role = await strapi.db.query('plugin::users-permissions.role').findOne({ where: { type: 'public' } });
  if (!role) return;
  for (const action of PUBLIC_ACTIONS) {
    const exists = await strapi.db
      .query('plugin::users-permissions.permission')
      .findOne({ where: { action, role: role.id } });
    if (!exists) {
      await strapi.db.query('plugin::users-permissions.permission').create({ data: { action, role: role.id } });
    }
  }
}

/**
 * Registra (ou atualiza) o webhook para o game-core, a partir do .env:
 * CATALOG_WEBHOOK_URL e CATALOG_WEBHOOK_TOKEN (o INTERNAL_TOKEN do game-core).
 */
async function registerWebhook(strapi: Core.Strapi) {
  const url = process.env.CATALOG_WEBHOOK_URL;
  const token = process.env.CATALOG_WEBHOOK_TOKEN;
  if (!url || !token) return;
  const store = strapi.get('webhookStore');
  const runner = strapi.get('webhookRunner');
  const data = {
    name: WEBHOOK_NAME,
    url,
    headers: { 'x-service-token': token },
    events: WEBHOOK_EVENTS,
    isEnabled: true,
  };
  const existing = (await store.findWebhooks()).find((w: { name: string }) => w.name === WEBHOOK_NAME);
  if (existing) {
    const updated = await store.updateWebhook(existing.id, data);
    runner.update(updated);
  } else {
    runner.add(await store.createWebhook(data));
  }
  strapi.log.info(`Webhook do catálogo: ${url}`);
}

export default {
  register() {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await allowPublicRead(strapi);
    await registerWebhook(strapi);
  },
};
