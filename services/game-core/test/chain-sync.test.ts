import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { type AvatarStore, MAX_AVATARS_PER_ACCOUNT, mayWork, newAvatar } from '../src/domain/avatar.js';
import { type ChainSyncStore, type FeedEvent, professionText, syncChain } from '../src/domain/chain-sync.js';
import { PostgresChainSyncStore } from '../src/infra/db/postgres-chain-sync-store.js';
import { PostgresAvatarStore } from '../src/infra/db/postgres-store.js';
import { MemoryChainSyncStore } from '../src/infra/memory-chain-sync-store.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 5 }) : null;
afterAll(() => pool?.end());

const T0 = new Date('2026-11-21T12:00:00Z');
const ZERO = '0x0000000000000000000000000000000000000000';
const ALICE = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
const BOB = '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc';
const CAROL = '0x90f79bf6eb2c4f870365e785982e1f101e93b906';
/** bytes32 do texto, como o DeployLocal grava a profissão. */
const bytes32 = (text: string) => `0x${Buffer.from(text, 'utf8').toString('hex').padEnd(64, '0')}`;
const uniqueToken = () => String(BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000)));

describe('profissão do token', () => {
  it('bytes32 → código do catálogo', () => {
    expect(professionText(bytes32('padeiro'))).toBe('padeiro');
  });
});

/** Feed de mentira com a mesma forma do /internal/v1/chain/events. */
class Feed {
  list: FeedEvent[] = [];
  private add(event: string, args: FeedEvent['args']) {
    this.list.push({ id: this.list.length + 1, contract: 'AvatarNFT', event, args });
  }
  /** O que o AvatarNFT emite no mint: o Transfer do ERC-721 e o AvatarMinted. */
  mint(to: string, tokenId: string, rarity = 0, profession = 'padeiro') {
    this.add('Transfer', { from: ZERO, to, tokenId });
    this.add('AvatarMinted', { tokenId, to, rarity, profession: bytes32(profession) });
  }
  transfer(from: string, to: string, tokenId: string) {
    this.add('Transfer', { from, to, tokenId });
  }
  async events(after: number, limit: number) {
    const events = this.list.filter((e) => e.id > after).slice(0, limit);
    return { events, nextAfter: events.at(-1)?.id ?? after };
  }
}

describe('chain.sync', () => {
  let avatars: MemoryAvatarStore;
  let feed: Feed;
  let links: Map<string, string>;
  let store: MemoryChainSyncStore;
  let clock: Date;

  beforeEach(() => {
    avatars = new MemoryAvatarStore();
    feed = new Feed();
    links = new Map();
    store = new MemoryChainSyncStore();
    clock = T0;
  });

  const run = () =>
    syncChain({ feed, owners: { ownerOf: async (a) => links.get(a) ?? null }, store, avatars, now: () => clock }, 2);

  it('o avatar revelado pela Lucky Box entra no jogo uma vez, com a raridade e a profissão do token', async () => {
    const alice = randomUUID();
    links.set(ALICE, alice);
    feed.mint(ALICE, '7', 1, 'dentista');
    expect(await run()).toEqual({ created: 1, transferred: 0, pending: 0, rejected: 0 });
    const [a] = await avatars.listByAccount(alice);
    expect(a).toMatchObject({ tokenId: '7', rarity: 'rare', jobCode: 'dentista', accountId: alice });
    expect(await run()).toEqual({ created: 0, transferred: 0, pending: 0, rejected: 0 });
    expect(await avatars.listByAccount(alice)).toHaveLength(1);
  });

  it('vendido na blockchain, o avatar passa para a conta do comprador com os atributos de agora', async () => {
    const alice = randomUUID();
    const bob = randomUUID();
    links.set(ALICE, alice).set(BOB, bob);
    feed.mint(ALICE, '8');
    await run();
    const before = (await avatars.getByToken('8'))!;
    clock = new Date(T0.getTime() + 3_600_000);
    feed.transfer(ALICE, BOB, '8');
    expect(await run()).toMatchObject({ transferred: 1 });
    const after = (await avatars.getByToken('8'))!;
    expect(after).toMatchObject({ id: before.id, accountId: bob, attributes: before.attributes });
    expect(after.ownedSince).toEqual(clock);
    expect(await avatars.listByAccount(alice)).toEqual([]);
  });

  it('mint para carteira sem conta: espera; se o token muda de mão antes, o avatar nasce na última carteira', async () => {
    feed.mint(ALICE, '9');
    expect(await run()).toMatchObject({ created: 0, pending: 1 });
    feed.transfer(ALICE, BOB, '9');
    await run();
    // Alice liga a carteira depois: o token já não é dela.
    links.set(ALICE, randomUUID());
    expect(await run()).toMatchObject({ created: 0, pending: 1 });
    const bob = randomUUID();
    links.set(BOB, bob);
    expect(await run()).toMatchObject({ created: 1, pending: 0 });
    expect((await avatars.getByToken('9'))!.accountId).toBe(bob);
    expect(await store.pending(10)).toEqual([]);
  });

  it('venda para carteira sem conta: o jogo mantém o dono até a carteira ser ligada; vale a última venda', async () => {
    const alice = randomUUID();
    const carol = randomUUID();
    links.set(ALICE, alice);
    feed.mint(ALICE, '10');
    feed.transfer(ALICE, BOB, '10');
    expect(await run()).toMatchObject({ created: 1, pending: 1 });
    expect((await avatars.getByToken('10'))!.accountId).toBe(alice);
    feed.transfer(BOB, CAROL, '10');
    links.set(CAROL, carol);
    await run();
    expect((await avatars.getByToken('10'))!.accountId).toBe(carol);
    links.set(BOB, randomUUID());
    await run();
    expect((await avatars.getByToken('10'))!.accountId).toBe(carol);
  });

  it('profissão fora do catálogo: o mint fica pendente, sem criar avatar', async () => {
    links.set(ALICE, randomUUID());
    feed.mint(ALICE, '11', 0, 'astronauta');
    expect(await run()).toMatchObject({ created: 0, rejected: 1 });
    expect(await avatars.getByToken('11')).toBeNull();
    expect((await store.getPending('11'))!.mint).toEqual({ rarity: 0, profession: 'astronauta' });
  });

  it('o avatar da blockchain entra mesmo com a conta no limite; só os mais antigos na conta trabalham', async () => {
    const alice = randomUUID();
    links.set(ALICE, alice);
    for (let i = 0; i < MAX_AVATARS_PER_ACCOUNT; i++) {
      await avatars.create(newAvatar({ id: randomUUID(), accountId: alice, rarity: 'common', jobCode: 'padeiro' }, new Date(T0.getTime() - (i + 1) * 1000)));
    }
    feed.mint(ALICE, '12');
    expect(await run()).toMatchObject({ created: 1 });
    const owned = await avatars.listByAccount(alice);
    expect(owned).toHaveLength(MAX_AVATARS_PER_ACCOUNT + 1);
    const chain = (await avatars.getByToken('12'))!;
    expect(mayWork(owned, chain.id)).toBe(false);
    expect(owned.filter((a) => a.id !== chain.id).every((a) => mayWork(owned, a.id))).toBe(true);
  });
});

