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
  PROPERTY_TYPES,
  REPAIR_SHARE_PER_POINT,
  type Property,
  type PropertyPayments,
  type PropertyStore,
  WEAR_PER_DAY,
  accrued,
  buildProperty,
  claimIncome,
  incomePerDay,
  nextLevel,
  phaseOf,
  repairCostCents,
  startWork,
  typeOf,
  wearAt,
} from './domain/properties.js';
import { type LandPayments, type Lot, type WorldStore, lotCode, priceOf } from './domain/lots.js';
import { buyLot } from './domain/purchase.js';
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
) {
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
    const purchase = await buyLot(store, payments, { city: code, lotId: id, accountId: me, scityUsd: scityUsd(), requestId: request.id }, now);
    const c = await cityOr404(code);
    const lot = (await store.getLot(code, id))!;
    return reply.status(201).send({
      purchase: { id: purchase.id, price_usd: purchase.priceUsd, price_scity: scityText(purchase.priceWei), status: 'paid' },
      lot: lotDto(lot, me, lot.district < c.openCount, c.zones),
      city: { open_count: c.openCount },
    });
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
      next_level: (() => {
        const n = nextLevel(p);
        return n ? { level: n.level, cost_cents: n.upgradeCostCents, income_cents_per_day: n.incomeCentsPerDay } : null;
      })(),
    };
  };

  const workRoute = (kind: 'repair' | 'upgrade') => async (request: FastifyRequest) => {
    const me = await player(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const { store: propStore, payments: propPayments } = propertiesOn();
    if (!propPayments) throw new AppError('ledger_unavailable', 'As obras estão desligadas.', 503);
    const target = await propStore.getProperty(id);
    if (target && target.ownerAccountId === me) await assertNotInDefault(taxes?.store ?? null, target.city, target.lotId, now());
    const { work, property, claim } = await startWork(propStore, propPayments, { propertyId: id, accountId: me, kind, requestId: request.id }, now, store);
    return {
      work: { id: work.id, kind: work.kind, cost_cents: work.costCents, to_level: work.toLevel },
      // Renda acumulada até a obra, fechada e paga antes de o imóvel mudar.
      claim: claim ? { id: claim.id, amount_cents: claim.amountCents, status: claim.status } : null,
      property: propertyDto(property),
    };
  };

  app.get('/v1/world/property-types', async () => ({
    rules: {
      accrual_cap_days: ACCRUAL_CAP_DAYS,
      wear_per_day: WEAR_PER_DAY,
      min_wear_for_income: MIN_WEAR_FOR_INCOME,
      repair_share_per_point: REPAIR_SHARE_PER_POINT,
    },
    types: PROPERTY_TYPES.map((t) => ({
      code: t.code,
      label: t.label,
      zones: t.zones,
      price_cents: t.priceCents,
      build_minutes: t.buildMinutes,
      levels: t.levels.map((l) => ({ level: l.level, income_cents_per_day: l.incomeCentsPerDay, upgrade_cost_cents: l.upgradeCostCents ?? null })),
      provisional: t.provisional,
    })),
  }));

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
    return { properties: list.map(propertyDto) };
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
