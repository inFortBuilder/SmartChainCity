import { randomUUID } from 'node:crypto';

import { buildApp as buildEconomy } from '@scc/economy/src/app.js';
import { loadConfig as economyConfig } from '@scc/economy/src/config.js';
import { MemoryLedgerStore } from '@scc/economy/src/infra/memory-store.js';
import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { type CmsPropertyType, fetchCmsPropertyTypes, mergeCatalog } from '../src/domain/catalog.js';
import {
  DAY_MS,
  DEFAULT_PROPERTY_TYPES,
  buildable,
  chainTypeAndLevel,
  familyOf,
  nextTypeOf,
  propertyTypes,
  setPropertyCatalog,
  typeOf,
} from '../src/domain/properties.js';
import { LedgerLandPayments } from '../src/infra/ledger-payments.js';
import { LedgerPropertyPayments } from '../src/infra/ledger-property-payments.js';
import { MemoryPropertyStore } from '../src/infra/memory-property-store.js';
import { MemoryWorldStore } from '../src/infra/memory-store.js';
import { testCity, testLots } from './fixtures.js';

/** Catálogo de imóveis do Strapi e troca de tipo T1 → T2 → T3 (doc 03 §6.1). */
afterEach(() => setPropertyCatalog([]));

const cms = (over: Partial<CmsPropertyType> & { code: string }): CmsPropertyType => ({
  label: over.code,
  zone: 'residential',
  lots: 1,
  availability: 'always',
  levels: [{ level: 1 }],
  ...over,
});

describe('catálogo do Strapi', () => {
  it('o CMS vale; o que falta vem do código; sem preço ou renda, aparece e não constrói', () => {
    const types = mergeCatalog([
      cms({ code: 't1', levels: [{ level: 1 }, { level: 2 }, { level: 3 }] }),
      cms({ code: 't2', upgradesFrom: 't1', price: 8000, levels: [{ level: 1, maxIncome: 26 }] }),
      cms({ code: 'mercado', zone: 'commercial', levels: [{ level: 1 }] }),
      cms({ code: 'residencial_1', availability: 'events', price: 9000, levels: [{ level: 1, maxIncome: 30 }] }),
      cms({ code: 'residencial_3', lots: 2, price: 9000, levels: [{ level: 1, maxIncome: 30 }] }),
      cms({ code: 'restaurante', zone: 'commercial', price: 5000, buildMinutes: 600, levels: [{ level: 1, maxIncome: 12 }] }),
    ]);
    const by = (c: string) => types.find((t) => t.code === c)!;
    // T1 sem valores no CMS: tudo do código, os três níveis.
    expect(by('t1')).toMatchObject({ priceCents: 4000_00, levels: [{ incomeCentsPerDay: 10_00 }, { incomeCentsPerDay: 15_00 }, { incomeCentsPerDay: 20_00 }] });
    expect(by('t1').available).toBeUndefined();
    // T2 com o preço e a renda do nível 1 do CMS; os níveis 2 e 3 não vieram, então param no 1.
    expect(by('t2')).toMatchObject({ priceCents: 8000_00, upgradesFrom: 't1', levels: [{ level: 1, incomeCentsPerDay: 26_00 }] });
    expect(by('mercado')).toMatchObject({ available: false, zones: ['commercial', 'mixed'], use: 'comercial' });
    expect(by('residencial_1')).toMatchObject({ available: false, unavailableReason: 'Raro: só em eventos.' });
    expect(by('residencial_3')).toMatchObject({ available: false, unavailableReason: 'Lote duplo ainda não existe no jogo.' });
    expect(by('restaurante')).toMatchObject({ priceCents: 5000_00, buildMinutes: 600, use: 'comercial' });
    expect(buildable(by('restaurante'))).toBe(true);
    expect(buildable(by('t2'))).toBe(false);
    // Do código, o que o CMS não publicou (academia, galeria, T3) continua; a academia mantém a entrada.
    expect(by('academia').venue).toMatchObject({ activity: 'academia' });
    expect(by('t3')).toMatchObject({ upgradesFrom: 't2' });
    expect(mergeCatalog([])).toBe(DEFAULT_PROPERTY_TYPES);
  });

  it('lê os tipos publicados com os níveis', async () => {
    const urls: string[] = [];
    const fetchFn = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ data: [cms({ code: 't1' })] }), { status: 200 });
    }) as typeof fetch;
    expect(await fetchCmsPropertyTypes('http://cms/', fetchFn)).toHaveLength(1);
    expect(urls[0]).toBe('http://cms/api/property-types?pagination[pageSize]=200&populate=levels&sort=code');
    const down = (async () => new Response('', { status: 500 })) as typeof fetch;
    await expect(fetchCmsPropertyTypes('http://cms', down)).rejects.toThrow('500');
  });

  it('o catálogo em uso troca e volta ao de partida', () => {
    setPropertyCatalog(mergeCatalog([cms({ code: 'restaurante', zone: 'commercial', price: 5000, levels: [{ level: 1, maxIncome: 12 }] })]));
    expect(typeOf('restaurante')?.priceCents).toBe(5000_00);
    setPropertyCatalog([]);
    expect(typeOf('restaurante')).toBeUndefined();
    expect(propertyTypes()).toBe(DEFAULT_PROPERTY_TYPES);
  });
});

