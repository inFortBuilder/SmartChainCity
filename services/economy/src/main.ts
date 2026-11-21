import { Pool } from 'pg';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { PostgresLedgerStore } from './infra/db/postgres-store.js';
import { MemoryLedgerStore } from './infra/memory-store.js';
import { settleWithdrawals } from './domain/withdrawals.js';
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
      }
    : null,
);
app.log.info(`armazenamento: ${pool ? 'postgres' : 'memória'}; saque: ${vaultOn ? `${config.GAME_VAULT_ADDRESS} (signer ${signer!.address})` : 'desligado'}`);

// Job withdrawals.settle: retoma saques parados, marca os resgatados e devolve os vencidos.
let settling = false;
const timer =
  vaultOn && signer && vault && config.WITHDRAW_EVERY_SECONDS > 0
    ? setInterval(async () => {
        if (settling) return;
        settling = true;
        try {
          const r = await settleWithdrawals({ ledger: store, store: withdrawalStore, signer, vault }, new Date());
          if (r.resumed || r.claimed || r.refunded) {
            app.log.info(`withdrawals.settle: ${r.resumed} retomado(s), ${r.claimed} resgatado(s), ${r.refunded} devolvido(s)`);
          }
        } catch (error) {
          app.log.error(error);
        } finally {
          settling = false;
        }
      }, config.WITHDRAW_EVERY_SECONDS * 1000)
    : null;
timer?.unref();

const shutdown = async () => {
  if (timer) clearInterval(timer);
  await app.close();
  await pool?.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.PORT, host: config.HOST });
