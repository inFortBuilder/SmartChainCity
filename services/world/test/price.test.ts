import { buildApp as buildEconomy } from '@scc/economy/src/app.js';
import { loadConfig as economyConfig } from '@scc/economy/src/config.js';
import { rateFromUsd } from '@scc/economy/src/domain/exchange.js';
import { MemoryExchangeStore } from '@scc/economy/src/infra/memory-exchange-store.js';
import { MemoryLedgerStore } from '@scc/economy/src/infra/memory-store.js';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { EconomyScityPrice } from '../src/infra/economy-price.js';
import { MemoryWorldStore } from '../src/infra/memory-store.js';
import { testCity, testLots } from './fixtures.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const INTERNAL = 'chave-interna-do-economy-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)

describe('cotação do SCITY vinda do câmbio do economy', () => {
  let economy: Awaited<ReturnType<typeof buildEconomy>> | null = null;
  afterEach(async () => {
    await economy?.close();
    economy = null;
  });

  it('o preço do lote em SCITY segue a cotação; sem o economy, fica a última conhecida', async () => {
    const fx = new MemoryExchangeStore();
    await fx.setRate(rateFromUsd(1, new Date(Date.now() - 1000), 'teste'));
    economy = await buildEconomy(economyConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: INTERNAL }), new MemoryLedgerStore(), undefined, null, {
      store: fx,
      earnings: null,
      poolStart: null,
      freeUntil: null,
    });
    const url = await economy.listen({ port: 0, host: '127.0.0.1' });

    const price = new EconomyScityPrice(url, 3);
    expect(price.usd()).toBe(3); // antes da primeira leitura: o valor do .env
    expect(await price.refresh()).toBe(true);
    expect(price.usd()).toBe(1);

    const lots = new MemoryWorldStore();
    await lots.importCity(testCity('teste'), testLots());
    const world = await buildApp(loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET }), lots, undefined, null, null, null, null, null, price.usd);
    const priceOfLot = async () => (await world.inject({ url: '/v1/world/cities/teste/lots/4' })).json().lot;
    const at1 = await priceOfLot();

    // O SCITY cai à metade: o mesmo lote em dólar custa o dobro em SCITY.
    await economy.inject({ method: 'POST', url: '/internal/v1/economy/fx', headers: { 'x-service-token': INTERNAL }, payload: { scity_usd: 0.5 } });
    await price.refresh();
    const atHalf = await priceOfLot();
    expect(atHalf.price_usd).toBe(at1.price_usd);
    expect(Number(atHalf.price_scity)).toBeCloseTo(Number(at1.price_scity) * 2, 5);
    expect((await world.inject({ url: '/v1/world/cities/teste' })).json().city.scity_usd).toBe(0.5);

    await economy.close();
    economy = null;
    expect(await price.refresh()).toBe(false);
    expect(price.usd()).toBe(0.5);
  });
});
