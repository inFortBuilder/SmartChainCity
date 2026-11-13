import { Pool } from 'pg';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { PostgresAvatarStore } from './infra/db/postgres-store.js';
import { MemoryAvatarStore } from './infra/memory-store.js';
import { scheduleDecay } from './jobs/decay.js';

const config = loadConfig();

if (config.NODE_ENV === 'production' && !config.DATABASE_URL) {
  throw new Error('Defina DATABASE_URL: em produção o game-core não roda em memória.');
}

const pool = config.DATABASE_URL ? new Pool({ connectionString: config.DATABASE_URL }) : null;
const store = pool ? new PostgresAvatarStore(pool) : new MemoryAvatarStore();

const app = await buildApp(config, store);
app.log.info(`armazenamento: ${pool ? 'postgres' : 'memória'}`);

const decay = scheduleDecay(store, config.DECAY_EVERY_SECONDS * 1000, (msg) => app.log.info(msg));

const shutdown = async () => {
  decay.stop();
  await app.close();
  await pool?.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.PORT, host: config.HOST });
