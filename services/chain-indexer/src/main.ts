import { Pool } from 'pg';

import { type IndexerStatus, buildApp } from './app.js';
import { loadConfig } from './config.js';
import { creditDeposits } from './domain/deposits.js';
import { tick } from './domain/indexer.js';
import { PostgresIndexerStore } from './infra/db/postgres-store.js';
import { EconomyDepositLedger, GatewayWalletOwners } from './infra/deposit-clients.js';
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
// Crédito dos depósitos do GameVault: precisa do gateway (de quem é a carteira) e do economy (o ledger).
const credit =
  config.GATEWAY_URL && config.GATEWAY_TOKEN && config.ECONOMY_URL && config.ECONOMY_TOKEN
    ? { owners: new GatewayWalletOwners(config.GATEWAY_URL, config.GATEWAY_TOKEN), ledger: new EconomyDepositLedger(config.ECONOMY_URL, config.ECONOMY_TOKEN) }
    : null;
const reader = config.RPC_URL ? new ViemChainReader(config.RPC_URL, config.CHAIN_ID, config.contracts) : null;
app.log.info(
  `armazenamento: ${pool ? 'postgres' : 'memória'}; rede: ${reader ? `${config.RPC_URL} (chain ${config.CHAIN_ID}, ${config.CONFIRMATIONS} confirmações)` : 'desligada'}; ` +
    `contratos: ${JSON.stringify(config.contracts)}; crédito de depósitos: ${credit ? 'ligado' : 'desligado'}`,
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
      if (credit) {
        const c = await creditDeposits(store, config.CHAIN_ID, credit.owners, credit.ledger);
        if (c.credited) app.log.info(`depósitos: ${c.credited} creditado(s) no ledger`);
      }
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
