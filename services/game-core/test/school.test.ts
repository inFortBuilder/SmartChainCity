import { randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { type Avatar, decayed, newAvatar, status } from '../src/domain/avatar.js';
import { professionsByRarity } from '../src/domain/catalog.js';
import { type Meal, type MealPayer, planSchool } from '../src/domain/meal.js';
import { applySchoolEffect, checkChange, checkClass, grade, schoolDto } from '../src/domain/school.js';
import { startShift } from '../src/domain/shift.js';
import { PostgresAvatarStore } from '../src/infra/db/postgres-store.js';
import { EconomyPayer } from '../src/infra/economy-payer.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const INTERNAL = 'chave-interna-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: INTERNAL });
const t0 = new Date('2026-11-21T08:00:00Z');
const HOUR = 3_600_000;
const at = (h: number) => new Date(t0.getTime() + h * HOUR);

const COMMON = Object.keys(professionsByRarity().common).filter((c) => c !== 'padeiro');
const RARE = Object.keys(professionsByRarity().rare);
const OTHER = COMMON[0]!;

const make = (attrs: Partial<Avatar['attributes']> = {}): Avatar => {
  const a = newAvatar({ id: randomUUID(), accountId: randomUUID(), rarity: 'common', jobCode: 'padeiro' }, t0);
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
const classAt = (a: Avatar, when: Date) => {
  const { cents: _c, ...effect } = checkClass(a, when);
  return applySchoolEffect(a, effect, when);
};

describe('regras da escola', () => {
  it('graus pelos marcos da ADR-0013', () => {
    expect([0, 32, 33, 65, 66, 99, 100].map(grade)).toEqual([0, 0, 1, 1, 2, 2, 3]);
  });

  it('aula: +2 de educação, −2 de energia, uma por dia, até 100', () => {
    let a = classAt(make({ education: 40, energy: 5 }), t0);
    expect(a.attributes).toMatchObject({ education: 42, energy: 3 });
    expect(code(() => checkClass(a, at(10)))).toBe('class_taken');
    // Dia seguinte (UTC) pode de novo.
    a = classAt(a, at(17));
    expect(a.attributes.education).toBe(44);
    expect(code(() => checkClass(make({ education: 100 }), t0))).toBe('max_education');
    expect(code(() => checkClass(make({ energy: 1 }), t0))).toBe('too_tired');
    expect(classAt(make({ education: 99 }), t0).attributes.education).toBe(100);
  });

  it('troca de profissão: mesma raridade, 4 dias sem trabalhar, +2 de felicidade no 1º e no 2º dia, educação mantida', () => {
    const base = make({ happiness: 5, education: 60 });
    expect(code(() => checkChange(base, 'padeiro', false, t0))).toBe('same_job');
    expect(code(() => checkChange(base, RARE[0]!, false, t0))).toBe('invalid_job');
    expect(code(() => checkChange(base, 'nao-existe', false, t0))).toBe('invalid_job');
    expect(code(() => checkChange(base, OTHER, true, t0))).toBe('shift_running');

    const { cents: _c, ...effect } = checkChange(base, OTHER, false, t0);
    const enrolled = applySchoolEffect(base, effect, t0);
    expect(enrolled.attributes.happiness).toBe(7);
    expect(status(enrolled, at(1)).canWork).toBe(false);
    expect(code(() => startShift(enrolled, { id: randomUUID(), hours: 6, hoursToday: 0, running: false }, at(1)))).toBe('in_school');
    expect(code(() => checkClass(enrolled, at(1)))).toBe('in_school');
    expect(code(() => checkChange(enrolled, COMMON[1]!, false, at(1)))).toBe('in_school');
    expect(schoolDto(enrolled, at(1)).changing_to).toMatchObject({ job: OTHER, ends_at: at(96).toISOString() });

    // 24 h depois, o segundo ponto (uma vez só).
    const day2 = decayed(enrolled, at(25));
    expect(day2.school!.change!.bonusGiven).toBe(2);
    expect(decayed(day2, at(30)).attributes.happiness).toBe(day2.attributes.happiness);
    expect(day2.jobCode).toBe('padeiro');

    const done = decayed(enrolled, at(96));
    expect(done.jobCode).toBe(OTHER);
    expect(done.school!.change).toBeNull();
    expect(done.attributes.education).toBe(60);
    expect(status(done, at(96)).canWork).toBe(true);
  });

  it('o ledger lança a escola como school_buy, para a queima da escola', async () => {
    const bodies: { kind: string; legs: { owner_id: string; amount: string }[] }[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response('{}', { status: 201 });
    }) as typeof fetch;
    const a = make();
    const { cents, ...effect } = checkChange(a, OTHER, false, t0);
    await new EconomyPayer('http://economy', 'token', fetchFn).chargeMeal(planSchool(a, { id: randomUUID(), clientKey: null, effect, cents }, t0));
    expect(bodies[0]).toMatchObject({ kind: 'school_buy', legs: [{ amount: '-10000' }, { owner_id: 'school', amount: '10000' }] });
  });
});

