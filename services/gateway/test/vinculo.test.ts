import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Mailer } from '../src/domain/email-login.js';
import { MemoryAuthStore } from '../src/infra/memory-store.js';

const env = {
  NODE_ENV: 'test',
  JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres', // gitleaks:allow (só no teste)
  SIWE_DOMAINS: 'localhost:5173',
  SIWE_CHAIN_IDS: '97',
  AUTH_RATE_LIMIT_PER_MINUTE: '1000',
  RATE_LIMIT_PER_MINUTE: '1000',
};

class Inbox implements Mailer {
  codes = new Map<string, string>();
  async sendLoginCode(email: string, code: string) {
    this.codes.set(email, code);
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

const newWallet = () => privateKeyToAccount(generatePrivateKey());
type Wallet = ReturnType<typeof newWallet>;
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const errorCode = (r: { json: () => { error: { code: string } } }) => r.json().error.code;

const siwe = async (wallet: Wallet) => {
  const { nonce } = (await app.inject({ method: 'POST', url: '/v1/auth/siwe/nonce' })).json();
  const message = createSiweMessage({
    address: wallet.address,
    chainId: 97,
    domain: 'localhost:5173',
    nonce,
    uri: 'http://localhost:5173',
    version: '1',
    issuedAt: clock,
  });
  return { message, signature: await wallet.signMessage({ message }) };
};

const loginWallet = async (wallet: Wallet) => {
  const r = await app.inject({ method: 'POST', url: '/v1/auth/siwe/verify', payload: await siwe(wallet) });
  return r.json() as { access_token: string; account: { id: string } };
};

const loginEmail = async (email: string) => {
  await app.inject({ method: 'POST', url: '/v1/auth/email/start', payload: { email } });
  const r = await app.inject({
    method: 'POST',
    url: '/v1/auth/email/verify',
    payload: { email, code: inbox.codes.get(email) },
  });
  clock = new Date(clock.getTime() + 61_000);
  return r.json() as { access_token: string; account: { id: string } };
};

const linkWallet = async (token: string, wallet: Wallet) =>
  app.inject({ method: 'POST', url: '/v1/me/wallets', headers: bearer(token), payload: await siwe(wallet) });

const linkEmail = async (token: string, email: string, code?: string) => {
  const start = await app.inject({ method: 'POST', url: '/v1/me/email/start', headers: bearer(token), payload: { email } });
  if (start.statusCode !== 202) return start;
  return app.inject({
    method: 'POST',
    url: '/v1/me/email/verify',
    headers: bearer(token),
    payload: { email, code: code ?? inbox.codes.get(email.toLowerCase()) },
  });
};

describe('vincular carteira à conta logada', () => {
  it('conta de e-mail ganha a carteira, e o login pela carteira cai na mesma conta', async () => {
    const session = await loginEmail('a@b.com');
    const wallet = newWallet();
    const r = await linkWallet(session.access_token, wallet);
    expect(r.statusCode).toBe(201);
    expect(r.json().account.email).toBe('a@b.com');
    expect(r.json().wallets.map((w: { address: string }) => w.address)).toEqual([wallet.address]);

    expect((await loginWallet(wallet)).account.id).toBe(session.account.id);
  });

  it('ligar de novo a mesma carteira é 200, sem duplicar', async () => {
    const session = await loginEmail('a@b.com');
    const wallet = newWallet();
    await linkWallet(session.access_token, wallet);
    const again = await linkWallet(session.access_token, wallet);
    expect(again.statusCode).toBe(200);
    expect(again.json().wallets).toHaveLength(1);
  });

  it('carteira de outra conta é 409 e continua com a dona', async () => {
    const wallet = newWallet();
    const owner = await loginWallet(wallet);
    const other = await loginEmail('a@b.com');
    const r = await linkWallet(other.access_token, wallet);
    expect(r.statusCode).toBe(409);
    expect(errorCode(r)).toBe('wallet_in_use');
    expect((await loginWallet(wallet)).account.id).toBe(owner.account.id);
  });

  it('uma conta pode ter mais de uma carteira', async () => {
    const first = newWallet();
    const session = await loginWallet(first);
    const second = newWallet();
    expect((await linkWallet(session.access_token, second)).json().wallets).toHaveLength(2);
    expect((await loginWallet(second)).account.id).toBe(session.account.id);
  });

  it('assinatura de outra carteira não liga nada', async () => {
    const session = await loginEmail('a@b.com');
    const wallet = newWallet();
    const { message } = await siwe(wallet);
    const forged = await newWallet().signMessage({ message });
    const r = await app.inject({
      method: 'POST',
      url: '/v1/me/wallets',
      headers: bearer(session.access_token),
      payload: { message, signature: forged },
    });
    expect(r.statusCode).toBe(401);
    expect(errorCode(r)).toBe('invalid_signature');
  });

  it('sem token é 401', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/me/wallets', payload: await siwe(newWallet()) });
    expect(r.statusCode).toBe(401);
  });

  it('conta bloqueada não liga carteira', async () => {
    const session = await loginEmail('a@b.com');
    store.setStatus(session.account.id, 'banned');
    expect((await linkWallet(session.access_token, newWallet())).statusCode).toBe(403);
  });
});

describe('pôr e-mail na conta de carteira', () => {
  it('a conta ganha o e-mail, e o login pelo e-mail cai na mesma conta', async () => {
    const session = await loginWallet(newWallet());
    const r = await linkEmail(session.access_token, 'Jogador@Exemplo.com');
    expect(r.statusCode).toBe(200);
    expect(r.json().account.email).toBe('jogador@exemplo.com');
    clock = new Date(clock.getTime() + 61_000);
    expect((await loginEmail('jogador@exemplo.com')).account.id).toBe(session.account.id);
  });

  it('código errado é 401 e não grava', async () => {
    const session = await loginWallet(newWallet());
    const r = await linkEmail(session.access_token, 'a@b.com', '000000');
    if (inbox.codes.get('a@b.com') === '000000') return; // 1 em 1 milhão
    expect(r.statusCode).toBe(401);
    const me = await app.inject({ url: '/v1/me', headers: bearer(session.access_token) });
    expect(me.json().account.email).toBeNull();
  });

  it('e-mail de outra conta é 409, mas só depois do código certo', async () => {
    await loginEmail('a@b.com');
    const session = await loginWallet(newWallet());
    const start = await app.inject({
      method: 'POST',
      url: '/v1/me/email/start',
      headers: bearer(session.access_token),
      payload: { email: 'a@b.com' },
    });
    expect(start.statusCode).toBe(202);
    const r = await app.inject({
      method: 'POST',
      url: '/v1/me/email/verify',
      headers: bearer(session.access_token),
      payload: { email: 'a@b.com', code: inbox.codes.get('a@b.com') },
    });
    expect(r.statusCode).toBe(409);
    expect(errorCode(r)).toBe('email_in_use');
  });

  it('conta que já tem e-mail não troca por aqui', async () => {
    const session = await loginEmail('a@b.com');
    const r = await linkEmail(session.access_token, 'c@d.com');
    expect(r.statusCode).toBe(409);
    expect(errorCode(r)).toBe('email_already_set');
    expect(inbox.codes.has('c@d.com')).toBe(false);
  });

  it('EMAIL_LOGIN=off responde 404', async () => {
    const off = await buildApp(loadConfig({ ...env, EMAIL_LOGIN: 'off' }), store, () => clock, inbox);
    const session = (
      await off.inject({ method: 'POST', url: '/v1/auth/siwe/verify', payload: await siwe(newWallet()) })
    ).json();
    const r = await off.inject({
      method: 'POST',
      url: '/v1/me/email/start',
      headers: bearer(session.access_token),
      payload: { email: 'a@b.com' },
    });
    expect(r.statusCode).toBe(404);
  });
});

describe('rota interna de carteiras (para o world)', () => {
  const INTERNAL = 'token-interno-de-teste-com-32-caracteres!'; // gitleaks:allow (só no teste)
  const wallets = (target: typeof app, id: string, token?: string) =>
    target.inject({
      method: 'GET',
      url: `/internal/v1/accounts/${id}/wallets`,
      headers: token ? { 'x-service-token': token } : {},
    });

  it('lista as carteiras da conta com o token interno', async () => {
    const internal = await buildApp(loadConfig({ ...env, INTERNAL_TOKEN: INTERNAL }), store, () => clock, inbox);
    const wallet = newWallet();
    const session = (
      await internal.inject({ method: 'POST', url: '/v1/auth/siwe/verify', payload: await siwe(wallet) })
    ).json() as { account: { id: string } };
    const r = await wallets(internal, session.account.id, INTERNAL);
    expect(r.statusCode).toBe(200);
    const list = r.json().wallets as { address: string; chain_id: number }[];
    expect(list).toHaveLength(1);
    expect(list[0]!.address.toLowerCase()).toBe(wallet.address.toLowerCase());
    expect(list[0]!.chain_id).toBe(97);
  });

  it('recusa sem o token certo', async () => {
    const internal = await buildApp(loadConfig({ ...env, INTERNAL_TOKEN: INTERNAL }), store, () => clock, inbox);
    const id = crypto.randomUUID();
    expect((await wallets(internal, id)).statusCode).toBe(403);
    expect((await wallets(internal, id, `${INTERNAL}x`)).statusCode).toBe(403);
  });

  it('sem INTERNAL_TOKEN a rota responde 503', async () => {
    const r = await wallets(app, crypto.randomUUID(), INTERNAL);
    expect(r.statusCode).toBe(503);
    expect(errorCode(r)).toBe('internal_disabled');
  });
});
