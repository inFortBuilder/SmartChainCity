import { createHmac } from 'node:crypto';

import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { AppError, observe, requireServiceToken, serverOptions } from '@scc/shared';
import Fastify, { type FastifyRequest } from 'fastify';
import { getAddress } from 'viem';
import { z } from 'zod';

import type { Config } from './config.js';
import { publicStatsSource } from './public-stats.js';
import { AuthService } from './domain/auth.js';
import { Captcha } from './domain/captcha.js';
import { type KycStore, decideKyc, kycDto, startKyc } from './domain/kyc.js';
import { EmailLogin, type Mailer } from './domain/email-login.js';
import type { Account, AuthStore, WalletLink } from './domain/ports.js';
import { verifyToken } from './domain/token.js';
import { LogMailer } from './infra/log-mailer.js';

/** Solução do captcha (base64), nas rotas onde a conta pode nascer. */
const captchaField = z.string().max(2048).optional();

const verifyBody = z.object({
  message: z.string().min(1).max(4096),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  captcha: captchaField,
});

const emailField = z.email().max(254);
const emailStartBody = z.object({ email: emailField, captcha: captchaField });
const emailVerifyBody = z.object({ email: emailField, code: z.string().regex(/^[0-9]{6}$/) });

const accountDto = (account: Account) => ({
  id: account.id,
  email: account.email,
  status: account.status,
  kyc_level: account.kycLevel,
  created_at: account.createdAt.toISOString(),
});

