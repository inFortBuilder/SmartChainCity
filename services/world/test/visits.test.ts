import { randomUUID } from 'node:crypto';

import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Building } from '../src/domain/buildings.js';
import { DAY_MS, type Property } from '../src/domain/properties.js';
import { type GuestStore, MAX_GUESTS } from '../src/domain/visits.js';
import { PostgresGuestStore } from '../src/infra/db/postgres-guest-store.js';
import { MemoryBuildingStore } from '../src/infra/memory-building-store.js';
import { MemoryGuestStore } from '../src/infra/memory-guest-store.js';
import { MemoryPropertyStore } from '../src/infra/memory-property-store.js';
import { MemoryWorldStore } from '../src/infra/memory-store.js';
import { testCity, testLots } from './fixtures.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const T0 = new Date('2026-11-21T12:00:00Z');
const at = (days: number) => new Date(T0.getTime() + days * DAY_MS);
const WALLET = '0x90f79bf6eb2c4f870365e785982e1f101e93b906';

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 3 }) : null;
afterAll(async () => {
  await pool?.end();
});

const auth = async (accountId: string) => ({
  authorization: `Bearer ${await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(accountId)
    .setIssuer('scc-gateway')
    .setAudience('scc-api')
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET))}`,
});

const house = (owner: string, lotId: number, over: Partial<Property> = {}): Property => ({
  id: randomUUID(),
  city: 'teste',
  lotId,
  ownerAccountId: owner,
  type: 't1',
  level: 1,
  status: 'active',
  priceCents: 4000_00,
  createdAt: at(-2),
  readyAt: at(-1),
  wearBase: 100,
  wearSince: at(-1),
  lastClaimAt: at(-1),
  ...over,
});

const office = (owner: string, lotId: number, over: Partial<Building> = {}): Building => ({
  id: randomUUID(),
  city: 'teste',
  lotId,
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
  modelSha256: 'a'.repeat(64),
  status: 'approved',
  reviewNote: null,
  createdAt: T0,
  reviewedAt: T0,
  ...over,
});

