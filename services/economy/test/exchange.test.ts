import { randomUUID } from 'node:crypto';

import { SignJWT } from 'jose';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import {
  DAILY_EXIT_CENTS,
  type ExchangeStore,
  brakeLevel,
  convert,
  quote,
  rateFromUsd,
  releasedScity,
} from '../src/domain/exchange.js';
import type { LedgerStore } from '../src/domain/ledger.js';
import { PostgresExchangeStore } from '../src/infra/db/postgres-exchange-store.js';
import { PostgresLedgerStore } from '../src/infra/db/postgres-store.js';
import { MemoryExchangeStore } from '../src/infra/memory-exchange-store.js';
import { MemoryLedgerStore } from '../src/infra/memory-store.js';
import { pool } from './stores.js';

const WEI = 10n ** 18n;
const T0 = new Date('2026-11-20T12:00:00Z');
const DAY = 86_400_000;
const at = (ms: number) => new Date(T0.getTime() + ms);

afterAll(async () => {
  await pool?.end();
});

describe('cotação', () => {
  const r1 = rateFromUsd(1, T0, 'teste');

  it('20 THALER por SCITY a US$ 1; 10 a US$ 0,50', () => {
    expect(r1.thalerPerScityMicro).toBe(20_000_000n);
    expect(rateFromUsd(0.5, T0, 't').thalerPerScityMicro).toBe(10_000_000n);
    expect(quote('scity_to_thaler', 3n * WEI, r1)).toMatchObject({ thalerCents: 60_00n, feeCents: 0n });
  });

  it('a saída paga 7,5% de spread, arredondado a favor do jogo', () => {
    const q = quote('thaler_to_scity', 1000_00n, r1);
    expect(q).toMatchObject({ feeCents: 75_00n, spreadBps: 750 });
    // 925 THALER / 20 = 46,25 SCITY
    expect(q.scityWei).toBe(4625n * 10n ** 16n);
    expect(quote('thaler_to_scity', 1n, r1).feeCents).toBe(1n);
  });

  it('o freio liga aos 70% do liberado e sobe o spread até +10 pontos', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const released = releasedScity(start, new Date(start.getTime() + 364 * DAY));
    expect(released).toBe(123_000_000n * WEI);
    expect(brakeLevel((released * 7n) / 10n, released)).toBe(0);
    expect(brakeLevel((released * 85n) / 100n, released)).toBeCloseTo(0.5);
    expect(brakeLevel(released, released)).toBe(1);
    expect(quote('thaler_to_scity', 1000_00n, r1, 0.5).spreadBps).toBe(1250);
    expect(releasedScity(start, new Date(start.getTime() - DAY))).toBe(0n);
  });
});

const fund = (ledger: LedgerStore, accountId: string, currency: 'THALER' | 'SCITY', amount: bigint, kind = 'test_credit', when = T0) =>
  ledger.post(
    {
      kind,
      idempotencyKey: `credito-${randomUUID()}`,
      legs: [
        { account: { ownerType: 'system', ownerId: 'mint', currency }, amount: -amount },
        { account: { ownerType: 'player', ownerId: accountId, currency }, amount },
      ],
    },
    when,
  );

const spend = (ledger: LedgerStore, accountId: string, cents: bigint) =>
  ledger.post(
    {
      kind: 'food',
      idempotencyKey: `gasto-${randomUUID()}`,
      legs: [
        { account: { ownerType: 'player', ownerId: accountId, currency: 'THALER' }, amount: -cents },
        { account: { ownerType: 'burn', ownerId: 'food', currency: 'THALER' }, amount: cents },
      ],
    },
    T0,
  );

const bal = async (ledger: LedgerStore, id: string, currency: 'THALER' | 'SCITY', ownerType: 'player' | 'burn' = 'player') =>
  (await ledger.balances(ownerType, id)).find((b) => b.currency === currency)?.amount ?? 0n;

