import { Pool } from 'pg';
import type { Address, Hex } from 'viem';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { settleProperties } from './domain/properties.js';
import { settleStale } from './domain/purchase.js';
import { PostgresPropertyStore } from './infra/db/postgres-property-store.js';
import { PostgresWorldStore } from './infra/db/postgres-store.js';
import { GatewayWalletDirectory, LocalKeyQuoteSigner } from './infra/land-chain.js';
import { LedgerLandPayments } from './infra/ledger-payments.js';
import { LedgerPropertyPayments } from './infra/ledger-property-payments.js';
import { MemoryPropertyStore } from './infra/memory-property-store.js';
import { MemoryWorldStore } from './infra/memory-store.js';

const config = loadConfig();

if (config.NODE_ENV === 'production' && !config.DATABASE_URL) {
  throw new Error('Defina DATABASE_URL: em produção o world não roda em memória.');
}

const pool = config.DATABASE_URL ? new Pool({ connectionString: config.DATABASE_URL }) : null;
const store = pool ? new PostgresWorldStore(pool) : new MemoryWorldStore();
const payments =
  config.ECONOMY_URL && config.ECONOMY_TOKEN ? new LedgerLandPayments(config.ECONOMY_URL, config.ECONOMY_TOKEN) : null;

// Posse on-chain do lote: só com o gateway (carteiras) e a chave do SIGNER do LandNFT.
const land =
  config.GATEWAY_URL && config.GATEWAY_TOKEN && config.LAND_NFT_ADDRESS && config.LAND_SIGNER_KEY
    ? {
        wallets: new GatewayWalletDirectory(config.GATEWAY_URL, config.GATEWAY_TOKEN),
        signer: new LocalKeyQuoteSigner(
          config.LAND_SIGNER_KEY as Hex,
          config.CHAIN_ID,
          config.LAND_NFT_ADDRESS as Address,
        ),
        contract: config.LAND_NFT_ADDRESS,
        chainId: config.CHAIN_ID,
      }
    : null;
if (land && config.NODE_ENV === 'production') {
  throw new Error('LAND_SIGNER_KEY no .env é só para o MVP local: em produção a chave fica num KMS.');
}

// Imóveis: obra e renda em THALER no mesmo ledger.
const propertyStore = pool ? new PostgresPropertyStore(pool) : new MemoryPropertyStore();
const propertyPayments =
  config.ECONOMY_URL && config.ECONOMY_TOKEN ? new LedgerPropertyPayments(config.ECONOMY_URL, config.ECONOMY_TOKEN) : null;

const app = await buildApp(config, store, undefined, payments, land, { store: propertyStore, payments: propertyPayments });
const onchain = land ? `${land.contract} (chain ${land.chainId}, signer ${land.signer.address})` : 'desligada';
app.log.info(
  `armazenamento: ${pool ? 'postgres' : 'memória'}; venda de lotes: ${payments ? config.ECONOMY_URL : 'desligada'}; posse on-chain: ${onchain}`,
);

// Jobs purchases.settle e properties.settle: compras, obras e coletas que ficaram
// pendentes (resposta do ledger perdida, por exemplo).
let settling = false;
const timer = setInterval(async () => {
  if (!payments || settling) return;
  settling = true;
  try {
    const n = await settleStale(store, payments, new Date());
    if (n) app.log.info(`purchases.settle: ${n} compra(s) resolvida(s)`);
    if (propertyPayments) {
      const m = await settleProperties(propertyStore, propertyPayments, new Date());
      if (m) app.log.info(`properties.settle: ${m} obra(s) ou coleta(s) resolvida(s)`);
    }
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
