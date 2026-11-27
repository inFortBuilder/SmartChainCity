import { createHash } from 'node:crypto';

import { AppError, bearerToken, observe, requireServiceToken, serverOptions, verifyAccessToken } from '@scc/shared';
import cors from '@fastify/cors';
import Fastify, { type FastifyRequest } from 'fastify';
import { getAddress, isAddress } from 'viem';
import { z } from 'zod';

import type { Config } from './config.js';
import { type PanelStore, buildPanel, panelGauges } from './domain/panel.js';
import {
  type Conversion,
  type EarningsReader,
  type ExchangeStore,
  MIN_EXIT_CENTS,
  convert,
  currentTerms,
  rateFromUsd,
} from './domain/exchange.js';
import { TWAP_SOURCE } from './domain/fx-twap.js';
import { type SwitchStore, assertOpen, isSwitch, statusOf, switchDto } from './domain/switches.js';
import { MemorySwitchStore } from './infra/switch-stores.js';
import {
  type AccountDirectory,
  type VaultReader,
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
  /** Tetos e pausa do contrato: sem isso, o saque não confere o teto do dia antes de assinar. */
  reader?: VaultReader | null;
}

/** Câmbio THALER ↔ SCITY (passo 11 da trilha). */
export interface ExchangeWiring {
  store: ExchangeStore;
  earnings: EarningsReader | null;
  poolStart: Date | null;
  freeUntil: Date | null;
}

const conversionDto = (c: Conversion) => ({
  id: c.id,
  direction: c.direction,
  thaler_cents: c.thalerCents.toString(),
  scity_wei: c.scityWei.toString(),
  fee_cents: c.feeCents.toString(),
  thaler_per_scity: Number(c.thalerPerScityMicro) / 1_000_000,
  spread_bps: c.spreadBps,
  status: c.status,
  created_at: c.createdAt.toISOString(),
});

