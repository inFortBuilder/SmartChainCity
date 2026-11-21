import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { type CaptchaChallenge, solveCaptcha } from '../src/domain/captcha.js';
import { MemoryAuthStore } from '../src/infra/memory-store.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const env = {
  NODE_ENV: 'test',
  JWT_SECRET: SECRET,
  SIWE_DOMAINS: 'localhost:5173',
  SIWE_CHAIN_IDS: '97',
  AUTH_RATE_LIMIT_PER_MINUTE: '1000',
  RATE_LIMIT_PER_MINUTE: '1000',
  CAPTCHA: 'pow',
  CAPTCHA_MAX_NUMBER: '2000',
};

let clock: Date;
let app: Awaited<ReturnType<typeof buildApp>>;
beforeEach(async () => {
  clock = new Date();
  app = await buildApp(loadConfig(env), new MemoryAuthStore(), () => clock);
});

const challenge = async () => (await app.inject({ method: 'GET', url: '/v1/auth/captcha' })).json() as CaptchaChallenge & { enabled: boolean };
const solved = async () => solveCaptcha(await challenge());
const codeOf = (r: { json: () => { error?: { code: string } } }) => r.json().error?.code;

const siwe = async (captcha?: string) => {
  const wallet = privateKeyToAccount(generatePrivateKey());
  const { nonce } = (await app.inject({ method: 'POST', url: '/v1/auth/siwe/nonce' })).json();
  const message = createSiweMessage({ address: wallet.address, chainId: 97, domain: 'localhost:5173', nonce, uri: 'http://localhost:5173', version: '1', issuedAt: clock });
  return app.inject({ method: 'POST', url: '/v1/auth/siwe/verify', payload: { message, signature: await wallet.signMessage({ message }), captcha } });
};
const emailStart = (captcha?: string) =>
  app.inject({ method: 'POST', url: '/v1/auth/email/start', payload: { email: `x${Math.random()}@exemplo.com`, captcha } });

describe('captcha no cadastro', () => {
  it('o desafio segue o formato do ALTCHA e é resolvível', async () => {
    const c = await challenge();
    expect(c).toMatchObject({ enabled: true, algorithm: 'SHA-256', maxnumber: 2000 });
    expect(c.salt).toMatch(/\?expires=\d+$/);
    expect(typeof solveCaptcha(c)).toBe('string');
  });

  it('login SIWE e pedido de código por e-mail exigem o captcha resolvido', async () => {
    expect(codeOf(await siwe())).toBe('captcha_required');
    expect((await siwe(await solved())).statusCode).toBe(200);
    expect(codeOf(await emailStart())).toBe('captcha_required');
    expect((await emailStart(await solved())).statusCode).toBe(202);
  });

  it('a mesma solução não abre duas contas', async () => {
    const s = await solved();
    expect((await siwe(s)).statusCode).toBe(200);
    const again = await siwe(s);
    expect(again.statusCode).toBe(403);
    expect(codeOf(again)).toBe('captcha_invalid');
  });

  it('recusa número errado, assinatura forjada, salt trocado e desafio vencido', async () => {
    const c = await challenge();
    const payload = JSON.parse(Buffer.from(solveCaptcha(c), 'base64').toString());
    const enc = (p: object) => Buffer.from(JSON.stringify(p)).toString('base64');
    expect(codeOf(await siwe(enc({ ...payload, number: payload.number + 1 })))).toBe('captcha_invalid');
    expect(codeOf(await siwe(enc({ ...payload, signature: 'ab'.repeat(32) })))).toBe('captcha_invalid');
    expect(codeOf(await siwe(enc({ ...payload, salt: payload.salt.replace(/expires=\d+/, 'expires=9999999999') })))).toBe('captcha_invalid');
    expect(codeOf(await siwe('não é base64 de json'))).toBe('captcha_invalid');
    // Depois de vencido, nem a solução certa vale.
    const late = solveCaptcha(await challenge());
    clock = new Date(clock.getTime() + 301_000);
    expect(codeOf(await siwe(late))).toBe('captcha_invalid');
  });

  it('desligado, a rota avisa e o login segue sem captcha; produção não aceita desligar', async () => {
    const off = await buildApp(loadConfig({ ...env, CAPTCHA: 'off' }), new MemoryAuthStore());
    expect((await off.inject({ method: 'GET', url: '/v1/auth/captcha' })).json()).toEqual({ enabled: false });
    expect(loadConfig({ ...env, CAPTCHA: undefined }).CAPTCHA).toBe('off'); // teste
    expect(loadConfig({ ...env, NODE_ENV: 'development', CAPTCHA: undefined }).CAPTCHA).toBe('pow');
    expect(() => loadConfig({ ...env, NODE_ENV: 'production', CAPTCHA: 'off' })).toThrow(/produção/);
  });
});
