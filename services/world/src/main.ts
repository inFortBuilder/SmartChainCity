import { JobRunner, metricsOf } from '@scc/shared';
import { Pool } from 'pg';
import type { Address, Hex } from 'viem';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { fetchCmsPropertyTypes, mergeCatalog } from './domain/catalog.js';
import { settleBuildings } from './domain/buildings.js';
import { setPropertyCatalog, settleProperties } from './domain/properties.js';
import { HttpBuilderClient } from './infra/builder-client.js';
import { PostgresAuctionStore } from './infra/db/postgres-auction-store.js';
import { PostgresBuildingStore } from './infra/db/postgres-building-store.js';
import { LedgerOutorgaPayments } from './infra/ledger-outorga-payments.js';
import { LedgerUnitPayments } from './infra/ledger-unit-payments.js';
import { MemoryUnitStore } from './infra/memory-unit-store.js';
import { PostgresUnitStore } from './infra/db/postgres-unit-store.js';
import { settleUnits } from './domain/units.js';
import { LedgerAuctionPayments } from './infra/ledger-auction-payments.js';
import { EconomyScityPrice } from './infra/economy-price.js';
import { MemoryAuctionStore } from './infra/memory-auction-store.js';
import { MemoryBuildingStore } from './infra/memory-building-store.js';
import { settleStale } from './domain/purchase.js';
import { chargeTaxes } from './domain/taxes.js';
import { tickAuctions } from './domain/auctions.js';
import { syncChain } from './domain/chain-sync.js';
import { GatewayWalletOwners, IndexerChainFeed } from './infra/chain-feed.js';
import { PostgresGuestStore } from './infra/db/postgres-guest-store.js';
import { PostgresSaleStore } from './infra/db/postgres-sale-store.js';
import { MemoryGuestStore } from './infra/memory-guest-store.js';
import { MemorySaleStore } from './infra/memory-sale-store.js';
import { PostgresChainSyncStore } from './infra/db/postgres-chain-sync-store.js';
import { MemoryChainSyncStore } from './infra/memory-chain-sync-store.js';
import { PostgresPropertyStore } from './infra/db/postgres-property-store.js';
import { PostgresWorldStore } from './infra/db/postgres-store.js';
import { PostgresTaxStore } from './infra/db/postgres-tax-store.js';
import { lotTokenId } from './domain/land-quote.js';
import { PostgresSeizureStore } from './infra/db/postgres-seizure-store.js';
import {
  GatewayWalletDirectory,
  IndexerChainTokens,
  LocalKeyBuildingSigner,
  LocalKeyPropertySigner,
  LocalKeyQuoteSigner,
  LocalKeySeizureSigner,
} from './infra/land-chain.js';
import { MemorySeizureStore } from './infra/memory-seizure-store.js';
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
// Leilão do lote inadimplente: lance do vencedor no mesmo ledger.
const auctionStore = pool ? new PostgresAuctionStore(pool) : new MemoryAuctionStore();
const auctionPayments =
  config.ECONOMY_URL && config.ECONOMY_TOKEN ? new LedgerAuctionPayments(config.ECONOMY_URL, config.ECONOMY_TOKEN) : null;
const taxPayments =
  config.ECONOMY_URL && config.ECONOMY_TOKEN ? new LedgerTaxPayments(config.ECONOMY_URL, config.ECONOMY_TOKEN) : null;

// Apreensão do NFT no leilão (ADR-0016): mesma chave do world (papel SIGNER) nos dois contratos.
const seizureStore = pool ? new PostgresSeizureStore(pool) : new MemorySeizureStore();
const guestStore = pool ? new PostgresGuestStore(pool) : new MemoryGuestStore();
const lotToken = (city: string, lotId: number) => {
  const n = config.LAND_CITY_IDS[city];
  return n ? lotTokenId(n, lotId) : null;
};
const seizureSigners = {
  ...(land ? { lot: new LocalKeySeizureSigner(config.LAND_SIGNER_KEY as Hex, config.CHAIN_ID, config.LAND_NFT_ADDRESS as Address, 'land') } : {}),
  ...(land && config.PROPERTY_NFT_ADDRESS
    ? { property: new LocalKeySeizureSigner(config.LAND_SIGNER_KEY as Hex, config.CHAIN_ID, config.PROPERTY_NFT_ADDRESS as Address, 'property') }
    : {}),
};