/** Id da conversão a partir da Idempotency-Key: a mesma chave da mesma conta dá o mesmo id. */
const idFromKey = (accountId: string, key: string) => {
  const h = createHash('sha256').update(`fx:${accountId}:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

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
  exchange: ExchangeWiring | null = null,
  /** Travas de incidente (E4.6). Sem store, ficam em memória. */
  switchStore: SwitchStore | null = null,
) {
  const switches = switchStore ?? new MemorySwitchStore();
  const app = Fastify({
    ...serverOptions({
      service: 'economy',
      nodeEnv: config.NODE_ENV,
      logLevel: config.LOG_LEVEL,
    }),
  });
  const metrics = observe(app, { service: 'economy', nodeEnv: config.NODE_ENV, metricsToken: config.METRICS_TOKEN });

  // PUT e DELETE também: o padrão do @fastify/cors é só GET, HEAD e POST, e as telas usam os dois.
  await app.register(cors, { origin: config.CORS_ORIGINS, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] });

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

  // ---------------------------------------------------------------- câmbio (passo 11)

  const exchangeOn = () => {
    if (!exchange) throw new AppError('fx_disabled', 'O câmbio ainda não está ligado.', 503);
    return exchange;
  };

  app.get('/v1/economy/fx', async () => {
    const terms = await currentTerms(exchangeOn(), now());
    return {
      thaler_per_scity: Number(terms.rate.thalerPerScityMicro) / 1_000_000,
      scity_usd: terms.rate.scityUsd,
      valid_from: terms.rate.validFrom.toISOString(),
      source: terms.rate.source,
      exit_spread_bps: terms.exitSpreadBps,
      pool_brake: Math.round(terms.brake * 1000) / 1000,
      min_exit_cents: MIN_EXIT_CENTS.toString(),
      daily_exit_cents: terms.dailyExitCents.toString(),
      // Provisória enquanto não vem do TWAP da DEX.
      provisional: terms.rate.source !== TWAP_SOURCE,
    };
  });

  app.post('/v1/economy/exchange', async (request, reply) => {
    const accountId = await player(request);
    const x = exchangeOn();
    await assertOpen(switches, 'exchange');
    const body = z
      .object({ direction: z.enum(['scity_to_thaler', 'thaler_to_scity']), amount: z.string().regex(/^\d{1,40}$/) })
      .parse(request.body);
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 8 || key.length > 128) {
      throw new AppError('missing_idempotency_key', 'Envie o cabeçalho Idempotency-Key.', 400);
    }
    const c = await convert(
      { ledger: store, store: x.store, earnings: x.earnings, poolStart: x.poolStart, freeUntil: x.freeUntil },
      { accountId, direction: body.direction, amount: BigInt(body.amount), id: idFromKey(accountId, key) },
      now(),
    );
    return reply.status(201).send({ conversion: conversionDto(c) });
  });

  app.get('/v1/economy/exchange', async (request) => {
    const accountId = await player(request);
    return { conversions: (await exchangeOn().store.listOf(accountId, 50)).map(conversionDto) };
  });

  // Cotação nova por quem opera. Com o pool da DEX ligado, o job fx.twap volta a mandar no período seguinte.
  app.post('/internal/v1/economy/fx', async (request, reply) => {
    requireServiceToken(request.headers['x-service-token'], config.INTERNAL_TOKEN);
    const { scity_usd, source } = z.object({ scity_usd: z.number().positive().max(1e6), source: z.string().max(40).default('manual') }).parse(request.body);
    const rate = rateFromUsd(scity_usd, now(), source);
    await exchangeOn().store.setRate(rate);
    return reply.status(201).send({ thaler_per_scity: Number(rate.thalerPerScityMicro) / 1_000_000, valid_from: rate.validFrom.toISOString() });
  });

  // ---------------------------------------------------------------- travas de incidente (E4.6)

  const switchGauges = (list: Awaited<ReturnType<typeof statusOf>>) => {
    for (const x of list) metrics.set('economy_incident_switch', 'Trava de incidente ligada (1) ou não (0)', { switch: x.name }, x.frozen ? 1 : 0);
  };

  // Público: o mapa mostra o aviso quando saque ou câmbio estão travados.
  app.get('/v1/economy/status', async () => {
    const list = await statusOf(switches);
    switchGauges(list);
    return { switches: Object.fromEntries(list.map((x) => [x.name, switchDto(x)])) };
  });

  // Operação: liga ou desliga uma trava (runbooks em docs/incidentes).
  app.put('/internal/v1/economy/switches/:name', async (request) => {
    requireServiceToken(request.headers['x-service-token'], config.INTERNAL_TOKEN);
    const { name } = z.object({ name: z.string() }).parse(request.params);
    if (!isSwitch(name)) throw new AppError('unknown_switch', 'Trava desconhecida: use withdrawals ou exchange.', 404);
    const b = z.object({ frozen: z.boolean(), reason: z.string().max(200).optional(), by: z.string().min(1).max(80) }).parse(request.body);
    await switches.set({ name, frozen: b.frozen, reason: b.frozen ? (b.reason ?? null) : null, by: b.by, since: now() });
    request.log.warn({ switch: name, frozen: b.frozen, by: b.by }, 'trava de incidente alterada');
    const list = await statusOf(switches);
    switchGauges(list);
    return { switches: Object.fromEntries(list.map((x) => [x.name, switchDto(x)])) };
  });

  // ---------------------------------------------------------------- saques (E3.7)

  const withdrawalsOn = () => {
    if (!withdrawals) throw new AppError('withdrawals_disabled', 'O saque ainda não está ligado.', 503);
    return withdrawals;
  };

  app.post('/v1/economy/withdrawals', async (request, reply) => {
    const accountId = await player(request);
    const w = withdrawalsOn();
    await assertOpen(switches, 'withdrawals');
    const body = z.object({ wallet: z.string(), amount_wei: z.string().regex(/^\d{1,40}$/) }).parse(request.body);
    const created = await requestWithdrawal(
      { ledger: store, store: w.store, signer: w.signer, accounts: w.accounts, vault: w.reader ?? undefined },
      { accountId, wallet: body.wallet, amountWei: BigInt(body.amount_wei) },
      now(),
    );
    return reply.status(201).send({ contract: w.vault.contract, chain_id: w.vault.chainId, withdrawal: withdrawalDto(created) });
  });

  app.get('/v1/economy/withdrawals', async (request) => {
    const accountId = await player(request);
    const w = withdrawalsOn();
    const q = z.object({ wallet: z.string().optional() }).parse(request.query);
    // Com ?wallet=, mostra o que o cofre ainda libera hoje para ela (null sem a RPC).
    const status = q.wallet && isAddress(q.wallet) && w.reader ? await w.reader.status(getAddress(q.wallet)).catch(() => null) : null;
    return {
      contract: w.vault.contract,
      chain_id: w.vault.chainId,
      vault: status && {
        paused: status.paused,
        daily_limit_wei: status.dailyLimitWei.toString(),
        per_address_limit_wei: status.perAddressLimitWei.toString(),
        total_left_wei: status.totalLeftWei.toString(),
        wallet_left_wei: status.walletLeftWei.toString(),
      },
      withdrawals: (await w.store.listOf(accountId, 50)).map(withdrawalDto),
    };
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
