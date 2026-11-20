import cors from '@fastify/cors';
import { AppError, bearerToken, observe, serverOptions, verifyAccessToken } from '@scc/shared';
import Fastify, { type FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { Config } from './config.js';
import { type QuoteSigner, type WalletDirectory, issueOnchainQuote } from './domain/land-quote.js';
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
  properties: { store: PropertyStore; payments: PropertyPayments | null } | null = null,
) {
  const app = Fastify({
    ...serverOptions({ service: 'world', nodeEnv: config.NODE_ENV, logLevel: config.LOG_LEVEL }),
  });
  observe(app, { service: 'world', nodeEnv: config.NODE_ENV, metricsToken: config.METRICS_TOKEN });
  await app.register(cors, { origin: config.CORS_ORIGINS });

  app.setErrorHandler((error, request, reply) => {
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
    const { priceUsd, priceWei } = priceOf(lot.areaM2, zone, config.SCITY_USD);
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
      city: { code: c.code, name: c.name, open_count: c.openCount, release_threshold: c.releaseThreshold, scity_usd: config.SCITY_USD },
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
    const purchase = await buyLot(store, payments, { city: code, lotId: id, accountId: me, scityUsd: config.SCITY_USD, requestId: request.id }, now);
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
    const { work, property, claim } = await startWork(propStore, propPayments, { propertyId: id, accountId: me, kind, requestId: request.id }, now);
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
    const { claim, property } = await claimIncome(propStore, propPayments, { propertyId: id, accountId: me, requestId: request.id }, now);
    return { claim: { id: claim.id, amount_cents: claim.amountCents, status: claim.status }, property: propertyDto(property) };
  });

  app.post('/v1/world/properties/:id/repair', workRoute('repair'));
  app.post('/v1/world/properties/:id/upgrade', workRoute('upgrade'));

  return app;
}
