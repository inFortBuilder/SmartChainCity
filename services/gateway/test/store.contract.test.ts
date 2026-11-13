import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import type { AuthStore } from '../src/domain/ports.js';
import { PostgresAuthStore } from '../src/infra/db/postgres-store.js';
import { MemoryAuthStore } from '../src/infra/memory-store.js';

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url }) : null;
afterAll(() => pool?.end());

const stores: [string, () => AuthStore, boolean][] = [
  ['memória', () => new MemoryAuthStore(), true],
  ['postgres', () => new PostgresAuthStore(pool!), pool !== null],
];

const address = () => `0x${randomUUID().replaceAll('-', '')}00000000`;
const later = (ms: number) => new Date(Date.now() + ms);

describe.each(stores)('AuthStore: %s', (_name, make, enabled) => {
  it.runIf(enabled)('nonce vale uma vez, mesmo em paralelo', async () => {
    const store = make();
    const nonce = randomUUID();
    await store.saveNonce(nonce, later(60_000));
    const results = await Promise.all(
      Array.from({ length: 10 }, () => store.consumeNonce(nonce, new Date())),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it.runIf(enabled)('nonce vencido ou inexistente não vale', async () => {
    const store = make();
    const nonce = randomUUID();
    await store.saveNonce(nonce, later(60_000));
    expect(await store.consumeNonce(nonce, later(120_000))).toBe(false);
    expect(await store.consumeNonce(randomUUID(), new Date())).toBe(false);
  });

  it.runIf(enabled)('primeiro login em paralelo cria uma só conta', async () => {
    const store = make();
    const wallet = address();
    const accounts = await Promise.all(
      Array.from({ length: 10 }, () => store.findOrCreateAccountByWallet(wallet, 97, new Date())),
    );
    expect(new Set(accounts.map((a) => a.id)).size).toBe(1);
    const wallets = await store.listWallets(accounts[0]!.id);
    expect(wallets).toHaveLength(1);
    expect(wallets[0]).toMatchObject({ address: wallet, chainId: 97 });
  });

  it.runIf(enabled)('conta nasce ativa e é encontrada pelo id', async () => {
    const store = make();
    const created = await store.findOrCreateAccountByWallet(address(), 97, new Date());
    expect(created).toMatchObject({ status: 'active', kycLevel: 0, email: null });
    expect((await store.findAccount(created.id))?.id).toBe(created.id);
    expect(await store.findAccount(randomUUID())).toBeNull();
  });
});

describe.each(stores)('AuthStore, código por e-mail: %s', (_name, make, enabled) => {
  const email = () => `${randomUUID()}@teste.local`;

  it.runIf(enabled)('código certo vale uma vez, mesmo em paralelo', async () => {
    const store = make();
    const e = email();
    expect(await store.saveEmailCode(e, 'h1', later(60_000), new Date(), 60)).toBe(true);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => store.consumeEmailCode(e, 'h1', new Date(), 5)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it.runIf(enabled)('erros contam e, no limite, nem o certo vale', async () => {
    const store = make();
    const e = email();
    await store.saveEmailCode(e, 'h1', later(60_000), new Date(), 60);
    for (let i = 0; i < 3; i++) expect(await store.consumeEmailCode(e, 'errado', new Date(), 3)).toBe(false);
    expect(await store.consumeEmailCode(e, 'h1', new Date(), 3)).toBe(false);
  });

  it.runIf(enabled)('não troca o código antes do intervalo; depois troca e zera os erros', async () => {
    const store = make();
    const e = email();
    const t0 = new Date();
    const at = (s: number) => new Date(t0.getTime() + s * 1000);
    await store.saveEmailCode(e, 'h1', at(600), t0, 60);
    await store.consumeEmailCode(e, 'errado', t0, 2);
    expect(await store.saveEmailCode(e, 'h2', at(600), at(10), 60)).toBe(false);
    expect(await store.saveEmailCode(e, 'h2', at(700), at(61), 60)).toBe(true);
    await store.consumeEmailCode(e, 'errado', at(62), 2);
    expect(await store.consumeEmailCode(e, 'h2', at(63), 2)).toBe(true);
  });

  it.runIf(enabled)('código vencido não vale', async () => {
    const store = make();
    const e = email();
    await store.saveEmailCode(e, 'h1', later(1_000), new Date(), 60);
    expect(await store.consumeEmailCode(e, 'h1', later(2_000), 5)).toBe(false);
  });

  it.runIf(enabled)('primeiro login por e-mail em paralelo cria uma só conta', async () => {
    const store = make();
    const e = email();
    const accounts = await Promise.all(
      Array.from({ length: 10 }, () => store.findOrCreateAccountByEmail(e, new Date())),
    );
    expect(new Set(accounts.map((a) => a.id)).size).toBe(1);
    expect(accounts[0]).toMatchObject({ email: e, status: 'active' });
    expect(await store.listWallets(accounts[0]!.id)).toEqual([]);
  });
});
