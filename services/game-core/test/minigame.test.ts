import { randomUUID } from 'node:crypto';

import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { profession } from '../src/domain/catalog.js';
import { DAMAGE_EVENTS, MVP_PROFESSIONS, minigameOf } from '../src/domain/minigame.js';
import type { Shift } from '../src/domain/shift.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';

const T0 = new Date('2026-11-20T08:00:00Z');
const HOUR = 3_600_000;
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

const shift = (over: Partial<Shift> = {}): Shift => ({
  id: randomUUID(),
  avatarId: randomUUID(),
  accountId: randomUUID(),
  jobCode: 'pedreiro',
  hours: 6,
  startsAt: T0,
  endsAt: new Date(T0.getTime() + 6 * HOUR),
  seedCommit: 'c',
  seed: 'ab'.repeat(32),
  snapshot: { health: 10, happiness: 10, education: 0, earnsReward: true, base: 100, illness: 1 },
  result: null,
  status: 'running',
  ...over,
});

describe('minigame do turno', () => {
  it('as tarefas do Pedreiro dividem o turno pela duração do GDD', () => {
    const m = minigameOf(shift(), at(0))!;
    expect(m.job).toBe('Pedreiro');
    expect(m.tasks.map((t) => t.name)).toEqual(profession('pedreiro')!.tasks.map((t) => t.name));
    // 30 de 265 min do GDD → 30/265 de 6 h
    expect(m.tasks[0]!.endsAt.getTime() - T0.getTime()).toBe(Math.round((30 / 265) * 6 * HOUR));
    expect(m.tasks.at(-1)!.endsAt).toEqual(at(360));
    expect(m.current).toBe(0);
    expect(m.tasks[0]!.state).toBe('current');
    expect(m.tasks[1]!.state).toBe('next');
  });

  it('avança com o relógio e mostra só a direção dos efeitos', () => {
    const m = minigameOf(shift(), at(180))!;
    const construir = m.tasks.findIndex((t) => t.name.startsWith('Construir'));
    expect(m.current).toBe(construir); // a tarefa longa ocupa o meio do turno
    expect(m.tasks.slice(0, construir).every((t) => t.state === 'done')).toBe(true);
    expect(m.progress).toBeCloseTo(0.5);
    expect(m.tasks[construir]).toMatchObject({ energy: '-', happiness: '+' });
  });

  it('o dano só aparece no fim, numa tarefa e com um motivo tirados da semente', () => {
    const running = minigameOf(shift({ result: null }), at(100))!;
    expect(running.damage).toBeNull();

    const done = shift({
      status: 'done',
      result: { damaged: true, thalerCents: 1n, factors: { base: 100, hours: 6, health: 1, happiness: 1, expPet: 1, damage: 0.7, illness: 1 } },
    });
    const m = minigameOf(done, at(400))!;
    expect(m.tasks.every((t) => t.state === 'done')).toBe(true);
    expect(m.progress).toBe(1);
    expect(DAMAGE_EVENTS).toContain(m.damage!.event as (typeof DAMAGE_EVENTS)[number]);
    expect(m.tasks.map((t) => t.name)).toContain(m.damage!.task);
    // Mesma semente, mesmo resultado: quem tem a semente refaz a conta.
    expect(minigameOf(done, at(500))!.damage).toEqual(m.damage);
    expect(minigameOf({ ...done, result: { ...done.result!, damaged: false } }, at(400))!.damage).toBeNull();
  });

  it('as 12 profissões do MVP existem no catálogo e têm tarefas', () => {
    expect(MVP_PROFESSIONS).toHaveLength(12);
    for (const code of MVP_PROFESSIONS) {
      const p = profession(code);
      expect(p, code).toBeTruthy();
      expect(p!.tasks.length, code).toBeGreaterThan(0);
      expect(minigameOf(shift({ jobCode: code }), at(10))!.tasks.length).toBe(p!.tasks.length);
    }
    expect(MVP_PROFESSIONS.filter((c) => profession(c)!.rarity === 'common')).toHaveLength(11);
  });
});

describe('API', () => {
  const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
  const INTERNAL = 'chave-interna-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)

  it('o turno vem com o minigame, e o catálogo marca as 12 do MVP', async () => {
    let clock = T0;
    const app = await buildApp(
      loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: INTERNAL, DEV_FREE_AVATAR: 'true' }),
      new MemoryAvatarStore(),
      () => clock,
    );
    const headers = {
      authorization: `Bearer ${await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(randomUUID())
        .setIssuer('scc-gateway')
        .setAudience('scc-api')
        .setExpirationTime('1h')
        .sign(new TextEncoder().encode(SECRET))}`,
    };
    const avatar = (await app.inject({ method: 'POST', url: '/v1/dev/avatar', headers })).json().avatar;
    const work = await app.inject({ method: 'POST', url: `/v1/avatars/${avatar.id}/work`, headers, payload: { shift: 6 } });
    expect(work.statusCode).toBe(201);
    // O avatar grátis sai com profissão sorteada: tarefas de 0 min no começo (Motorista: "Pegar seu carro") já nascem feitas.
    const mg = work.json().shift.minigame;
    expect(mg.progress).toBe(0);
    expect(mg.current).toBe(mg.tasks.findIndex((t: { starts_at: string; ends_at: string }) => t.ends_at > t.starts_at));

    clock = new Date(T0.getTime() + 3 * HOUR);
    const list = (await app.inject({ method: 'GET', url: `/v1/avatars/${avatar.id}/shifts`, headers })).json().shifts;
    expect(list[0].minigame.progress).toBeCloseTo(0.5);
    expect(list[0].minigame.tasks.some((t: { state: string }) => t.state === 'current')).toBe(true);

    const catalog = (await app.inject({ method: 'GET', url: '/v1/catalog/professions' })).json().professions;
    expect(catalog.filter((p: { mvp: boolean }) => p.mvp)).toHaveLength(12);
  });
});