class FakeLedger implements MealPayer {
  balances = new Map<string, bigint>();
  async chargeMeal(meal: Meal) {
    const balance = this.balances.get(meal.accountId) ?? 0n;
    if (balance < meal.priceCents) throw new AppError('insufficient_thaler', 'THALER insuficiente.', 409);
    this.balances.set(meal.accountId, balance - meal.priceCents);
  }
}

describe('API da escola', () => {
  let ledger: FakeLedger;
  let store: MemoryAvatarStore;
  let clock: Date;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    ledger = new FakeLedger();
    store = new MemoryAvatarStore();
    clock = t0;
    app = await buildApp(config, store, () => clock, null, ledger, null, () => 0.5);
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

  it('aula paga uma vez por dia; troca de profissão bloqueia o turno e vale no fim', async () => {
    const a = await store.create(make({ education: 31 }));
    ledger.balances.set(a.accountId, 12_000n);
    const h = await auth(a.accountId);
    const aula = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/school/class`, headers: h });
    expect(aula.statusCode).toBe(201);
    expect(aula.json().purchase).toMatchObject({ price: '1500', status: 'eaten' });
    expect(aula.json().avatar).toMatchObject({ attributes: { education: 33 }, school: { grade: 1, next_grade_at: 66, class_today: true } });
    const again = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/school/class`, headers: h });
    expect(again.json().error.code).toBe('class_taken');

    const change = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/school/change`, headers: h, payload: { job: OTHER } });
    expect(change.statusCode).toBe(201);
    expect(change.json().avatar.school.changing_to).toMatchObject({ job: OTHER });
    expect(change.json().avatar.status.canWork).toBe(false);
    expect(ledger.balances.get(a.accountId)).toBe(500n);
    const work = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/work`, headers: h, payload: { shift: 6 } });
    expect(work.json().error.code).toBe('in_school');

    clock = at(97);
    const seen = (await app.inject({ url: `/v1/avatars/${a.id}`, headers: h })).json().avatar;
    expect(seen).toMatchObject({ job: { code: OTHER }, school: { changing_to: null }, attributes: { education: 33 } });
    const cat = (await app.inject({ url: '/v1/catalog/school' })).json();
    expect(cat).toMatchObject({ class: { price: '1500', education: 2 }, change: { price: '10000', days: 4 }, grades: [33, 66, 100] });
  });

  it('sem THALER, a troca é 409 e nada muda', async () => {
    const a = await store.create(make());
    const r = await app.inject({ method: 'POST', url: `/v1/avatars/${a.id}/school/change`, headers: await auth(a.accountId), payload: { job: OTHER } });
    expect(r.json().error.code).toBe('insufficient_thaler');
    expect((await store.get(a.id))!.school ?? null).toBeNull();
  });
});

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 5 }) : null;
afterAll(() => pool?.end());

describe.skipIf(!pool)('escola no Postgres', () => {
  it('grava a troca com as datas e conclui na gravação depois dos 4 dias', async () => {
    const store = new PostgresAvatarStore(pool!);
    const a = await store.create(make());
    const meal = await store.beginMeal(a.id, a.accountId, null, t0, (current) => {
      const { cents, ...effect } = checkChange(current, OTHER, false, t0);
      return planSchool(current, { id: randomUUID(), clientKey: null, effect, cents }, t0);
    });
    await store.finishMeal(meal.id, t0);
    const back = (await store.get(a.id))!;
    expect(back.school!.change).toMatchObject({ toJob: OTHER, startsAt: t0, endsAt: at(96), bonusGiven: 1 });
    const later = await store.updateAvatar(a.id, a.accountId, at(97), (x) => x);
    expect(later.jobCode).toBe(OTHER);
    expect(later.school!.change).toBeNull();
  });
});
