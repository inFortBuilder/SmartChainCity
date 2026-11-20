import { Pool } from 'pg';
import type { Address, Hex } from 'viem';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { settleBuildings } from './domain/buildings.js';
import { settleProperties } from './domain/properties.js';
import { HttpBuilderClient } from './infra/builder-client.js';
import { PostgresBuildingStore } from './infra/db/postgres-building-store.js';
import { LedgerOutorgaPayments } from './infra/ledger-outorga-payments.js';
import { MemoryBuildingStore } from './infra/memory-building-store.js';
import { settleStale } from './domain/purchase.js';
import { chargeTaxes } from './domain/taxes.js';
import { PostgresPropertyStore } from './infra/db/postgres-property-store.js';
import { PostgresWorldStore } from './infra/db/postgres-store.js';
import { PostgresTaxStore } from './infra/db/postgres-tax-store.js';
import { GatewayWalletDirectory, LocalKeyBuildingSigner, LocalKeyQuoteSigner } from './infra/land-chain.js';
import { LedgerLandPayments } from './infra/ledger-payments.js';
import { LedgerPropertyPayments } from './infra/ledger-property-payments.js';
import { LedgerTaxPayments } from './infra/ledger-tax-payments.js';
import { MemoryPropertyStore } from './infra/memory-property-store.js';
import { MemoryWorldStore } from './infra/memory-store.js';
import { MemoryTaxStore } from './infra/memory-tax-store.js';

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

// Impostos: IPTU e PT em THALER no mesmo ledger.
const taxStore = pool ? new PostgresTaxStore(pool) : new MemoryTaxStore();
const taxPayments =
  config.ECONOMY_URL && config.ECONOMY_TOKEN ? new LedgerTaxPayments(config.ECONOMY_URL, config.ECONOMY_TOKEN) : null;

// Prédios de construtores: validação no SCC Builder e outorga em SCITY no ledger.
const buildingStore = pool ? new PostgresBuildingStore(pool) : new MemoryBuildingStore();
const builder = config.BUILDER_URL ? new HttpBuilderClient(config.BUILDER_URL) : null;
const outorga =
  config.ECONOMY_URL && config.ECONOMY_TOKEN ? new LedgerOutorgaPayments(config.ECONOMY_URL, config.ECONOMY_TOKEN) : null;

const app = await buildApp(
  config,
  store,
  undefined,
  payments,
  land,
  { store: propertyStore, payments: propertyPayments },
  { store: taxStore, payments: taxPayments },
  {
    store: buildingStore,
    builder,
    payments: outorga,
    // BuildingNFT: mesma chave e mesmo gateway da posse on-chain do lote.
    onchain:
      land && config.BUILDING_NFT_ADDRESS && config.LAND_SIGNER_KEY
        ? {
            wallets: land.wallets,
            signer: new LocalKeyBuildingSigner(config.LAND_SIGNER_KEY as Hex, config.CHAIN_ID, config.BUILDING_NFT_ADDRESS as Address),
            contract: config.BUILDING_NFT_ADDRESS,
            chainId: config.CHAIN_ID,
          }
        : null,
  },
);
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
    if (outorga) {
      const k = await settleBuildings(buildingStore, outorga, new Date());
      if (k) app.log.info(`buildings.settle: ${k} outorga(s) resolvida(s)`);
    }
  } catch (error) {
    app.log.error(error);
  } finally {
    settling = false;
  }
}, config.SETTLE_EVERY_SECONDS * 1000);
timer.unref();

// Job tax.charge: contas de IPTU e PT vencidas e débito automático (doc 03 §4).
let taxing = false;
const taxTimer = setInterval(async () => {
  if (!taxPayments || taxing) return;
  taxing = true;
  try {
    const r = await chargeTaxes(store, propertyStore, taxStore, taxPayments, new Date(), buildingStore);
    if (r.created || r.paid || r.unpaid) {
      app.log.info(`tax.charge: ${r.created} conta(s) nova(s), ${r.paid} paga(s), ${r.unpaid} sem saldo`);
    }
  } catch (error) {
    app.log.error(error);
  } finally {
    taxing = false;
  }
}, config.TAX_EVERY_SECONDS * 1000);
taxTimer.unref();

const shutdown = async () => {
  clearInterval(timer);
  clearInterval(taxTimer);
  await app.close();
  await pool?.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.PORT, host: config.HOST });
