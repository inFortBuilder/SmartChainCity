import { randomUUID } from 'node:crypto';

import { buildApp as buildEconomy } from '@scc/economy/src/app.js';
import { loadConfig as economyConfig } from '@scc/economy/src/config.js';
import { MemoryLedgerStore } from '@scc/economy/src/infra/memory-store.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newAvatar } from '../src/domain/avatar.js';
import { ENTRY_CENTS, type Member, newChampionship, play } from '../src/domain/championship.js';
import { checkActivity } from '../src/domain/leisure.js';
import { planLeisure, planLicense, planPetShop, planSchool } from '../src/domain/meal.js';
import { ipvaCents, newVehicle, settleVehicle } from '../src/domain/vehicle.js';
import { newRace } from '../src/domain/race.js';
import { MemoryVehicleStore } from '../src/infra/memory-vehicle-store.js';
import { checkAdoption } from '../src/domain/pet.js';
import { checkClass } from '../src/domain/school.js';
import { EconomyPayer } from '../src/infra/economy-payer.js';

/**
 * As cobranças novas do game-core contra o economy de verdade: o ledger confere tipo de conta,
 * dono e soma zero, e um teste com ledger falso não pega um id de conta que ele recusa.
 */
const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const LEDGER_TOKEN = 'chave-interna-do-economy-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const t0 = new Date('2026-11-21T08:00:00Z');

let economy: Awaited<ReturnType<typeof buildEconomy>>;
let payer: EconomyPayer;
let ledger: MemoryLedgerStore;

beforeEach(async () => {
  ledger = new MemoryLedgerStore();
  economy = await buildEconomy(economyConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: LEDGER_TOKEN }), ledger);
  payer = new EconomyPayer(await economy.listen({ port: 0, host: '127.0.0.1' }), LEDGER_TOKEN);
});
afterEach(async () => {
  await economy.close();
});

const credit = (accountId: string, cents: bigint) =>
  economy.inject({
    method: 'POST',
    url: '/internal/v1/ledger/transactions',
    headers: { 'x-service-token': LEDGER_TOKEN, 'idempotency-key': `credito-${randomUUID()}` },
    payload: {
      kind: 'test_credit',
      legs: [
        { owner_type: 'system', owner_id: 'bridge', currency: 'THALER', amount: `-${cents}` },
        { owner_type: 'player', owner_id: accountId, currency: 'THALER', amount: `${cents}` },
      ],
    },
  });

const thaler = async (ownerType: 'player' | 'escrow', ownerId: string) =>
  (await ledger.balances(ownerType, ownerId)).find((b) => b.currency === 'THALER')?.amount ?? 0n;

const avatar = (accountId = randomUUID()) => newAvatar({ id: randomUUID(), accountId, rarity: 'common', jobCode: 'padeiro' }, t0);