describe('troca de tipo e o PropertyNFT', () => {
  it('família T1 → T2 → T3 e o nível corrido no contrato', () => {
    expect(familyOf('t3').map((t) => t.code)).toEqual(['t1', 't2', 't3']);
    expect(nextTypeOf('t1')?.code).toBe('t2');
    expect(nextTypeOf('t3')).toBeUndefined();
    expect(chainTypeAndLevel({ type: 't1', level: 3 })).toEqual({ typeCode: 't1', level: 3 });
    expect(chainTypeAndLevel({ type: 't2', level: 1 })).toEqual({ typeCode: 't1', level: 4 });
    expect(chainTypeAndLevel({ type: 't3', level: 2 })).toEqual({ typeCode: 't1', level: 8 });
    expect(chainTypeAndLevel({ type: 'academia', level: 1 })).toEqual({ typeCode: 'academia', level: 1 });
  });
});

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const LEDGER_TOKEN = 'chave-interna-do-economy-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const T0 = new Date('2026-11-20T12:00:00Z');
const at = (days: number) => new Date(T0.getTime() + days * DAY_MS);

describe('troca de tipo de ponta a ponta (world + economy)', () => {
  let economy: Awaited<ReturnType<typeof buildEconomy>>;
  let world: Awaited<ReturnType<typeof buildApp>>;
  let clock: Date;

  beforeEach(async () => {
    economy = await buildEconomy(economyConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: LEDGER_TOKEN }), new MemoryLedgerStore());
    const ledgerUrl = await economy.listen({ port: 0, host: '127.0.0.1' });
    const store = new MemoryWorldStore();
    await store.importCity(testCity('teste'), testLots());
    clock = T0;
    world = await buildApp(
      loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET }),
      store,
      () => clock,
      new LedgerLandPayments(ledgerUrl, LEDGER_TOKEN),
      null,
      { store: new MemoryPropertyStore(), payments: new LedgerPropertyPayments(ledgerUrl, LEDGER_TOKEN) },
    );
  });
  afterEach(async () => {
    await economy.close();
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
  const credit = (owner: { owner_type: string; owner_id: string }, currency: 'SCITY' | 'THALER', amount: bigint) =>
    economy.inject({
      method: 'POST',
      url: '/internal/v1/ledger/transactions',
      headers: { 'x-service-token': LEDGER_TOKEN, 'idempotency-key': `credito-${randomUUID()}` },
      payload: {
        kind: 'test_credit',
        legs: [
          { owner_type: 'system', owner_id: 'bridge', currency, amount: `-${amount}` },
          { ...owner, currency, amount: `${amount}` },
        ],
      },
    });

  it('T2 não se constrói direto; a T1 no nível 3 troca para T2 pagando a diferença', async () => {
    await credit({ owner_type: 'pool', owner_id: 'p2e' }, 'THALER', 10_000_000n);
    const me = randomUUID();
    const headers = await auth(me);
    await credit({ owner_type: 'player', owner_id: me }, 'SCITY', 1000n * 10n ** 18n);
    await credit({ owner_type: 'player', owner_id: me }, 'THALER', 20_000_00n);
    await world.inject({ method: 'POST', url: '/v1/world/cities/teste/lots/4/buy', headers });

    const list = (await world.inject({ url: '/v1/world/property-types' })).json().types;
    expect(list.find((t: { code: string }) => t.code === 't2')).toMatchObject({ upgrades_from: 't1', buildable: false, available: true });
    const direct = await world.inject({ method: 'POST', url: '/v1/world/cities/teste/lots/4/property', headers, payload: { type: 't2' } });
    expect(direct.json().error.code).toBe('type_by_upgrade');

    const id = (await world.inject({ method: 'POST', url: '/v1/world/cities/teste/lots/4/property', headers, payload: { type: 't1' } })).json().property.id;
    clock = at(1);
    const early = await world.inject({ method: 'POST', url: `/v1/world/properties/${id}/retype`, headers });
    expect(early.json().error.code).toBe('max_level_first');
    await world.inject({ method: 'POST', url: `/v1/world/properties/${id}/upgrade`, headers });
    const l3 = await world.inject({ method: 'POST', url: `/v1/world/properties/${id}/upgrade`, headers });
    expect(l3.json().property).toMatchObject({ level: 3, next_type: { code: 't2', cost_cents: 3000_00, ready: true }, chain: { typeCode: 't1', level: 3 } });

    const retype = await world.inject({ method: 'POST', url: `/v1/world/properties/${id}/retype`, headers });
    expect(retype.statusCode).toBe(200);
    expect(retype.json().work).toMatchObject({ kind: 'retype', cost_cents: 3000_00, to_type: 't2' });
    expect(retype.json().property).toMatchObject({
      type: 't2',
      label: 'Casa T2',
      level: 1,
      income_cents_per_day: 24_00,
      chain: { typeCode: 't1', level: 4 },
      next_type: { code: 't3', ready: false },
    });
    // 20.000 − 4.000 (obra) − 2.000 − 4.000 (níveis) − 3.000 (troca), mais a renda fechada nas obras.
    const balance = (await economy.inject({ method: 'GET', url: '/v1/economy/balances', headers })).json().balances.find(
      (b: { currency: string }) => b.currency === 'THALER',
    ).amount;
    expect(BigInt(balance)).toBe(7000_00n);
  });
});
