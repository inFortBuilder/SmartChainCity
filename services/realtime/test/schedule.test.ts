import { randomUUID } from 'node:crypto';

import { Client } from '@colyseus/sdk';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { airshipText, carnival, dueEvents, easter, eventsBetween } from '../src/schedule.js';
import { configSchema, startRealtime } from '../src/server.js';

/** Agenda de eventos ao vivo: dirigível 3×/dia e datas marcadas (schedule.ts). */
const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)

describe('regras da agenda', () => {
  it('Páscoa e Carnaval pelo calendário', () => {
    expect(easter(2026).toISOString().slice(0, 10)).toBe('2026-04-05');
    expect(easter(2027).toISOString().slice(0, 10)).toBe('2027-03-28');
    expect(carnival(2026).toISOString().slice(0, 10)).toBe('2026-02-17');
    expect(carnival(2027).toISOString().slice(0, 10)).toBe('2027-02-09');
  });

  it('o dirigível passa às 10, 15 e 20 h de Brasília; datas marcadas ao meio-dia', () => {
    const day = eventsBetween(new Date('2026-12-25T03:00:00Z'), new Date('2026-12-26T03:00:00Z'));
    expect(day.map((e) => [e.key, e.at.toISOString()])).toEqual([
      ['airship:2026-12-25:10', '2026-12-25T13:00:00.000Z'],
      ['holiday:natal:2026', '2026-12-25T15:00:00.000Z'],
      ['airship:2026-12-25:15', '2026-12-25T18:00:00.000Z'],
      ['airship:2026-12-25:20', '2026-12-25T23:00:00.000Z'],
    ]);
    // Outro fuso (UTC): os mesmos horários locais.
    expect(eventsBetween(new Date('2026-11-27T00:00:00Z'), new Date('2026-11-28T00:00:00Z'), 0).map((e) => e.at.getUTCHours())).toEqual([10, 15, 20]);
  });

  it('vencidos desde a última passada, sem repetir e sem os atrasados de mais de 5 min', () => {
    const at = new Date('2026-11-27T13:00:30Z'); // 10:00:30 em Brasília
    expect(dueEvents(new Date('2026-11-27T12:59:00Z'), at, new Set()).map((e) => e.key)).toEqual(['airship:2026-11-27:10']);
    expect(dueEvents(new Date('2026-11-27T12:59:00Z'), at, new Set(['airship:2026-11-27:10']))).toEqual([]);
    // Fora do ar desde a véspera: só o que venceu nos últimos 5 minutos.
    expect(dueEvents(new Date('2026-11-26T00:00:00Z'), new Date('2026-11-27T13:10:00Z'), new Set())).toEqual([]);
  });

  it('o texto do dirigível usa o evento da semana ou um aviso', () => {
    expect(airshipText({ label: 'Semana da Saúde', factor: 1.2 }, new Date())).toBe('Semana da Saúde: as profissões da semana ganham +20% no turno.');
    expect(airshipText(null, new Date('2026-11-27T13:00:00Z'))).toMatch(/\./);
  });
});

describe('agenda no servidor', () => {
  let clock = new Date('2026-11-27T12:59:50Z');
  let server: Awaited<ReturnType<typeof startRealtime>>;
  let endpoint: string;

  beforeAll(async () => {
    const config = configSchema.parse({ NODE_ENV: 'test', PORT: '0', JWT_SECRET: SECRET, EVENTS_TICK_SECONDS: '3600' });
    server = await startRealtime(config, () => {}, {
      now: () => clock,
      weekly: async () => ({ label: 'Semana da Saúde', factor: 1.2 }),
      visits: { check: async () => null },
    });
    endpoint = `http://127.0.0.1:${server.port}`;
  });
  afterAll(async () => {
    await server.stop();
  });

  it('mostra a próxima agenda e manda o dirigível uma vez para quem está no bairro', async () => {
    const agenda = (await (await fetch(`${endpoint}/v1/realtime/schedule`)).json()) as { next: { title: string; at: string }[] };
    expect(agenda.next[0]).toEqual({ kind: 'airship', title: '🎈 Dirigível da Prefeitura', at: '2026-11-27T13:00:00.000Z' });

    const client = new Client(endpoint);
    client.auth.token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(randomUUID())
      .setIssuer('scc-gateway')
      .setAudience('scc-api')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    const room = await client.joinOrCreate('district', { city: 'pittsburg', district: 0, name: 'Teste' });
    const got: { title?: string; text: string }[] = [];
    room.onMessage('event', (e) => got.push(e));

    clock = new Date('2026-11-27T13:00:10Z');
    const sent = await server.tick();
    expect(sent).toEqual([expect.objectContaining({ key: 'airship:2026-11-27:10', rooms: 1 })]);
    expect(await server.tick()).toEqual([]);
    const end = Date.now() + 3000;
    while (!got.length && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    expect(got).toEqual([expect.objectContaining({ title: '🎈 Dirigível da Prefeitura', text: 'Semana da Saúde: as profissões da semana ganham +20% no turno.' })]);
    await room.leave();
  });
});
