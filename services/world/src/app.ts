import cors from '@fastify/cors';
import { AppError, bearerToken, verifyAccessToken } from '@scc/shared';
import Fastify, { type FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { Config } from './config.js';
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
) {
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { redact: ['req.headers.authorization'] },
  });
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
    const purchase = await buyLot(store, payments, { city: code, lotId: id, accountId: me, scityUsd: config.SCITY_USD }, now);
    const c = await cityOr404(code);
    const lot = (await store.getLot(code, id))!;
    return reply.status(201).send({
      purchase: { id: purchase.id, price_usd: purchase.priceUsd, price_scity: scityText(purchase.priceWei), status: 'paid' },
      lot: lotDto(lot, me, lot.district < c.openCount, c.zones),
      city: { open_count: c.openCount },
    });
  });

  return app;
}