describe('visitas pelo street view (API)', () => {
  const owner = randomUUID();
  const friend = randomUUID();
  const stranger = randomUUID();
  let properties: MemoryPropertyStore;
  let buildings: MemoryBuildingStore;
  let world: Awaited<ReturnType<typeof buildApp>>;
  let home: Property;

  beforeEach(async () => {
    const lots = new MemoryWorldStore();
    await lots.importCity(testCity('teste'), testLots());
    properties = new MemoryPropertyStore();
    buildings = new MemoryBuildingStore();
    home = house(owner, 4);
    await properties.createProperty(home);
    world = await buildApp(
      loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET }),
      lots,
      () => T0,
      null,
      null,
      { store: properties, payments: null },
      null,
      { store: buildings, builder: null, payments: null },
      undefined,
      null,
      { store: new MemoryGuestStore(), owners: { ownerOf: async (w: string) => (w === WALLET ? friend : null) } },
    );
  });

  const visit = async (who: string, lot = 4) =>
    world.inject({ method: 'GET', url: `/v1/world/cities/teste/lots/${lot}/visit`, headers: await auth(who) });

  it('o dono entra; o convidado entra depois do convite pela carteira; outro não', async () => {
    expect((await visit(owner)).json()).toMatchObject({ role: 'owner', place: { kind: 'property', id: home.id, interior: 'home' } });
    expect((await visit(friend)).json().error.code).toBe('not_invited');

    const invite = await world.inject({
      method: 'POST',
      url: `/v1/world/places/property/${home.id}/guests`,
      headers: await auth(owner),
      payload: { wallet: WALLET.toUpperCase().replace('0X', '0x') },
    });
    expect(invite.statusCode).toBe(201);
    expect((await visit(friend)).json()).toMatchObject({ role: 'guest', place: { interior: 'home' } });
    expect((await visit(stranger)).statusCode).toBe(403);

    // Só o dono vê e mexe nos convidados.
    const list = await world.inject({ method: 'GET', url: `/v1/world/places/property/${home.id}/guests`, headers: await auth(owner) });
    expect(list.json().guests.map((g: { account_id: string }) => g.account_id)).toEqual([friend]);
    expect((await world.inject({ method: 'GET', url: `/v1/world/places/property/${home.id}/guests`, headers: await auth(friend) })).statusCode).toBe(404);

    const mine = await world.inject({ method: 'GET', url: '/v1/world/me/invitations', headers: await auth(friend) });
    expect(mine.json().invitations).toMatchObject([{ place: { id: home.id, lot_id: 4 } }]);

    await world.inject({ method: 'DELETE', url: `/v1/world/places/property/${home.id}/guests/${friend}`, headers: await auth(owner) });
    expect((await visit(friend)).statusCode).toBe(403);
  });

  it('o convite para de valer quando o imóvel muda de dono', async () => {
    await world.inject({ method: 'POST', url: `/v1/world/places/property/${home.id}/guests`, headers: await auth(owner), payload: { account_id: friend } });
    expect((await visit(friend)).statusCode).toBe(200);
    await properties.transferProperty(home.id, owner, stranger);
    expect((await visit(friend)).json().error.code).toBe('not_invited');
    expect((await visit(stranger)).json().role).toBe('owner');
    expect((await world.inject({ method: 'GET', url: '/v1/world/me/invitations', headers: await auth(friend) })).json().invitations).toEqual([]);
  });

  it('prédio aprovado é escritório; prédio em análise, obra e lote vazio não', async () => {
    const b = office(owner, 5);
    await buildings.createBuilding(b);
    expect((await visit(owner, 5)).json()).toMatchObject({ role: 'owner', place: { kind: 'building', interior: 'office', id: b.id } });
    await buildings.createBuilding(office(owner, 6, { status: 'pending_review' }));
    expect((await visit(owner, 6)).json().error.code).toBe('nothing_to_visit');
    await properties.createProperty(house(owner, 7, { readyAt: at(1) }));
    expect((await visit(owner, 7)).json().error.code).toBe('under_construction');
    expect((await visit(owner, 8)).statusCode).toBe(404);
  });

  it('erros do convite: carteira sem conta, a si mesmo, imóvel alheio, corpo inválido', async () => {
    const post = async (who: string, payload: object) =>
      world.inject({ method: 'POST', url: `/v1/world/places/property/${home.id}/guests`, headers: await auth(who), payload });
    expect((await post(owner, { wallet: '0x0000000000000000000000000000000000000001' })).json().error.code).toBe('wallet_unknown');
    expect((await post(owner, { account_id: owner })).json().error.code).toBe('self_invite');
    expect((await post(stranger, { account_id: friend })).statusCode).toBe(404);
    expect((await post(owner, {})).statusCode).toBe(400);
    expect((await world.inject({ method: 'GET', url: '/v1/world/cities/teste/lots/4/visit' })).statusCode).toBe(401);
  });
});

describe.each([
  ['memória', () => new MemoryGuestStore() as GuestStore, true],
  ['postgres', () => new PostgresGuestStore(pool!) as GuestStore, pool !== null],
] as const)('GuestStore (%s)', (_name, make, enabled) => {
  it.skipIf(!enabled)('limite por imóvel, renovação sem contar duas vezes e convite do dono atual', async () => {
    const store = make();
    const place = randomUUID();
    const owner = randomUUID();
    const g = (guest: string, invitedBy = owner) => ({ kind: 'property' as const, placeId: place, guestAccountId: guest, invitedBy, createdAt: T0 });
    const first = randomUUID();
    await store.addGuest(g(first), 2);
    await store.addGuest(g(first), 2); // renovar não conta de novo
    await store.addGuest(g(randomUUID()), 2);
    await expect(store.addGuest(g(randomUUID()), 2)).rejects.toMatchObject({ code: 'guest_limit' });
    expect(await store.isGuest('property', place, first, owner)).toBe(true);
    expect(await store.isGuest('property', place, first, randomUUID())).toBe(false);
    expect((await store.invitationsOf(first)).map((x) => x.placeId)).toEqual([place]);
    expect(await store.removeGuest('property', place, first)).toBe(true);
    expect(await store.removeGuest('property', place, first)).toBe(false);
    expect(await store.guestsOf('property', place, owner)).toHaveLength(1);
    expect(MAX_GUESTS).toBe(20);
  });
});
