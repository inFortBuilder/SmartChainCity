import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { KycStore } from '../src/domain/kyc.js';
import type { AuthStore } from '../src/domain/ports.js';
import { PostgresAuthStore } from '../src/infra/db/postgres-store.js';
import { MemoryAuthStore } from '../src/infra/memory-store.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const INTERNAL = 'chave-interna-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const config = loadConfig({
  NODE_ENV: 'test',
  JWT_SECRET: SECRET,
  SIWE_DOMAINS: 'localhost:5173',
  SIWE_CHAIN_IDS: '97',
  AUTH_RATE_LIMIT_PER_MINUTE: '1000',
  RATE_LIMIT_PER_MINUTE: '1000',
  INTERNAL_TOKEN: INTERNAL,
});

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 5 }) : null;
afterAll(async () => {
  await pool?.end();
});

describe.each([
  ['memória', () => new MemoryAuthStore() as AuthStore & KycStore, true],
  ['postgres', () => new PostgresAuthStore(pool!) as AuthStore & KycStore, pool !== null],
] as const)('KYC (%s)', (_name, make, enabled) => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let clock: Date;

  beforeEach(async () => {
    if (!enabled) return;
    clock = new Date();
    app = await buildApp(config, make(), () => clock);
  });

  const login = async () => {
    const wallet = privateKeyToAccount(generatePrivateKey());
    const { nonce } = (await app.inject({ method: 'POST', url: '/v1/auth/siwe/nonce' })).json();
    const message = createSiweMessage({ address: wallet.address, chainId: 97, domain: 'localhost:5173', nonce, uri: 'http://localhost:5173', version: '1', issuedAt: clock });
    const r = (await app.inject({ method: 'POST', url: '/v1/auth/siwe/verify', payload: { message, signature: await wallet.signMessage({ message }) } })).json();
    return { token: r.access_token as string, id: r.account.id as string };
  };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const service = { 'x-service-token': INTERNAL };
  const decide = (id: string, decision: 'approve' | 'reject', note?: string) =>
    app.inject({ method: 'POST', url: `/internal/v1/kyc/${id}`, headers: service, payload: { decision, note } });
  const levelSeenByEconomy = async (accountId: string) =>
    (await app.inject({ method: 'GET', url: `/internal/v1/accounts/${accountId}/wallets`, headers: service })).json().kyc_level;

  it.skipIf(!enabled)('pedido pendente, um só por conta; aprovado, a conta sobe para o nível 1 e o economy vê', async () => {
    const me = await login();
    expect((await app.inject({ method: 'GET', url: '/v1/me/kyc', headers: bearer(me.token) })).json()).toEqual({ level: 0, request: null });
    const first = await app.inject({ method: 'POST', url: '/v1/me/kyc', headers: bearer(me.token) });
    expect(first.statusCode).toBe(202);
    const again = await app.inject({ method: 'POST', url: '/v1/me/kyc', headers: bearer(me.token) });
    expect(again.json().request.id).toBe(first.json().request.id);

    const queue = (await app.inject({ method: 'GET', url: '/internal/v1/kyc?limit=500', headers: service })).json().requests;
    expect(queue.find((r: { id: string }) => r.id === first.json().request.id)).toMatchObject({ status: 'pending', account_id: me.id, provider: 'manual' });

    expect((await decide(first.json().request.id, 'approve')).json().request.status).toBe('approved');
    expect(await levelSeenByEconomy(me.id)).toBe(1);
    const status = (await app.inject({ method: 'GET', url: '/v1/me/kyc', headers: bearer(me.token) })).json();
    expect(status).toMatchObject({ level: 1, request: { status: 'approved' } });
    // Decidido não muda mais; verificado não pede de novo.
    expect((await decide(first.json().request.id, 'reject')).json().error.code).toBe('not_pending');
    expect((await app.inject({ method: 'POST', url: '/v1/me/kyc', headers: bearer(me.token) })).json().error.code).toBe('already_verified');
  });

  it.skipIf(!enabled)('recusado, o nível fica em 0 e o jogador pode pedir de novo', async () => {
    const me = await login();
    const r = (await app.inject({ method: 'POST', url: '/v1/me/kyc', headers: bearer(me.token) })).json().request;
    expect((await decide(r.id, 'reject', 'documento ilegível')).json().request).toMatchObject({ status: 'rejected', note: 'documento ilegível' });
    expect(await levelSeenByEconomy(me.id)).toBe(0);
    const again = await app.inject({ method: 'POST', url: '/v1/me/kyc', headers: bearer(me.token) });
    expect(again.statusCode).toBe(202);
    expect(again.json().request.id).not.toBe(r.id);
  });

  it.skipIf(!enabled)('rotas da revisão só com o token de serviço; pedido inexistente, 409', async () => {
    expect((await app.inject({ method: 'GET', url: '/internal/v1/kyc' })).statusCode).toBe(403);
    expect((await decide(randomUUID(), 'approve')).json().error.code).toBe('not_pending');
    expect((await app.inject({ method: 'POST', url: '/v1/me/kyc' })).statusCode).toBe(401);
  });
});