describe('cobranças no economy de verdade', () => {
  it('Pet Shop, escola e entrada de lazer são aceitas e mexem nos saldos certos', async () => {
    const a = avatar();
    const owner = randomUUID();
    await credit(a.accountId, 20_000n);

    const pet = checkAdoption(a, { species: 'cat', name: 'Mia' }, t0);
    await payer.chargeMeal(planPetShop(a, { id: randomUUID(), clientKey: null, effect: { kind: 'adopt', species: 'cat', name: 'Mia' }, cents: pet.cents }, t0));
    const aula = checkClass(a, t0);
    await payer.chargeMeal(planSchool(a, { id: randomUUID(), clientKey: null, effect: { kind: 'class' }, cents: aula.cents }, t0));
    const gym = checkActivity(a, { activity: 'academia', venue: { id: randomUUID(), activity: 'academia', feeCents: 500n, ownerAccountId: owner, open: true }, venueId: 'x' }, t0);
    await payer.chargeMeal(planLeisure(a, { id: randomUUID(), clientKey: null, effect: gym.effect, cents: gym.cents }, t0));

    // 20.000 − 5.000 (gato) − 1.500 (aula) − 500 (academia).
    expect(await thaler('player', a.accountId)).toBe(13_000n);
    expect(await thaler('player', owner)).toBe(450n);
  });

  it('campeonato: inscrição para o escrow do mês e a disputa esvazia o escrow', async () => {
    const c = newChampionship('2026-11', 'ab'.repeat(32));
    const teams = ['A', 'B', 'C'].map((name) => ({ id: randomUUID(), championshipId: c.id, name, captainAccountId: randomUUID(), createdAt: t0 }));
    const members: Member[] = [];
    for (const t of teams) {
      for (let i = 0; i < 6; i++) {
        const accountId = randomUUID();
        await credit(accountId, ENTRY_CENTS);
        const m: Member = { championshipId: c.id, teamId: t.id, accountId, avatarId: randomUUID(), feeCents: ENTRY_CENTS, status: 'paid', joinedAt: t0 };
        await payer.chargeEntry(m);
        members.push(m);
      }
    }
    expect(await thaler('escrow', 'championship_2026_11')).toBe(18_000n);
    const result = play(c, teams, members, () => ({ energy: 5, health: 5, happiness: 5 }));
    await payer.payOut(c, result);
    await payer.payOut(c, result); // repetir não paga de novo (mesma chave)
    expect(await thaler('escrow', 'championship_2026_11')).toBe(0n);
    const winner = result.payouts.find((p) => p.cents === '1125')!;
    expect(await thaler('player', winner.accountId)).toBe(1125n);
  });

  it('veículos: autoescola, compra, IPVA e recompra da agência', async () => {
    const a = avatar();
    await credit(a.accountId, 400_000n);
    await payer.chargeMeal(planLicense(a, { id: randomUUID(), clientKey: null, cents: 5000n }, t0));
    const store = new MemoryVehicleStore();
    const car = newVehicle({ id: randomUUID(), accountId: a.accountId, model: 'hatch', rent: false }, t0);
    await store.create(car);
    await settleVehicle({ store, payer }, car);
    await payer.chargeVehicle({ key: `vehicle-ipva:${car.id}:1`, kind: 'vehicle_ipva', accountId: a.accountId, cents: ipvaCents('hatch'), sink: 'ipva', refId: car.id });
    await payer.payBuyback({ key: `vehicle-buyback:${car.id}`, accountId: a.accountId, cents: 100_000n, refId: car.id });
    await payer.payBuyback({ key: `vehicle-buyback:${car.id}`, accountId: a.accountId, cents: 100_000n, refId: car.id });
    // 400.000 − 5.000 − 300.000 − 6.000 + 100.000 (uma vez).
    expect(await thaler('player', a.accountId)).toBe(189_000n);
  });

  it('corrida: gasolina para a queima e prêmio do pool P2E, uma vez', async () => {
    const a = { ...avatar(), license: { readyAt: t0 } };
    await credit(a.accountId, 1000n);
    await economy.inject({
      method: 'POST',
      url: '/internal/v1/ledger/transactions',
      headers: { 'x-service-token': LEDGER_TOKEN, 'idempotency-key': 'pool-corrida' },
      payload: {
        kind: 'test_credit',
        legs: [
          { owner_type: 'system', owner_id: 'bridge', currency: 'THALER', amount: '-100000' },
          { owner_type: 'pool', owner_id: 'p2e', currency: 'THALER', amount: '100000' },
        ],
      },
    });
    const car = { ...newVehicle({ id: randomUUID(), accountId: a.accountId, model: 'super', rent: false }, t0), status: 'active' as const };
    const race = newRace({ id: randomUUID(), vehicle: car, avatar: a }, t0);
    const forced = { ...race, result: { ...race.result, prizeCents: '2000' } };
    await payer.chargeFuel(forced);
    await payer.payPrize(forced);
    await payer.payPrize(forced);
    // 1.000 − 300 de gasolina + 2.000 de prêmio (uma vez).
    expect(await thaler('player', a.accountId)).toBe(2700n);
  });
});
