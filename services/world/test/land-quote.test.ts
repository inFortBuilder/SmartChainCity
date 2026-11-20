import { randomUUID } from 'node:crypto';

import { SignJWT } from 'jose';
import { type Address, hashTypedData, recoverTypedDataAddress, zeroAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import {
  LOT_QUOTE_TYPES,
  type WalletDirectory,
  issueOnchainQuote,
  landDomain,
  lotTokenId,
} from '../src/domain/land-quote.js';
import type { LandPayments } from '../src/domain/lots.js';
import { buyLot } from '../src/domain/purchase.js';
import { GatewayWalletDirectory, LocalKeyQuoteSigner } from '../src/infra/land-chain.js';
import { MemoryWorldStore } from '../src/infra/memory-store.js';
import { testCity, testLots } from './fixtures.js';

/** Endereço do LandNFT num anvil recém-iniciado com o DeployLocal (contracts/deployments/anvil.json). */
const ANVIL_LAND: Address = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)

const freePayments: LandPayments = { charge: async () => {}, refund: async () => {} };

class Wallets implements WalletDirectory {
  links = new Map<string, string[]>();
  async walletsOf(accountId: string) {
    return this.links.get(accountId) ?? [];
  }
}

let store: MemoryWorldStore;
let wallets: Wallets;
let signer: LocalKeyQuoteSigner;
const owner = randomUUID();
const playerWallet = privateKeyToAccount(generatePrivateKey()).address;
const now = () => new Date('2026-11-20T12:00:00Z');

beforeEach(async () => {
  store = new MemoryWorldStore();
  await store.importCity(testCity('teste'), testLots());
  await buyLot(store, freePayments, { city: 'teste', lotId: 3, accountId: owner, scityUsd: 1 }, now);
  wallets = new Wallets();
  wallets.links.set(owner, [playerWallet.toLowerCase()]);
  signer = new LocalKeyQuoteSigner(generatePrivateKey(), 31337, ANVIL_LAND);
});

const input = (over: Partial<Parameters<typeof issueOnchainQuote>[3]> = {}) => ({
  city: 'teste',
  lotId: 3,
  accountId: owner,
  wallet: playerWallet,
  cityNftId: 1,
  ttlSeconds: 600,
  ...over,
});

describe('cotação EIP-712 do LandNFT', () => {
  /** O hash tem de ser igual ao `quoteDigest` do contrato, lido no anvil para esta cotação fixa. */
  it('o hash bate com o do contrato', () => {
    const digest = hashTypedData({
      domain: landDomain(31337, ANVIL_LAND),
      types: LOT_QUOTE_TYPES,
      primaryType: 'LotQuote',
      message: {
        city: 1,
        lot: 42,
        buyer: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        currency: zeroAddress,
        price: 0n,
        nonce: lotTokenId(1, 42),
        deadline: 1_800_000_000n,
      },
    });
    expect(digest).toBe('0x90eda015e926a610aae38a689b04db9eed2ef3340b93f482ee783540c60c0c86');
  });

  it('o tokenId é o mesmo do contrato', () => {
    expect(lotTokenId(1, 42)).toBe(4_294_967_338n);
    expect(lotTokenId(7, 100_151)).toBe((7n << 32n) | 100_151n);
  });

  it('assina para o dono, com preço 0, nonce = tokenId e prazo', async () => {
    const { quote, signature, tokenId } = await issueOnchainQuote(store, wallets, signer, input(), now);
    expect(quote).toMatchObject({ city: 1, lot: 3, buyer: playerWallet, currency: zeroAddress, price: 0n });
    expect(quote.nonce).toBe(tokenId);
    expect(quote.deadline).toBe(BigInt(Math.floor(now().getTime() / 1000) + 600));
    const recovered = await recoverTypedDataAddress({
      domain: landDomain(31337, ANVIL_LAND),
      types: LOT_QUOTE_TYPES,
      primaryType: 'LotQuote',
      message: quote,
      signature,
    });
    expect(recovered).toBe(signer.address);
  });

  it('recusa quem não é dono do lote', async () => {
    await expect(issueOnchainQuote(store, wallets, signer, input({ accountId: randomUUID() }), now)).rejects.toMatchObject({
      code: 'not_lot_owner',
    });
    await expect(issueOnchainQuote(store, wallets, signer, input({ lotId: 4 }), now)).rejects.toMatchObject({
      code: 'not_lot_owner',
    });
  });

  it('recusa carteira que não é da conta', async () => {
    const other = privateKeyToAccount(generatePrivateKey()).address;
    await expect(issueOnchainQuote(store, wallets, signer, input({ wallet: other }), now)).rejects.toMatchObject({
      code: 'wallet_not_linked',
    });
  });

  it('recusa cidade sem id no contrato e carteira inválida', async () => {
    await expect(issueOnchainQuote(store, wallets, signer, input({ cityNftId: undefined }), now)).rejects.toMatchObject({
      code: 'city_not_onchain',
    });
    await expect(issueOnchainQuote(store, wallets, signer, input({ wallet: '0x123' }), now)).rejects.toMatchObject({
      code: 'invalid_request',
    });
  });
});

