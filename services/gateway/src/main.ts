import { Pool } from 'pg';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { PostgresAuthStore } from './infra/db/postgres-store.js';
import { MemoryAuthStore } from './infra/memory-store.js';

const config = loadConfig();

// In memory, accounts vanish on restart and nonces are not shared between instances.
if (config.NODE_ENV === 'production' && !config.DATABASE_URL) {
  throw new Error('Defina DATABASE_URL: em produção o gateway não roda em memória.');
}

// O código no log é só para a máquina local: em produção, quem lê o log entraria em qualquer conta.
if (config.NODE_ENV === 'production' && config.EMAIL_LOGIN === 'log') {
  throw new Error('EMAIL_LOGIN=log é só para desenvolvimento: em produção use off até existir um provedor de e-mail.');
}

const pool = config.DATABASE_URL ? new Pool({ connectionString: config.DATABASE_URL }) : null;
const store = pool ? new PostgresAuthStore(pool) : new MemoryAuthStore();

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
