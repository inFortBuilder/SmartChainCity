import { AppError, bearerToken, observe, requireServiceToken, serverOptions, verifyAccessToken } from '@scc/shared';
import cors from '@fastify/cors';
import Fastify, { type FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { Config } from './config.js';
import { type PanelStore, buildPanel, panelGauges } from './domain/panel.js';
import {
  type AccountDirectory,
  type VoucherSigner,
  type Withdrawal,
  type WithdrawalStore,
  deadlineSeconds,
  requestWithdrawal,
} from './domain/withdrawals.js';
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

/** Saque pelo GameVault (E3.7): sem isso, as rotas de saque respondem 503. */
export interface WithdrawalsWiring {
  store: WithdrawalStore;
  signer: VoucherSigner;
  accounts: AccountDirectory;
  vault: { contract: string; chainId: number };
}

const withdrawalDto = (w: Withdrawal) => ({
  id: w.id,
  wallet: w.wallet,
  amount_wei: w.amountWei.toString(),
  status: w.status,
  created_at: w.createdAt.toISOString(),
  deadline: w.deadline.toISOString(),
  // O voucher só serve enquanto está pendente: com ele, a carteira chama GameVault.claim.
  voucher:
    w.status === 'pending' && w.signature
      ? { to: w.wallet, amount: w.amountWei.toString(), nonce: w.nonce.toString(), deadline: deadlineSeconds(w).toString(), signature: w.signature }
      : null,
});

export async function buildApp(
  config: Config,
  store: LedgerStore & Partial<PanelStore>,
  now: () => Date = () => new Date(),
  withdrawals: WithdrawalsWiring | null = null,
) {
  const app = Fastify({
    ...serverOptions({
      service: 'economy',
      nodeEnv: config.NODE_ENV,
      logLevel: config.LOG_LEVEL,
    }),
  });
  const metrics = observe(app, { service: 'economy', nodeEnv: config.NODE_ENV, metricsToken: config.METRICS_TOKEN });

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

  // Só desenvolvimento: 1.000 SCITY de teste por pedido, como um depósito
  // simulado da ponte (system/bridge). Desligada, é 404.
  app.post('/v1/dev/faucet', async (request) => {
    if (!config.DEV_FAUCET) throw new AppError('not_found', 'Rota não encontrada.', 404);
    const accountId = await player(request);
    const amount = 1000n * 10n ** 18n;
    await store.post(
      {
        kind: 'dev_faucet',
        refType: 'dev',
        idempotencyKey: `faucet:${accountId}:${now().getTime()}`,
        legs: [
          { account: { ownerType: 'system', ownerId: 'bridge', currency: 'SCITY' }, amount: -amount },
          { account: { ownerType: 'player', ownerId: accountId, currency: 'SCITY' }, amount },
        ],
      },
      now(),
    );
    return { currency: 'SCITY', amount: amount.toString(), decimals: 18 };
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

  // ---------------------------------------------------------------- saques (E3.7)

  const withdrawalsOn = () => {
    if (!withdrawals) throw new AppError('withdrawals_disabled', 'O saque ainda não está ligado.', 503);
    return withdrawals;
  };

  app.post('/v1/economy/withdrawals', async (request, reply) => {
    const accountId = await player(request);
    const w = withdrawalsOn();
    const body = z.object({ wallet: z.string(), amount_wei: z.string().regex(/^\d{1,40}$/) }).parse(request.body);
    const created = await requestWithdrawal(
      { ledger: store, store: w.store, signer: w.signer, accounts: w.accounts },
      { accountId, wallet: body.wallet, amountWei: BigInt(body.amount_wei) },
      now(),
    );
    return reply.status(201).send({ contract: w.vault.contract, chain_id: w.vault.chainId, withdrawal: withdrawalDto(created) });
  });

  app.get('/v1/economy/withdrawals', async (request) => {
    const accountId = await player(request);
    const w = withdrawalsOn();
    return { contract: w.vault.contract, chain_id: w.vault.chainId, withdrawals: (await w.store.listOf(accountId, 50)).map(withdrawalDto) };
  });

  // ---------------------------------------------------------------- painel econômico (E2.8)

  const panelStore = store.flows && store.snapshot ? (store as PanelStore) : null;

  app.get('/internal/v1/economy/panel', async (request) => {
    requireServiceToken(request.headers['x-service-token'], config.INTERNAL_TOKEN);
    if (!panelStore) throw new AppError('panel_disabled', 'Este armazenamento não tem painel.', 503);
    const { currency } = z.object({ currency: z.enum(['THALER', 'SCITY']).default('THALER') }).parse(request.query);
    return buildPanel(panelStore, currency, now());
  });

  // Job economy.panel: recalcula os indicadores e os põe no /metrics (Grafana e alertas).
  let lastAlerts = '';
  const refreshPanel = async () => {
    if (!panelStore) return;
    for (const currency of ['THALER', 'SCITY'] as const) {
      const p = await buildPanel(panelStore, currency, now());
      panelGauges(p, (name, help, labels, value) => metrics.set(name, help, labels, value));
      const alerts = JSON.stringify(p.alerts);
      if (currency === 'THALER' && alerts !== lastAlerts) {
        lastAlerts = alerts;
        for (const a of p.alerts) app.log.warn({ code: a.code, severity: a.severity }, a.message);
      }
    }
  };
  if (config.PANEL_EVERY_SECONDS > 0) {
    const timer = setInterval(() => refreshPanel().catch((e) => app.log.error(e)), config.PANEL_EVERY_SECONDS * 1000);
    timer.unref();
    app.addHook('onReady', async () => {
      await refreshPanel().catch((e) => app.log.error(e));
    });
    app.addHook('onClose', async () => clearInterval(timer));
  }

  return app;
}