describe('GatewayWalletDirectory', () => {
  it('lê as carteiras pela rota interna, com o token e o x-request-id', async () => {
    let seen: { url: string; headers: Record<string, string> } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, headers: init.headers as Record<string, string> };
      return Response.json({ wallets: [{ address: playerWallet, chain_id: 97 }] });
    }) as unknown as typeof fetch;
    const dir = new GatewayWalletDirectory('http://gateway/', 't'.repeat(32), fake);
    expect(await dir.walletsOf(owner, 'req-1')).toEqual([playerWallet]);
    expect(seen!.url).toBe(`http://gateway/internal/v1/accounts/${owner}/wallets`);
    expect(seen!.headers['x-service-token']).toBe('t'.repeat(32));
    expect(seen!.headers['x-request-id']).toBe('req-1');
  });

  it('gateway fora vira 503', async () => {
    const down = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(new GatewayWalletDirectory('http://gateway', 't'.repeat(32), down).walletsOf(owner)).rejects.toMatchObject({
      code: 'gateway_unavailable',
    });
  });
});

describe('POST /v1/world/cities/:code/lots/:id/onchain-quote', () => {
  const token = (sub: string) =>
    new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setIssuer('scc-gateway')
      .setAudience('scc-api')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));

  it('devolve contrato, rede, tokenId, cotação e assinatura', async () => {
    const app = await buildApp(
      loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, LAND_CITY_IDS: 'teste=1' }),
      store,
      now,
      null,
      { wallets, signer, contract: ANVIL_LAND, chainId: 31337 },
    );
    const r = await app.inject({
      method: 'POST',
      url: '/v1/world/cities/teste/lots/3/onchain-quote',
      headers: { authorization: `Bearer ${await token(owner)}` },
      payload: { wallet: playerWallet },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body).toMatchObject({ contract: ANVIL_LAND, chain_id: 31337, token_id: lotTokenId(1, 3).toString() });
    expect(body.quote).toMatchObject({ city: 1, lot: 3, price: '0', nonce: lotTokenId(1, 3).toString() });
    expect(body.signature).toMatch(/^0x[0-9a-f]{130}$/);
  });

  it('desligada responde 503', async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET }), store, now);
    const r = await app.inject({
      method: 'POST',
      url: '/v1/world/cities/teste/lots/3/onchain-quote',
      headers: { authorization: `Bearer ${await token(owner)}` },
      payload: { wallet: playerWallet },
    });
    expect(r.statusCode).toBe(503);
    expect(r.json().error.code).toBe('onchain_disabled');
  });

  it('LAND_CITY_IDS inválido derruba a configuração', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, LAND_CITY_IDS: 'teste=0' })).toThrow();
  });
});
