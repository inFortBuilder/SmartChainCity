import cors from '@fastify/cors';
import { AppError, observe, requireServiceToken, serverOptions } from '@scc/shared';
import Fastify from 'fastify';
import { z } from 'zod';

import type { Config } from './config.js';
import type { AvatarToken, BoxRequest, LotToken, PropertyToken, MarketListing, MarketAuction } from './domain/events.js';
import type { IndexerStore } from './domain/indexer.js';

/** Estado do laço de leitura, para `/v1/chain/status`. */
export interface IndexerStatus {
  head: bigint | null;
  lastTickAt: Date | null;
  lastError: string | null;
  /**
   * Relógio da cadeia: o timestamp do bloco mais novo (segundos) e quando o laço o leu (ms). Prazos de
   * anúncio e de leilão são do contrato (block.timestamp), então "vencido" e "encerrado" seguem a cadeia,
   * não o relógio do servidor. Sem leitura ainda, vale o relógio do servidor.
   */
  chainTime?: { seconds: number; seenAt: number } | null;
}

/** Agora, pelo relógio da cadeia: o último bloco mais o tempo desde que foi lido. */
export const chainNowSec = (status: Pick<IndexerStatus, 'chainTime'>, nowMs = Date.now()) => {
  const t = status.chainTime;
  return t ? t.seconds + Math.max(0, Math.floor((nowMs - t.seenAt) / 1000)) : Math.floor(nowMs / 1000);
};

const tokenParam = z.object({ tokenId: z.string().regex(/^[0-9]{1,78}$/) });
const addressParam = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });

const lotDto = (l: LotToken) => ({ token_id: l.tokenId, city: l.city, lot: l.lot, owner: l.owner, block: l.block.toString() });
const avatarDto = (a: AvatarToken) => ({
  token_id: a.tokenId,
  owner: a.owner,
  rarity: a.rarity,
  profession: a.profession,
  block: a.block.toString(),
});
const propertyDto = (p: PropertyToken) => ({
  token_id: p.tokenId,
  owner: p.owner,
  lot_token_id: p.lotId,
  type: p.typeCode,
  level: p.level,
  block: p.block.toString(),
});
const boxDto = (b: BoxRequest) => ({
  request_id: b.requestId,
  buyer: b.buyer,
  tier_id: b.tierId,
  status: b.status,
  token_id: b.tokenId,
  block: b.block.toString(),
});

