import { randomUUID } from 'node:crypto';

import { SignJWT } from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { mergeCatalog } from '../src/domain/catalog.js';
import { DAY_MS, HOTEL_TYPES, type Property, hotelRooms, typeOf } from '../src/domain/properties.js';
import { MemoryPropertyStore } from '../src/infra/memory-property-store.js';
import { MemoryWorldStore } from '../src/infra/memory-store.js';
import { testCity, testLots } from './fixtures.js';

/** Hotel de jogador (GDD §6 "Hotel"): 3 níveis, quartos por nível; o game-core cobra a diária ao dono. */
const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const INTERNAL = 'chave-interna-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const T0 = new Date('2026-11-21T12:00:00Z');
const at = (days: number) => new Date(T0.getTime() + days * DAY_MS);

const hotel = (over: Partial<Property> = {}): Property => ({
  id: randomUUID(),
  city: 'teste',
  lotId: 1,
  ownerAccountId: randomUUID(),
  type: 'hotel',
  level: 1,
  status: 'active',
  priceCents: 9000_00,
  createdAt: at(-1),
  readyAt: T0,
  wearBase: 100,
  wearSince: T0,
  lastClaimAt: T0,
  ...over,
});

describe('hotel de jogador', () => {
  it('é um tipo comercial de 3 níveis, sem renda do pool, com 10, 20 e 40 quartos', () => {
    expect(HOTEL_TYPES()).toEqual(['hotel']);
    const t = typeOf('hotel')!;
    expect(t).toMatchObject({ zones: ['commercial', 'mixed'], use: 'comercial' });
    expect(t.levels.map((l) => l.incomeCentsPerDay)).toEqual([0, 0, 0]);
    expect([1, 2, 3].map((l) => hotelRooms(t, l))).toEqual([10, 20, 40]);
    expect(hotelRooms(typeOf('t1'), 1)).toBe(0);
    // O hotel do seed do Strapi (sem preço nem renda) herda os do código e os quartos.
    const merged = mergeCatalog([{ code: 'hotel', label: 'Hotel', zone: 'commercial', lots: 1, availability: 'always', levels: [{ level: 1 }, { level: 2 }, { level: 3 }] }]);
    expect(merged.find((x) => x.code === 'hotel')).toMatchObject({ priceCents: 9000_00, lodging: { roomsByLevel: { 3: 40 } } });
    expect(merged.find((x) => x.code === 'hotel')!.levels).toHaveLength(3);
    expect(merged.find((x) => x.code === 'hotel')).not.toHaveProperty('available');
  });

  let props: MemoryPropertyStore;
  let world: Awaited<ReturnType<typeof buildApp>>;
  beforeEach(async () => {
    const store = new MemoryWorldStore();
    await store.importCity(testCity('teste'), testLots());
    props = new MemoryPropertyStore();
    world = await buildApp(loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: INTERNAL }), store, () => T0, null, null, {
      store: props,
      payments: null,
    });
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

  it('lista os hotéis da cidade sem expor o dono; a rota interna dá o dono e os quartos ao game-core', async () => {
    const h = hotel({ lotId: 2, level: 2 });
    const building = hotel({ lotId: 3, readyAt: at(1) });
    await props.createProperty(h);
    await props.createProperty(building);
    await props.createProperty(hotel({ lotId: 4, type: 'academia' }));

    const list = (await world.inject({ url: '/v1/world/cities/teste/hotels', headers: await auth(h.ownerAccountId) })).json().hotels;
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({ id: h.id, label: 'Hotel', level: 2, rooms: 20, lot_id: 2, lot_code: expect.any(String), open: true, mine: true });
    expect(list[1]).toMatchObject({ id: building.id, open: false, mine: false });
    expect(JSON.stringify(list)).not.toContain(h.ownerAccountId);

    expect((await world.inject({ url: `/internal/v1/hotels/${h.id}` })).statusCode).toBe(403);
    const inside = await world.inject({ url: `/internal/v1/hotels/${h.id}`, headers: { 'x-service-token': INTERNAL } });
    expect(inside.json().hotel).toMatchObject({ id: h.id, city: 'teste', level: 2, rooms: 20, open: true, owner_account_id: h.ownerAccountId });
    const all = await world.inject({ url: '/internal/v1/cities/teste/hotels', headers: { 'x-service-token': INTERNAL } });
    expect(all.json().hotels.map((x: { owner_account_id: string }) => x.owner_account_id)).toEqual([h.ownerAccountId, building.ownerAccountId]);
    const gym = (await props.propertiesOfTypes('teste', ['academia'], 10))[0]!;
    expect((await world.inject({ url: `/internal/v1/hotels/${gym.id}`, headers: { 'x-service-token': INTERNAL } })).statusCode).toBe(404);
  });
});
