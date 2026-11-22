import { randomUUID } from 'node:crypto';

import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { LandPayments } from '../src/domain/lots.js';
import { type SaleConfig, type SaleStore, salePhase, ticketState, turnOf } from '../src/domain/sale.js';
import { PostgresSaleStore } from '../src/infra/db/postgres-sale-store.js';
import { PostgresWorldStore } from '../src/infra/db/postgres-store.js';
import { MemorySaleStore } from '../src/infra/memory-sale-store.js';
import { MemoryWorldStore } from '../src/infra/memory-store.js';
import { testCity, testLots, uniqueCode } from './fixtures.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const TOKEN = 'token-interno-de-teste-com-32-caracteres-ou-mais'; // gitleaks:allow (só no teste)
const OPENS = new Date('2026-12-01T15:00:00Z');
const MIN = 60_000;
const at = (minutes: number) => new Date(OPENS.getTime() + minutes * MIN);

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 10 }) : null;
afterAll(async () => {
  await pool?.end();
});

const sale = (city: string, over: Partial<SaleConfig> = {}): SaleConfig => ({
  city,
  opensAt: OPENS,
  endsAt: at(72 * 60),
  preQueueSeconds: 30 * 60,
  batchSize: 2,
  batchSeconds: 60,
  windowSeconds: 600,
  maxLots: 2,
  requireWallet: false,
  ...over,
});

describe('vez na fila', () => {
  const s = sale('x');
  const ticket = (position: number, joinedAt: Date) => ({ id: position, city: 'x', accountId: 'a', joinedAt, preOpen: false, position });

  it('entra de 2 em 2 por minuto a partir da abertura, e quem chega depois da vez entra na hora', () => {
    expect(turnOf(s, ticket(1, at(-20))).admitAt).toEqual(OPENS);
    expect(turnOf(s, ticket(2, at(-20))).admitAt).toEqual(OPENS);
    expect(turnOf(s, ticket(3, at(-20))).admitAt).toEqual(at(1));
    expect(turnOf(s, ticket(7, at(-20))).admitAt).toEqual(at(3));
    // Posição 7 entrou aos 10 minutos: a vez dela (minuto 3) já passou, então entra na hora.
    expect(turnOf(s, ticket(7, at(10))).admitAt).toEqual(at(10));
    expect(turnOf(s, ticket(1, at(-20))).expiresAt).toEqual(at(10));
  });

  it('estados e fases', () => {
    const t = ticket(3, at(-5));
    expect(ticketState(s, t, at(0.5))).toBe('waiting');
    expect(ticketState(s, t, at(1))).toBe('admitted');
    expect(ticketState(s, t, at(11))).toBe('expired');
    expect(salePhase(s, at(-31))).toBe('soon');
    expect(salePhase(s, at(-30))).toBe('queue');
    expect(salePhase(s, at(0))).toBe('launch');
    expect(salePhase(s, at(72 * 60))).toBe('ended');
  });
});

const stores: [string, () => SaleStore, boolean][] = [
  ['memória', () => new MemorySaleStore(), true],
  ['postgres', () => new PostgresSaleStore(pool!), pool !== null],
];

describe.each(stores)('fila do lançamento: %s', (_name, make, enabled) => {
  const setup = async () => {
    const store = make();
    const city = uniqueCode();
    if (pool) await new PostgresWorldStore(pool).importCity(testCity(city), testLots());
    await store.setSale(sale(city));
    return { store, city };
  };
  const valid = () => true;

  it.runIf(enabled)('antes da abertura, posição por sorteio; depois, por chegada atrás dos sorteados', async () => {
    const { store, city } = await setup();
    const early = Array.from({ length: 5 }, () => randomUUID());
    for (const a of early) await store.join(city, a, at(-10), true, valid);
    const positions = await Promise.all(early.map(async (a) => (await store.latestTicket(city, a))!.position));
    expect([...positions].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);
    const late = [randomUUID(), randomUUID()];
    expect((await store.join(city, late[0]!, at(1), false, valid)).position).toBe(6);
    expect((await store.join(city, late[1]!, at(2), false, valid)).position).toBe(7);
    // Entrar de novo com a ficha valendo devolve a mesma.
    const again = await store.join(city, late[0]!, at(3), false, valid);
    expect(again.position).toBe(6);
  });

  it.runIf(enabled)('ficha vencida: entra de novo no fim', async () => {
    const { store, city } = await setup();
    const a = randomUUID();
    const first = await store.join(city, a, at(1), false, valid);
    await store.join(city, randomUUID(), at(2), false, valid);
    const second = await store.join(city, a, at(30), false, () => false);
    expect(second.id).not.toBe(first.id);
    expect(second.position).toBe(3);
    expect((await store.latestTicket(city, a))!.id).toBe(second.id);
  });

  it.runIf(enabled)('dois cliques juntos: uma ficha só', async () => {
    const { store, city } = await setup();
    const a = randomUUID();
    const [x, y] = await Promise.all([
      store.join(city, a, at(1), false, valid),
      store.join(city, a, at(1), false, valid),
    ]);
    expect(x.id).toBe(y.id);
  });

  it.runIf(enabled)('configuração: troca e apaga', async () => {
    const { store, city } = await setup();
    await store.setSale(sale(city, { maxLots: 5 }));
    expect((await store.getSale(city))!.maxLots).toBe(5);
    await store.clearSale(city);
    expect(await store.getSale(city)).toBeNull();
  });
});

