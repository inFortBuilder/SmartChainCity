import { JobRunner, metricsOf } from '@scc/shared';
import { Pool } from 'pg';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { PostgresAvatarStore } from './infra/db/postgres-store.js';
import { PostgresPetSitterStore } from './infra/db/postgres-sitter-store.js';
import { MemoryPetSitterStore } from './infra/memory-sitter-store.js';
import { MemoryAvatarStore } from './infra/memory-store.js';
import { syncChain } from './domain/chain-sync.js';
import { GatewayWalletOwners, IndexerChainFeed } from './infra/chain-feed.js';
import { PostgresChainSyncStore } from './infra/db/postgres-chain-sync-store.js';
import { MemoryChainSyncStore } from './infra/memory-chain-sync-store.js';
import { MemoryRiskStore, PostgresRiskStore } from './infra/risk-store.js';
import { EconomyPayer } from './infra/economy-payer.js';
import { WorldVenues } from './infra/world-venues.js';
import { WorldHomes } from './infra/world-homes.js';
import { WorldHotels } from './infra/world-hotels.js';
import { decayed } from './domain/avatar.js';
import { settleDue, settleEntry } from './domain/championship.js';
import { PostgresChampionshipStore } from './infra/db/postgres-championship-store.js';
import { MemoryChampionshipStore } from './infra/memory-championship-store.js';
import { settleVehicle } from './domain/vehicle.js';
import { PostgresVehicleStore } from './infra/db/postgres-vehicle-store.js';
import { MemoryVehicleStore } from './infra/memory-vehicle-store.js';
import { settleRace } from './domain/race.js';
import { PostgresRaceStore } from './infra/db/postgres-race-store.js';
import { MemoryRaceStore } from './infra/memory-race-store.js';
import { PostgresGamePassStore } from './infra/db/postgres-gamepass-store.js';
import { MemoryGamePassStore } from './infra/memory-gamepass-store.js';
import { PostgresFarmStore } from './infra/db/postgres-farm-store.js';
import { MemoryFarmStore } from './infra/memory-farm-store.js';
import { runDecay } from './jobs/decay.js';
import { runHospital } from './jobs/hospital.js';
import { completeShifts } from './jobs/shift.js';

const config = loadConfig();

if (config.NODE_ENV === 'production' && !config.DATABASE_URL) {
  throw new Error('Defina DATABASE_URL: em produção o game-core não roda em memória.');
}

const pool = config.DATABASE_URL ? new Pool({ connectionString: config.DATABASE_URL }) : null;
const store = pool ? new PostgresAvatarStore(pool) : new MemoryAvatarStore();

const payer =
  config.ECONOMY_URL && config.ECONOMY_TOKEN ? new EconomyPayer(config.ECONOMY_URL, config.ECONOMY_TOKEN) : null;

// O mesmo cliente do ledger paga os turnos e cobra as refeições e o hospital.
// Antifraude (E2.9): sinais de aparelho e rede, no mesmo banco.
const riskStore = pool ? new PostgresRiskStore(pool) : new MemoryRiskStore();
// Lazer (E3.3): academias e galerias de jogador vêm do world.
const venues = config.WORLD_URL && config.WORLD_TOKEN ? new WorldVenues(config.WORLD_URL, config.WORLD_TOKEN) : null;
// Campeonato de botão (E3.3): o escrow e os prêmios passam pelo mesmo ledger.
const championshipStore = pool ? new PostgresChampionshipStore(pool) : new MemoryChampionshipStore();
const championships = payer ? { store: championshipStore, payer } : null;
// Veículos (E3.5): agência e IPVA pelo mesmo ledger.
const vehicleStore = pool ? new PostgresVehicleStore(pool) : new MemoryVehicleStore();
const raceStore = pool ? new PostgresRaceStore(pool) : new MemoryRaceStore();
const vehicles = payer ? { store: vehicleStore, payer, races: raceStore } : null;
// GamePass (E3.10): SCITY para a queima no mesmo ledger.
const passStore = pool ? new PostgresGamePassStore(pool) : new MemoryGamePassStore();
const passes = payer ? { store: passStore, payer } : null;
// Fazenda (E3.4): slot, máquinas e plantio pelo mesmo ledger.
const farmStore = pool ? new PostgresFarmStore(pool) : new MemoryFarmStore();
const farms = payer ? { store: farmStore, payer } : null;
// Pet Sitter (E3.1): ofertas e estadias.
const sitterStore = pool ? new PostgresPetSitterStore(pool) : new MemoryPetSitterStore();
// Moradia própria (doc 04 §4): as casas regulares da conta pela rota interna do world.
const homes = config.WORLD_URL && config.WORLD_TOKEN ? new WorldHomes(config.WORLD_URL, config.WORLD_TOKEN) : null;
// Hotéis de jogador (GDD §6 "Hotel"): a diária vai para o dono.
const hotels = config.WORLD_URL && config.WORLD_TOKEN ? new WorldHotels(config.WORLD_URL, config.WORLD_TOKEN) : null;
const app = await buildApp(config, store, undefined, payer, payer, payer, undefined, riskStore, venues, championships, vehicles, passes, farms, sitterStore, homes, hotels);

