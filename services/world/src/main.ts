import { Pool } from 'pg';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { settleStale } from './domain/purchase.js';
import { PostgresWorldStore } from './infra/db/postgres-store.js';
import { LedgerLandPayments } from './infra/ledger-payments.js';
import { MemoryWorldStore } from './infra/memory-store.js';

const config = loadConfig();

if (config.NODE_ENV === 'production' && !config.DATABASE_URL) {
  throw new Error('Defina DATABASE_URL: em produção o world não roda em memória.');
}

const pool = config.DATABASE_URL ? new Pool({ connectionString: config.DATABASE_URL }) : null;
const store = pool ? new PostgresWorldStore(pool) : new MemoryWorldStore();
const payments =
  config.ECONOMY_URL && config.ECONOMY_TOKEN ? new LedgerLandPayments(config.ECONOMY_URL, config.ECONOMY_TOKEN) : null;

const app = await buildApp(config, store, undefined, payments);
app.log.info(`armazenamento: ${pool ? 'postgres' : 'memória'}; venda de lotes: ${payments ? config.ECONOMY_URL : 'desligada'}`);

// Job purchases.settle: compras que ficaram pendentes (resposta do ledger perdida, por exemplo).
let settling = false;
const timer = setInterval(async () => {
  if (!payments || settling) return;
  settling = true;
  try {
    const n = await settleStale(store, payments, new Date());
    if (n) app.log.info(`purchases.settle: ${n} compra(s) resolvida(s)`);
  } catch (error) {
    app.log.error(error);
  } finally {
    settling = false;
  }
}, config.SETTLE_EVERY_SECONDS * 1000);
timer.unref();

const shutdown = async () => {
  clearInterval(timer);
  await app.close();
  await pool?.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.PORT, host: config.HOST });
