import { Pool } from 'pg';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { PostgresLedgerStore } from './infra/db/postgres-store.js';
import { MemoryLedgerStore } from './infra/memory-store.js';

const config = loadConfig();

// Em memória, todo saldo some ao reiniciar: nunca em produção.
if (config.NODE_ENV === 'production' && !config.DATABASE_URL) {
  throw new Error('Defina DATABASE_URL: em produção o economy não roda em memória.');
}

const pool = config.DATABASE_URL ? new Pool({ connectionString: config.DATABASE_URL }) : null;
const store = pool ? new PostgresLedgerStore(pool) : new MemoryLedgerStore();

const app = await buildApp(config, store);
app.log.info(`armazenamento: ${pool ? 'postgres' : 'memória'}`);

const shutdown = async () => {
  await app.close();
  await pool?.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.PORT, host: config.HOST });