describe.each([
  ['memória', () => new MemoryLedgerStore(), () => new MemoryExchangeStore() as ExchangeStore, true],
  ['postgres', () => new PostgresLedgerStore(pool!), () => new PostgresExchangeStore(pool!) as ExchangeStore, pool !== null],
] as const)('conversão (%s)', (_name, makeLedger, makeStore, enabled) => {
  let ledger: MemoryLedgerStore | PostgresLedgerStore;
  let store: ExchangeStore;
  beforeEach(async () => {
    if (!enabled) return;
    ledger = makeLedger();
    store = makeStore();
    await store.setRate(rateFromUsd(1, new Date(T0.getTime() - Math.floor(Math.random() * 1e6)), 'teste'));
  });
  const deps = (over: { freeUntil?: Date | null } = {}) => ({ ledger, store, earnings: ledger, poolStart: null, freeUntil: over.freeUntil ?? null });

  it.skipIf(!enabled)('entra e sai, com o spread queimado; a mesma chave não converte duas vezes', async () => {
    const me = randomUUID();
    await fund(ledger, me, 'SCITY', 100n * WEI);
    await convert(deps(), { accountId: me, direction: 'scity_to_thaler', amount: 100n * WEI }, T0);
    expect(await bal(ledger, me, 'THALER')).toBe(2000_00n);
    expect(await bal(ledger, me, 'SCITY')).toBe(0n);

    const burnBefore = await bal(ledger, 'fx_spread', 'THALER', 'burn');
    const id = randomUUID();
    const c = await convert(deps(), { accountId: me, direction: 'thaler_to_scity', amount: 1000_00n, id }, T0);
    expect(c).toMatchObject({ status: 'done', feeCents: 75_00n, scityWei: 4625n * 10n ** 16n });
    expect(await convert(deps(), { accountId: me, direction: 'thaler_to_scity', amount: 1000_00n, id }, T0)).toMatchObject({ id, status: 'done' });
    expect(await bal(ledger, me, 'THALER')).toBe(1000_00n);
    expect(await bal(ledger, me, 'SCITY')).toBe(4625n * 10n ** 16n);
    expect((await bal(ledger, 'fx_spread', 'THALER', 'burn')) - burnBefore).toBe(75_00n);
  });

  it.skipIf(!enabled)('mínimo, teto de 24 h e saldo', async () => {
    const me = randomUUID();
    await fund(ledger, me, 'THALER', 5000_00n);
    const out = (cents: bigint, when = T0) => convert(deps(), { accountId: me, direction: 'thaler_to_scity', amount: cents }, when);
    await expect(out(499_00n)).rejects.toMatchObject({ code: 'below_minimum' });
    await out(1500_00n);
    await expect(out(600_00n)).rejects.toMatchObject({ code: 'daily_limit' });
    await out(500_00n);
    await out(DAILY_EXIT_CENTS, at(DAY + 1));
    // Sobraram 1.000 THALER: 1.500 não passa.
    await expect(out(1500_00n, at(3 * DAY))).rejects.toMatchObject({ code: 'insufficient_thaler' });
    // O que falhou não conta no teto.
    await fund(ledger, me, 'THALER', 1000_00n);
    await out(1500_00n, at(3 * DAY));
  });

  it.skipIf(!enabled)('período grátis: o ganho do trabalho antes do fim não vira SCITY; gasto consome o grátis primeiro', async () => {
    const me = randomUUID();
    const freeUntil = at(DAY);
    await fund(ledger, me, 'THALER', 1000_00n, 'shift_pay', T0); // grátis
    await fund(ledger, me, 'THALER', 600_00n, 'shift_pay', at(2 * DAY)); // depois do fim
    const out = (cents: bigint) => convert(deps({ freeUntil }), { accountId: me, direction: 'thaler_to_scity', amount: cents }, at(2 * DAY));
    await expect(out(700_00n)).rejects.toMatchObject({ code: 'free_period_locked' });
    await spend(ledger, me, 300_00n); // sai do grátis: 700 presos
    await expect(out(700_00n)).rejects.toMatchObject({ code: 'free_period_locked' });
    await out(600_00n);
    expect(await bal(ledger, me, 'THALER')).toBe(700_00n);
  });
});

describe('API', () => {
  const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
  const INTERNAL = 'chave-interna-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)

  it('cotação pública, conversão com Idempotency-Key, histórico e cotação nova pela rota interna', async () => {
    const ledger = new MemoryLedgerStore();
    const store = new MemoryExchangeStore();
    await store.setRate(rateFromUsd(1, at(-1000), 'teste'));
    let clock = T0;
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: INTERNAL }), ledger, () => clock, null, {
      store,
      earnings: ledger,
      poolStart: null,
      freeUntil: null,
    });
    const me = randomUUID();
    await fund(ledger, me, 'SCITY', 10n * WEI);
    const headers = {
      authorization: `Bearer ${await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(me)
        .setIssuer('scc-gateway')
        .setAudience('scc-api')
        .setExpirationTime('5m')
        .sign(new TextEncoder().encode(SECRET))}`,
    };
    expect((await app.inject({ method: 'GET', url: '/v1/economy/fx' })).json()).toMatchObject({ thaler_per_scity: 20, exit_spread_bps: 750, pool_brake: 0 });

    const body = { direction: 'scity_to_thaler', amount: (5n * WEI).toString() };
    expect((await app.inject({ method: 'POST', url: '/v1/economy/exchange', headers, payload: body })).statusCode).toBe(400);
    const h = { ...headers, 'idempotency-key': 'troca-0001' };
    const r1 = await app.inject({ method: 'POST', url: '/v1/economy/exchange', headers: h, payload: body });
    const r2 = await app.inject({ method: 'POST', url: '/v1/economy/exchange', headers: h, payload: body });
    expect(r1.statusCode).toBe(201);
    expect(r2.json().conversion.id).toBe(r1.json().conversion.id);
    expect(await bal(ledger, me, 'THALER')).toBe(100_00n);
    expect((await app.inject({ method: 'GET', url: '/v1/economy/exchange', headers })).json().conversions).toHaveLength(1);

    clock = at(1000);
    expect((await app.inject({ method: 'POST', url: '/internal/v1/economy/fx', payload: { scity_usd: 0.5 } })).statusCode).toBe(403);
    const set = await app.inject({ method: 'POST', url: '/internal/v1/economy/fx', headers: { 'x-service-token': INTERNAL }, payload: { scity_usd: 0.5 } });
    expect(set.json()).toMatchObject({ thaler_per_scity: 10 });
    expect((await app.inject({ method: 'GET', url: '/v1/economy/fx' })).json()).toMatchObject({ thaler_per_scity: 10, scity_usd: 0.5 });
  });
});
