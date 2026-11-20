import { createHash, randomUUID } from 'node:crypto';

import { SignJWT } from 'jose';
import { type Address, hashTypedData, recoverTypedDataAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { BUILDING_VOUCHER_TYPES, buildingDomain, buildingNonce, issueBuildingVoucher } from '../src/domain/building-voucher.js';
import type { Building } from '../src/domain/buildings.js';
import { type WalletDirectory, lotTokenId } from '../src/domain/land-quote.js';
import { LocalKeyBuildingSigner } from '../src/infra/land-chain.js';
import { MemoryBuildingStore } from '../src/infra/memory-building-store.js';
import { MemoryWorldStore } from '../src/infra/memory-store.js';

/** BuildingNFT num anvil recém-iniciado com o DeployLocal (contracts/deployments/anvil.json). */
const ANVIL_BUILDING: Address = '0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0';
const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const GLB_SHA = createHash('sha256').update('glTF').digest('hex');
const T0 = new Date('2026-11-20T12:00:00Z');

class Wallets implements WalletDirectory {
  links = new Map<string, string[]>();
  async walletsOf(accountId: string) {
    return this.links.get(accountId) ?? [];
  }
}

const owner = randomUUID();
const wallet = privateKeyToAccount(generatePrivateKey()).address;

const approved = (over: Partial<Building> = {}): Building => ({
  id: randomUUID(),
  city: 'teste',
  lotId: 4,
  ownerAccountId: owner,
  jobId: 'job_abc',
  modelId: 'mdl_1',
  modelVersion: 1,
  rotationDeg: 0,
  position: [85, 5],
  heightM: 80,
  footprintM2: 400,
  floors: 25,
  gfaM2: 8500,
  outorgaWei: 0n,
  checks: [],
  artifacts: {},
  modelSha256: GLB_SHA,
  status: 'approved',
  reviewNote: null,
  createdAt: T0,
  reviewedAt: T0,
  ...over,
});

let store: MemoryBuildingStore;
let wallets: Wallets;
let signer: LocalKeyBuildingSigner;

beforeEach(() => {
  store = new MemoryBuildingStore();
  wallets = new Wallets();
  wallets.links.set(owner, [wallet.toLowerCase()]);
  signer = new LocalKeyBuildingSigner(generatePrivateKey(), 31337, ANVIL_BUILDING);
});

const input = (buildingId: string, over: Partial<Parameters<typeof issueBuildingVoucher>[3]> = {}) => ({
  buildingId,
  accountId: owner,
  wallet,
  cityNftId: (c: string) => (c === 'teste' ? 1 : undefined),
  ttlSeconds: 600,
  ...over,
});

describe('voucher EIP-712 do BuildingNFT', () => {
  /** O hash tem de ser igual ao `voucherDigest` do contrato, lido no anvil para este voucher fixo. */
  it('o hash bate com o do contrato', () => {
    const digest = hashTypedData({
      domain: buildingDomain(31337, ANVIL_BUILDING),
      types: BUILDING_VOUCHER_TYPES,
      primaryType: 'BuildingVoucher',
      message: {
        lotId: 4_294_967_338n,
        developer: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        modelHash: `0x${GLB_SHA}`,
        floors: 25,
        nonce: 7n,
        deadline: 1_800_000_000n,
      },
    });
    expect(digest).toBe('0x6fa13046dd86e1b0ce4b8494be4e53a3a7b8221c0d33f5034b4feb7e59124f0d');
  });

  it('assina o prédio aprovado com o lote, o hash do GLB e os andares', async () => {
    const b = approved();
    await store.createBuilding(b);
    const { voucher, signature } = await issueBuildingVoucher(store, wallets, signer, input(b.id), () => T0);
    expect(voucher).toMatchObject({ lotId: lotTokenId(1, 4), developer: wallet, modelHash: `0x${GLB_SHA}`, floors: 25 });
    expect(voucher.nonce).toBe(buildingNonce(b.id));
    expect(voucher.deadline).toBe(BigInt(Math.floor(T0.getTime() / 1000) + 600));
    const recovered = await recoverTypedDataAddress({
      domain: buildingDomain(31337, ANVIL_BUILDING),
      types: BUILDING_VOUCHER_TYPES,
      primaryType: 'BuildingVoucher',
      message: voucher,
      signature,
    });
    expect(recovered).toBe(signer.address);
  });

  it('recusa prédio sem alvará, sem hash, de outra conta, cidade fora da rede e carteira não ligada', async () => {
    const review = approved({ status: 'pending_review' });
    const noHash = approved({ modelSha256: null, lotId: 5 });
    const elsewhere = approved({ city: 'outra', lotId: 6 });
    const ok = approved({ lotId: 7 });
    for (const b of [review, noHash, elsewhere, ok]) await store.createBuilding(b);

    const issue = (id: string, over = {}) => issueBuildingVoucher(store, wallets, signer, input(id, over), () => T0);
    await expect(issue(review.id)).rejects.toMatchObject({ code: 'building_not_approved' });
    await expect(issue(noHash.id)).rejects.toMatchObject({ code: 'model_hash_missing' });
    await expect(issue(elsewhere.id)).rejects.toMatchObject({ code: 'city_not_onchain' });
    await expect(issue(ok.id, { accountId: randomUUID() })).rejects.toMatchObject({ code: 'not_found' });
    const stranger = privateKeyToAccount(generatePrivateKey()).address;
    await expect(issue(ok.id, { wallet: stranger })).rejects.toMatchObject({ code: 'wallet_not_linked' });
  });
});

describe('POST /v1/world/buildings/:id/onchain-voucher', () => {
  it('devolve contrato, rede, voucher e assinatura; desligado responde 503', async () => {
    const b = approved();
    await store.createBuilding(b);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(owner)
      .setIssuer('scc-gateway')
      .setAudience('scc-api')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    const headers = { authorization: `Bearer ${token}` };
    const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, LAND_CITY_IDS: 'teste=1' });

    const on = await buildApp(config, new MemoryWorldStore(), () => T0, null, null, null, null, {
      store,
      builder: null,
      payments: null,
      onchain: { wallets, signer, contract: ANVIL_BUILDING, chainId: 31337 },
    });
    const r = await on.inject({ method: 'POST', url: `/v1/world/buildings/${b.id}/onchain-voucher`, headers, payload: { wallet } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      contract: ANVIL_BUILDING,
      chain_id: 31337,
      voucher: { lotId: lotTokenId(1, 4).toString(), developer: wallet, modelHash: `0x${GLB_SHA}`, floors: 25 },
    });
    expect(r.json().signature).toMatch(/^0x[0-9a-f]{130}$/);

    const off = await buildApp(config, new MemoryWorldStore(), () => T0, null, null, null, null, { store, builder: null, payments: null });
    const r2 = await off.inject({ method: 'POST', url: `/v1/world/buildings/${b.id}/onchain-voucher`, headers, payload: { wallet } });
    expect(r2.statusCode).toBe(503);
    expect(r2.json().error.code).toBe('onchain_disabled');
  });
});
