import { JobRunner, metricsOf } from '@scc/shared';
import { Pool } from 'pg';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { PostgresLedgerStore } from './infra/db/postgres-store.js';
import { MemoryLedgerStore } from './infra/memory-store.js';
import { settleWithdrawals } from './domain/withdrawals.js';
import { rateFromUsd } from './domain/exchange.js';
import { refreshFxFromDex } from './domain/fx-twap.js';
import { RpcDexPool } from './infra/dex-pool.js';
import { PostgresExchangeStore } from './infra/db/postgres-exchange-store.js';
import { MemoryExchangeStore } from './infra/memory-exchange-store.js';
import { MemorySwitchStore, PostgresSwitchStore } from './infra/switch-stores.js';
import { PostgresWithdrawalStore } from './infra/db/postgres-withdrawal-store.js';
import { MemoryWithdrawalStore } from './infra/memory-withdrawal-store.js';
import { GatewayAccountDirectory, LocalKeyVoucherSigner, RpcVaultReader } from './infra/vault-chain.js';

const config = loadConfig();

// Em memória, todo saldo some ao reiniciar: nunca em produção.
if (config.NODE_ENV === 'production' && !config.DATABASE_URL) {
  throw new Error('Defina DATABASE_URL: em produção o economy não roda em memória.');
}

const pool = config.DATABASE_URL ? new Pool({ connectionString: config.DATABASE_URL }) : null;
const store = pool ? new PostgresLedgerStore(pool) : new MemoryLedgerStore();

// Saque pelo GameVault: só com o gateway, a RPC, o endereço do cofre e a chave do signer.
const vaultOn = config.GATEWAY_URL && config.GATEWAY_TOKEN && config.RPC_URL && config.GAME_VAULT_ADDRESS && config.VAULT_SIGNER_KEY;
const withdrawalStore = pool ? new PostgresWithdrawalStore(pool) : new MemoryWithdrawalStore();
const signer = vaultOn ? new LocalKeyVoucherSigner(config.VAULT_SIGNER_KEY as `0x${string}`, config.CHAIN_ID, config.GAME_VAULT_ADDRESS as `0x${string}`) : null;
const vault = vaultOn ? new RpcVaultReader(config.RPC_URL!, config.GAME_VAULT_ADDRESS as `0x${string}`) : null;

// Câmbio: a primeira cotação sai do SCITY_USD; depois, de POST /internal/v1/economy/fx.
const exchangeStore = pool ? new PostgresExchangeStore(pool) : new MemoryExchangeStore();
if (!(await exchangeStore.latestRate(new Date()))) await exchangeStore.setRate(rateFromUsd(config.SCITY_USD, new Date(), 'config'));

const app = await buildApp(
  config,
  store,
  undefined,
  vaultOn && signer
    ? {
        store: withdrawalStore,
        signer,
        accounts: new GatewayAccountDirectory(config.GATEWAY_URL!, config.GATEWAY_TOKEN!),
        vault: { contract: config.GAME_VAULT_ADDRESS!, chainId: config.CHAIN_ID },
        reader: vault,
      }
    : null,
  { store: exchangeStore, earnings: store, poolStart: config.P2E_START ?? null, freeUntil: config.FREE_PERIOD_UNTIL ?? null },
  pool ? new PostgresSwitchStore(pool) : new MemorySwitchStore(),
);
app.log.info(`armazenamento: ${pool ? 'postgres' : 'memória'}; saque: ${vaultOn ? `${config.GAME_VAULT_ADDRESS} (signer ${signer!.address})` : 'desligado'}`);

// Jobs do economy (trilha do backend): com mais de uma instância, só uma roda cada passada (JobRunner).
const jobs = new JobRunner({
  service: 'economy',
  pool,
  log: { info: (m) => app.log.info(m), error: (m) => app.log.error(m) },
  metrics: metricsOf(app),
});

// Job withdrawals.settle: retoma saques parados, marca os resgatados e devolve os vencidos.
if (vaultOn && signer && vault && config.WITHDRAW_EVERY_SECONDS > 0) {
  jobs.add('withdrawals.settle', config.WITHDRAW_EVERY_SECONDS * 1000, async () => {
    const r = await settleWithdrawals({ ledger: store, store: withdrawalStore, signer, vault }, new Date());
    if (r.resumed || r.claimed || r.refunded || r.cancelled) {
      return `${r.resumed} retomado(s), ${r.claimed} resgatado(s), ${r.refunded} devolvido(s), ${r.cancelled} cancelado(s)`;
    }
  });
}

// Job fx.twap: cotação nova pelo TWAP da DEX quando a atual vence (doc 04 §5).
const dexPool = config.RPC_URL && config.DEX_POOL_ADDRESS && config.SCITY_ADDRESS ? new RpcDexPool(config.RPC_URL, config.DEX_POOL_ADDRESS as `0x${string}`) : null;
if (dexPool && config.FX_CHECK_SECONDS > 0) {
  jobs.add('fx.twap', config.FX_CHECK_SECONDS * 1000, async () => {
    const r = await refreshFxFromDex(
      { store: exchangeStore, pool: dexPool },
      { poolAddress: config.DEX_POOL_ADDRESS!, scityToken: config.SCITY_ADDRESS!, windowSeconds: config.FX_TWAP_SECONDS, periodMs: config.FX_PERIOD_HOURS * 3_600_000, maxJumpBps: config.FX_MAX_JUMP_BPS },
      new Date(),
    );
    if (r.kind === 'updated') return `SCITY a US$ ${r.scityUsd} (antes ${r.previousUsd ?? '-'}; acumulado de 24 h do ${r.from === 'pool' ? 'pool' : 'histórico de amostras'})`;
    if (r.kind === 'unavailable') app.log.warn(`fx.twap: sem TWAP (${r.reason}); a cotação fica como está`);
    if (r.kind === 'rejected') {
      app.log.error(`fx.twap: disjuntor, TWAP US$ ${r.scityUsd} contra US$ ${r.previousUsd} em vigor (${r.jumpBps} bps). Decida pela rota interna /internal/v1/economy/fx`);
    }
  });
}

const shutdown = async () => {
  await jobs.stop();
  await app.close();
  await pool?.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.PORT, host: config.HOST });
app.log.info(`câmbio: ${dexPool ? `TWAP de ${config.FX_TWAP_SECONDS} s do pool ${config.DEX_POOL_ADDRESS}` : 'só pela rota interna'}`);
if (jobs.status().some((j) => j.name === 'fx.twap')) void jobs.run('fx.twap');
