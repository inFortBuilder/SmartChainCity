import { randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';
import { SignJWT } from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { type Avatar, newAvatar, status } from '../src/domain/avatar.js';
import {
  HOSPITAL_FEE_CENTS,
  HOSPITAL_STAY_MS,
  type HospitalPayer,
  type HospitalStay,
  admit,
  needsHospital,
} from '../src/domain/hospital.js';
import { planMeal } from '../src/domain/meal.js';
import { startShift } from '../src/domain/shift.js';
import { EconomyPayer } from '../src/infra/economy-payer.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';
import { runHospital } from '../src/jobs/hospital.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const INTERNAL = 'chave-interna-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: INTERNAL });
const HOUR = 3_600_000;
const t0 = new Date('2026-11-13T08:00:00Z');

const make = (attrs: Partial<Avatar['attributes']> = {}, accountId = randomUUID()): Avatar => {
  const a = newAvatar({ id: randomUUID(), accountId, rarity: 'common', jobCode: 'padeiro' }, t0);
  return { ...a, attributes: { ...a.attributes, ...attrs } };
};

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return null;
};

/** Ledger falso: saldo por conta, idempotente pela internação, e pode cair. */
class FakeLedger implements HospitalPayer {
  balances = new Map<string, bigint>();
  charged = new Map<string, bigint>();
  down = false;
  async chargeHospital(stay: HospitalStay) {
    if (this.down) throw new AppError('ledger_unavailable', 'O ledger não respondeu.', 502);
    if (this.charged.has(stay.id)) return;
    const balance = this.balances.get(stay.accountId) ?? 0n;
    if (balance < stay.feeCents) throw new AppError('insufficient_thaler', 'THALER insuficiente.', 409);
    this.balances.set(stay.accountId, balance - stay.feeCents);
    this.charged.set(stay.id, stay.feeCents);
  }
}

describe('regras do hospital', () => {
  it('saúde 0 ou energia 0 interna; saúde vem primeiro como motivo', () => {
    expect(needsHospital(make(), t0)).toBeNull();
    expect(needsHospital(make({ energy: 0 }), t0)).toBe('energy');
    expect(needsHospital(make({ health: 0, energy: 0 }), t0)).toBe('health');
  });

  it('a internação dura 1 dia, cobra 30 THALER e dá alta com energia e saúde cheias', () => {
    const { stay, avatar } = admit(make({ energy: 0, health: 3 }), randomUUID(), t0)!;
    expect(stay).toMatchObject({ reason: 'energy', feeCents: 3000n, feeStatus: 'pending' });
    expect(HOSPITAL_FEE_CENTS).toBe(3000n);
    expect(stay.dischargeAt.getTime() - t0.getTime()).toBe(HOSPITAL_STAY_MS);
    expect(avatar.attributes).toMatchObject({ energy: 10, health: 10 });
    expect(avatar.hospitalUntil).toEqual(stay.dischargeAt);
  });

  it('internado não trabalha nem come; com a alta, volta a poder', () => {
    const { avatar } = admit(make({ energy: 0, food: 4 }), randomUUID(), t0)!;
    expect(status(avatar, t0)).toMatchObject({ inHospital: true, canWork: false, canLeisure: false });
    // Já internado: não interna de novo até a alta.
    expect(needsHospital({ ...avatar, attributes: { ...avatar.attributes, energy: 0 } }, t0)).toBeNull();
    const shift = () => startShift(avatar, { id: randomUUID(), hours: 6, hoursToday: 0, running: false }, t0);
    const meal = () => planMeal(avatar, { id: randomUUID(), foodCode: 'maca', clientKey: null }, t0);
    expect(code(shift)).toBe('in_hospital');
    expect(code(meal)).toBe('in_hospital');
    const later = new Date(t0.getTime() + HOSPITAL_STAY_MS);
    expect(status(avatar, later)).toMatchObject({ inHospital: false, canWork: true });
    expect(code(() => startShift(avatar, { id: randomUUID(), hours: 6, hoursToday: 0, running: false }, later))).toBeNull();
  });
});