describe.each([
  ['memória', () => new MemoryAvatarStore() as AvatarStore, true],
  ['postgres', () => new PostgresAvatarStore(pool!) as AvatarStore, pool !== null],
] as const)('AvatarStore na blockchain (%s)', (_name, make, enabled) => {
  it.runIf(enabled)('cria uma vez por token, acha pelo token e passa de dono só a partir do dono certo', async () => {
    const avatars = make();
    const tokenId = uniqueToken();
    const alice = randomUUID();
    const bob = randomUUID();
    const a = newAvatar({ id: randomUUID(), tokenId, accountId: alice, rarity: 'common', jobCode: 'padeiro' }, T0);
    await avatars.createFromChain({ ...a, tokenId });
    const again = await avatars.createFromChain({ ...a, id: randomUUID(), tokenId });
    expect(again.id).toBe(a.id);
    expect((await avatars.getByToken(tokenId))!.accountId).toBe(alice);
    expect(await avatars.transfer(a.id, bob, randomUUID(), T0)).toBe(false);
    const later = new Date(T0.getTime() + 60_000);
    expect(await avatars.transfer(a.id, alice, bob, later)).toBe(true);
    const moved = (await avatars.get(a.id))!;
    expect(moved).toMatchObject({ accountId: bob, tokenId });
    expect(moved.ownedSince).toEqual(later);
  });

  it.runIf(enabled)('o avatar só do jogo não tem token e é da conta desde a criação', async () => {
    const avatars = make();
    const a = newAvatar({ id: randomUUID(), accountId: randomUUID(), rarity: 'common', jobCode: 'padeiro' }, T0);
    await avatars.create(a);
    expect(await avatars.get(a.id)).toMatchObject({ tokenId: null, ownedSince: T0 });
  });
});

describe.each([
  ['memória', () => new MemoryChainSyncStore() as ChainSyncStore, true],
  ['postgres', () => new PostgresChainSyncStore(pool!) as ChainSyncStore, pool !== null],
] as const)('ChainSyncStore (%s)', (_name, make, enabled) => {
  it.runIf(enabled)('cursor e uma pendente por token', async () => {
    const store = make();
    const base = Math.floor(Math.random() * 1e8);
    await store.setCursor(base);
    expect(await store.cursor()).toBe(base);
    const token = uniqueToken();
    await store.putPending({ tokenId: token, eventId: base + 1, to: ALICE, mint: { rarity: 2, profession: 'padeiro' } });
    await store.putPending({ tokenId: token, eventId: base + 2, to: BOB, mint: null });
    expect(await store.getPending(token)).toEqual({ tokenId: token, eventId: base + 2, to: BOB, mint: null });
    await store.dropPending(token);
    expect(await store.getPending(token)).toBeNull();
  });
});