// Jobs do game-core (trilha do backend): com mais de uma instância, só uma roda cada passada (JobRunner).
const jobs = new JobRunner({
  service: 'game-core',
  pool,
  log: { info: (m) => app.log.info(m), error: (m) => app.log.error(m) },
  metrics: metricsOf(app),
});

// Job championship.settle: disputa o campeonato do mês que virou e cobra as inscrições paradas.
if (championships) {
  jobs.add('championship.settle', 60_000, async () => {
    // Carros pendentes (ledger fora na hora da compra): cobra de novo, com a mesma chave.
    if (vehicles) {
      for (const v of await vehicles.store.pendingOlderThan(new Date(Date.now() - 60_000))) {
        await settleVehicle(vehicles, v).catch(() => undefined);
      }
      // Corridas paradas: gasolina cobrada sem efeito ainda, ou prêmio sem pagar (pool vazio).
      for (const r of await raceStore.stuck(new Date(Date.now() - 60_000))) {
        await settleRace(
          {
            races: raceStore,
            payer: vehicles.payer,
            vehicles: vehicleStore,
            updateAvatar: (race, apply) => store.updateAvatar(race.avatarId, race.accountId, new Date(), apply),
          },
          r,
          new Date(),
        ).catch(() => undefined);
      }
    }
    for (const m of await championships.store.pendingMembers(new Date(Date.now() - 60_000))) {
      await settleEntry(championships, m).catch(() => undefined);
    }
    const n = await settleDue(
      {
        ...championships,
        attrsOf: async (id) => {
          const a = await store.get(id);
          return a ? decayed(a, new Date()).attributes : null;
        },
      },
      new Date(),
    );
    if (n) return `${n} campeonato(s) disputado(s)`;
  });
}
app.log.info(`armazenamento: ${pool ? 'postgres' : 'memória'}; pagamento de turnos: ${payer ? config.ECONOMY_URL : 'desligado'}`);

// Catálogo publicado no Strapi; se ele estiver fora, segue o seed e o webhook atualiza depois.
if (config.CMS_URL) {
  try {
    const n = await (app as unknown as { loadCatalog: () => Promise<number> }).loadCatalog();
    app.log.info(`catálogo: ${n} profissões do Strapi (${config.CMS_URL})`);
  } catch (error) {
    app.log.warn(`catálogo: Strapi indisponível, usando o seed (${(error as Error).message})`);
  }
  try {
    const n = await (app as unknown as { loadFoods: () => Promise<number> }).loadFoods();
    app.log.info(`mercado: ${n} alimentos do Strapi`);
  } catch (error) {
    app.log.warn(`mercado: alimentos do seed (${(error as Error).message})`);
  }
  try {
    const r = await (app as unknown as { loadEvents: () => Promise<{ groups: number; seasons: number }> }).loadEvents();
    app.log.info(`eventos: ${r.groups} grupos e ${r.seasons} temporadas do Strapi`);
  } catch (error) {
    app.log.warn(`eventos: grupos e temporadas do seed (${(error as Error).message})`);
  }
}

jobs.add('attributes.decay', config.DECAY_EVERY_SECONDS * 1000, async () => {
  const n = await runDecay(store, new Date());
  if (n) return `${n} avatar(es) atualizado(s)`;
});
jobs.add('shift.complete', config.SHIFT_CHECK_SECONDS * 1000, async () => {
  const n = await completeShifts(store, new Date());
  if (n) return `${n} turno(s) concluído(s)`;
});
jobs.add('hospital.admit', config.HOSPITAL_CHECK_SECONDS * 1000, async () => {
  const { admitted, charged } = await runHospital(store, payer, new Date());
  if (admitted || charged) return `${admitted} internação(ões), ${charged} taxa(s) acertada(s)`;
});

// Job chain.sync: avatar revelado pela Lucky Box entra no jogo; vendido na blockchain, muda de conta.
const chainSync =
  config.CHAIN_INDEXER_URL && config.CHAIN_INDEXER_TOKEN && config.GATEWAY_URL && config.GATEWAY_TOKEN
    ? {
        feed: new IndexerChainFeed(config.CHAIN_INDEXER_URL, config.CHAIN_INDEXER_TOKEN),
        owners: new GatewayWalletOwners(config.GATEWAY_URL, config.GATEWAY_TOKEN),
        store: pool ? new PostgresChainSyncStore(pool) : new MemoryChainSyncStore(),
        avatars: store,
        now: () => new Date(),
      }
    : null;
if (chainSync) {
  jobs.add('chain.sync', config.CHAIN_SYNC_SECONDS * 1000, async () => {
    const r = await syncChain(chainSync);
    if (r.created || r.transferred || r.pending || r.rejected) {
      return `${r.created} avatar(es) novo(s), ${r.transferred} passagem(ns) de dono, ${r.pending} esperando a carteira, ${r.rejected} fora do catálogo`;
    }
  });
}
app.log.info(`AvatarNFT → jogo: ${chainSync ? config.CHAIN_INDEXER_URL : 'desligado'}`);

const shutdown = async () => {
  await jobs.stop();
  await app.close();
  await pool?.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.PORT, host: config.HOST });