// Prédios de construtores: validação no SCC Builder e outorga em SCITY no ledger.
const buildingStore = pool ? new PostgresBuildingStore(pool) : new MemoryBuildingStore();
// Unidades dos prédios (E3.11): venda e aluguel em THALER pelo ledger.
const unitStore = pool ? new PostgresUnitStore(pool) : new MemoryUnitStore();
const unitPayments = config.ECONOMY_URL && config.ECONOMY_TOKEN ? new LedgerUnitPayments(config.ECONOMY_URL, config.ECONOMY_TOKEN) : null;
const builder = config.BUILDER_URL ? new HttpBuilderClient(config.BUILDER_URL) : null;
const outorga =
  config.ECONOMY_URL && config.ECONOMY_TOKEN ? new LedgerOutorgaPayments(config.ECONOMY_URL, config.ECONOMY_TOKEN) : null;

// Cotação do SCITY: do câmbio do economy, renovada a cada minuto; sem ele, o SCITY_USD fixo.
const price = config.ECONOMY_URL ? new EconomyScityPrice(config.ECONOMY_URL, config.SCITY_USD) : null;
if (price) await price.refresh();

const app = await buildApp(
  config,
  store,
  undefined,
  payments,
  land,
  {
    store: propertyStore,
    payments: propertyPayments,
    // PropertyNFT: mesma chave e mesmo gateway da posse on-chain do lote.
    onchain:
      land && config.PROPERTY_NFT_ADDRESS && config.LAND_SIGNER_KEY
        ? {
            wallets: land.wallets,
            signer: new LocalKeyPropertySigner(config.LAND_SIGNER_KEY as Hex, config.CHAIN_ID, config.PROPERTY_NFT_ADDRESS as Address),
            contract: config.PROPERTY_NFT_ADDRESS,
            chainId: config.CHAIN_ID,
          }
        : null,
  },
  { store: taxStore, payments: taxPayments, auctions: auctionStore },
  {
    store: buildingStore,
    units: { store: unitStore, payments: unitPayments },
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
  price ? price.usd : undefined,
  {
    store: seizureStore,
    wallets: land?.wallets ?? null,
    signers: seizureSigners,
    chain: config.CHAIN_INDEXER_URL ? new IndexerChainTokens(config.CHAIN_INDEXER_URL) : null,
    chainId: config.CHAIN_ID,
  },
  {
    store: guestStore,
    owners: config.GATEWAY_URL && config.GATEWAY_TOKEN ? new GatewayWalletOwners(config.GATEWAY_URL, config.GATEWAY_TOKEN) : null,
  },
  pool ? new PostgresSaleStore(pool) : new MemorySaleStore(),
);
// Catálogo de imóveis do Strapi (tipos, preços e renda); fora do ar, segue o do código.
const loadCatalog = async () => {
  if (!config.CMS_URL) return;
  try {
    const types = mergeCatalog(await fetchCmsPropertyTypes(config.CMS_URL));
    setPropertyCatalog(types);
    app.log.info(`catálogo de imóveis: ${types.length} tipos do Strapi, ${types.filter((t) => t.available !== false).length} à venda`);
  } catch (error) {
    app.log.warn(`catálogo de imóveis: Strapi indisponível, segue o atual (${(error as Error).message})`);
  }
};
await loadCatalog();
const onchain = land ? `${land.contract} (chain ${land.chainId}, signer ${land.signer.address})` : 'desligada';
app.log.info(
  `armazenamento: ${pool ? 'postgres' : 'memória'}; venda de lotes: ${payments ? config.ECONOMY_URL : 'desligada'}; posse on-chain: ${onchain}`,
);

// Jobs do world (trilha do backend): com mais de uma instância, só uma roda cada passada (JobRunner).
const jobs = new JobRunner({
  service: 'world',
  pool,
  log: { info: (m) => app.log.info(m), error: (m) => app.log.error(m) },
  metrics: metricsOf(app),
});
// Catálogo e cotação ficam na memória de cada instância: rodam em todas.
if (config.CMS_URL) jobs.add('catalog.refresh', config.CATALOG_REFRESH_SECONDS * 1000, async () => void (await loadCatalog()), { local: true });
if (price) jobs.add('price.refresh', 60_000, async () => void (await price.refresh()), { local: true });

// Jobs purchases.settle, properties.settle, units.settle e buildings.settle: compras, obras, coletas,
// vendas e outorgas que ficaram pendentes (resposta do ledger perdida, por exemplo).
if (payments) {
  jobs.add('purchases.settle', config.SETTLE_EVERY_SECONDS * 1000, async () => {
    const out: string[] = [];
    const n = await settleStale(store, payments, new Date());
    if (n) out.push(`${n} compra(s)`);
    if (propertyPayments) {
      const m = await settleProperties(propertyStore, propertyPayments, new Date(), store);
      if (m) out.push(`${m} obra(s) ou coleta(s)`);
    }
    if (unitPayments) {
      const u = await settleUnits(unitStore, unitPayments, new Date());
      if (u) out.push(`${u} venda(s) ou aluguel(is) de unidade`);
    }
    if (outorga) {
      const k = await settleBuildings(buildingStore, outorga, new Date());
      if (k) out.push(`${k} outorga(s)`);
    }
    return out.length ? `resolvido(s): ${out.join(', ')}` : undefined;
  });
}

// Job tax.charge: contas de IPTU e PT vencidas e débito automático (doc 03 §4).
if (taxPayments) {
  jobs.add('tax.charge', config.TAX_EVERY_SECONDS * 1000, async () => {
    const r = await chargeTaxes(store, propertyStore, taxStore, taxPayments, new Date(), buildingStore);
    if (r.created || r.paid || r.unpaid) return `${r.created} conta(s) nova(s), ${r.paid} paga(s), ${r.unpaid} sem saldo`;
  });
}

// Job auctions.tick: abre o leilão do lote inadimplente e fecha os vencidos (doc 03 §4).
if (auctionPayments) {
  jobs.add('auctions.tick', config.AUCTION_EVERY_SECONDS * 1000, async () => {
    const r = await tickAuctions(
      {
        auctions: auctionStore,
        taxes: taxStore,
        lots: store,
        properties: propertyStore,
        payments: auctionPayments,
        buildings: buildingStore,
        seizures: { store: seizureStore, lotToken },
      },
      new Date(),
    );
    if (r.opened || r.settled || r.cancelled || r.unsold) {
      return `${r.opened} aberto(s), ${r.settled} vendido(s), ${r.cancelled} cancelado(s), ${r.unsold} sem comprador`;
    }
  });
}

// Job chain.sync: lote e imóvel vendidos na blockchain mudam de dono no jogo (doc 07 §2.1 e §2.2).
const chainSync =
  config.CHAIN_INDEXER_URL && config.CHAIN_INDEXER_TOKEN && config.GATEWAY_URL && config.GATEWAY_TOKEN
    ? {
        feed: new IndexerChainFeed(config.CHAIN_INDEXER_URL, config.CHAIN_INDEXER_TOKEN),
        owners: new GatewayWalletOwners(config.GATEWAY_URL, config.GATEWAY_TOKEN),
        store: pool ? new PostgresChainSyncStore(pool) : new MemoryChainSyncStore(),
        lots: store,
        properties: propertyStore,
        cityOf: (id: number) => Object.entries(config.LAND_CITY_IDS).find(([, n]) => n === id)?.[0],
        seizures: seizureStore,
      }
    : null;
if (chainSync) {
  jobs.add('chain.sync', config.CHAIN_SYNC_SECONDS * 1000, async () => {
    const r = await syncChain(chainSync);
    if (r.applied || r.pending) return `${r.applied} passagem(ns) de dono, ${r.pending} esperando a carteira ser ligada`;
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
