import { beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Mailer } from '../src/domain/email-login.js';
import { MemoryAuthStore } from '../src/infra/memory-store.js';

const env = {
  NODE_ENV: 'test',
  JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres', // gitleaks:allow (só no teste)
  SIWE_DOMAINS: 'localhost:5173',
  AUTH_RATE_LIMIT_PER_MINUTE: '1000',
  RATE_LIMIT_PER_MINUTE: '1000',
};

/** Carteiro de teste: guarda o último código de cada e-mail. */
class Inbox implements Mailer {
  codes = new Map<string, string>();
  sent = 0;
  async sendLoginCode(email: string, code: string) {
    this.codes.set(email, code);
    this.sent++;
  }
}

let store: MemoryAuthStore;
let inbox: Inbox;
let clock: Date;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeEach(async () => {
  store = new MemoryAuthStore();
  inbox = new Inbox();
  clock = new Date();
  app = await buildApp(loadConfig(env), store, () => clock, inbox);
});

const start = (email: string) => app.inject({ method: 'POST', url: '/v1/auth/email/start', payload: { email } });
const verify = (email: string, code: string) =>
  app.inject({ method: 'POST', url: '/v1/auth/email/verify', payload: { email, code } });
const codeOf = (email: string) => inbox.codes.get(email)!;
const wrong = (code: string) => (code === '000000' ? '111111' : '000000');
const later = (seconds: number) => {
  clock = new Date(clock.getTime() + seconds * 1000);
};

describe('login por e-mail', () => {
  it('manda o código, troca por um JWT que abre o /v1/me e cria a conta com o e-mail', async () => {
    const r = await start('Jogador@Exemplo.com');
    expect(r.statusCode).toBe(202);
    expect(r.json()).toEqual({ expires_in: 600 });
    expect(codeOf('jogador@exemplo.com')).toMatch(/^\d{6}$/);

    const v = await verify('jogador@exemplo.com', codeOf('jogador@exemplo.com'));
    expect(v.statusCode).toBe(200);
    expect(v.json().account).toMatchObject({ email: 'jogador@exemplo.com', status: 'active' });

    const me = await app.inject({ url: '/v1/me', headers: { authorization: `Bearer ${v.json().access_token}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ account: { email: 'jogador@exemplo.com' }, wallets: [] });
  });

  it('o mesmo e-mail volta para a mesma conta, com maiúsculas ou não', async () => {
    await start('a@b.com');
    const first = (await verify('a@b.com', codeOf('a@b.com'))).json().account.id;
    later(61);
    await start('A@B.com');
    const second = (await verify('A@b.com', codeOf('a@b.com'))).json().account.id;
    expect(second).toBe(first);
  });

  it('o código vale uma vez só', async () => {
    await start('a@b.com');
    const code = codeOf('a@b.com');
    expect((await verify('a@b.com', code)).statusCode).toBe(200);
    const again = await verify('a@b.com', code);
    expect(again.statusCode).toBe(401);
    expect(again.json().error.code).toBe('invalid_code');
  });

  it('código vencido não vale', async () => {
    await start('a@b.com');
    later(601);
    expect((await verify('a@b.com', codeOf('a@b.com'))).statusCode).toBe(401);
  });

  it('5 erros queimam o código, mesmo que o certo venha depois', async () => {
    await start('a@b.com');
    const code = codeOf('a@b.com');
    for (let i = 0; i < 5; i++) expect((await verify('a@b.com', wrong(code))).statusCode).toBe(401);
    expect((await verify('a@b.com', code)).statusCode).toBe(401);
  });

  it('código de um e-mail não abre outro', async () => {
    await start('a@b.com');
    expect((await verify('c@d.com', codeOf('a@b.com'))).statusCode).toBe(401);
  });

  it('pedir de novo antes de 60 s não manda outro código, mas a resposta é a mesma', async () => {
    await start('a@b.com');
    const r = await start('a@b.com');
    expect(r.statusCode).toBe(202);
    expect(r.json()).toEqual({ expires_in: 600 });
    expect(inbox.sent).toBe(1);
    later(61);
    await start('a@b.com');
    expect(inbox.sent).toBe(2);
  });

  it('o código novo substitui o antigo', async () => {
    await start('a@b.com');
    const old = codeOf('a@b.com');
    later(61);
    await start('a@b.com');
    const fresh = codeOf('a@b.com');
    if (old !== fresh) expect((await verify('a@b.com', old)).statusCode).toBe(401);
    expect((await verify('a@b.com', fresh)).statusCode).toBe(200);
  });

  it('e-mail ou código malformado é 400', async () => {
    expect((await start('nao-e-email')).statusCode).toBe(400);
    expect((await verify('a@b.com', '12345')).statusCode).toBe(400);
    expect((await verify('a@b.com', 'abcdef')).statusCode).toBe(400);
  });

  it('conta bloqueada não entra', async () => {
    await start('a@b.com');
    const id = (await verify('a@b.com', codeOf('a@b.com'))).json().account.id;
    store.setStatus(id, 'banned');
    later(61);
    await start('a@b.com');
    expect((await verify('a@b.com', codeOf('a@b.com'))).statusCode).toBe(403);
  });

  it('EMAIL_LOGIN=off responde 404', async () => {
    const off = await buildApp(loadConfig({ ...env, EMAIL_LOGIN: 'off' }), store, () => clock, inbox);
    const r = await off.inject({ method: 'POST', url: '/v1/auth/email/start', payload: { email: 'a@b.com' } });
    expect(r.statusCode).toBe(404);
  });
});