export async function buildApp(config: Config, store: AuthStore & KycStore, now?: () => Date, mailer?: Mailer) {
  const app = Fastify({
    trustProxy: config.TRUST_PROXY,
    ...serverOptions({
      service: 'gateway',
      nodeEnv: config.NODE_ENV,
      logLevel: config.LOG_LEVEL,
      redact: ['req.body.signature', 'req.body.code', 'req.body.captcha'],
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

  const emailLogin = new EmailLogin(
    store,
    mailer ?? new LogMailer(app.log),
    {
      secret: config.JWT_SECRET,
      ttlSeconds: config.EMAIL_CODE_TTL_SECONDS,
      resendSeconds: config.EMAIL_CODE_RESEND_SECONDS,
      maxAttempts: config.EMAIL_CODE_MAX_ATTEMPTS,
      token: tokenOptions,
    },
    now,
  );

  const captcha =
    config.CAPTCHA === 'pow'
      ? new Captcha(
          store,
          {
            // Chave própria, derivada: o segredo do JWT nunca assina outra coisa.
            secret: createHmac('sha256', config.JWT_SECRET).update('scc-captcha').digest('hex'),
            maxNumber: config.CAPTCHA_MAX_NUMBER,
            ttlSeconds: config.CAPTCHA_TTL_SECONDS,
          },
          now,
        )
      : null;

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

  // Números públicos da cidade para o site (E4.5): avatares, lotes, impostos e acidentes de trabalho.
  const publicStats = publicStatsSource({ game: config.GAME_CORE_URL, world: config.WORLD_URL }, now ?? (() => new Date()));
  app.get('/v1/public/stats', async () => publicStats());

  // Desafio do captcha. Desligado, o cliente recebe enabled: false e não manda nada.
  app.get('/v1/auth/captcha', { config: authLimit }, async () =>
    captcha ? { enabled: true, ...(await captcha.challenge()) } : { enabled: false },
  );

  app.post('/v1/auth/siwe/nonce', { config: authLimit }, async () => {
    const { nonce, expiresAt } = await auth.createNonce();
    return { nonce, expires_at: expiresAt.toISOString() };
  });

  app.post('/v1/auth/siwe/verify', { config: authLimit }, async (request) => {
    const body = verifyBody.parse(request.body);
    await captcha?.verify(body.captcha);
    const result = await auth.verifySiwe(body.message, body.signature as `0x${string}`);
    return {
      access_token: result.token,
      token_type: 'Bearer',
      expires_in: result.expiresIn,
      account: accountDto(result.account),
    };
  });

  const emailOn = () => {
    if (config.EMAIL_LOGIN === 'off') throw new AppError('not_found', 'Rota não encontrada.', 404);
  };

  // Passo 1: manda o código. A resposta é sempre a mesma, para não revelar quem joga.
  app.post('/v1/auth/email/start', { config: authLimit }, async (request, reply) => {
    emailOn();
    const { email, captcha: solution } = emailStartBody.parse(request.body);
    await captcha?.verify(solution);
    const { expiresIn } = await emailLogin.start(email);
    return reply.status(202).send({ expires_in: expiresIn });
  });

  // Passo 2: troca o código pelo mesmo JWT do login SIWE.
  app.post('/v1/auth/email/verify', { config: authLimit }, async (request) => {
    emailOn();
    const body = emailVerifyBody.parse(request.body);
    const result = await emailLogin.verify(body.email, body.code);
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

  const meDto = ({ account, wallets }: { account: Account; wallets: WalletLink[] }) => ({
    account: accountDto(account),
    wallets: wallets.map((wallet) => ({
      address: wallet.address,
      chain_id: wallet.chainId,
      verified_at: wallet.verifiedAt.toISOString(),
    })),
  });

  app.get('/v1/me', async (request) => meDto(await auth.me(await authenticate(request))));

  // Liga mais uma carteira à conta logada, com a mesma assinatura SIWE do login.
  app.post('/v1/me/wallets', { config: authLimit }, async (request, reply) => {
    const accountId = await authenticate(request);
    const body = verifyBody.parse(request.body);
    const result = await auth.linkWallet(accountId, body.message, body.signature as `0x${string}`);
    return reply.status(result.linked ? 201 : 200).send(meDto(result));
  });

  // Põe e-mail na conta logada (a de carteira): código como no login.
  app.post('/v1/me/email/start', { config: authLimit }, async (request, reply) => {
    emailOn();
    const accountId = await authenticate(request);
    const { email } = emailStartBody.parse(request.body);
    const { account } = await auth.me(accountId);
    const { expiresIn } = await emailLogin.startLink(account, email);
    return reply.status(202).send({ expires_in: expiresIn });
  });

  app.post('/v1/me/email/verify', { config: authLimit }, async (request) => {
    emailOn();
    const accountId = await authenticate(request);
    const body = emailVerifyBody.parse(request.body);
    await auth.me(accountId);
    await emailLogin.verifyLink(accountId, body.email, body.code);
    return meDto(await auth.me(accountId));
  });

  // KYC (doc 10): o jogador pede a verificação; a revisão (ou o webhook do provedor) decide.
  const clock = now ?? (() => new Date());
  app.get('/v1/me/kyc', async (request) => {
    const accountId = await authenticate(request);
    const { account } = await auth.me(accountId);
    const last = await store.latestKyc(accountId);
    return { level: account.kycLevel, request: last ? kycDto(last) : null };
  });

  app.post('/v1/me/kyc', { config: authLimit }, async (request, reply) => {
    const accountId = await authenticate(request);
    const r = await startKyc(store, accountId, clock());
    return reply.status(202).send({ request: kycDto(r) });
  });

  const internalOn = (request: FastifyRequest) => {
    if (!config.INTERNAL_TOKEN) {
      throw new AppError('internal_disabled', 'Rotas internas desligadas: defina INTERNAL_TOKEN.', 503);
    }
    requireServiceToken(request.headers['x-service-token'], config.INTERNAL_TOKEN);
  };

  // Fila da revisão: pedidos pendentes, do mais antigo para o mais novo.
  app.get('/internal/v1/kyc', async (request) => {
    internalOn(request);
    const q = z
      .object({ status: z.enum(['pending', 'approved', 'rejected']).default('pending'), limit: z.coerce.number().int().min(1).max(500).default(100) })
      .parse(request.query);
    return { requests: (await store.listKyc(q.status, q.limit)).map((r) => ({ ...kycDto(r), account_id: r.accountId })) };
  });

  // Decisão da revisão; o webhook do provedor de KYC vai chamar a mesma rota.
  app.post('/internal/v1/kyc/:id', async (request) => {
    internalOn(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = z.object({ decision: z.enum(['approve', 'reject']), note: z.string().max(500).optional() }).parse(request.body);
    const r = await decideKyc(store, id, body.decision === 'approve' ? 'approved' : 'rejected', body.note ?? null, clock());
    return { request: { ...kycDto(r), account_id: r.accountId } };
  });

  // Carteiras de uma conta, para os outros serviços (world: cotação on-chain do lote).
  app.get('/internal/v1/accounts/:id/wallets', async (request) => {
    if (!config.INTERNAL_TOKEN) {
      throw new AppError('internal_disabled', 'Rotas internas desligadas: defina INTERNAL_TOKEN.', 503);
    }
    requireServiceToken(request.headers['x-service-token'], config.INTERNAL_TOKEN);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const { account, wallets } = await auth.me(id);
    return {
      wallets: wallets.map((w) => ({ address: w.address, chain_id: w.chainId })),
      // O economy usa para a carência do saque da conta nova e para o limite sem KYC.
      account_created_at: account.createdAt.toISOString(),
      kyc_level: account.kycLevel,
    };
  });

  // Conta dona da carteira, para o chain-indexer creditar o depósito do GameVault na conta certa.
  app.get('/internal/v1/wallets/:address/account', async (request) => {
    if (!config.INTERNAL_TOKEN) {
      throw new AppError('internal_disabled', 'Rotas internas desligadas: defina INTERNAL_TOKEN.', 503);
    }
    requireServiceToken(request.headers['x-service-token'], config.INTERNAL_TOKEN);
    const { address } = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) }).parse(request.params);
    const accountId = await store.walletOwner(getAddress(address));
    if (!accountId) throw new AppError('not_found', 'Nenhuma conta ligada a esta carteira.', 404);
    return { account_id: accountId };
  });

  return app;
}
