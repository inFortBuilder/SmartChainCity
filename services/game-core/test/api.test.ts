import { randomUUID } from 'node:crypto';

import { SignJWT } from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const INTERNAL = 'chave-interna-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: INTERNAL });

const HOUR = 3_600_000;
let clock = new Date('2026-11-12T12:00:00Z');
let app: Awaited<ReturnType<typeof buildApp>>;
beforeEach(async () => {
  clock = new Date('2026-11-12T12:00:00Z');
  app = await buildApp(config, new MemoryAvatarStore(), () => clock);
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

const create = (accountId: string, rarity = 'common', jobCode = 'padeiro', token = INTERNAL) =>
  app.inject({
    method: 'POST',
    url: '/internal/v1/avatars',
    headers: { 'x-service-token': token },
    payload: { account_id: accountId, rarity, job_code: jobCode },
  });

describe('API do game-core', () => {
  it('cria avatar só pela rota interna, com profissão da raridade', async () => {
    const account = randomUUID();
    expect((await create(account, 'common', 'padeiro', 'chave-errada')).statusCode).toBe(403);
    expect((await create(account, 'common', 'medico')).json().error.code).toBe('invalid_job');
    const ok = await create(account);
    expect(ok.statusCode).toBe(201);
    expect(ok.json().avatar.job).toEqual({ code: 'padeiro', label: 'Padeiro' });
  });

  it('o jogador vê os próprios avatares com a queda até agora', async () => {
    const account = randomUUID();
    await create(account);
    clock = new Date(clock.getTime() + 24 * HOUR);
    const list = await app.inject({ method: 'GET', url: '/v1/avatars', headers: await auth(account) });
    const [avatar] = list.json().avatars;
    expect(avatar.attributes.food).toBe(5);
    expect(avatar.attributes.happiness).toBe(8);
    expect(avatar.status).toEqual({ earnsReward: true, canWork: true, canLeisure: true });
  });

  it('avatar de outra conta é 404, e sem token é 401', async () => {
    const owner = randomUUID();
    const id = (await create(owner)).json().avatar.id;
    const other = await app.inject({ method: 'GET', url: `/v1/avatars/${id}`, headers: await auth(randomUUID()) });
    expect(other.statusCode).toBe(404);
    const mine = await app.inject({ method: 'GET', url: `/v1/avatars/${id}`, headers: await auth(owner) });
    expect(mine.json().avatar.id).toBe(id);
    expect((await app.inject({ method: 'GET', url: '/v1/avatars' })).statusCode).toBe(401);
  });

  it('a quarta criação para a mesma conta é recusada', async () => {
    const account = randomUUID();
    for (let k = 0; k < 3; k++) expect((await create(account)).statusCode).toBe(201);
    expect((await create(account)).json().error.code).toBe('avatar_limit');
  });
});
