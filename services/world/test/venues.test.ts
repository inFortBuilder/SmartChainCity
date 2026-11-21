import { randomUUID } from 'node:crypto';

import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { DAY_MS, type Property, VENUE_TYPES, typeOf, venueOpen } from '../src/domain/properties.js';
import { PostgresPropertyStore } from '../src/infra/db/postgres-property-store.js';
import { MemoryPropertyStore } from '../src/infra/memory-property-store.js';
import { MemoryWorldStore } from '../src/infra/memory-store.js';
import { testCity, testLots, uniqueCode } from './fixtures.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const INTERNAL = 'chave-interna-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const T0 = new Date('2026-11-21T12:00:00Z');
const at = (days: number) => new Date(T0.getTime() + days * DAY_MS);

const venue = (over: Partial<Property> = {}): Property => ({
  id: randomUUID(),
  city: 'teste',
  lotId: 1,
  ownerAccountId: randomUUID(),
  type: 'academia',
  level: 1,
  status: 'active',
  priceCents: 6000_00,
  createdAt: at(-1),
  readyAt: T0,
  wearBase: 100,
  wearSince: T0,
  lastClaimAt: T0,
  ...over,
});

describe('negócios de lazer (E3.3)', () => {
  it('academia e galeria são tipos de lazer, sem renda do pool, abertos com a obra pronta e o desgaste em dia', () => {
    expect(VENUE_TYPES()).toEqual(['academia', 'galeria']);
    expect(typeOf('academia')).toMatchObject({ zones: ['commercial', 'mixed'], venue: { activity: 'academia', feeCents: 500 } });
    expect(typeOf('galeria')!.levels[0]!.incomeCentsPerDay).toBe(0);
    expect(venueOpen(venue(), T0)).toBe(true);
    expect(venueOpen(venue({ readyAt: at(1) }), T0)).toBe(false);
    // Desgaste abaixo de 30 (70 dias sem reparo): fechada para reforma.
    expect(venueOpen(venue(), at(71))).toBe(false);
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

  it('lista as academias e galerias da cidade sem expor o dono; a rota interna dá o dono ao game-core', async () => {
    const gym = venue({ lotId: 2 });
    const art = venue({ lotId: 3, type: 'galeria', readyAt: at(1) });
    await props.createProperty(gym);
    await props.createProperty(art);
    await props.createProperty(venue({ lotId: 4, type: 't1' }));

    const list = (await world.inject({ url: '/v1/world/cities/teste/venues', headers: await auth(gym.ownerAccountId) })).json().venues;
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({
      id: gym.id,
      type: 'academia',
      label: 'Academia',
      activity: 'academia',
      fee_cents: 500,
      lot_id: 2,
      lot_code: expect.any(String),
      open: true,
      phase: 'ready',
      mine: true,
    });
    expect(list[1]).toMatchObject({ type: 'galeria', open: false, phase: 'building', mine: false });
    expect(JSON.stringify(list)).not.toContain(gym.ownerAccountId);

    const denied = await world.inject({ url: `/internal/v1/venues/${gym.id}` });
    expect(denied.statusCode).toBe(403);
    const inside = await world.inject({ url: `/internal/v1/venues/${gym.id}`, headers: { 'x-service-token': INTERNAL } });
    expect(inside.json().venue).toMatchObject({ activity: 'academia', fee_cents: 500, owner_account_id: gym.ownerAccountId, open: true });
    const house = (await props.propertiesOf(gym.ownerAccountId)).find((p) => p.type === 't1')!;
    const notVenue = await world.inject({ url: `/internal/v1/venues/${house?.id ?? randomUUID()}`, headers: { 'x-service-token': INTERNAL } });
    expect(notVenue.statusCode).toBe(404);
  });
});

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 5 }) : null;
afterAll(() => pool?.end());

describe.skipIf(!pool)('negócios de lazer no Postgres', () => {
  it('propertiesOfTypes filtra cidade, tipo e situação', async () => {
    const store = new PostgresPropertyStore(pool!);
    const city = uniqueCode();
    const world = new (await import('../src/infra/db/postgres-store.js')).PostgresWorldStore(pool!);
    await world.importCity(testCity(city), testLots());
    const gym = venue({ city, lotId: 2 });
    await store.createProperty(gym);
    await store.createProperty(venue({ city, lotId: 3, type: 't1' }));
    await store.createProperty(venue({ city, lotId: 5, type: 'galeria', status: 'pending' }));
    const found = await store.propertiesOfTypes(city, ['academia', 'galeria'], 10);
    expect(found.map((p) => p.id)).toEqual([gym.id]);
    expect(await store.propertiesOfTypes(city, [], 10)).toEqual([]);
  });
});
