import { randomUUID } from 'node:crypto';

import { SignJWT } from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MemoryLedgerStore } from '../src/infra/memory-store.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const INTERNAL = 'chave-interna-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: INTERNAL });

const tokenFor = (accountId: string, audience = 'scc-api') =>
  new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(accountId)
    .setIssuer('scc-gateway')
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(SECRET));

let app: Awaited<ReturnType<typeof buildApp>>;
beforeEach(async () => {
  app = await buildApp(config, new MemoryLedgerStore());
});

const payShift = (
  accountId: string,
  amount: string,
  key = `turno-${randomUUID()}`,
  token = INTERNAL,
  refId: string = randomUUID(),
) =>
  app.inject({
    method: 'POST',
    url: '/internal/v1/ledger/transactions',
    headers: { 'x-service-token': token, 'idempotency-key': key },
    payload: {
      kind: 'shift_pay',
      ref_type: 'shift',
      ref_id: refId,
      legs: [
        { owner_type: 'pool', owner_id: 'p2e', currency: 'THALER', amount: `-${amount}` },
        { owner_type: 'player', owner_id: accountId, currency: 'THALER', amount },
      ],
    },
  });

const fund = () =>
  app.inject({
    method: 'POST',
    url: '/internal/v1/ledger/transactions',
    headers: { 'x-service-token': INTERNAL, 'idempotency-key': `emissao-${randomUUID()}` },
    payload: {
      kind: 'pool_mint',
      legs: [
        { owner_type: 'system', owner_id: 'mint', currency: 'THALER', amount: '-1000000' },
        { owner_type: 'pool', owner_id: 'p2e', currency: 'THALER', amount: '1000000' },
      ],
    },
  });

describe('API do economy', () => {
  it('lançamento interno exige a chave de serviço e a chave de idempotência', async () => {
    const id = randomUUID();
    expect((await payShift(id, '100', undefined, 'chave-errada')).statusCode).toBe(403);
    const semChave = await app.inject({
      method: 'POST',
      url: '/internal/v1/ledger/transactions',
      headers: { 'x-service-token': INTERNAL },
      payload: {},
    });
    expect(semChave.json().error.code).toBe('missing_idempotency_key');
  });

  it('pool sem saldo não paga; com saldo, paga uma vez por chave', async () => {
    const id = randomUUID();
    expect((await payShift(id, '1185')).json().error.code).toBe('insufficient_funds');
    expect((await fund()).statusCode).toBe(201);
    const key = `turno-${randomUUID()}`;
    const shift = randomUUID();
    const first = await payShift(id, '1185', key, INTERNAL, shift);
    expect(first.statusCode).toBe(201);
    expect(first.json().transaction.legs[1].amount).toBe('1185');
    const again = await payShift(id, '1185', key, INTERNAL, shift);
    expect(again.statusCode).toBe(200);
    expect(again.json().replayed).toBe(true);
    // A mesma chave para outro turno é erro, não repetição.
    expect((await payShift(id, '1185', key)).json().error.code).toBe('idempotency_conflict');
  });

  it('jogador vê o próprio saldo e extrato, com valores em texto', async () => {
    const id = randomUUID();
    await fund();
    await payShift(id, '1185');
    await payShift(id, '815');
    const auth = { authorization: `Bearer ${await tokenFor(id)}` };

    const balances = await app.inject({ method: 'GET', url: '/v1/economy/balances', headers: auth });
    expect(balances.json()).toEqual({ balances: [{ currency: 'THALER', amount: '2000', decimals: 2 }] });

    const ledger = await app.inject({ method: 'GET', url: '/v1/economy/ledger?limit=1', headers: auth });
    expect(ledger.json().entries).toHaveLength(1);
    expect(ledger.json().entries[0]).toMatchObject({ kind: 'shift_pay', amount: '815', currency: 'THALER' });
    expect(ledger.json().next_cursor).not.toBeNull();
  });

  it('sem token, com token do SCC Builder ou com valor fracionado: recusa', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/economy/balances' })).statusCode).toBe(401);
    const builder = { authorization: `Bearer ${await tokenFor(randomUUID(), 'scc-builder')}` };
    expect((await app.inject({ method: 'GET', url: '/v1/economy/balances', headers: builder })).statusCode).toBe(401);
    expect((await payShift(randomUUID(), '11.85')).statusCode).toBe(400);
  });
});