export async function buildApp(config: Config, store: IndexerStore, status: IndexerStatus = { head: null, lastTickAt: null, lastError: null }) {
  const app = Fastify({ ...serverOptions({ service: 'chain-indexer', nodeEnv: config.NODE_ENV, logLevel: config.LOG_LEVEL }) });
  observe(app, { service: 'chain-indexer', nodeEnv: config.NODE_ENV, metricsToken: config.METRICS_TOKEN });
  await app.register(cors, { origin: config.CORS_ORIGINS });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.status).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof z.ZodError) {
      return reply.status(400).send({ error: { code: 'invalid_request', message: 'Requisição inválida.' } });
    }
    request.log.error(error);
    return reply.status(500).send({ error: { code: 'internal_error', message: 'Erro interno.' } });
  });

  const chainId = config.CHAIN_ID;
  const notFound = (what: string) => new AppError('not_found', `${what} não encontrado na rede.`, 404);

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/v1/chain/status', async () => {
    const cursor = await store.cursor(chainId);
    return {
      chain_id: chainId,
      confirmations: config.CONFIRMATIONS,
      head: status.head?.toString() ?? null,
      indexed_block: cursor?.block.toString() ?? null,
      lag_blocks: status.head !== null && cursor ? (status.head - cursor.block).toString() : null,
      last_tick_at: status.lastTickAt?.toISOString() ?? null,
      last_error: status.lastError,
      chain_time: new Date(chainNowSec(status) * 1000).toISOString(),
      contracts: config.contracts,
    };
  });

  app.get('/v1/chain/lots/:tokenId', async (request) => {
    const { tokenId } = tokenParam.parse(request.params);
    const lot = await store.lot(chainId, tokenId);
    if (!lot) throw notFound('Lote');
    return { lot: lotDto(lot) };
  });

  app.get('/v1/chain/avatars/:tokenId', async (request) => {
    const { tokenId } = tokenParam.parse(request.params);
    const avatar = await store.avatar(chainId, tokenId);
    if (!avatar) throw notFound('Avatar');
    return { avatar: avatarDto(avatar) };
  });

  app.get('/v1/chain/properties/:tokenId', async (request) => {
    const { tokenId } = tokenParam.parse(request.params);
    const property = await store.property(chainId, tokenId);
    if (!property) throw notFound('Imóvel');
    return { property: propertyDto(property) };
  });

  app.get('/v1/chain/boxes/:tokenId', async (request) => {
    const { tokenId } = tokenParam.parse(request.params);
    const box = await store.box(chainId, tokenId);
    if (!box) throw notFound('Caixa');
    return { box: boxDto(box) };
  });

  app.get('/v1/chain/owners/:address', async (request) => {
    const { address } = addressParam.parse(request.params);
    const [lots, avatars, properties] = await Promise.all([
      store.lotsOf(chainId, address),
      store.avatarsOf(chainId, address),
      store.propertiesOf(chainId, address),
    ]);
    return { lots: lots.map(lotDto), avatars: avatars.map(avatarDto), properties: properties.map(propertyDto) };
  });

  // Depósitos do GameVault de uma carteira e se já viraram saldo no jogo.
  app.get('/v1/chain/deposits/:address', async (request) => {
    const { address } = addressParam.parse(request.params);
    const list = await store.depositsOf(chainId, address);
    return {
      deposits: list.map((d) => ({
        tx_hash: d.txHash,
        log_index: d.logIndex,
        amount_wei: d.amountWei,
        block: d.block.toString(),
        status: d.status,
      })),
    };
  });

  // ---------------------------------------------------------------- Marketplace (E3.6)

  // Nome da coleção pelo endereço, e o dono atual de cada NFT pelas projeções de posse.
  const collectionName = new Map(
    Object.entries(config.contracts)
      .filter(([, a]) => a)
      .map(([name, a]) => [(a as string).toLowerCase(), name]),
  );
  const ownerNow = async (name: string | undefined, tokenId: string) => {
    if (name === 'LandNFT') return (await store.lot(chainId, tokenId))?.owner;
    if (name === 'PropertyNFT') return (await store.property(chainId, tokenId))?.owner;
    if (name === 'AvatarNFT') return (await store.avatar(chainId, tokenId))?.owner;
    return undefined;
  };
  /**
   * `stale`: o vendedor já não tem algum dos NFTs (vendeu fora do mercado ou o leilão apreendeu); a compra
   * reverteria. `expired`: passou do prazo. O mapa mostra só as que estão valendo.
   */
  const listingDto = async (l: MarketListing, nowSec: number) => {
    const items = await Promise.all(
      l.items.map(async (i) => {
        const name = collectionName.get(i.collection);
        const owner = await ownerNow(name, i.tokenId);
        return { collection: name ?? i.collection, address: i.collection, token_id: i.tokenId, owner: owner ?? null };
      }),
    );
    return {
      listing_id: l.listingId,
      seller: l.seller,
      price_wei: l.priceWei,
      expires_at: new Date(l.expiresAt * 1000).toISOString(),
      status: l.status,
      buyer: l.buyer,
      items,
      stale: items.some((i) => i.owner !== null && i.owner !== l.seller),
      expired: l.expiresAt <= nowSec,
      block: l.block.toString(),
    };
  };

  app.get('/v1/market/listings', async (request) => {
    const q = z
      .object({ limit: z.coerce.number().int().min(1).max(200).default(50), all: z.stringbool().default(false) })
      .parse(request.query);
    const nowSec = chainNowSec(status);
    const list = await Promise.all((await store.activeListings(chainId, q.limit)).map((l) => listingDto(l, nowSec)));
    return { marketplace: config.contracts.Marketplace ?? null, listings: q.all ? list : list.filter((l) => !l.stale && !l.expired) };
  });

  app.get('/v1/market/listings/:id', async (request) => {
    const { id } = z.object({ id: z.string().regex(/^[0-9]{1,78}$/) }).parse(request.params);
    const l = await store.listing(chainId, id);
    if (!l) throw new AppError('not_found', 'Listagem não encontrada.', 404);
    return { listing: await listingDto(l, chainNowSec(status)) };
  });

  /** `ended`: passou do prazo e falta alguém chamar `settle` (qualquer um pode). */
  const auctionDto = async (a: MarketAuction, nowSec: number) => ({
    auction_id: a.auctionId,
    seller: a.seller,
    start_price_wei: a.startPriceWei,
    highest_bid_wei: a.highestBidWei,
    highest_bidder: a.highestBidder,
    bids: a.bids,
    // Lance mínimo agora: o inicial ou 5% acima do maior (a mesma conta do contrato).
    minimum_bid_wei: a.highestBidWei
      ? (BigInt(a.highestBidWei) + (BigInt(a.highestBidWei) * 500n) / 10_000n || 1n).toString()
      : a.startPriceWei,
    ends_at: new Date(a.endsAt * 1000).toISOString(),
    ended: a.endsAt <= nowSec,
    status: a.status,
    winner: a.winner,
    items: a.items.map((i) => ({ collection: collectionName.get(i.collection) ?? i.collection, address: i.collection, token_id: i.tokenId })),
    block: a.block.toString(),
  });

  app.get('/v1/market/auctions', async (request) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(request.query);
    const nowSec = chainNowSec(status);
    return {
      marketplace: config.contracts.Marketplace ?? null,
      auctions: await Promise.all((await store.activeAuctions(chainId, q.limit)).map((a) => auctionDto(a, nowSec))),
    };
  });

  app.get('/v1/market/auctions/:id', async (request) => {
    const { id } = z.object({ id: z.string().regex(/^[0-9]{1,78}$/) }).parse(request.params);
    const a = await store.auction(chainId, id);
    if (!a) throw new AppError('not_found', 'Leilão não encontrado.', 404);
    return { auction: await auctionDto(a, chainNowSec(status)) };
  });

  // Feed para os outros serviços (world, game-core): eventos confirmados, em ordem.
  app.get('/internal/v1/chain/events', async (request) => {
    if (!config.INTERNAL_TOKEN) {
      throw new AppError('internal_disabled', 'Rotas internas desligadas: defina INTERNAL_TOKEN.', 503);
    }
    requireServiceToken(request.headers['x-service-token'], config.INTERNAL_TOKEN);
    const q = z
      .object({ after: z.coerce.number().int().nonnegative().default(0), limit: z.coerce.number().int().min(1).max(1000).default(200) })
      .parse(request.query);
    const events = await store.eventsAfter(chainId, q.after, q.limit);
    return {
      events: events.map((e) => ({
        id: e.id,
        block: e.blockNumber.toString(),
        tx_hash: e.txHash,
        log_index: e.logIndex,
        contract: e.contract,
        event: e.event,
        args: e.args,
      })),
      next_after: events.at(-1)?.id ?? q.after,
    };
  });

  return app;
}
