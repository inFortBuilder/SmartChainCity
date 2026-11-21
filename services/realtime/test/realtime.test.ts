import { randomUUID } from 'node:crypto';

import { Client, type Room } from '@colyseus/sdk';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MuteBook, RateLimiter, cleanName, moderateText } from '../src/moderation.js';
import { configSchema, startRealtime } from '../src/server.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const INTERNAL = 'token-interno-do-realtime-com-32-caracteres'; // gitleaks:allow (só no teste)

describe('moderação do chat', () => {
  it('limpa espaços e controle, recusa vazio, longo e link', () => {
    expect(moderateText('  oi​   pessoal  ')).toEqual({ ok: true, text: 'oi pessoal', masked: false });
    expect(moderateText('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(moderateText('a'.repeat(201))).toEqual({ ok: false, reason: 'too_long' });
    for (const golpe of ['ganhe scity em https://x.io', 'entra no www.golpe.net', 'carteira-gratis.xyz', 'chama no t.me/fulano', 'discord.gg/abc']) {
      expect(moderateText(golpe)).toMatchObject({ ok: false, reason: 'link' });
    }
  });

  it('mascara palavrão, com acento ou letra repetida', () => {
    expect(moderateText('que porra é essa')).toEqual({ ok: true, text: 'que ***** é essa', masked: true });
    expect(moderateText('PUUUUTA vida')).toMatchObject({ ok: true, text: '******* vida', masked: true });
    expect(moderateText('Otário!')).toMatchObject({ text: '******!' });
    expect(moderateText('computador e repúblicas')).toMatchObject({ masked: false });
  });

  it('nome com link, palavrão ou vazio vira Visitante', () => {
    expect(cleanName('Padeiro Zé')).toBe('Padeiro Zé');
    expect(cleanName('www.golpe.com')).toBe('Visitante');
    expect(cleanName('merda')).toBe('Visitante');
    expect(cleanName(42)).toBe('Visitante');
    expect(cleanName('x'.repeat(30))).toBe('Visitante');
  });

  it('3 violações em 10 minutos silenciam por 10; 3 denúncias distintas por 15', () => {
    let now = 0;
    const book = new MuteBook(() => now);
    expect(book.violation('a')).toBe(0);
    now = 9 * 60_000;
    expect(book.violation('a')).toBe(0);
    now = 9.5 * 60_000;
    expect(book.violation('a')).toBe(now + 10 * 60_000);
    expect(book.isMuted('a')).toBeGreaterThan(now);
    now += 10 * 60_000 + 1;
    expect(book.isMuted('a')).toBe(0);

    expect(book.report('b', 'b')).toBe(0); // a si mesmo não conta
    book.report('b', 'x');
    book.report('b', 'x'); // o mesmo denunciante conta uma vez
    expect(book.report('b', 'y')).toBe(0);
    expect(book.report('b', 'z')).toBe(now + 15 * 60_000);
  });

  it('limite por cliente: rajada e reposição', () => {
    let now = 0;
    const rl = new RateLimiter(1, 3, () => now);
    expect([rl.take('c'), rl.take('c'), rl.take('c'), rl.take('c')]).toEqual([true, true, true, false]);
    now = 1000;
    expect(rl.take('c')).toBe(true);
    expect(rl.take('c')).toBe(false);
  });
});

// ---------------------------------------------------------------- servidor de verdade

let server: Awaited<ReturnType<typeof startRealtime>>;
let endpoint: string;
const logs: { event: string; data: Record<string, unknown> }[] = [];

beforeAll(async () => {
  const config = configSchema.parse({ NODE_ENV: 'test', PORT: '0', JWT_SECRET: SECRET, INTERNAL_TOKEN: INTERNAL, MAX_CLIENTS: '25' });
  server = await startRealtime(config, (event, data) => logs.push({ event, data }));
  endpoint = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => {
  await server.stop();
});

const token = (sub: string = randomUUID()) =>
  new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuer('scc-gateway')
    .setAudience('scc-api')
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));

/** Cliente que já entrou e recebeu o primeiro estado. */
async function join(city: string, district: number, opts: Record<string, unknown> = {}, sub?: string) {
  const client = new Client(endpoint);
  client.auth.token = await token(sub);
  const room = await client.joinOrCreate('district', { city, district, ...opts });
  await waitFor(() => room.state?.players !== undefined);
  return room;
}

async function waitFor(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('tempo esgotado');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const players = (room: Room) => room.state.players as Map<string, { name: string; x: number; z: number; mode: string; speed: number; skin: string }>;
const messages = (room: Room, type: string) => {
  const got: Record<string, unknown>[] = [];
  room.onMessage(type, (m: Record<string, unknown>) => got.push(m));
  return got;
};

describe('sala do bairro', () => {
  it('sem token válido não entra', async () => {
    const client = new Client(endpoint);
    client.auth.token = 'token-falso';
    await expect(client.joinOrCreate('district', { city: 'pittsburg', district: 0 })).rejects.toBeTruthy();
  });

  it('presença: quem entra no mesmo bairro se vê; outro bairro é outra sala', async () => {
    const a = await join('pittsburg', 1, { name: 'Ana', x: 10, z: 20 });
    const b = await join('pittsburg', 1, { name: 'Bia' });
    const c = await join('pittsburg', 2, { name: 'Caio' });
    expect(a.roomId).toBe(b.roomId);
    expect(c.roomId).not.toBe(a.roomId);
    await waitFor(() => players(a).size === 2);
    expect([...players(b).values()].map((p) => p.name).sort()).toEqual(['Ana', 'Bia']);
    expect(players(c).size).toBe(1);

    a.send('move', { x: 123.5, z: -42, rot: 1.5 });
    await waitFor(() => players(b).get(a.sessionId)?.x === 123.5);
    expect(players(b).get(a.sessionId)?.z).toBe(-42);

    // Movimento fora do mapa é ignorado.
    a.send('move', { x: 9e9, z: 0 });
    await new Promise((r) => setTimeout(r, 150));
    expect(players(b).get(a.sessionId)?.x).toBe(123.5);

    // Street view: modo e velocidade chegam aos outros; velocidade absurda é limitada e modo estranho vira mapa.
    expect(players(b).get(a.sessionId)?.mode).toBe('map');
    a.send('move', { x: 124, z: -42, rot: 0.5, mode: 'street', speed: 1.5 });
    await waitFor(() => players(b).get(a.sessionId)?.mode === 'street');
    expect(players(b).get(a.sessionId)?.speed).toBeCloseTo(1.5);
    a.send('move', { x: 125, z: -42, rot: 0.5, mode: 'street', speed: 500 });
    await waitFor(() => players(b).get(a.sessionId)?.x === 125);
    expect(players(b).get(a.sessionId)?.speed).toBe(10);
    a.send('move', { x: 126, z: -42, mode: 'voando', speed: 3 });
    await waitFor(() => players(b).get(a.sessionId)?.x === 126);
    expect(players(b).get(a.sessionId)).toMatchObject({ mode: 'map', speed: 0, skin: 'man' });

    // Tipo de avatar: human passa; desconhecido mantém o atual.
    a.send('move', { x: 127, z: -42, mode: 'street', speed: 0, skin: 'human' });
    await waitFor(() => players(b).get(a.sessionId)?.skin === 'human');
    a.send('move', { x: 128, z: -42, mode: 'street', speed: 0, skin: 'dragao' });
    await waitFor(() => players(b).get(a.sessionId)?.x === 128);
    expect(players(b).get(a.sessionId)?.skin).toBe('human');

    await b.leave();
    await waitFor(() => players(a).size === 1);
    await a.leave();
    await c.leave();
  });

  it('chat: passa moderado, link é recusado, rápido demais também', async () => {
    const a = await join('pittsburg', 3, { name: 'Ana' });
    const b = await join('pittsburg', 3, { name: 'Bia' });
    const chatB = messages(b, 'chat');
    const errA = messages(a, 'chat_error');

    a.send('chat', { text: 'bom dia, que porra de sol' });
    await waitFor(() => chatB.length === 1);
    expect(chatB[0]).toMatchObject({ from: a.sessionId, name: 'Ana', text: 'bom dia, que ***** de sol' });

    a.send('chat', { text: 'pega scity grátis em https://golpe.io' });
    a.send('chat', { text: 'oi' });
    a.send('chat', { text: 'oi de novo' });
    await waitFor(() => errA.length >= 2);
    expect(errA.map((e) => e.reason)).toContain('link');
    expect(errA.map((e) => e.reason)).toContain('too_fast');
    expect(logs.some((l) => l.event === 'chat.blocked' && l.data.reason === 'link')).toBe(true);
    await a.leave();
    await b.leave();
  });

  it('3 denúncias de contas diferentes silenciam o alvo', async () => {
    const alvo = await join('pittsburg', 4, { name: 'Troll' });
    const errs = messages(alvo, 'chat_error');
    for (let i = 0; i < 3; i++) {
      const r = await join('pittsburg', 4, { name: `J${i}` });
      const ok = messages(r, 'report_ok');
      r.send('report', { sessionId: alvo.sessionId, reason: 'ofensa' });
      await waitFor(() => ok.length === 1);
      await r.leave();
    }
    alvo.send('chat', { text: 'oi' });
    await waitFor(() => errs.length === 1);
    expect(errs[0]).toMatchObject({ reason: 'muted' });
    await alvo.leave();
  });

  it('sala lotada abre outra instância do mesmo bairro', async () => {
    const rooms = await Promise.all(Array.from({ length: 30 }, (_, i) => join('pittsburg', 5, { name: `P${i}` })));
    const ids = new Set(rooms.map((r) => r.roomId));
    expect(ids.size).toBe(2); // MAX_CLIENTS = 25 neste teste

    const res = await fetch(`${endpoint}/v1/realtime/rooms`).then((r) => r.json());
    expect(res.districts).toContainEqual({ city: 'pittsburg', district: 5, players: 30, rooms: 2 });
    await Promise.all(rooms.map((r) => r.leave()));
  });

  it('evento global da Prefeitura chega às salas da cidade, com o token interno', async () => {
    const a = await join('pittsburg', 6);
    const outra = await join('outra-cidade', 6);
    const evA = messages(a, 'event');
    const evOutra = messages(outra, 'event');

    const forbidden = await fetch(`${endpoint}/internal/v1/broadcast`, { method: 'POST', body: '{}' });
    expect(forbidden.status).toBe(403);
    const r = await fetch(`${endpoint}/internal/v1/broadcast`, {
      method: 'POST',
      headers: { 'x-service-token': INTERNAL, 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'dirigivel', text: 'Promoção no Mercado do bairro 6!', city: 'pittsburg' }),
    });
    expect(r.status).toBe(200);
    await waitFor(() => evA.length === 1);
    expect(evA[0]).toMatchObject({ kind: 'dirigivel', text: 'Promoção no Mercado do bairro 6!' });
    await new Promise((res) => setTimeout(res, 150));
    expect(evOutra).toEqual([]);
    await a.leave();
    await outra.leave();
  });
});
