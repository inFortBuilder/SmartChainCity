import { randomUUID } from 'node:crypto';

import { buildApp as buildEconomy } from '@scc/economy/src/app.js';
import { loadConfig as economyConfig } from '@scc/economy/src/config.js';
import { MemoryLedgerStore } from '@scc/economy/src/infra/memory-store.js';
import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { EconomyPayer } from '../src/infra/economy-payer.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';

/**
 * Ponta a ponta: o game-core paga o turno no ledger do economy de verdade (em
 * memória, ouvindo numa porta local), pelo mesmo cliente HTTP da produção.
 */
const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const GAME_TOKEN = 'chave-interna-do-game-core-com-32-caracteres'; // gitleaks:allow (só no teste)
const LEDGER_TOKEN = 'chave-interna-do-economy-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)

const HOUR = 3_600_000;
let clock: Date;
let economy: Awaited<ReturnType<typeof buildEconomy>>;
let game: Awaited<ReturnType<typeof buildApp>>;
let ledgerUrl: string;

beforeEach(async () => {
  clock = new Date('2026-11-12T08:00:00Z');
  economy = await buildEconomy(
    economyConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: LEDGER_TOKEN }),
    new MemoryLedgerStore(),
  );
  ledgerUrl = await economy.listen({ port: 0, host: '127.0.0.1' });
  game = await buildApp(
    loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: GAME_TOKEN }),
    new MemoryAvatarStore(),
    () => clock,
    new EconomyPayer(ledgerUrl, LEDGER_TOKEN),
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

const fundPool = (cents: string) =>
  economy.inject({
    method: 'POST',
    url: '/internal/v1/ledger/transactions',
    headers: { 'x-service-token': LEDGER_TOKEN, 'idempotency-key': `emissao-${randomUUID()}` },
    payload: {
      kind: 'pool_mint',
      legs: [
        { owner_type: 'system', owner_id: 'mint', currency: 'THALER', amount: `-${cents}` },
        { owner_type: 'pool', owner_id: 'p2e', currency: 'THALER', amount: cents },
      ],
    },
  });

const newPlayer = async () => {
  const accountId = randomUUID();
  const created = await game.inject({
    method: 'POST',
    url: '/internal/v1/avatars',
    headers: { 'x-service-token': GAME_TOKEN },
    payload: { account_id: accountId, rarity: 'common', job_code: 'padeiro' },
  });
  return { accountId, avatarId: created.json().avatar.id as string, headers: await auth(accountId) };
};

const balance = async (headers: Record<string, string>) =>
  (await economy.inject({ method: 'GET', url: '/v1/economy/balances', headers })).json().balances[0]?.amount ?? '0';

describe('turno de ponta a ponta', () => {
  it('trabalha 6 h com o cliente fechado, conclui sozinho e a coleta paga uma vez no ledger', async () => {
    await fundPool('10000000');
    const p = await newPlayer();
    const started = await game.inject({ method: 'POST', url: `/v1/avatars/${p.avatarId}/work`, headers: p.headers, payload: { shift: 6 } });
    expect(started.statusCode).toBe(201);
    expect(started.json().shift.seed).toBeNull();

    clock = new Date(clock.getTime() + 6 * HOUR);
    const shifts = (await game.inject({ method: 'GET', url: `/v1/avatars/${p.avatarId}/shifts`, headers: p.headers })).json().shifts;
    expect(shifts[0].status).toBe('done');
    expect(shifts[0].seed).toMatch(/^[0-9a-f]{64}$/);

    const claim = await game.inject({ method: 'POST', url: `/v1/avatars/${p.avatarId}/claim`, headers: p.headers });
    expect(claim.json().thaler).toBe(shifts[0].result.thaler);
    expect(await balance(p.headers)).toBe(shifts[0].result.thaler);

    const again = await game.inject({ method: 'POST', url: `/v1/avatars/${p.avatarId}/claim`, headers: p.headers });
    expect(again.json().claimed).toEqual([]);
    expect(await balance(p.headers)).toBe(shifts[0].result.thaler);
  });

  it('pagar o mesmo turno duas vezes (resposta perdida e repetida) não paga em dobro', async () => {
    await fundPool('10000000');
    const p = await newPlayer();
    await game.inject({ method: 'POST', url: `/v1/avatars/${p.avatarId}/work`, headers: p.headers, payload: { shift: 6 } });
    clock = new Date(clock.getTime() + 6 * HOUR);
    const [shift] = (await game.inject({ method: 'GET', url: `/v1/avatars/${p.avatarId}/shifts`, headers: p.headers })).json().shifts;
    const payer = new EconomyPayer(ledgerUrl, LEDGER_TOKEN);
    const full = { id: shift.id, accountId: p.accountId } as Parameters<EconomyPayer['payShift']>[0];
    await payer.payShift(full, BigInt(shift.result.thaler));
    await payer.payShift(full, BigInt(shift.result.thaler));
    expect(await balance(p.headers)).toBe(shift.result.thaler);
  });

  it('pool vazio: a coleta falha com pool_empty e o turno continua para coletar depois', async () => {
    const p = await newPlayer();
    await game.inject({ method: 'POST', url: `/v1/avatars/${p.avatarId}/work`, headers: p.headers, payload: { shift: 6 } });
    clock = new Date(clock.getTime() + 6 * HOUR);
    const failed = await game.inject({ method: 'POST', url: `/v1/avatars/${p.avatarId}/claim`, headers: p.headers });
    expect(failed.statusCode).toBe(503);
    expect(failed.json().error.code).toBe('pool_empty');
    await fundPool('10000000');
    const ok = await game.inject({ method: 'POST', url: `/v1/avatars/${p.avatarId}/claim`, headers: p.headers });
    expect(ok.json().claimed).toHaveLength(1);
  });
});
