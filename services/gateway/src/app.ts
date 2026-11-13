import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { AppError, observe, serverOptions } from '@scc/shared';
import Fastify, { type FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { Config } from './config.js';
import { AuthService } from './domain/auth.js';
import type { Account, AuthStore } from './domain/ports.js';
import { verifyToken } from './domain/token.js';

const verifyBody = z.object({
  message: z.string().min(1).max(4096),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

const accountDto = (account: Account) => ({
  id: account.id,
  email: account.email,
  status: account.status,
  kyc_level: account.kycLevel,
  created_at: account.createdAt.toISOString(),
});

export async function buildApp(config: Config, store: AuthStore, now?: () => Date) {
  const app = Fastify({
    trustProxy: config.TRUST_PROXY,
    ...serverOptions({
      service: 'gateway',
      nodeEnv: config.NODE_ENV,
      logLevel: config.LOG_LEVEL,
      redact: ['req.body.signature'],
    }),
  });
  observe(app, { service: 'gateway', nodeEnv: config.NODE_ENV, metricsToken: config.METRICS_TOKEN });

  const tokenOptions = {
    secret: config.JWT_SECRET,
    issuer: config.JWT_ISSUER,
    ttlSeconds: config.JWT_TTL_SECONDS,
  };
  const auth = new AuthService(
    store,
    {
      domains: config.SIWE_DOMAINS,
      chainIds: config.SIWE_CHAIN_IDS,
      nonceTtlSeconds: config.SIWE_NONCE_TTL_SECONDS,
      token: tokenOptions,
    },
    now,
  );

  await app.register(cors, { origin: config.CORS_ORIGINS });
  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    errorResponseBuilder: (_request, context) =>
      new AppError('rate_limited', `Limite excedido. Tente em ${context.after}.`, 429),
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.status).send({
        error: { code: error.code, message: error.message },
      });
    }
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: { code: 'invalid_request', message: 'Requisição inválida.' },
      });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.status(status).send({
        error: { code: 'invalid_request', message: 'Requisição inválida.' },
      });
    }
    request.log.error(error);
    return reply.status(500).send({
      error: { code: 'internal_error', message: 'Erro interno.' },
    });
  });

  const authLimit = { rateLimit: { max: config.AUTH_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' } };

  app.get('/healthz', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));

  app.post('/v1/auth/siwe/nonce', { config: authLimit }, async () => {
    const { nonce, expiresAt } = await auth.createNonce();
    return { nonce, expires_at: expiresAt.toISOString() };
  });

  app.post('/v1/auth/siwe/verify', { config: authLimit }, async (request) => {
    const body = verifyBody.parse(request.body);
    const result = await auth.verifySiwe(body.message, body.signature as `0x${string}`);
    return {
      access_token: result.token,
      token_type: 'Bearer',
      expires_in: result.expiresIn,
      account: accountDto(result.account),
    };
  });

  const authenticate = async (request: FastifyRequest) => {
    const match = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? '');
    if (!match?.[1]) throw new AppError('missing_credentials', 'Envie o token.', 401);
    return verifyToken(match[1], tokenOptions);
  };

  app.get('/v1/me', async (request) => {
    const { account, wallets } = await auth.me(await authenticate(request));
    return {
      account: accountDto(account),
      wallets: wallets.map((wallet) => ({
        address: wallet.address,
        chain_id: wallet.chainId,
        verified_at: wallet.verifiedAt.toISOString(),
      })),
    };
  });

  return app;
}
