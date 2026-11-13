import { Pool } from 'pg';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { PostgresAvatarStore } from './infra/db/postgres-store.js';
import { MemoryAvatarStore } from './infra/memory-store.js';
import { EconomyPayer } from './infra/economy-payer.js';
import { scheduleDecay } from './jobs/decay.js';
import { scheduleShifts } from './jobs/shift.js';

const config = loadConfig();

if (config.NODE_ENV === 'production' && !config.DATABASE_URL) {
  throw new Error('Defina DATABASE_URL: em produção o game-core não roda em memória.');
}

const pool = config.DATABASE_URL ? new Pool({ connectionString: config.DATABASE_URL }) : null;
const store = pool ? new PostgresAvatarStore(pool) : new MemoryAvatarStore();

const payer =
  config.ECONOMY_URL && config.ECONOMY_TOKEN ? new EconomyPayer(config.ECONOMY_URL, config.ECONOMY_TOKEN) : null;

const app = await buildApp(config, store, undefined, payer);
app.log.info(`armazenamento: ${pool ? 'postgres' : 'memória'}; pagamento de turnos: ${payer ? config.ECONOMY_URL : 'desligado'}`);

// Catálogo publicado no Strapi; se ele estiver fora, segue o seed e o webhook atualiza depois.
if (config.CMS_URL) {
  try {
    const n = await (app as unknown as { loadCatalog: () => Promise<number> }).loadCatalog();
    app.log.info(`catálogo: ${n} profissões do Strapi (${config.CMS_URL})`);
  } catch (error) {
    app.log.warn(`catálogo: Strapi indisponível, usando o seed (${(error as Error).message})`);
  }
}

const decay = scheduleDecay(store, config.DECAY_EVERY_SECONDS * 1000, (msg) => app.log.info(msg));
const shifts = scheduleShifts(store, config.SHIFT_CHECK_SECONDS * 1000, (msg) => app.log.info(msg));

const shutdown = async () => {
  decay.stop();
  shifts.stop();
  await app.close();
  await pool?.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.PORT, host: config.HOST });