describe('cobrança da taxa', () => {
  it('manda o THALER do jogador para a queima, com a chave da internação', async () => {
    const calls: { headers: Record<string, string>; body: { kind: string; legs: unknown[] } }[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      calls.push({ headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
      return new Response('{}', { status: 201 });
    }) as typeof fetch;
    const { stay } = admit(make({ health: 0 }), randomUUID(), t0)!;
    await new EconomyPayer('http://economy', 'token', fetchFn).chargeHospital(stay, 'req-1');
    expect(calls[0]!.headers['idempotency-key']).toBe(`hospital:${stay.id}`);
    expect(calls[0]!.headers['x-request-id']).toBe('req-1');
    expect(calls[0]!.body.kind).toBe('hospital_fee');
    expect(calls[0]!.body.legs).toEqual([
      { owner_type: 'player', owner_id: stay.accountId, currency: 'THALER', amount: '-3000' },
      { owner_type: 'burn', owner_id: 'hospital', currency: 'THALER', amount: '3000' },
    ]);
  });
});

describe('job hospital.admit', () => {
  it('interna, cobra quem tem saldo e perdoa quem não tem', async () => {
    const store = new MemoryAvatarStore();
    const ledger = new FakeLedger();
    const rich = await store.create(make({ energy: 0 }));
    const poor = await store.create(make({ health: 0 }));
    await store.create(make());
    ledger.balances.set(rich.accountId, 5000n);
    expect(await runHospital(store, ledger, t0)).toEqual({ admitted: 2, charged: 2 });
    expect((await store.listStays(rich.id, 5))[0]!.feeStatus).toBe('paid');
    expect((await store.listStays(poor.id, 5))[0]!.feeStatus).toBe('waived');
    expect(ledger.balances.get(rich.accountId)).toBe(2000n);
    // Rodar de novo não interna nem cobra outra vez.
    expect(await runHospital(store, ledger, t0)).toEqual({ admitted: 0, charged: 0 });
  });

  it('ledger fora: interna mesmo assim, e a taxa é cobrada na passada seguinte', async () => {
    const store = new MemoryAvatarStore();
    const ledger = new FakeLedger();
    const a = await store.create(make({ energy: 0 }));
    ledger.balances.set(a.accountId, 5000n);
    ledger.down = true;
    expect(await runHospital(store, ledger, t0)).toEqual({ admitted: 1, charged: 0 });
    expect((await store.get(a.id))!.hospitalUntil).not.toBeNull();
    ledger.down = false;
    expect(await runHospital(store, ledger, t0)).toEqual({ admitted: 0, charged: 1 });
    expect(ledger.balances.get(a.accountId)).toBe(2000n);
  });
});

describe('API do hospital', () => {
  let clock: Date;
  let ledger: FakeLedger;
  let store: MemoryAvatarStore;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    clock = new Date(t0);
    ledger = new FakeLedger();
    store = new MemoryAvatarStore();
    app = await buildApp(config, store, () => clock, null, null, ledger);
  });

  const auth = async (accountId: string) => ({
    authorization: `Bearer ${await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(accountId)
      .setIssuer('scc-gateway')
      .setAudience('scc-api')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(SECRET))}`,
  });

  it('o turno que zera a energia interna quando acaba, e o avatar fica 1 dia sem trabalhar', async () => {
    const a = await store.create(make({ energy: 3 }));
    ledger.balances.set(a.accountId, 5000n);
    const headers = await auth(a.accountId);
    const work = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/work`, headers, payload: { shift: 6 } });
    expect(work.statusCode).toBe(201);

    // Com o turno rodando, a energia está em 0 mas a internação espera.
    let view = await app.inject({ url: `/v1/avatars/${a.id}`, headers });
    expect(view.json().avatar).toMatchObject({ attributes: { energy: 0 }, hospital_until: null });

    clock = new Date(t0.getTime() + 6 * HOUR);
    view = await app.inject({ url: `/v1/avatars/${a.id}`, headers });
    const until = new Date(clock.getTime() + HOSPITAL_STAY_MS).toISOString();
    expect(view.json().avatar).toMatchObject({
      attributes: { energy: 10, health: 10 },
      status: { inHospital: true, canWork: false },
      hospital_until: until,
    });
    expect(ledger.balances.get(a.accountId)).toBe(2000n);

    const again = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/work`, headers, payload: { shift: 6 } });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('in_hospital');

    const stays = await app.inject({ url: `/v1/avatars/${a.id}/hospital`, headers });
    expect(stays.json().stays).toMatchObject([
      { reason: 'energy', fee: '3000', decimals: 2, fee_status: 'paid', discharge_at: until },
    ]);

    // Alta: um dia depois, trabalha de novo.
    clock = new Date(clock.getTime() + HOSPITAL_STAY_MS);
    const after = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/work`, headers, payload: { shift: 6 } });
    expect(after.statusCode).toBe(201);
  });

  it('sem ledger, interna do mesmo jeito e a taxa fica pendente', async () => {
    const closed = await buildApp(config, store, () => clock);
    const a = await store.create(make({ health: 0 }));
    const r = await closed.inject({ url: `/v1/avatars/${a.id}/hospital`, headers: await auth(a.accountId) });
    expect(r.json().stays).toMatchObject([{ reason: 'health', fee_status: 'pending' }]);
  });

  it('a lista de avatares também interna, e de outra conta é 404 sem internar', async () => {
    const a = await store.create(make({ energy: 0 }));
    expect((await app.inject({ url: `/v1/avatars/${a.id}/hospital`, headers: await auth(randomUUID()) })).statusCode).toBe(404);
    expect(await store.listStays(a.id, 5)).toHaveLength(0);
    const list = await app.inject({ url: '/v1/avatars', headers: await auth(a.accountId) });
    expect(list.json().avatars[0].status.inHospital).toBe(true);
    // Sem saldo: perdoada.
    expect((await store.listStays(a.id, 5))[0]!.feeStatus).toBe('waived');
  });
});
