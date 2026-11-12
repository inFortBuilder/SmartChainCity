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
