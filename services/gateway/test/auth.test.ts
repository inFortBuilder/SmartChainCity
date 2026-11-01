import { SignJWT } from 'jose';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MemoryAuthStore } from '../src/infra/memory-store.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres';
const config = loadConfig({
  NODE_ENV: 'test',
  JWT_SECRET: SECRET,
  SIWE_DOMAINS: 'localhost:5173',
  SIWE_CHAIN_IDS: '97',
  AUTH_RATE_LIMIT_PER_MINUTE: '1000',
  RATE_LIMIT_PER_MINUTE: '1000',
});

let store: MemoryAuthStore;
let clock: Date;
let app: Awaited<ReturnType<typeof buildApp>>;
const wallet = privateKeyToAccount(generatePrivateKey());

beforeEach(async () => {
  store = new MemoryAuthStore();
  clock = new Date();
  app = await buildApp(config, store, () => clock);
});

const getNonce = async () =>
  (await app.inject({ method: 'POST', url: '/v1/auth/siwe/nonce' })).json().nonce as string;

const sign = async (overrides: Record<string, unknown> = {}, signer = wallet) => {
  const message = createSiweMessage({
    address: signer.address,
    chainId: 97,
    domain: 'localhost:5173',
    nonce: await getNonce(),
    uri: 'http://localhost:5173',
    version: '1',
    issuedAt: clock,
    ...overrides,
  });
  return { message, signature: await signer.signMessage({ message }) };
};

const verify = (payload: object) =>
  app.inject({ method: 'POST', url: '/v1/auth/siwe/verify', payload });