const auth = async (accountId: string) => ({
  authorization: `Bearer ${await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(accountId)
    .setIssuer('scc-gateway')
    .setAudience('scc-api')
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET))}`,
});

/** Ledger falso que sempre cobra. */
const payments: LandPayments = { charge: async () => {}, refund: async () => {} };

describe('venda de lançamento (API)', () => {
  let clock = at(-60);
  let world: Awaited<ReturnType<typeof buildApp>>;
  const withWallet = randomUUID();

  beforeEach(async () => {
    clock = at(-60);
    const lots = new MemoryWorldStore();
    await lots.importCity(testCity('teste'), testLots());
    world = await buildApp(
      loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: TOKEN }),
      lots,
      () => clock,
      payments,
      {
        wallets: { walletsOf: async (id: string) => (id === withWallet ? ['0x90f79bf6eb2c4f870365e785982e1f101e93b906'] : []) },
        signer: { address: '0x0000000000000000000000000000000000000001', sign: async () => '0x' },
        contract: '0x0000000000000000000000000000000000000002',
        chainId: 31337,
      },
      null,
      null,
      null,
      undefined,
      null,
      null,
      new MemorySaleStore(),
    );
  });

  const schedule = async (body: Record<string, unknown> = {}, token = TOKEN) =>
    world.inject({
      method: 'PUT',
      url: '/internal/v1/cities/teste/sale',
      headers: { 'x-service-token': token },
      payload: { opens_at: OPENS.toISOString(), ends_at: at(72 * 60).toISOString(), batch_size: 1, batch_seconds: 60, max_lots: 2, require_wallet: false, ...body },
    });
  const join = async (who: string) => world.inject({ method: 'POST', url: '/v1/world/cities/teste/sale/queue', headers: await auth(who) });
  const buy = async (who: string, lot: number) =>
    world.inject({ method: 'POST', url: `/v1/world/cities/teste/lots/${lot}/buy`, headers: await auth(who) });
  const view = async (who: string) => (await world.inject({ method: 'GET', url: '/v1/world/cities/teste/sale', headers: await auth(who) })).json();

  it('sem lançamento agendado, a compra é direta e a fila recusa', async () => {
    expect((await view(randomUUID())).sale).toBeNull();
    expect((await join(randomUUID())).json().error.code).toBe('no_sale');
    clock = at(0);
    expect((await buy(randomUUID(), 0)).statusCode).toBe(201);
  });

  it('só a operação agenda, e com dados coerentes', async () => {
    expect((await schedule({}, 'outro-token')).statusCode).toBe(403);
    expect((await schedule({ ends_at: at(-1).toISOString() })).json().error.code).toBe('invalid_request');
    const ok = await schedule();
    expect(ok.statusCode).toBe(200);
    expect(ok.json().sale).toMatchObject({ phase: 'soon', max_lots: 2, queue_opens_at: at(-30).toISOString() });
  });

  it('fila, vez, limite por carteira e venda livre depois do lançamento', async () => {
    await schedule();
    const [a, b] = [randomUUID(), randomUUID()];
    expect((await join(a)).json().error.code).toBe('queue_not_open');

    clock = at(-10);
    expect((await buy(a, 0)).json().error.code).toBe('sale_not_open');
    const ja = await join(a);
    expect(ja.statusCode).toBe(201);
    expect(ja.json().me.ticket).toMatchObject({ state: 'waiting', provisional: true });
    await join(b);

    // Na abertura, 1 por minuto: um dos dois entra já, o outro no minuto seguinte.
    clock = at(0);
    const first = (await view(a)).me.ticket.position === 1 ? a : b;
    const second = first === a ? b : a;
    expect((await view(first)).me.ticket).toMatchObject({ state: 'admitted', provisional: false });
    expect((await buy(second, 1)).json().error.code).toBe('queue_waiting');
    expect((await buy(randomUUID(), 1)).json().error.code).toBe('queue_required');

    expect((await buy(first, 0)).statusCode).toBe(201);
    expect((await buy(first, 1)).statusCode).toBe(201);
    expect((await buy(first, 2)).json().error.code).toBe('sale_limit');
    expect((await view(first)).me.bought).toBe(2);

    clock = at(1);
    expect((await buy(second, 3)).statusCode).toBe(201);

    // A vez passa depois de 10 minutos: entra de novo no fim.
    clock = at(12);
    expect((await buy(second, 4)).json().error.code).toBe('queue_expired');
    expect((await join(second)).json().me.ticket).toMatchObject({ state: 'admitted', position: 3 });
    expect((await buy(second, 4)).statusCode).toBe(201);

    // Fim do lançamento: sem fila e sem o limite.
    clock = at(72 * 60);
    expect((await join(first)).json().error.code).toBe('sale_ended');
    expect((await buy(first, 5)).statusCode).toBe(201);
  });

  it('com carteira obrigatória, só quem tem carteira ligada entra na fila', async () => {
    await schedule({ require_wallet: true });
    clock = at(-5);
    expect((await join(randomUUID())).json().error.code).toBe('wallet_required');
    expect((await join(withWallet)).statusCode).toBe(201);
  });
});
