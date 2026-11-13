import { AppError, bearerToken, observe, requireServiceToken, serverOptions, verifyAccessToken } from '@scc/shared';
import cors from '@fastify/cors';
import Fastify, { type FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { Config } from './config.js';
import {
  CURRENCIES,
  type Currency,
  type LedgerStore,
  MAX_LEGS,
  OWNER_TYPES,
  type PostedTx,
} from './domain/ledger.js';

/** Valores trafegam como texto em unidade mínima: JSON não guarda inteiros de 38 dígitos. */
const amountText = z.string().regex(/^-?\d{1,38}$/, 'valor em unidade mínima, sem casas');
const currency = z.enum(Object.keys(CURRENCIES) as [Currency, ...Currency[]]);

const postBody = z.object({
  kind: z.string(),
  ref_type: z.string().nullish(),
  ref_id: z.string().nullish(),
  legs: z
    .array(
      z.object({
        owner_type: z.enum(OWNER_TYPES),
        owner_id: z.string(),
        currency,
        amount: amountText,
      }),
    )
    .min(2)
    .max(MAX_LEGS),
});

const statementQuery = z.object({
  currency: currency.optional(),
  cursor: z.string().regex(/^\d{1,19}$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const txDto = (tx: PostedTx) => ({
  id: tx.id,
  kind: tx.kind,
  ref_type: tx.refType,
  ref_id: tx.refId,
  created_at: tx.createdAt.toISOString(),
  legs: tx.legs.map((l) => ({
    owner_type: l.account.ownerType,
    owner_id: l.account.ownerId,
    currency: l.account.currency,
    amount: l.amount.toString(),
  })),
});

export async function buildApp(config: Config, store: LedgerStore, now: () => Date = () => new Date()) {
  const app = Fastify({
    ...serverOptions({
      service: 'economy',
      nodeEnv: config.NODE_ENV,
      logLevel: config.LOG_LEVEL,
    }),
  });
  observe(app, { service: 'economy', nodeEnv: config.NODE_ENV, metricsToken: config.METRICS_TOKEN });

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

  app.get('/healthz', async () => ({ status: 'ok' }));

  // Saldo do jogador logado (tela de carteira, HUD).
  app.get('/v1/economy/balances', async (request) => {
    const balances = await store.balances('player', await player(request));
    return {
      balances: balances.map((b) => ({
        currency: b.currency,
        amount: b.amount.toString(),
        decimals: CURRENCIES[b.currency],
      })),
    };
  });

  // Extrato, do mais recente para o mais antigo, paginado por cursor.
  app.get('/v1/economy/ledger', async (request) => {
    const accountId = await player(request);
    const query = statementQuery.parse(request.query);
    const { lines, next } = await store.statement('player', accountId, {
      currency: query.currency,
      before: query.cursor ? BigInt(query.cursor) : undefined,
      limit: query.limit,
    });
    return {
      entries: lines.map((l) => ({
        tx_id: l.txId,
        kind: l.kind,
        ref_type: l.refType,
        ref_id: l.refId,
        currency: l.currency,
        amount: l.amount.toString(),
        created_at: l.createdAt.toISOString(),
      })),
      next_cursor: next?.toString() ?? null,
    };
  });

  // Lançamento feito pelos outros serviços (pagamento de turno, compra de lote,
  // imposto). Jogador nunca chama: o cliente não decide saldo (ADR-0002).
  app.post('/internal/v1/ledger/transactions', async (request, reply) => {
    requireServiceToken(request.headers['x-service-token'], config.INTERNAL_TOKEN);
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string') {
      throw new AppError('missing_idempotency_key', 'Envie o cabeçalho Idempotency-Key.', 400);
    }
    const body = postBody.parse(request.body);
    const result = await store.post(
      {
        kind: body.kind,
        refType: body.ref_type ?? null,
        refId: body.ref_id ?? null,
        idempotencyKey: key,
        legs: body.legs.map((l) => ({
          account: { ownerType: l.owner_type, ownerId: l.owner_id, currency: l.currency },
          amount: BigInt(l.amount),
        })),
      },
      now(),
    );
    return reply.status(result.replayed ? 200 : 201).send({ transaction: txDto(result.tx), replayed: result.replayed });
  });

  return app;
}