const me = (token?: string) =>
  app.inject({
    method: 'GET',
    url: '/v1/me',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

const code = (response: { json: () => { error: { code: string } } }) => response.json().error.code;

describe('login SIWE', () => {
  it('cria a conta e devolve um JWT que abre o /v1/me', async () => {
    const response = await verify(await sign());
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.token_type).toBe('Bearer');

    const profile = await me(body.access_token);
    expect(profile.statusCode).toBe(200);
    expect(profile.json().account.id).toBe(body.account.id);
    expect(profile.json().wallets[0].address).toBe(wallet.address);
    expect(profile.json().wallets[0].chain_id).toBe(97);
  });

  it('a mesma carteira volta para a mesma conta', async () => {
    const first = (await verify(await sign())).json();
    const second = (await verify(await sign())).json();
    expect(second.account.id).toBe(first.account.id);
  });

  it('carteiras diferentes são contas diferentes', async () => {
    const other = privateKeyToAccount(generatePrivateKey());
    const first = (await verify(await sign())).json();
    const second = (await verify(await sign({}, other))).json();
    expect(second.account.id).not.toBe(first.account.id);
  });

  it('nonce só vale uma vez', async () => {
    const signed = await sign();
    expect((await verify(signed)).statusCode).toBe(200);
    const replay = await verify(signed);
    expect(replay.statusCode).toBe(401);
    expect(code(replay)).toBe('invalid_nonce');
  });

  it('assinatura errada queima o nonce', async () => {
    const signed = await sign();
    const other = privateKeyToAccount(generatePrivateKey());
    const forged = await other.signMessage({ message: signed.message });
    const response = await verify({ message: signed.message, signature: forged });
    expect(code(response)).toBe('invalid_signature');
    expect(code(await verify(signed))).toBe('invalid_nonce');
  });

  it('recusa nonce inventado e nonce vencido', async () => {
    expect(code(await verify(await sign({ nonce: 'inventado12345' })))).toBe('invalid_nonce');
    const signed = await sign();
    clock = new Date(clock.getTime() + 301_000);
    expect(code(await verify(signed))).toBe('invalid_nonce');
  });

  it('recusa domínio que não é o do jogo: proteção contra phishing', async () => {
    const response = await verify(await sign({ domain: 'site-falso.example' }));
    expect(response.statusCode).toBe(401);
    expect(code(response)).toBe('invalid_siwe_domain');
  });

  it('recusa rede não aceita e mensagem expirada', async () => {
    expect(code(await verify(await sign({ chainId: 1 })))).toBe('invalid_siwe_chain');
    const expired = await sign({ expirationTime: new Date(clock.getTime() - 1000) });
    expect(code(await verify(expired))).toBe('invalid_siwe_message');
  });

  it('corpo malformado é 400, não 500', async () => {
    expect((await verify({ message: 'x' })).statusCode).toBe(400);
    expect((await verify({ message: 'x', signature: 'nao-hex' })).statusCode).toBe(400);
    expect((await verify({ message: 'não é siwe', signature: '0xabcd' })).statusCode).toBe(400);
  });

  it('conta bloqueada não entra nem usa token antigo', async () => {
    const { account, access_token: token } = (await verify(await sign())).json();
    store.setStatus(account.id, 'banned');
    expect((await me(token)).statusCode).toBe(403);
    const response = await verify(await sign());
    expect(response.statusCode).toBe(403);
    expect(code(response)).toBe('account_blocked');
  });
});

describe('JWT', () => {
  const craft = (secret: string, alg = 'HS256', issuer = 'scc-gateway', aud = 'scc-api') =>
    new SignJWT({})
      .setProtectedHeader({ alg })
      .setSubject('conta')
      .setIssuer(issuer)
      .setAudience(aud)
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(secret.padEnd(64, 'x')));

  it('sem token é 401', async () => {
    const response = await me();
    expect(response.statusCode).toBe(401);
    expect(code(response)).toBe('missing_credentials');
  });

  it('recusa segredo, algoritmo, emissor e público errados', async () => {
    expect(code(await me(await craft('outro')))).toBe('invalid_token');
    expect(code(await me(await craft(SECRET, 'HS512')))).toBe('invalid_token');
    const raw = new TextEncoder().encode(SECRET);
    const sign2 = (b: SignJWT) => b.setSubject('c').setExpirationTime('1h').sign(raw);
    const wrongIss = await sign2(
      new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setIssuer('x').setAudience('scc-api'),
    );
    const wrongAud = await sign2(
      new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer('scc-gateway')
        .setAudience('outro'),
    );
    expect(code(await me(wrongIss))).toBe('invalid_token');
    expect(code(await me(wrongAud))).toBe('invalid_token');
  });

  it('token vencido é token_expired', async () => {
    const { access_token: token } = (await verify(await sign())).json();
    const later = await buildApp(config, store, () => clock);
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    const raw = new TextEncoder().encode(SECRET);
    const old = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuer(claims.iss)
      .setAudience(claims.aud)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(raw);
    const response = await later.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${old}` },
    });
    expect(code(response)).toBe('token_expired');
  });

  it('emite o formato que o SCC Builder valida', async () => {
    const { access_token: token, account } = (await verify(await sign())).json();
    const [header, payload] = token.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString()).alg).toBe('HS256');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    expect(claims.sub).toBe(account.id);
    expect(claims.aud).toContain('scc-builder');
    expect(claims.exp).toBeGreaterThan(claims.iat);
  });
});

describe('borda', () => {
  it('healthz responde sem credencial', async () => {
    expect((await app.inject({ method: 'GET', url: '/healthz' })).json()).toEqual({ status: 'ok' });
  });

  it('o limite de tentativas de login vira 429', async () => {
    const limited = await buildApp(
      { ...config, AUTH_RATE_LIMIT_PER_MINUTE: 2 },
      new MemoryAuthStore(),
    );
    const call = () => limited.inject({ method: 'POST', url: '/v1/auth/siwe/nonce' });
    await call();
    await call();
    const response = await call();
    expect(response.statusCode).toBe(429);
    expect(code(response)).toBe('rate_limited');
  });

  it('segredo curto impede a subida', () => {
    expect(() => loadConfig({ JWT_SECRET: 'curto', SIWE_DOMAINS: 'x' })).toThrow();
  });
});
