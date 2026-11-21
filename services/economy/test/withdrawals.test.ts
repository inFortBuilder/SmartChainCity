import { randomUUID } from 'node:crypto';

import { SignJWT } from 'jose';
import { type Address, hashTypedData, recoverTypedDataAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { LedgerStore } from '../src/domain/ledger.js';
import {
  KYC_FREE_WEI,
  DAILY_LIMIT_WEI,
  VOUCHER_TTL_MS,
  WEI,
  type Withdrawal,
  type WithdrawalStore,
  deadlineSeconds,
  requestWithdrawal,
  settleWithdrawals,
  withdrawalNonce,
} from '../src/domain/withdrawals.js';
import { PostgresWithdrawalStore } from '../src/infra/db/postgres-withdrawal-store.js';
import { MemoryLedgerStore } from '../src/infra/memory-store.js';
import { MemoryWithdrawalStore } from '../src/infra/memory-withdrawal-store.js';
import { LocalKeyVoucherSigner, WITHDRAWAL_TYPES, vaultDomain } from '../src/infra/vault-chain.js';
import { pool, stores } from './stores.js';

/** GameVault num anvil recém-iniciado com o DeployLocal (contracts/deployments/anvil.json). */
const ANVIL_VAULT: Address = '0x959922bE3CAee4b8Cd9a407cc3ac1C251C2007B1';
const T0 = new Date('2026-11-20T12:00:00Z');
const DAY = 86_400_000;
const at = (ms: number) => new Date(T0.getTime() + ms);

afterAll(async () => {
  await pool?.end();
});

/** withdrawalDigest do contrato no anvil para o voucher fixo do teste abaixo. */
const DIGEST = '0xdc921bddaa74a19e2a0d24025a3b419329df24457772b2afdedf249379131982';

const wallet = privateKeyToAccount(generatePrivateKey()).address;

/** Credita SCITY como faria o depósito do GameVault. */
const deposit = (ledger: LedgerStore, accountId: string, wei: bigint) =>
  ledger.post(
    {
      kind: 'scity_deposit',
      idempotencyKey: `deposito-${randomUUID()}`,
      legs: [
        { account: { ownerType: 'system', ownerId: 'vault', currency: 'SCITY' }, amount: -wei },
        { account: { ownerType: 'player', ownerId: accountId, currency: 'SCITY' }, amount: wei },
      ],
    },
    T0,
  );

const scityOf = async (ledger: LedgerStore, ownerType: 'player' | 'escrow' | 'system', id: string) =>
  (await ledger.balances(ownerType, id)).find((b) => b.currency === 'SCITY')?.amount ?? 0n;

describe('voucher de saque', () => {
  it('o hash é o do GameVault (domínio SCC GameVault v1)', async () => {
    const signer = new LocalKeyVoucherSigner(generatePrivateKey(), 31337, ANVIL_VAULT);
    const v = { to: wallet, amount: 5n * WEI, nonce: 7n, deadline: 1_800_000_000n };
    const sig = await signer.sign(v);
    expect(await recoverTypedDataAddress({ domain: vaultDomain(31337, ANVIL_VAULT), types: WITHDRAWAL_TYPES, primaryType: 'Withdrawal', message: v, signature: sig })).toBe(
      signer.address,
    );
    // Conferido contra o withdrawalDigest do contrato no anvil.
    expect(
      hashTypedData({
        domain: vaultDomain(31337, ANVIL_VAULT),
        types: WITHDRAWAL_TYPES,
        primaryType: 'Withdrawal',
        message: { to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', amount: 5n * WEI, nonce: 7n, deadline: 1_800_000_000n },
      }),
    ).toBe(DIGEST);
  });
});

describe.each(
  stores.map(([name, make, enabled], i) => [
    name,
    make,
    i === 0 ? () => new MemoryWithdrawalStore() as WithdrawalStore : () => new PostgresWithdrawalStore(pool!) as WithdrawalStore,
    enabled,
  ] as const),
)('saque (%s)', (_name, makeLedger, makeStore, enabled) => {
  let ledger: LedgerStore;
  let store: WithdrawalStore;
  let signer: LocalKeyVoucherSigner;
  let used: Set<bigint>;
  // Conta antiga e verificada: os testes do teto de 24 h não esbarram no limite sem KYC.
  const old = { wallets: [wallet as string], createdAt: at(-30 * DAY), kycLevel: 1 };

  beforeEach(() => {
    if (!enabled) return;
    ledger = makeLedger();
    store = makeStore();
    signer = new LocalKeyVoucherSigner(generatePrivateKey(), 31337, ANVIL_VAULT);
    used = new Set();
  });

  const deps = (accounts = { account: async () => old }) => ({ ledger, store, signer, accounts });
  const vault = { nonceUsed: async (n: bigint) => used.has(n) };

  it.skipIf(!enabled)('debita para o escrow e assina; resgatado, o escrow vai para o cofre', async () => {
    const me = randomUUID();
    await deposit(ledger, me, 50n * WEI);
    const w = await requestWithdrawal(deps(), { accountId: me, wallet: wallet.toLowerCase(), amountWei: 20n * WEI }, T0);
    expect(w).toMatchObject({ status: 'pending', wallet, nonce: withdrawalNonce(w.id) });
    expect(w.deadline).toEqual(at(VOUCHER_TTL_MS));
    expect(await scityOf(ledger, 'player', me)).toBe(30n * WEI);
    expect(await scityOf(ledger, 'escrow', 'withdrawals')).toBeGreaterThanOrEqual(20n * WEI);
    const recovered = await recoverTypedDataAddress({
      domain: vaultDomain(31337, ANVIL_VAULT),
      types: WITHDRAWAL_TYPES,
      primaryType: 'Withdrawal',
      message: { to: wallet, amount: 20n * WEI, nonce: w.nonce, deadline: deadlineSeconds(w) },
      signature: w.signature!,
    });
    expect(recovered).toBe(signer.address);

    used.add(w.nonce);
    expect(await settleWithdrawals({ ledger, store, signer, vault }, at(60_000))).toMatchObject({ claimed: 1 });
    expect((await store.get(w.id))!.status).toBe('claimed');
    expect(await settleWithdrawals({ ledger, store, signer, vault }, at(120_000))).toMatchObject({ claimed: 0 });
  });

  it.skipIf(!enabled)('vencido sem resgate volta para o jogador, uma vez', async () => {
    const me = randomUUID();
    await deposit(ledger, me, 10n * WEI);
    const w = await requestWithdrawal(deps(), { accountId: me, wallet, amountWei: 10n * WEI }, T0);
    // No Postgres compartilhado, o job também pega saques de outros testes: confere só este.
    const settle = (when: Date) => settleWithdrawals({ ledger, store, signer, vault }, when);
    await settle(at(DAY));
    expect((await store.get(w.id))!.status).toBe('pending');
    expect(await scityOf(ledger, 'player', me)).toBe(0n);
    await settle(at(VOUCHER_TTL_MS + 1));
    await settle(at(VOUCHER_TTL_MS + 2));
    expect(await scityOf(ledger, 'player', me)).toBe(10n * WEI);
    expect((await store.get(w.id))!.status).toBe('refunded');
  });

  it.skipIf(!enabled)('recusa carteira de outro, conta nova, abaixo do mínimo, sem saldo e acima do teto de 24 h', async () => {
    const me = randomUUID();
    await deposit(ledger, me, 5000n * WEI);
    const ask = (amountWei: bigint, over: { wallet?: string; accounts?: { account: () => Promise<typeof old> }; when?: Date } = {}) =>
      requestWithdrawal(deps(over.accounts), { accountId: me, wallet: over.wallet ?? wallet, amountWei }, over.when ?? T0);
    await expect(ask(5n * WEI, { wallet: privateKeyToAccount(generatePrivateKey()).address })).rejects.toMatchObject({ code: 'wallet_not_linked' });
    await expect(ask(5n * WEI, { accounts: { account: async () => ({ ...old, createdAt: at(-DAY) }) } })).rejects.toMatchObject({ code: 'account_too_new' });
    await expect(ask(WEI / 2n)).rejects.toMatchObject({ code: 'below_minimum' });

    await ask(DAILY_LIMIT_WEI - 100n * WEI);
    await expect(ask(200n * WEI)).rejects.toMatchObject({ code: 'daily_limit' });
    await ask(100n * WEI);
    // 24 h depois, o teto libera.
    await ask(200n * WEI, { when: at(DAY + 1) });

    const broke = randomUUID();
    await expect(requestWithdrawal(deps(), { accountId: broke, wallet, amountWei: 5n * WEI }, T0)).rejects.toMatchObject({ code: 'insufficient_scity' });
    // O que falhou não conta no teto.
    const failed = (await store.listOf(broke, 5))[0] as Withdrawal;
    expect(failed.status).toBe('failed');
  });

  it.skipIf(!enabled)('sem KYC, até 300 SCITY em 30 dias; com KYC, só o teto de 24 h', async () => {
    const me = randomUUID();
    await deposit(ledger, me, 5000n * WEI);
    const semKyc = { account: async () => ({ ...old, kycLevel: 0 }) };
    const ask = (amountWei: bigint, when = T0, accounts = semKyc) => requestWithdrawal(deps(accounts), { accountId: me, wallet, amountWei }, when);
    await ask(KYC_FREE_WEI - 50n * WEI);
    await expect(ask(100n * WEI, at(2 * DAY))).rejects.toMatchObject({ code: 'kyc_required', status: 403 });
    // O que ainda cabe no teto passa.
    await ask(50n * WEI, at(2 * DAY));
    await expect(ask(1n * WEI, at(29 * DAY))).rejects.toMatchObject({ code: 'kyc_required' });
    // Passados 30 dias do primeiro, o teto volta.
    await ask(250n * WEI, at(30 * DAY + 1));
    // Verificada, a mesma conta saca acima de 300 SCITY (só o teto de 24 h vale).
    await ask(600n * WEI, at(32 * DAY), { account: async () => old });
  });

  it.skipIf(!enabled)('pedidos em paralelo não passam juntos do teto', async () => {
    const me = randomUUID();
    await deposit(ledger, me, 5000n * WEI);
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => requestWithdrawal(deps(), { accountId: me, wallet, amountWei: 400n * WEI }, T0)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(await scityOf(ledger, 'player', me)).toBe(4200n * WEI);
  });
});

describe('API', () => {
  const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
  const INTERNAL = 'chave-interna-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)

  it('pede o saque, devolve o voucher e lista; sem cofre, 503', async () => {
    const ledger = new MemoryLedgerStore();
    const me = randomUUID();
    await deposit(ledger, me, 30n * WEI);
    const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: INTERNAL });
    const signer = new LocalKeyVoucherSigner(generatePrivateKey(), 31337, ANVIL_VAULT);
    const app = await buildApp(config, ledger, () => T0, {
      store: new MemoryWithdrawalStore(),
      signer,
      accounts: { account: async () => ({ wallets: [wallet], createdAt: at(-30 * DAY), kycLevel: 0 }) },
      vault: { contract: ANVIL_VAULT, chainId: 31337 },
    });
    const headers = {
      authorization: `Bearer ${await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(me)
        .setIssuer('scc-gateway')
        .setAudience('scc-api')
        .setExpirationTime('5m')
        .sign(new TextEncoder().encode(SECRET))}`,
    };
    const r = await app.inject({ method: 'POST', url: '/v1/economy/withdrawals', headers, payload: { wallet, amount_wei: (10n * WEI).toString() } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      contract: ANVIL_VAULT,
      chain_id: 31337,
      withdrawal: { status: 'pending', amount_wei: (10n * WEI).toString(), voucher: { to: wallet, amount: (10n * WEI).toString() } },
    });
    expect(r.json().withdrawal.voucher.signature).toMatch(/^0x[0-9a-f]{130}$/);
    const list = (await app.inject({ method: 'GET', url: '/v1/economy/withdrawals', headers })).json();
    expect(list.withdrawals).toHaveLength(1);

    const off = await buildApp(config, ledger, () => T0);
    const r2 = await off.inject({ method: 'POST', url: '/v1/economy/withdrawals', headers, payload: { wallet, amount_wei: '1' } });
    expect(r2.statusCode).toBe(503);
  });
});
