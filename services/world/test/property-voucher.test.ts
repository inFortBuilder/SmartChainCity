import { randomUUID } from 'node:crypto';

import { SignJWT } from 'jose';
import { type Address, hashTypedData, recoverTypedDataAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { type WalletDirectory, lotTokenId } from '../src/domain/land-quote.js';
import type { Property } from '../src/domain/properties.js';
import {
  LEVEL_VOUCHER_TYPES,
  PROPERTY_VOUCHER_TYPES,
  issueLevelVoucher,
  issuePropertyVoucher,
  propertyDomain,
  propertyTokenId,
  typeCodeHex,
} from '../src/domain/property-voucher.js';
import { LocalKeyPropertySigner } from '../src/infra/land-chain.js';
import { MemoryPropertyStore } from '../src/infra/memory-property-store.js';
import { MemoryWorldStore } from '../src/infra/memory-store.js';

/** PropertyNFT num anvil recém-iniciado com o DeployLocal (contracts/deployments/anvil.json). */
const ANVIL_PROPERTY: Address = '0x9A676e781A523b5d0C0e43731313A708CB607508';
const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const T0 = new Date('2026-11-20T12:00:00Z');
const DAY = 86_400_000;

class Wallets implements WalletDirectory {
  links = new Map<string, string[]>();
  async walletsOf(accountId: string) {
    return this.links.get(accountId) ?? [];
  }
}

const owner = randomUUID();
const wallet = privateKeyToAccount(generatePrivateKey()).address;
let nextLot = 1;

const property = (over: Partial<Property> = {}): Property => ({
  id: randomUUID(),
  city: 'teste',
  lotId: nextLot++,
  ownerAccountId: owner,
  type: 't1',
  level: 1,
  status: 'active',
  priceCents: 4000_00,
  createdAt: new Date(T0.getTime() - 2 * DAY),
  readyAt: new Date(T0.getTime() - DAY),
  wearBase: 100,
  wearSince: new Date(T0.getTime() - DAY),
  lastClaimAt: new Date(T0.getTime() - DAY),
  ...over,
});

let store: MemoryPropertyStore;
let wallets: Wallets;
let signer: LocalKeyPropertySigner;

beforeEach(() => {
  store = new MemoryPropertyStore();
  wallets = new Wallets();
  wallets.links.set(owner, [wallet.toLowerCase()]);
  signer = new LocalKeyPropertySigner(generatePrivateKey(), 31337, ANVIL_PROPERTY);
});

const input = (propertyId: string, over: Partial<Parameters<typeof issuePropertyVoucher>[3]> = {}) => ({
  propertyId,
  accountId: owner,
  wallet,
  cityNftId: (c: string) => (c === 'teste' ? 1 : undefined),
  ttlSeconds: 600,
  ...over,
});

describe('vouchers EIP-712 do PropertyNFT', () => {
  /** Os hashes têm de ser iguais aos `voucherDigest` e `levelDigest` do contrato, lidos no anvil. */
  it('os hashes batem com os do contrato', () => {
    const domain = propertyDomain(31337, ANVIL_PROPERTY);
    const tokenId = 147_735_337_091_412_453_395_938_540_624_009_591_403n;
    expect(
      hashTypedData({
        domain,
        types: PROPERTY_VOUCHER_TYPES,
        primaryType: 'PropertyVoucher',
        message: {
          tokenId,
          owner: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          lotId: 4_294_967_338n,
          typeCode: typeCodeHex('t1'),
          level: 1,
          deadline: 1_800_000_000n,
        },
      }),
    ).toBe('0x0e3ac7dd43ef071256060286dd025ae05eee9262c8d740feb2618b298da50882');
    expect(
      hashTypedData({ domain, types: LEVEL_VOUCHER_TYPES, primaryType: 'LevelVoucher', message: { tokenId, level: 2, deadline: 1_800_000_000n } }),
    ).toBe('0x92765ad1c978820d7ade7a7ed372e1871ad6e16fa5faf0da190745e0be513e56');
  });

  it('assina o imóvel pronto com o id, o lote, o tipo e o nível', async () => {
    const p = property({ level: 2 });
    await store.createProperty(p);
    const { voucher, signature } = await issuePropertyVoucher(store, wallets, signer, input(p.id), () => T0);
    expect(voucher).toMatchObject({ tokenId: propertyTokenId(p.id), owner: wallet, lotId: lotTokenId(1, p.lotId), level: 2 });
    expect(voucher.typeCode).toBe(`0x7431${'0'.repeat(60)}`);
    expect(voucher.deadline).toBe(BigInt(Math.floor(T0.getTime() / 1000) + 600));
    const recovered = await recoverTypedDataAddress({
      domain: propertyDomain(31337, ANVIL_PROPERTY),
      types: PROPERTY_VOUCHER_TYPES,
      primaryType: 'PropertyVoucher',
      message: voucher,
      signature,
    });
    expect(recovered).toBe(signer.address);
  });

  it('recusa obra em andamento ou não paga, de outra conta, cidade fora da rede e carteira não ligada', async () => {
    const building = property({ readyAt: new Date(T0.getTime() + DAY) });
    const unpaid = property({ status: 'pending' });
    const elsewhere = property({ city: 'outra' });
    const ok = property();
    for (const p of [building, unpaid, elsewhere, ok]) await store.createProperty(p);

    const issue = (id: string, over = {}) => issuePropertyVoucher(store, wallets, signer, input(id, over), () => T0);
    await expect(issue(building.id)).rejects.toMatchObject({ code: 'property_not_ready' });
    await expect(issue(unpaid.id)).rejects.toMatchObject({ code: 'property_not_ready' });
    await expect(issue(elsewhere.id)).rejects.toMatchObject({ code: 'city_not_onchain' });
    await expect(issue(ok.id, { accountId: randomUUID() })).rejects.toMatchObject({ code: 'not_found' });
    const stranger = privateKeyToAccount(generatePrivateKey()).address;
    await expect(issue(ok.id, { wallet: stranger })).rejects.toMatchObject({ code: 'wallet_not_linked' });
  });

  it('o voucher de nível leva o nível atual; no nível 1 não há o que subir', async () => {
    const one = property();
    const three = property({ level: 3 });
    await store.createProperty(one);
    await store.createProperty(three);
    const lvl = (id: string) => issueLevelVoucher(store, signer, { propertyId: id, accountId: owner, ttlSeconds: 600 }, () => T0);
    await expect(lvl(one.id)).rejects.toMatchObject({ code: 'nothing_to_upgrade' });
    const { voucher, signature } = await lvl(three.id);
    expect(voucher).toMatchObject({ tokenId: propertyTokenId(three.id), level: 3 });
    const recovered = await recoverTypedDataAddress({
      domain: propertyDomain(31337, ANVIL_PROPERTY),
      types: LEVEL_VOUCHER_TYPES,
      primaryType: 'LevelVoucher',
      message: voucher,
      signature,
    });
    expect(recovered).toBe(signer.address);
  });
});

describe('rotas do PropertyNFT', () => {
  it('devolvem contrato, rede, voucher e assinatura; desligado responde 503', async () => {
    const p = property({ level: 2 });
    await store.createProperty(p);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(owner)
      .setIssuer('scc-gateway')
      .setAudience('scc-api')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    const headers = { authorization: `Bearer ${token}` };
    const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, LAND_CITY_IDS: 'teste=1' });

    const on = await buildApp(config, new MemoryWorldStore(), () => T0, null, null, {
      store,
      payments: null,
      onchain: { wallets, signer, contract: ANVIL_PROPERTY, chainId: 31337 },
    });
    const r = await on.inject({ method: 'POST', url: `/v1/world/properties/${p.id}/onchain-voucher`, headers, payload: { wallet } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      contract: ANVIL_PROPERTY,
      chain_id: 31337,
      token_id: propertyTokenId(p.id).toString(),
      voucher: { lotId: lotTokenId(1, p.lotId).toString(), owner: wallet, typeCode: typeCodeHex('t1'), level: 2 },
    });
    expect(r.json().signature).toMatch(/^0x[0-9a-f]{130}$/);

    const lv = await on.inject({ method: 'POST', url: `/v1/world/properties/${p.id}/level-voucher`, headers });
    expect(lv.statusCode).toBe(200);
    expect(lv.json().voucher).toMatchObject({ tokenId: propertyTokenId(p.id).toString(), level: 2 });

    const off = await buildApp(config, new MemoryWorldStore(), () => T0, null, null, { store, payments: null });
    const r2 = await off.inject({ method: 'POST', url: `/v1/world/properties/${p.id}/onchain-voucher`, headers, payload: { wallet } });
    expect(r2.statusCode).toBe(503);
    expect(r2.json().error.code).toBe('onchain_disabled');
  });
});
