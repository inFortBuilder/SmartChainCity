import { randomUUID } from 'node:crypto';

import { buildApp as buildEconomy } from '@scc/economy/src/app.js';
import { loadConfig as economyConfig } from '@scc/economy/src/config.js';
import { MemoryLedgerStore } from '@scc/economy/src/infra/memory-store.js';
import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { LedgerLandPayments } from '../src/infra/ledger-payments.js';
import { MemoryWorldStore } from '../src/infra/memory-store.js';
import { testCity, testLots } from './fixtures.js';

/** Ponta a ponta: a compra cobra SCITY no economy de verdade (em memória, porta local). */
const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const LEDGER_TOKEN = 'chave-interna-do-economy-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)

let economy: Awaited<ReturnType<typeof buildEconomy>>;
let world: Awaited<ReturnType<typeof buildApp>>;

beforeEach(async () => {
  economy = await buildEconomy(
    economyConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: LEDGER_TOKEN }),
    new MemoryLedgerStore(),
  );
  const ledgerUrl = await economy.listen({ port: 0, host: '127.0.0.1' });
  const store = new MemoryWorldStore();
  await store.importCity(testCity('teste'), testLots());
  world = await buildApp(
    loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET }),
    store,
    undefined,
    new LedgerLandPayments(ledgerUrl, LEDGER_TOKEN),
  );
});
afterEach(async () => {
  await economy.close();
});

const auth = async (accountId: string) => ({
  authorization: `Bearer ${await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(accountId)
    .setIssuer('scc-gateway')
    .setAudience('scc-api')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(SECRET))}`,
});

/** Depósito simulado: SCITY da ponte para o jogador (no jogo, vem da blockchain). */
const deposit = (accountId: string, scity: bigint) =>
  economy.inject({
    method: 'POST',
    url: '/internal/v1/ledger/transactions',
    headers: { 'x-service-token': LEDGER_TOKEN, 'idempotency-key': `deposito-${randomUUID()}` },
    payload: {
      kind: 'chain_deposit',
      legs: [
        { owner_type: 'system', owner_id: 'bridge', currency: 'SCITY', amount: `-${scity * 10n ** 18n}` },
        { owner_type: 'player', owner_id: accountId, currency: 'SCITY', amount: `${scity * 10n ** 18n}` },
      ],
    },
  });

const scityOf = async (headers: Record<string, string>) =>
  (await economy.inject({ method: 'GET', url: '/v1/economy/balances', headers })).json().balances.find(
    (b: { currency: string }) => b.currency === 'SCITY',
  )?.amount ?? '0';

describe('venda de lotes de ponta a ponta', () => {
  it('lista o bairro, compra pagando SCITY no ledger e o lote aparece como seu', async () => {
    const me = randomUUID();
    const headers = await auth(me);
    await deposit(me, 1000n);

    const city = (await world.inject({ method: 'GET', url: '/v1/world/cities/teste' })).json();
    expect(city.districts[0]).toMatchObject({ open: true, lots: 10, for_sale: 9, sold: 0 });

    const lot = (await world.inject({ method: 'GET', url: '/v1/world/cities/teste/lots/4' })).json().lot;
    expect(lot).toMatchObject({ code: 'TES-000005', status: 'vacant', price_usd: 156, price_scity: '156' });

    const bought = await world.inject({ method: 'POST', url: '/v1/world/cities/teste/lots/4/buy', headers });
    expect(bought.statusCode).toBe(201);
    expect(bought.json().lot).toMatchObject({ status: 'sold', mine: true });
    expect(await scityOf(headers)).toBe(`${844n * 10n ** 18n}`);

    const mine = (await world.inject({ method: 'GET', url: '/v1/world/me/lots', headers })).json().lots;
    expect(mine.map((l: { id: number }) => l.id)).toEqual([4]);
    const listed = (await world.inject({ method: 'GET', url: '/v1/world/cities/teste/districts/0/lots' })).json().lots;
    expect(listed.find((l: { id: number }) => l.id === 4)).toMatchObject({ status: 'sold', mine: false });
  });

  it('sem SCITY: 409 insufficient_scity, nada cobrado e o lote segue à venda', async () => {
    const headers = await auth(randomUUID());
    const r = await world.inject({ method: 'POST', url: '/v1/world/cities/teste/lots/5/buy', headers });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('insufficient_scity');
    expect((await world.inject({ method: 'GET', url: '/v1/world/cities/teste/lots/5' })).json().lot.status).toBe('vacant');
  });

  it('comprar exige login; lote da Prefeitura não vende', async () => {
    expect((await world.inject({ method: 'POST', url: '/v1/world/cities/teste/lots/4/buy' })).statusCode).toBe(401);
    const me = randomUUID();
    await deposit(me, 1000n);
    const civic = await world.inject({ method: 'POST', url: '/v1/world/cities/teste/lots/9/buy', headers: await auth(me) });
    expect(civic.json().error.code).toBe('lot_not_for_sale');
  });
});
