import { Pool } from 'pg';

import { type IndexerStatus, buildApp } from './app.js';
import { loadConfig } from './config.js';
import { tick } from './domain/indexer.js';
import { PostgresIndexerStore } from './infra/db/postgres-store.js';
import { MemoryIndexerStore } from './infra/memory-store.js';
import { ViemChainReader } from './infra/viem-reader.js';

const config = loadConfig();

if (config.NODE_ENV === 'production' && !config.DATABASE_URL) {
  throw new Error('Defina DATABASE_URL: em produção o indexer não roda em memória.');
}

const pool = config.DATABASE_URL ? new Pool({ connectionString: config.DATABASE_URL }) : null;
const store = pool ? new PostgresIndexerStore(pool) : new MemoryIndexerStore();
const status: IndexerStatus = { head: null, lastTickAt: null, lastError: null };

const app = await buildApp(config, store, status);
const reader = config.RPC_URL ? new ViemChainReader(config.RPC_URL, config.CHAIN_ID, config.contracts) : null;
app.log.info(
  `armazenamento: ${pool ? 'postgres' : 'memória'}; rede: ${reader ? `${config.RPC_URL} (chain ${config.CHAIN_ID}, ${config.CONFIRMATIONS} confirmações)` : 'desligada'}; ` +
    `contratos: ${JSON.stringify(config.contracts)}`,
);

// Laço de leitura: enquanto houver blocos confirmados atrás, lê sem esperar.
let stopped = false;
async function loop() {
  while (!stopped && reader) {
    let busy = false;
    try {
      const r = await tick(reader, store, {
        chainId: config.CHAIN_ID,
        confirmations: config.CONFIRMATIONS,
        startBlock: config.START_BLOCK,
        batchBlocks: config.BATCH_BLOCKS,
        reorgDepth: config.REORG_DEPTH,
      });
      status.lastTickAt = new Date();
      status.lastError = null;
      if (r.kind === 'idle') status.head = r.head;
      if (r.kind === 'indexed') {
        busy = true;
        if (r.inserted) app.log.info(`blocos ${r.from}–${r.to}: ${r.inserted} evento(s) novo(s)`);
      }
      if (r.kind === 'reorg') {
        busy = true;
        app.log.warn(`reorganização: voltou para o bloco ${r.rewoundTo ?? 'inicial'}, ${r.dropped} evento(s) descartado(s)`);
      }
    } catch (error) {
      status.lastError = error instanceof Error ? error.message : String(error);
      app.log.error(error);
    }
    if (!busy) await new Promise((resolve) => setTimeout(resolve, config.POLL_SECONDS * 1000));
  }
}
void loop();

const shutdown = async () => {
  stopped = true;
  await app.close();
  await pool?.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.PORT, host: config.HOST });
