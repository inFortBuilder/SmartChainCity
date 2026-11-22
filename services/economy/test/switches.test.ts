import { randomUUID } from 'node:crypto';

import { SignJWT } from 'jose';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { rateFromUsd } from '../src/domain/exchange.js';
import type { LedgerStore } from '../src/domain/ledger.js';
import type { SwitchStore } from '../src/domain/switches.js';
import { MemoryExchangeStore } from '../src/infra/memory-exchange-store.js';
import { MemoryLedgerStore } from '../src/infra/memory-store.js';
import { MemoryWithdrawalStore } from '../src/infra/memory-withdrawal-store.js';
import { MemorySwitchStore, PostgresSwitchStore } from '../src/infra/switch-stores.js';
import { LocalKeyVoucherSigner } from '../src/infra/vault-chain.js';
import { pool } from './stores.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const INTERNAL = 'chave-interna-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const T0 = new Date('2026-11-22T12:00:00Z');
const WEI = 10n ** 18n;
const VAULT = '0x68B1D87F95878fE05B998F19b66F4baba5De1aed';
const wallet = privateKeyToAccount(generatePrivateKey()).address;

afterAll(async () => {
  await pool?.end();
});

describe.each([
  ['memória', () => new MemorySwitchStore() as SwitchStore, true],
  ['postgres', () => new PostgresSwitchStore(pool!) as SwitchStore, pool !== null],
] as const)('store das travas (%s)', (_n, make, enabled) => {
  it.runIf(enabled)('liga, troca o motivo e desliga, uma linha por trava', async () => {
    const s = make();
    // O Postgres é compartilhado entre os testes: zera antes.
    await s.set({ name: 'exchange', frozen: false, reason: null, by: 'teste', since: T0 });
    await s.set({ name: 'exchange', frozen: true, reason: 'manutenção', by: 'ana', since: T0 });
    await s.set({ name: 'exchange', frozen: true, reason: 'investigação', by: 'bia', since: T0 });
    const x = (await s.all()).filter((r) => r.name === 'exchange');
    expect(x).toHaveLength(1);
    expect(x[0]).toMatchObject({ frozen: true, reason: 'investigação', by: 'bia' });
    await s.set({ name: 'exchange', frozen: false, reason: null, by: 'bia', since: T0 });
    expect((await s.all()).find((r) => r.name === 'exchange')!.frozen).toBe(false);
  });
});

/** Credita SCITY na conta, como o depósito do cofre. */
const credit = (ledger: LedgerStore, accountId: string, wei: bigint) =>
  ledger.post(
    {
      kind: 'scity_deposit',
      idempotencyKey: `deposito-${randomUUID()}`,
      legs: [
        { account: { ownerType: 'system', ownerId: 'vault', currency: 'SCITY' }, amount: -wei },
        { account: { ownerType: 'player', ownerId: accountId, currency: 'SCITY' }, amount: wei },
      ],
    },
    T0,
  );

describe('travas de incidente (API)', () => {
  it('a operação trava saque e câmbio sem deploy; o jogador vê o aviso e o saldo não mexe', async () => {
    const ledger = new MemoryLedgerStore();
    const exchange = new MemoryExchangeStore();
    await exchange.setRate(rateFromUsd(1, new Date(T0.getTime() - 1000), 'teste'));
    const app = await buildApp(
      loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: INTERNAL }),
      ledger,
      () => T0,
      {
        store: new MemoryWithdrawalStore(),
        signer: new LocalKeyVoucherSigner(generatePrivateKey(), 31337, VAULT),
        accounts: { account: async () => ({ wallets: [wallet], createdAt: new Date('2026-10-01T00:00:00Z'), kycLevel: 0 }) },
        vault: { contract: VAULT, chainId: 31337 },
      },
      { store: exchange, earnings: ledger, poolStart: null, freeUntil: null },
      new MemorySwitchStore(),
    );
    const me = randomUUID();
    await credit(ledger, me, 50n * WEI);
    const headers = {
      authorization: `Bearer ${await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(me)
        .setIssuer('scc-gateway')
        .setAudience('scc-api')
        .setExpirationTime('5m')
        .sign(new TextEncoder().encode(SECRET))}`,
    };
    const scity = async () => (await ledger.balances('player', me)).find((b) => b.currency === 'SCITY')?.amount ?? 0n;
    const sw = (name: string, payload: Record<string, unknown>, token: string | null = INTERNAL) =>
      app.inject({ method: 'PUT', url: `/internal/v1/economy/switches/${name}`, headers: token ? { 'x-service-token': token } : {}, payload });
    const withdraw = () =>
      app.inject({ method: 'POST', url: '/v1/economy/withdrawals', headers, payload: { wallet, amount_wei: (10n * WEI).toString() } });
    const convert = (key: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/economy/exchange',
        headers: { ...headers, 'idempotency-key': key },
        payload: { direction: 'scity_to_thaler', amount: (1n * WEI).toString() },
      });

    // Tudo aberto no começo.
    expect((await app.inject({ url: '/v1/economy/status' })).json()).toEqual({
      switches: { withdrawals: { frozen: false, reason: null, since: null }, exchange: { frozen: false, reason: null, since: null } },
    });

    // Só a operação mexe, só nas travas que existem, e com quem mexeu.
    expect((await sw('withdrawals', { frozen: true, by: 'x' }, null)).statusCode).toBe(403);
    expect((await sw('deposits', { frozen: true, by: 'ops' })).json().error.code).toBe('unknown_switch');
    expect((await sw('withdrawals', { frozen: true })).statusCode).toBe(400);

    const on = await sw('withdrawals', { frozen: true, reason: 'verificação de segurança', by: 'runbook-signer' });
    expect(on.json().switches.withdrawals).toEqual({ frozen: true, reason: 'verificação de segurança', since: T0.toISOString() });
    const blocked = await withdraw();
    expect(blocked.statusCode).toBe(503);
    expect(blocked.json().error).toMatchObject({ code: 'withdrawals_frozen' });
    expect(blocked.json().error.message).toMatch(/verificação de segurança.*saldo está seguro/);
    expect(await scity()).toBe(50n * WEI);
    // O câmbio segue aberto.
    expect((await convert('troca-0001')).statusCode).toBe(201);

    await sw('exchange', { frozen: true, by: 'ops' });
    expect((await convert('troca-0002')).json().error.code).toBe('exchange_frozen');
    expect((await app.inject({ url: '/v1/economy/status' })).json().switches.exchange.frozen).toBe(true);

    // Destravou: volta ao normal, e o motivo some.
    await sw('withdrawals', { frozen: false, reason: 'ignorado', by: 'runbook-signer' });
    expect((await app.inject({ url: '/v1/economy/status' })).json().switches.withdrawals).toMatchObject({ frozen: false, reason: null });
    expect((await withdraw()).statusCode).toBe(201);

    // A métrica para o alerta.
    const metrics = (await app.inject({ url: '/metrics' })).body;
    expect(metrics).toMatch(/economy_incident_switch\{[^}]*switch="exchange"[^}]*\} 1/);
    expect(metrics).toMatch(/economy_incident_switch\{[^}]*switch="withdrawals"[^}]*\} 0/);
  });
});
