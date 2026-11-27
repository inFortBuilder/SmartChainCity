import cors from '@fastify/cors';
import { AppError, bearerToken, observe, requireServiceToken, serverOptions, verifyAccessToken } from '@scc/shared';
import Fastify, { type FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { Config } from './config.js';
import { type QuoteSigner, type WalletDirectory, issueOnchainQuote } from './domain/land-quote.js';
import { type BuildingVoucherSigner, issueBuildingVoucher } from './domain/building-voucher.js';
import { type PropertyVoucherSigner, issueLevelVoucher, issuePropertyVoucher } from './domain/property-voucher.js';
import {
  ACCRUAL_CAP_DAYS,
  MIN_WEAR_FOR_INCOME,
  REGULARIZATION_SHARE,
  REPAIR_SHARE_PER_POINT,
  UNREGULAR_FACTOR,
  UTILITIES,
  UTILITY_DAILY_CENTS,
  UTILITY_EDGE_EXTRA,
  UTILITY_MAX_AHEAD_DAYS,
  UTILITY_PERIOD_DAYS,
  type Property,
  type PropertyPayments,
  type PropertyStore,
  WEAR_PER_DAY,
  accrued,
  buildProperty,
  claimIncome,
  incomePerDay,
  isRegular,
  nextLevel,
  phaseOf,
  propertyTypes,
  buildable,
  nextTypeOf,
  chainTypeAndLevel,
  regularWindow,
  regularizationCostCents,
  repairCostCents,
  utilityCostOf,
  type WorkKind,
  startWork,
  typeOf,
  wearAt,
  VENUE_TYPES,
  venueOpen,
} from './domain/properties.js';
import { type LandPayments, type Lot, type WorldStore, lotCode, priceOf } from './domain/lots.js';
import { buyLot } from './domain/purchase.js';
import {
  type UnitPayments,
  type UnitStore,
  buyUnit,
  controllerOf,
  generateUnits,
  leaseUnit,
  setUnitOffer,
  unitDto,
  unitLabel,
} from './domain/units.js';
import {
  type QueueTicket,
  type SaleConfig,
  type SaleStore,
  admitPurchase,
  joinQueue,
  queueOpensAt,
  salePhase,
  ticketState,
  turnOf,
  validateSale,
} from './domain/sale.js';
import { MemorySaleStore } from './infra/memory-sale-store.js';
import {
  type BuilderClient,
  type Building,
  BuildingInvalidError,
  type BuildingStore,
  type OutorgaPayments,
  reviewBuilding,
  submitBuilding,
} from './domain/buildings.js';
import { type ChainTokens, type SeizureKind, type SeizureSigner, type SeizureStore, issueSeizureVoucher, seizureDto } from './domain/seizures.js';
import { type GuestStore, type PlaceKind, guestDto, invite, ownedPlace, placeDto, visit } from './domain/visits.js';
import { type TaxPayments, type TaxStore, assertNotInDefault, payMyTaxes, totalOf } from './domain/taxes.js';
import { type Auction, type AuctionStore, minBid, placeBid } from './domain/auctions.js';
import { rentsHere } from './domain/chain-sync.js';

const WEI = 10n ** 18n;
/** wei → texto em SCITY com até 6 casas, para a tela. */
const scityText = (wei: bigint) => {
  const micro = (wei * 1_000_000n) / WEI;
  const whole = micro / 1_000_000n;
  const frac = (micro % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
};

const codeParam = z.object({ code: z.string().regex(/^[a-z][a-z0-9-]{1,30}$/) });
const lotParams = codeParam.extend({ id: z.coerce.number().int().min(0) });
const districtParams = codeParam.extend({ order: z.coerce.number().int().min(0) });

export async function buildApp(
  config: Config,
  store: WorldStore,
  now: () => Date = () => new Date(),
  payments: LandPayments | null = null,
  land: { wallets: WalletDirectory; signer: QuoteSigner; contract: string; chainId: number } | null = null,
  properties: {
    store: PropertyStore;
    payments: PropertyPayments | null;
    /** PropertyNFT (E2.5): vouchers de mint e de nível do imóvel pronto. */
    onchain?: { wallets: WalletDirectory; signer: PropertyVoucherSigner; contract: string; chainId: number } | null;
  } | null = null,
  taxes: {
    store: TaxStore;
    payments: TaxPayments | null;
    /** Leilão do lote inadimplente (E2.6). */
    auctions?: AuctionStore | null;
  } | null = null,
  buildings: {
    store: BuildingStore;
    builder: BuilderClient | null;
    payments: OutorgaPayments | null;
    /** BuildingNFT (E2.11): voucher para levar o prédio aprovado à blockchain. */
    onchain?: { wallets: WalletDirectory; signer: BuildingVoucherSigner; contract: string; chainId: number } | null;
    /** Unidades (E3.11): venda primária, revenda e aluguel em THALER. */
    units?: { store: UnitStore; payments: UnitPayments | null } | null;
  } | null = null,
  /** Preço do SCITY em dólar agora: a cotação do economy (passo 11) ou o SCITY_USD fixo. */
  scityUsd: () => number = () => config.SCITY_USD,
  /** Apreensão do NFT no leilão (ADR-0016). */
  seizures: {
    store: SeizureStore;
    wallets: WalletDirectory | null;
    signers: Partial<Record<SeizureKind, SeizureSigner>>;
    chain?: ChainTokens | null;
    chainId: number;
  } | null = null,
  /** Visitas pelo street view: dono e convidados entram no interior. */
  visits: {
    store: GuestStore;
    /** Carteira → conta, para convidar pela carteira (gateway). */
    owners: { ownerOf(wallet: string): Promise<string | null> } | null;
  } | null = null,
  /** Venda de lançamento com fila e limite por carteira (E4.3). Sem store, fica em memória. */
  sale: SaleStore | null = null,
) {
  const sales = sale ?? new MemorySaleStore();
  const app = Fastify({
    ...serverOptions({ service: 'world', nodeEnv: config.NODE_ENV, logLevel: config.LOG_LEVEL }),
  });
  observe(app, { service: 'world', nodeEnv: config.NODE_ENV, metricsToken: config.METRICS_TOKEN });
  await app.register(cors, { origin: config.CORS_ORIGINS });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof BuildingInvalidError) {
      return reply.status(422).send({
        error: { code: error.code, message: error.message },
        checks: error.validation.checks,
        footprint: error.validation.footprint,
      });
    }
    if (error instanceof AppError) {
      return reply.status(error.status).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof z.ZodError) {
      return reply.status(400).send({ error: { code: 'invalid_request', message: 'Requisição inválida.' } });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.status(status).send({ error: { code: 'invalid_request', message: 'Requisição inválida.' } });
    }
    request.log.error(error);
    return reply.status(500).send({ error: { code: 'internal_error', message: 'Erro interno.' } });
  });

  const player = (request: FastifyRequest) =>
    verifyAccessToken(bearerToken(request.headers.authorization), {
      secret: config.JWT_SECRET,
      issuer: config.JWT_ISSUER,
    });
  /** Leitura pública que, com token, também diz quais lotes são seus. */
  const maybePlayer = async (request: FastifyRequest) => (request.headers.authorization ? player(request) : null);

  const cityOr404 = async (code: string) => {
    const c = await store.getCity(code);
    if (!c) throw new AppError('not_found', 'Cidade não encontrada.', 404);
    return c;
  };

  const lotDto = (lot: Lot, me: string | null, open: boolean, zones: Awaited<ReturnType<typeof cityOr404>>['zones']) => {
    const zone = zones.find((z) => z.key === lot.zone)!;
    const { priceUsd, priceWei } = priceOf(lot.areaM2, zone, scityUsd());
    // Reserva vencida aparece como à venda; o dono não é exposto, só "seu".
    const status = lot.status === 'reserved' && (lot.reservedUntil?.getTime() ?? 0) <= now().getTime() ? 'vacant' : lot.status;
    return {
      id: lot.id,
      code: lotCode(lot.city, lot.id),
      district: lot.district,
      district_open: open,
      zone: lot.zone,
      area_m2: Math.round(lot.areaM2),
      status,
      mine: me !== null && lot.ownerAccountId === me,
      price_usd: priceUsd,
      price_scity: scityText(priceWei),
    };
  };

  // Números públicos para o site (E4.5): lotes vendidos e impostos pagos (THALER), com cache de 1 minuto.
  let publicCache: { at: number; body: { lands: number; taxes: number } } | null = null;
  app.get('/v1/public/stats', async () => {
    const t = now().getTime();
    if (!publicCache || t - publicCache.at >= 60_000) {
      const lands = (await store.soldLots()).length;
      const cents = taxes ? await taxes.store.paidTotalCents() : 0n;
      publicCache = { at: t, body: { lands, taxes: Number(cents / 100n) } };
    }
    return publicCache.body;
  });

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/v1/world/cities/:code', async (request) => {
    const { code } = codeParam.parse(request.params);
    const c = await cityOr404(code);
    const districts = await store.districts(code);
    return {
      city: { code: c.code, name: c.name, open_count: c.openCount, release_threshold: c.releaseThreshold, scity_usd: scityUsd() },
      districts: districts.map((d) => ({ order: d.order, open: d.order < c.openCount, lots: d.lots, for_sale: d.forSale, sold: d.sold })),
    };
  });

  // Situação dos lotes de um bairro. A geometria o mapa já tem nos arquivos estáticos.
  app.get('/v1/world/cities/:code/districts/:order/lots', async (request) => {
    const { code, order } = districtParams.parse(request.params);
    const c = await cityOr404(code);
    const me = await maybePlayer(request);
    const lots = await store.lotsOfDistrict(code, order);
    return { lots: lots.map((l) => lotDto(l, me, l.district < c.openCount, c.zones)) };
  });

  app.get('/v1/world/cities/:code/lots/:id', async (request) => {
    const { code, id } = lotParams.parse(request.params);
    const c = await cityOr404(code);
    const lot = await store.getLot(code, id);
    if (!lot) throw new AppError('not_found', 'Lote não encontrado.', 404);
    return { lot: lotDto(lot, await maybePlayer(request), lot.district < c.openCount, c.zones) };
  });

  app.get('/v1/world/me/lots', async (request) => {
    const me = await player(request);
    const lots = await store.lotsOf(me);
    const out = [];
    for (const l of lots) {
      const c = await cityOr404(l.city);
      out.push(lotDto(l, me, l.district < c.openCount, c.zones));
    }
    return { lots: out };
  });

  app.post('/v1/world/cities/:code/lots/:id/buy', async (request, reply) => {
    const me = await player(request);
    const { code, id } = lotParams.parse(request.params);
    if (!payments) throw new AppError('ledger_unavailable', 'A venda de lotes está desligada.', 503);
    // Lançamento: só com a vez na fila, e com o limite por carteira (conferido dentro da reserva).
    const cap = (await admitPurchase(sales, code, me, now())) ?? undefined;
    const purchase = await buyLot(
      store,
      payments,
      { city: code, lotId: id, accountId: me, scityUsd: scityUsd(), requestId: request.id, cap },
      now,
    );
    const c = await cityOr404(code);
    const lot = (await store.getLot(code, id))!;
    return reply.status(201).send({
      purchase: { id: purchase.id, price_usd: purchase.priceUsd, price_scity: scityText(purchase.priceWei), status: 'paid' },
      lot: lotDto(lot, me, lot.district < c.openCount, c.zones),
      city: { open_count: c.openCount },
    });
  });

  // ---------------------------------------------------------------- venda de lançamento (E4.3)

  const saleDto = (s: SaleConfig) => ({
    phase: salePhase(s, now()),
    queue_opens_at: queueOpensAt(s).toISOString(),
    opens_at: s.opensAt.toISOString(),
    ends_at: s.endsAt.toISOString(),
    batch_size: s.batchSize,
    batch_seconds: s.batchSeconds,
    window_seconds: s.windowSeconds,
    max_lots: s.maxLots,
    require_wallet: s.requireWallet,
  });
  const ticketDto = (s: SaleConfig, t: QueueTicket) => {
    const { admitAt, expiresAt } = turnOf(s, t);
    return {
      state: ticketState(s, t, now()),
      position: t.position,
      // Antes da abertura, a posição de quem entrou cedo ainda muda: sai do sorteio na abertura.
      provisional: t.preOpen && now().getTime() < s.opensAt.getTime(),
      admit_at: admitAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    };
  };
  const saleView = async (code: string, me: string | null) => {
    const s = await sales.getSale(code);
    if (!s) return { sale: null };
    if (!me) return { sale: saleDto(s) };
    const t = await sales.latestTicket(code, me);
    const bought = await store.countPurchases(code, me, s.opensAt);
    return { sale: saleDto(s), me: { ticket: t ? ticketDto(s, t) : null, bought } };
  };

  app.get('/v1/world/cities/:code/sale', async (request) => {
    const { code } = codeParam.parse(request.params);
    await cityOr404(code);
    return saleView(code, await maybePlayer(request));
  });

  app.post('/v1/world/cities/:code/sale/queue', async (request, reply) => {
    const me = await player(request);
    const { code } = codeParam.parse(request.params);
    const s = await sales.getSale(code);
    if (!s) throw new AppError('no_sale', 'Esta cidade não tem venda de lançamento: compre direto.', 409);
    // Uma carteira só se liga a uma conta (gateway): com carteira obrigatória, o limite vale por carteira.
    const directory = land?.wallets ?? seizures?.wallets ?? null;
    if (s.requireWallet && directory) {
      const linked = await directory.walletsOf(me, request.id);
      if (linked.length === 0) {
        throw new AppError('wallet_required', 'O lançamento exige uma carteira ligada à conta.', 403);
      }
    }
    await joinQueue(sales, s, me, now());
    return reply.status(201).send(await saleView(code, me));
  });

  const internalOnly = (request: FastifyRequest) => {
    if (!config.INTERNAL_TOKEN) {
      throw new AppError('internal_disabled', 'Rotas internas desligadas: defina INTERNAL_TOKEN.', 503);
    }
    requireServiceToken(request.headers['x-service-token'], config.INTERNAL_TOKEN);
  };
  const saleBody = z.object({
    opens_at: z.iso.datetime({ offset: true }),
    ends_at: z.iso.datetime({ offset: true }),
    pre_queue_seconds: z.number().int().min(0).max(86_400).default(1800),
    batch_size: z.number().int().min(1).max(100_000).default(200),
    batch_seconds: z.number().int().min(1).max(3600).default(60),
    window_seconds: z.number().int().min(60).max(3600).default(600),
    max_lots: z.number().int().min(1).max(324).default(3),
    require_wallet: z.boolean().default(true),
  });

  // Ferramenta da operação: agenda (ou muda) o lançamento de uma cidade.
  app.put('/internal/v1/cities/:code/sale', async (request) => {
    internalOnly(request);
    const { code } = codeParam.parse(request.params);
    await cityOr404(code);
    const b = saleBody.parse(request.body);
    const s: SaleConfig = {
      city: code,
      opensAt: new Date(b.opens_at),
      endsAt: new Date(b.ends_at),
      preQueueSeconds: b.pre_queue_seconds,
      batchSize: b.batch_size,
      batchSeconds: b.batch_seconds,
      windowSeconds: b.window_seconds,
      maxLots: b.max_lots,
      requireWallet: b.require_wallet,
    };
    validateSale(s);
    await sales.setSale(s);
    return { sale: saleDto(s) };
  });

  app.delete('/internal/v1/cities/:code/sale', async (request, reply) => {
    internalOnly(request);
    const { code } = codeParam.parse(request.params);
    await sales.clearSale(code);
    return reply.status(204).send();
  });

  // Cotação assinada para levar o lote (já pago no ledger) ao LandNFT. O jogador
  // chama buyPrimary(quote, signature) com a própria carteira.
  app.post('/v1/world/cities/:code/lots/:id/onchain-quote', async (request) => {
    const me = await player(request);
    const { code, id } = lotParams.parse(request.params);
    const { wallet } = z.object({ wallet: z.string() }).parse(request.body);
    if (!land) throw new AppError('onchain_disabled', 'A posse on-chain dos lotes está desligada.', 503);
    await cityOr404(code);
    await assertNotInDefault(taxes?.store ?? null, code, id, now());
    const { quote, signature, tokenId } = await issueOnchainQuote(
      store,
      land.wallets,
      land.signer,
      { city: code, lotId: id, accountId: me, wallet, cityNftId: config.LAND_CITY_IDS[code], ttlSeconds: config.QUOTE_TTL_SECONDS, requestId: request.id },
      now,
    );
    return {
      contract: land.contract,
      chain_id: land.chainId,
      token_id: tokenId.toString(),
      quote: { ...quote, price: quote.price.toString(), nonce: quote.nonce.toString(), deadline: quote.deadline.toString() },
      signature,
    };
  });

  // ---------------------------------------------------------------- imóveis (E2.5)

  const propertiesOn = () => {
    if (!properties) throw new AppError('properties_disabled', 'Os imóveis estão desligados.', 503);
    return properties;
  };

  const propertyDto = (p: Property) => {
    const t = now();
    const type = typeOf(p.type);
    const phase = phaseOf(p, t);
    const wear = wearAt(p, t);
    const income = accrued(p, t);
    const buildMs = p.readyAt.getTime() - p.createdAt.getTime();
    return {
      id: p.id,
      city: p.city,
      lot_id: p.lotId,
      type: p.type,
      label: type?.label ?? p.type,
      level: p.level,
      phase,
      build_progress: phase === 'building' ? Math.min(1, (t.getTime() - p.createdAt.getTime()) / buildMs) : phase === 'ready' ? 1 : 0,
      ready_at: p.readyAt.toISOString(),
      wear: Math.round(wear * 10) / 10,
      producing: phase === 'ready' && wear >= MIN_WEAR_FOR_INCOME,
      income_cents_per_day: Math.floor((incomePerDay(p) * wear) / 100),
      accrued_cents: income.cents,
      accrual_full: income.capped,
      repair_cost_cents: phase === 'ready' ? repairCostCents(p, t) : 0,
      // Regularização e infraestrutura (doc 03 §3): sem as três, a renda é de 50%.
      use: type?.use ?? null,
      regularized_at: p.regularizedAt?.toISOString() ?? null,
      water_until: p.waterUntil?.toISOString() ?? null,
      power_until: p.powerUntil?.toISOString() ?? null,
      regular: isRegular(p, t),
      income_factor: isRegular(p, t) ? 1 : UNREGULAR_FACTOR,
      regularization_cost_cents: p.regularizedAt ? 0 : regularizationCostCents(p),
      // Troca de tipo: o próximo da família, o custo (a diferença de preço) e se já pode (último nível).
      next_type: (() => {
        const n = nextTypeOf(p.type);
        if (!n || !type) return null;
        return {
          code: n.code,
          label: n.label,
          cost_cents: Math.max(0, n.priceCents - type.priceCents),
          income_cents_per_day: n.levels[0]?.incomeCentsPerDay ?? 0,
          ready: p.level >= type.levels.length,
        };
      })(),
      // No PropertyNFT: a família vai como o tipo da raiz e o nível corrido.
      chain: chainTypeAndLevel(p),
      next_level: (() => {
        const n = nextLevel(p);
        return n ? { level: n.level, cost_cents: n.upgradeCostCents, income_cents_per_day: n.incomeCentsPerDay } : null;
      })(),
    };
  };

  /** O imóvel com os custos de 30 dias de água e energia no lote dele (sobem com a distância ao centro). */
  const propertyOut = async (p: Property) => ({
    ...propertyDto(p),
    utility_cost_cents: {
      water: await utilityCostOf(store, p, 'water'),
      power: await utilityCostOf(store, p, 'power'),
    },
  });

  const workRoute = (kind: WorkKind) => async (request: FastifyRequest) => {
    const me = await player(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const { store: propStore, payments: propPayments } = propertiesOn();
    if (!propPayments) throw new AppError('ledger_unavailable', 'As obras estão desligadas.', 503);
    const target = await propStore.getProperty(id);
    if (target && target.ownerAccountId === me) await assertNotInDefault(taxes?.store ?? null, target.city, target.lotId, now());
    const { work, property, claim } = await startWork(propStore, propPayments, { propertyId: id, accountId: me, kind, requestId: request.id }, now, store);
    return {
      work: { id: work.id, kind: work.kind, cost_cents: work.costCents, to_level: work.toLevel, to_type: work.toType ?? null },
      // Renda acumulada até a obra, fechada e paga antes de o imóvel mudar.
      claim: claim ? { id: claim.id, amount_cents: claim.amountCents, status: claim.status } : null,
      property: await propertyOut(property),
    };
  };

  app.get('/v1/world/property-types', async () => ({
    rules: {
      accrual_cap_days: ACCRUAL_CAP_DAYS,
      wear_per_day: WEAR_PER_DAY,
      min_wear_for_income: MIN_WEAR_FOR_INCOME,
      repair_share_per_point: REPAIR_SHARE_PER_POINT,
      unregular_factor: UNREGULAR_FACTOR,
      regularization_share: REGULARIZATION_SHARE,
      utility_period_days: UTILITY_PERIOD_DAYS,
      utility_max_ahead_days: UTILITY_MAX_AHEAD_DAYS,
      utility_daily_cents: UTILITY_DAILY_CENTS,
      utility_edge_extra: UTILITY_EDGE_EXTRA,
      utilities: UTILITIES,
    },
    types: propertyTypes().map((t) => ({
      code: t.code,
      label: t.label,
      zones: t.zones,
      price_cents: t.priceCents,
      build_minutes: t.buildMinutes,
      levels: t.levels.map((l) => ({ level: l.level, income_cents_per_day: l.incomeCentsPerDay, upgrade_cost_cents: l.upgradeCostCents ?? null })),
      provisional: t.provisional,
      use: t.use,
      // Troca de tipo (T1 → T2 → T3) e disponibilidade: sem os valores no catálogo, o tipo aparece e não constrói.
      upgrades_from: t.upgradesFrom ?? null,
      available: t.available !== false,
      unavailable_reason: t.unavailableReason ?? null,
      buildable: buildable(t),
      venue: t.venue ? { activity: t.venue.activity, fee_cents: t.venue.feeCents } : null,
    })),
  }));

  // Lazer (E3.3): academias e galerias abertas da cidade. O dono não é exposto, só "seu".
  app.get('/v1/world/cities/:code/venues', async (request) => {
    const { code } = codeParam.parse(request.params);
    await cityOr404(code);
    const me = await maybePlayer(request);
    const t = now();
    const list = await propertiesOn().store.propertiesOfTypes(code, VENUE_TYPES(), 200);
    return {
      venues: list.map((p) => {
        const type = typeOf(p.type)!;
        return {
          id: p.id,
          type: p.type,
          label: type.label,
          activity: type.venue!.activity,
          fee_cents: type.venue!.feeCents,
          lot_id: p.lotId,
          lot_code: lotCode(p.city, p.lotId),
          open: venueOpen(p, t),
          phase: phaseOf(p, t),
          mine: me !== null && p.ownerAccountId === me,
        };
      }),
    };
  });

  // O game-core pergunta o negócio antes de cobrar a entrada: tipo, dono e se está aberto.
  app.get('/internal/v1/venues/:id', async (request) => {
    if (!config.INTERNAL_TOKEN) {
      throw new AppError('internal_disabled', 'Rotas internas desligadas: defina INTERNAL_TOKEN.', 503);
    }
    requireServiceToken(request.headers['x-service-token'], config.INTERNAL_TOKEN);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const p = await propertiesOn().store.getProperty(id);
    const type = p && typeOf(p.type);
    if (!p || !type?.venue) throw new AppError('not_found', 'Negócio não encontrado.', 404);
    return {
      venue: {
        id: p.id,
        city: p.city,
        lot_id: p.lotId,
        type: p.type,
        activity: type.venue.activity,
        fee_cents: type.venue.feeCents,
        owner_account_id: p.ownerAccountId,
        open: venueOpen(p, now()),
      },
    };
  });

  app.post('/v1/world/cities/:code/lots/:id/property', async (request, reply) => {
    const me = await player(request);
    const { code, id } = lotParams.parse(request.params);
    const { type } = z.object({ type: z.string().min(1).max(40) }).parse(request.body);
    const { store: propStore, payments: propPayments } = propertiesOn();
    if (!propPayments) throw new AppError('ledger_unavailable', 'A construção está desligada.', 503);
    await cityOr404(code);
    await assertNotInDefault(taxes?.store ?? null, code, id, now());
    if (buildings && (await buildings.store.buildingOnLot(code, id))) {
      throw new AppError('lot_has_building', 'Este lote já tem um prédio de construtor.', 409);
    }
    const p = await buildProperty(store, propStore, propPayments, { city: code, lotId: id, accountId: me, type, requestId: request.id }, now);
    return reply.status(201).send({ property: propertyDto(p) });
  });

  app.get('/v1/world/me/properties', async (request) => {
    const me = await player(request);
    const list = await propertiesOn().store.propertiesOf(me);
    return { properties: await Promise.all(list.map(propertyOut)) };
  });

  app.post('/v1/world/properties/:id/claim', async (request) => {
    const me = await player(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const { store: propStore, payments: propPayments } = propertiesOn();
    if (!propPayments) throw new AppError('ledger_unavailable', 'A coleta está desligada.', 503);
    // Doc 07 §2.2: o imóvel só rende se o dono dele também for o dono do lote (o lote pode ter sido vendido na blockchain).
    const target = await propStore.getProperty(id);
    if (target && target.ownerAccountId === me && !rentsHere((await store.getLot(target.city, target.lotId))?.ownerAccountId, me)) {
      throw new AppError('lot_not_owned', 'O lote deste imóvel é de outra pessoa: o imóvel só rende para quem também é dono do lote.', 409);
    }
    const { claim, property } = await claimIncome(propStore, propPayments, { propertyId: id, accountId: me, requestId: request.id }, now);
    return { claim: { id: claim.id, amount_cents: claim.amountCents, status: claim.status }, property: propertyDto(property) };
  });

  app.post('/v1/world/properties/:id/repair', workRoute('repair'));
  app.post('/v1/world/properties/:id/upgrade', workRoute('upgrade'));
  // Prefeitura e serviços (doc 03 §3): regularizar uma vez; água e energia por 30 dias.
  app.post('/v1/world/properties/:id/regularize', workRoute('regularize'));
  // Troca de tipo (doc 03 §6.1): T1 → T2 → T3, com o tipo de origem no último nível.
  app.post('/v1/world/properties/:id/retype', workRoute('retype'));
  app.post('/v1/world/properties/:id/water', workRoute('water'));
  app.post('/v1/world/properties/:id/power', workRoute('power'));

  // Moradia própria para o game-core (fator do turno, doc 04 §4): as casas prontas da conta e até quando
  // cada uma fica regular (regularizada, com água e energia).
  app.get('/internal/v1/accounts/:accountId/homes', async (request) => {
    if (!config.INTERNAL_TOKEN) {
      throw new AppError('internal_disabled', 'Rotas internas desligadas: defina INTERNAL_TOKEN.', 503);
    }
    requireServiceToken(request.headers['x-service-token'], config.INTERNAL_TOKEN);
    const { accountId } = z.object({ accountId: z.uuid() }).parse(request.params);
    const t = now();
    // Sem imóveis ligados, só os aluguéis de unidade contam.
    const homes = (properties ? await properties.store.propertiesOf(accountId) : []).filter(
      (p) => typeOf(p.type)?.use === 'residencial' && phaseOf(p, t) === 'ready',
    );
    // Unidades alugadas (E3.11): moradia regular do avatar inquilino enquanto o aluguel vale.
    const leases = buildings?.units ? await buildings.units.store.activeLeasesOf(accountId, t) : [];
    const leased = await Promise.all(
      leases.map(async (l) => {
        const u = await buildings!.units!.store.getUnit(l.unitId);
        return {
          id: l.unitId,
          city: u?.city ?? null,
          lot_id: u?.lotId ?? null,
          type: 'unidade',
          label: u ? unitLabel(u, { lotId: u.lotId }) : 'Apartamento',
          regular: true,
          regular_until: l.endsAt.toISOString(),
          regularized: true,
          water_until: null,
          power_until: null,
          avatar_id: l.avatarId,
          lease: true,
        };
      }),
    );
    return {
      homes: [...leased, ...(await Promise.all(
        homes.map(async (p) => {
          // A casa só vale enquanto o dono também tem o lote (doc 07 §2.2).
          const lot = await store.getLot(p.city, p.lotId);
          const window = regularWindow(p);
          const regular = isRegular(p, t) && lot?.ownerAccountId === p.ownerAccountId;
          return {
            id: p.id,
            city: p.city,
            lot_id: p.lotId,
            type: p.type,
            label: typeOf(p.type)?.label ?? p.type,
            regular,
            regular_until: regular && window ? window[1].toISOString() : null,
            regularized: !!p.regularizedAt,
            water_until: p.waterUntil?.toISOString() ?? null,
            power_until: p.powerUntil?.toISOString() ?? null,
          };
        }),
      ))],
    };
  });

  // PropertyNFT (E2.5): o imóvel pronto vai para a carteira do dono do lote; o nível sobe com outro voucher.
  const propertyChain = () => {
    const onchain = propertiesOn().onchain;
    if (!onchain) throw new AppError('onchain_disabled', 'O PropertyNFT não está configurado.', 503);
    return onchain;
  };

  app.post('/v1/world/properties/:id/onchain-voucher', async (request) => {
    const me = await player(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const { wallet } = z.object({ wallet: z.string() }).parse(request.body);
    const onchain = propertyChain();
    const { voucher, signature, property } = await issuePropertyVoucher(
      propertiesOn().store,
      onchain.wallets,
      onchain.signer,
      { propertyId: id, accountId: me, wallet, cityNftId: (c) => config.LAND_CITY_IDS[c], ttlSeconds: config.QUOTE_TTL_SECONDS, requestId: request.id },
      now,
    );
    await assertNotInDefault(taxes?.store ?? null, property.city, property.lotId, now());
    return {
      contract: onchain.contract,
      chain_id: onchain.chainId,
      token_id: voucher.tokenId.toString(),
      voucher: {
        tokenId: voucher.tokenId.toString(),
        owner: voucher.owner,
        lotId: voucher.lotId.toString(),
        typeCode: voucher.typeCode,
        level: voucher.level,
        deadline: voucher.deadline.toString(),
      },
      signature,
    };
  });

  app.post('/v1/world/properties/:id/level-voucher', async (request) => {
    const me = await player(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const onchain = propertyChain();
    const { voucher, signature } = await issueLevelVoucher(
      propertiesOn().store,
      onchain.signer,
      { propertyId: id, accountId: me, ttlSeconds: config.QUOTE_TTL_SECONDS },
      now,
    );
    return {
      contract: onchain.contract,
      chain_id: onchain.chainId,
      voucher: { tokenId: voucher.tokenId.toString(), level: voucher.level, deadline: voucher.deadline.toString() },
      signature,
    };
  });

  // ---------------------------------------------------------------- impostos (E2.6)

  const taxesOn = () => {
    if (!taxes) throw new AppError('taxes_disabled', 'Os impostos estão desligados.', 503);
    return taxes;
  };

  app.get('/v1/world/me/taxes', async (request) => {
    const me = await player(request);
    const { store: taxStore } = taxesOn();
    const bills = await taxStore.billsOf(me, 100);
    const t = now();
    const pending = bills.filter((b) => b.status === 'pending');
    return {
      due_cents: pending.reduce((s, b) => s + totalOf(b), 0),
      bills: bills.map((b) => ({
        id: b.id,
        city: b.city,
        lot_id: b.lotId,
        kind: b.kind,
        period: b.period,
        amount_cents: b.amountCents,
        fine_cents: b.fineCents,
        total_cents: totalOf(b),
        due_at: b.dueAt.toISOString(),
        status: b.status,
        paid_at: b.paidAt?.toISOString() ?? null,
        overdue_days: b.status === 'pending' ? Math.max(0, Math.floor((t.getTime() - b.dueAt.getTime()) / 86_400_000)) : 0,
      })),
    };
  });

  // Leilão do lote inadimplente (E2.6): lances abertos em THALER; o job fecha e passa o lote.
  const auctionsOn = () => {
    const a = taxes?.auctions;
    if (!a) throw new AppError('auctions_disabled', 'Os leilões estão desligados.', 503);
    return a;
  };

  const auctionDto = async (a: Auction, me: string | null) => {
    const bids = await auctionsOn().bidsOf(a.id);
    const top = bids[0] ?? null;
    return {
      id: a.id,
      city: a.city,
      lot_id: a.lotId,
      status: a.status,
      debt_cents: a.debtCents,
      starts_at: a.startsAt.toISOString(),
      ends_at: a.endsAt.toISOString(),
      bids: bids.length,
      top_bid_cents: top?.amountCents ?? null,
      min_bid_cents: minBid(a, top),
      // Sem expor as contas dos outros jogadores: só se o lance mais alto é seu.
      you_lead: me !== null && top?.accountId === me,
      you_are_seller: me !== null && a.sellerAccountId === me,
      price_cents: a.priceCents,
      you_won: me !== null && a.winnerAccountId === me,
    };
  };

  app.get('/v1/world/auctions', async (request) => {
    const me = await maybePlayer(request);
    const list = await auctionsOn().listOpen(100);
    return { auctions: await Promise.all(list.map((a) => auctionDto(a, me))) };
  });

  app.get('/v1/world/auctions/:id', async (request) => {
    const me = await maybePlayer(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const a = await auctionsOn().getAuction(id);
    if (!a) throw new AppError('not_found', 'Leilão não encontrado.', 404);
    return { auction: await auctionDto(a, me) };
  });

  app.post('/v1/world/auctions/:id/bids', async (request, reply) => {
    const me = await player(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const { amount_cents } = z.object({ amount_cents: z.number().int().positive().max(1e12) }).parse(request.body);
    const { auction } = await placeBid(auctionsOn(), store, { auctionId: id, accountId: me, amountCents: amount_cents }, now());
    return reply.status(201).send({ auction: await auctionDto(auction, me) });
  });

  app.post('/v1/world/me/taxes/pay', async (request) => {
    const me = await player(request);
    const { store: taxStore, payments: taxPayments } = taxesOn();
    if (!taxPayments) throw new AppError('ledger_unavailable', 'O pagamento de impostos está desligado.', 503);
    return payMyTaxes(taxStore, taxPayments, me, now(), request.id);
  });

  // ---------------------------------------------------------------- prédios de construtores (E2.10)

  const buildingsOn = () => {
    if (!buildings) throw new AppError('buildings_disabled', 'Os prédios de construtores estão desligados.', 503);
    return buildings;
  };

  const buildingDto = (b: Building) => ({
    id: b.id,
    city: b.city,
    lot_id: b.lotId,
    status: b.status,
    model: { job_id: b.jobId, model_id: b.modelId, version: b.modelVersion },
    placement: { position: b.position, rotation_deg: b.rotationDeg },
    height_m: b.heightM,
    footprint_m2: b.footprintM2,
    floors: b.floors,
    gfa_m2: b.gfaM2,
    outorga_scity: scityText(b.outorgaWei),
    checks: b.checks,
    artifacts: b.artifacts,
    model_sha256: b.modelSha256,
    review_note: b.reviewNote,
    created_at: b.createdAt.toISOString(),
    reviewed_at: b.reviewedAt?.toISOString() ?? null,
  });

  const buildingBody = z.object({
    job_id: z.string().min(1).max(64),
    rotation_deg: z.number().min(-360).max(360).default(0),
    units: z.enum(['m', 'cm', 'mm', 'in', 'ft']).default('m'),
    position: z.tuple([z.number(), z.number()]).optional(),
  });

  // Envia o modelo do SCC Builder para o lote: o world manda o polígono e as regras.
  app.post('/v1/world/cities/:code/lots/:id/building', async (request, reply) => {
    const me = await player(request);
    const { code, id } = lotParams.parse(request.params);
    const body = buildingBody.parse(request.body);
    const { store: bStore, builder, payments: outorga } = buildingsOn();
    if (!builder || !outorga) throw new AppError('builder_unavailable', 'O SCC Builder ou o ledger não estão configurados.', 503);
    const c = await cityOr404(code);
    await assertNotInDefault(taxes?.store ?? null, code, id, now());
    const b = await submitBuilding(
      store,
      properties?.store ?? null,
      bStore,
      builder,
      outorga,
      {
        city: c,
        lotId: id,
        accountId: me,
        authorization: request.headers.authorization!,
        jobId: body.job_id,
        rotationDeg: body.rotation_deg,
        units: body.units,
        ...(body.position ? { position: body.position } : {}),
        requestId: request.id,
      },
      now,
    );
    return reply.status(201).send({ building: buildingDto(b) });
  });

  app.get('/v1/world/me/buildings', async (request) => {
    const me = await player(request);
    return { buildings: (await buildingsOn().store.buildingsOf(me)).map(buildingDto) };
  });

  // Público: só o prédio com alvará aparece para os outros jogadores (o mapa desenha).
  app.get('/v1/world/cities/:code/lots/:id/building', async (request) => {
    const { code, id } = lotParams.parse(request.params);
    const b = await buildingsOn().store.buildingOnLot(code, id);
    if (!b || b.status !== 'approved') throw new AppError('not_found', 'Este lote não tem prédio aprovado.', 404);
    return { building: buildingDto(b) };
  });

  // ---------------------------------------------------------------- unidades (E3.11, doc 13 §4)

  const unitsOn = () => {
    const u = buildingsOn().units;
    if (!u) throw new AppError('units_disabled', 'As unidades estão desligadas.', 503);
    return u;
  };
  const unitPaymentsOn = () => {
    const p = unitsOn().payments;
    if (!p) throw new AppError('ledger_unavailable', 'A venda de unidades está desligada: o ledger não está ligado.', 503);
    return p;
  };
  const unitOut = async (u: Awaited<ReturnType<UnitStore['getUnit']>>, me: string | null) =>
    unitDto(u!, me, await unitsOn().store.activeLeaseOfUnit(u!.id, now()), now());

  // O construtor gera as unidades do prédio aprovado: {units_per_floor, ground_commercial, price_cents_per_m2}.
  app.post('/v1/world/buildings/:id/units', async (request, reply) => {
    const me = await player(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = z
      .object({ units_per_floor: z.number().int(), ground_commercial: z.boolean().default(false), price_cents_per_m2: z.number().int() })
      .parse(request.body);
    const units = await generateUnits(
      buildingsOn().store,
      unitsOn().store,
      { buildingId: id, accountId: me, unitsPerFloor: body.units_per_floor, groundCommercial: body.ground_commercial, priceCentsPerM2: body.price_cents_per_m2 },
      now(),
    );
    return reply.status(201).send({ units: units.map((u) => unitDto(u, me, null, now())) });
  });

  // Público: as unidades do prédio, com preço, aluguel e se estão ocupadas.
  app.get('/v1/world/buildings/:id/units', async (request) => {
    const me = await maybePlayer(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const list = await unitsOn().store.unitsOfBuilding(id);
    return { units: await Promise.all(list.map((u) => unitOut(u, me))) };
  });

  // Unidades residenciais para alugar na cidade, as mais baratas primeiro.
  app.get('/v1/world/cities/:code/units/for-rent', async (request) => {
    const { code } = codeParam.parse(request.params);
    const me = await maybePlayer(request);
    const list = await unitsOn().store.unitsForRent(code, 100);
    const out = await Promise.all(list.map((u) => unitOut(u, me)));
    return { units: out.filter((u) => !u.rented_until || u.rented_by_me) };
  });

  // As unidades da conta (como dona ou construtora) e as que ela aluga.
  app.get('/v1/world/me/units', async (request) => {
    const me = await player(request);
    const s = unitsOn().store;
    const owned = await s.unitsOwnedBy(me);
    const leases = await s.activeLeasesOf(me, now());
    const rented = (await Promise.all(leases.map((l) => s.getUnit(l.unitId)))).filter((u) => u !== null);
    return {
      owned: await Promise.all(owned.map((u) => unitOut(u, me))),
      rented: await Promise.all(
        rented.map(async (u) => ({ ...(await unitOut(u, me)), avatar_id: leases.find((l) => l.unitId === u!.id)?.avatarId ?? null })),
      ),
    };
  });

  // O dono (ou o construtor, antes da 1ª venda) põe ou tira o preço de venda e o de aluguel (null tira).
  app.put('/v1/world/units/:id/offer', async (request) => {
    const me = await player(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = z
      .object({ price_cents: z.number().int().nullable().optional(), rent_cents_per_day: z.number().int().nullable().optional() })
      .parse(request.body);
    const u = await setUnitOffer(unitsOn().store, { unitId: id, accountId: me, priceCents: body.price_cents, rentCentsPerDay: body.rent_cents_per_day });
    return { unit: await unitOut(u, me) };
  });

  // Compra: venda primária (95% ao construtor, 5% de taxa) ou revenda (2% de royalty ao construtor).
  app.post('/v1/world/units/:id/buy', async (request, reply) => {
    const me = await player(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const { sale, unit } = await buyUnit(unitsOn().store, unitPaymentsOn(), { unitId: id, accountId: me, requestId: request.id }, now());
    return reply.status(201).send({
      sale: { id: sale.id, primary: sale.primary, price_cents: sale.priceCents, status: sale.status },
      unit: await unitOut(unit, me),
    });
  });

  // Aluguel para morar: {avatar_id, days}. 90% ao dono, 10% de taxa da Prefeitura.
  app.post('/v1/world/units/:id/lease', async (request, reply) => {
    const me = await player(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = z.object({ avatar_id: z.uuid(), days: z.number().int() }).parse(request.body);
    const lease = await leaseUnit(
      unitsOn().store,
      unitPaymentsOn(),
      { unitId: id, accountId: me, avatarId: body.avatar_id, days: body.days, requestId: request.id },
      now(),
    );
    const u = (await unitsOn().store.getUnit(id))!;
    return reply.status(201).send({
      lease: { id: lease.id, avatar_id: lease.avatarId, days: lease.days, amount_cents: lease.centsPerDay * lease.days, starts_at: lease.startsAt.toISOString(), ends_at: lease.endsAt.toISOString() },
      unit: await unitOut(u, me),
      owner_is_me: controllerOf(u) === me,
    });
  });

  // Voucher do BuildingNFT (E2.11): o prédio aprovado vai para a blockchain pela carteira do construtor.
  app.post('/v1/world/buildings/:id/onchain-voucher', async (request) => {
    const me = await player(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const { wallet } = z.object({ wallet: z.string() }).parse(request.body);
    const onchain = buildingsOn().onchain;
    if (!onchain) throw new AppError('onchain_disabled', 'O BuildingNFT não está configurado.', 503);
    const { voucher, signature, building: b } = await issueBuildingVoucher(
      buildingsOn().store,
      onchain.wallets,
      onchain.signer,
      { buildingId: id, accountId: me, wallet, cityNftId: (c) => config.LAND_CITY_IDS[c], ttlSeconds: config.QUOTE_TTL_SECONDS, requestId: request.id },
      now,
    );
    await assertNotInDefault(taxes?.store ?? null, b.city, b.lotId, now());
    return {
      contract: onchain.contract,
      chain_id: onchain.chainId,
      voucher: {
        lotId: voucher.lotId.toString(),
        developer: voucher.developer,
        modelHash: voucher.modelHash,
        floors: voucher.floors,
        nonce: voucher.nonce.toString(),
        deadline: voucher.deadline.toString(),
      },
      signature,
    };
  });

  // Alvará (moderação de conteúdo, doc 13 §4 passo 4): ferramenta interna da Prefeitura.
  app.post('/internal/v1/buildings/:id/review', async (request) => {
    if (!config.INTERNAL_TOKEN) {
      throw new AppError('internal_disabled', 'Rotas internas desligadas: defina INTERNAL_TOKEN.', 503);
    }
    requireServiceToken(request.headers['x-service-token'], config.INTERNAL_TOKEN);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = z.object({ approve: z.boolean(), note: z.string().max(500).optional() }).parse(request.body);
    const b = await reviewBuilding(buildingsOn().store, id, body.approve, body.note ?? null, now());
    return { building: buildingDto(b) };
  });

  // ---------------------------------------------------------------- apreensão (ADR-0016)

  const seizuresOn = () => {
    if (!seizures) throw new AppError('seizures_disabled', 'A apreensão do leilão não está configurada.', 503);
    return seizures;
  };

  app.get('/v1/world/me/seizures', async (request) => {
    const me = await player(request);
    return { seizures: (await seizuresOn().store.openOf(me)).map(seizureDto) };
  });

  // Voucher para o vencedor do leilão trazer o token: LandNFT.seize ou PropertyNFT.seize.
  app.post('/v1/world/seizures/:id/voucher', async (request) => {
    const me = await player(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const { wallet } = z.object({ wallet: z.string() }).parse(request.body);
    const s = seizuresOn();
    if (!s.wallets) throw new AppError('onchain_disabled', 'A posse on-chain não está configurada.', 503);
    const r = await issueSeizureVoucher({ store: s.store, wallets: s.wallets, signers: s.signers, chain: s.chain }, { seizureId: id, accountId: me, wallet, requestId: request.id }, now());
    return {
      contract: r.contract,
      chain_id: s.chainId,
      seizure: seizureDto(r.seizure),
      voucher: { tokenId: r.voucher.tokenId.toString(), to: r.voucher.to, nonce: r.voucher.nonce.toString(), deadline: r.voucher.deadline.toString() },
      signature: r.signature,
    };
  });


  // ---------------------------------------------------------------- visitas (street view)

  const visitsOn = () => {
    if (!visits) throw new AppError('visits_disabled', 'As visitas ainda não estão ligadas.', 503);
    return visits;
  };
  const placeDeps = () => ({ properties: properties?.store ?? null, buildings: buildings?.store ?? null, guests: visitsOn().store });
  const placeParams = z.object({ kind: z.enum(['property', 'building']), id: z.uuid() });

  // Posso entrar no imóvel deste lote? O dono e os convidados dele, sim.
  app.get('/v1/world/cities/:code/lots/:id/visit', async (request) => {
    const me = await player(request);
    const { code, id } = lotParams.parse(request.params);
    const { place, role } = await visit(placeDeps(), code, id, me, now());
    return { place: placeDto(place), role };
  });

  app.get('/v1/world/places/:kind/:id/guests', async (request) => {
    const me = await player(request);
    const { kind, id } = placeParams.parse(request.params);
    await ownedPlace(placeDeps(), kind, id, me, now());
    return { guests: (await visitsOn().store.guestsOf(kind, id, me)).map(guestDto) };
  });

  // Convida pela conta ou pela carteira ligada a ela.
  app.post('/v1/world/places/:kind/:id/guests', async (request, reply) => {
    const me = await player(request);
    const { kind, id } = placeParams.parse(request.params);
    const body = z
      .object({ account_id: z.uuid().optional(), wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional() })
      .refine((b) => !!b.account_id !== !!b.wallet, 'Informe account_id ou wallet.')
      .parse(request.body);
    let guest = body.account_id ?? null;
    if (body.wallet) {
      const owners = visitsOn().owners;
      if (!owners) throw new AppError('gateway_unavailable', 'Convidar pela carteira precisa do gateway.', 503);
      guest = await owners.ownerOf(body.wallet.toLowerCase());
      if (!guest) throw new AppError('wallet_unknown', 'Esta carteira não está ligada a nenhuma conta.', 404);
    }
    const g = await invite(placeDeps(), { kind: kind as PlaceKind, placeId: id, ownerAccountId: me, guestAccountId: guest! }, now());
    return reply.status(201).send({ guest: guestDto(g) });
  });

  app.delete('/v1/world/places/:kind/:id/guests/:account', async (request) => {
    const me = await player(request);
    const { kind, id } = placeParams.parse(request.params);
    const { account } = z.object({ account: z.uuid() }).parse(request.params);
    await ownedPlace(placeDeps(), kind, id, me, now());
    return { removed: await visitsOn().store.removeGuest(kind, id, account) };
  });

  // Onde fui convidado (só os convites que ainda valem).
  app.get('/v1/world/me/invitations', async (request) => {
    const me = await player(request);
    const out = [];
    for (const g of await visitsOn().store.invitationsOf(me)) {
      try {
        const { place } = await visit(placeDeps(), ...(await placeCityLot(g)), me, now());
        out.push({ place: placeDto(place), invited_at: g.createdAt.toISOString() });
      } catch {
        // Convite que não vale mais (dono mudou, imóvel em obra): fica de fora.
      }
    }
    return { invitations: out };
  });
  const placeCityLot = async (g: { kind: PlaceKind; placeId: string }): Promise<[string, number]> => {
    const w = g.kind === 'building' ? await buildings?.store.getBuilding(g.placeId) : await properties?.store.getProperty(g.placeId);
    if (!w) throw new AppError('not_found', 'Imóvel não encontrado.', 404);
    return [w.city, w.lotId];
  };

  return app;
}
