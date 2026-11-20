/**
 * Carga da trilha-backend (passo 14): 100 clientes simulados numa sala de bairro.
 *
 *   pnpm --filter @scc/realtime load            (sobe o servidor aqui mesmo)
 *   pnpm --filter @scc/realtime load -- --url http://127.0.0.1:8050   (contra um servidor no ar; precisa do JWT_SECRET dele)
 *
 * Opções: --clients 100 --seconds 10 --rate 5 (movimentos por segundo por cliente).
 * Mede: tempo para todos entrarem, se todos ficaram na mesma sala, quanto um
 * movimento leva para chegar a um observador (p50/p95/máx) e se alguém caiu.
 */
import { randomUUID } from 'node:crypto';

import { Client, type Room } from '@colyseus/sdk';
import { SignJWT } from 'jose';

import { configSchema, startRealtime } from '../src/server.js';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const k = args.indexOf(`--${name}`);
  return k >= 0 ? args[k + 1]! : fallback;
};
const CLIENTS = Number(flag('clients', '100'));
const SECONDS = Number(flag('seconds', '10'));
const RATE = Number(flag('rate', '5'));
const SECRET = process.env.JWT_SECRET ?? 'carga-local-segredo-com-mais-de-32-caracteres';

const own = flag('url', '') === '';
const server = own ? await startRealtime(configSchema.parse({ NODE_ENV: 'test', PORT: '0', JWT_SECRET: SECRET, MAX_CLIENTS: '100' })) : null;
const url = own ? `http://127.0.0.1:${server!.port}` : flag('url', '');

const token = () =>
  new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(randomUUID())
    .setIssuer('scc-gateway')
    .setAudience('scc-api')
    .setExpirationTime('10m')
    .sign(new TextEncoder().encode(SECRET));

const district = 900 + Math.floor(Math.random() * 1000);
const t0 = Date.now();
const rooms: Room[] = await Promise.all(
  Array.from({ length: CLIENTS }, async (_, i) => {
    const c = new Client(url);
    c.auth.token = await token();
    return c.joinOrCreate('district', { city: 'carga', district, name: `Bot ${i}`, x: i, z: 0 });
  }),
);
const joinMs = Date.now() - t0;
const roomIds = new Set(rooms.map((r) => r.roomId));

// O observador mede o atraso: cada bot manda em x o instante do envio (ms desde t1).
const observer = rooms[0]!;
const lags: number[] = [];
let drops = 0;
for (const r of rooms) r.onLeave(() => drops++);
const t1 = Date.now();
const seen = new Map<string, number>();
observer.onStateChange((state: { players: Map<string, { x: number }> }) => {
  const now = Date.now() - t1;
  state.players.forEach((p, id) => {
    if (id === observer.sessionId || p.x === seen.get(id) || p.x < 1) return;
    seen.set(id, p.x);
    lags.push(now - p.x);
  });
});

const timers = rooms.slice(1).map((r) =>
  setInterval(() => r.send('move', { x: Date.now() - t1, z: Math.random() * 100, rot: 0 }), 1000 / RATE),
);
await new Promise((res) => setTimeout(res, SECONDS * 1000));
timers.forEach(clearInterval);

const players = (observer.state as { players: Map<string, unknown> }).players.size;
await Promise.all(rooms.map((r) => r.leave()));
await server?.stop();

lags.sort((a, b) => a - b);
const pct = (p: number) => lags[Math.min(lags.length - 1, Math.floor((p / 100) * lags.length))] ?? NaN;
const result = {
  clientes: CLIENTS,
  salas: roomIds.size,
  jogadores_vistos_pelo_observador: players,
  entrada_ms: joinMs,
  movimentos_enviados_por_s: (CLIENTS - 1) * RATE,
  atualizacoes_medidas: lags.length,
  atraso_ms: { p50: pct(50), p95: pct(95), max: lags.at(-1) ?? NaN },
  quedas: drops - CLIENTS, // cada cliente sai uma vez no fim
};
console.log(JSON.stringify(result, null, 2));
const ok = result.salas === 1 && players === CLIENTS && result.quedas === 0 && pct(95) < 500;
console.log(ok ? 'OK: 100 jogadores numa sala, sem quedas, p95 abaixo de 500 ms.' : 'FALHOU: ver números acima.');
process.exit(ok ? 0 : 1);
