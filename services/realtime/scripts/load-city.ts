/**
 * Carga da cidade (E3.9, doc 10: "10 mil usuários simultâneos no Realtime").
 *
 *   pnpm --filter @scc/realtime load:city -- --url http://127.0.0.1:8050 --clients 10000
 *   pnpm --filter @scc/realtime load:city                (sobe um servidor aqui mesmo, 1.000 clientes)
 *
 * Opções:
 * - --clients 1000: total de clientes simultâneos;
 * - --workers 4: threads de clientes (cada uma com a sua parte);
 * - --ramp 500: entradas por segundo;
 * - --hold 30: segundos com todos conectados;
 * - --rate 2: movimentos por segundo por cliente;
 * - --per-room 100: clientes por bairro (o maxClients do servidor);
 * - --urls a,b,c: vários processos do realtime; o bairro d vai para o d % n (divisão por bairro).
 *
 * Contra um servidor no ar, o JWT_SECRET precisa ser o dele.
 *
 * Mede:
 * - quantos entraram e quanto a entrada levou (p50/p95);
 * - o atraso de um movimento até um observador de cada bairro (p50/p95/p99);
 * - quantos caíram no meio;
 * - com o servidor aqui, a memória e o atraso do event loop dele.
 *
 * Os clientes rodam em threads separadas do servidor (worker_threads), para o
 * teste não medir a própria máquina de clientes como se fosse o servidor.
 */
import { randomUUID } from 'node:crypto';
import { Agent, request } from 'node:http';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

import { Client, type Room } from '@colyseus/sdk';
import { SignJWT } from 'jose';

import { configSchema, startRealtime } from '../src/server.js';

interface Job {
  /** Um ou mais servidores: o bairro d vai para urls[d % n] (divisão por bairro entre processos). */
  urls: string[];
  secret: string;
  first: number;
  count: number;
  perRoom: number;
  ramp: number;
  hold: number;
  rate: number;
  t0: number;
}

interface WorkerResult {
  joined: number;
  failed: number;
  joinMs: number[];
  lags: number[];
  drops: number;
  errors: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch do matchmaking com poucas conexões HTTP reaproveitadas (keep-alive). Com o fetch padrão, cada
 * entrada abriu uma conexão nova; 10 mil entradas + 10 mil WebSockets passam das 16.384 portas
 * dinâmicas do Windows e o matchmaking falha com "fetch failed" (ver docs/desenvolvimento/teste-de-carga.md).
 */
const keepAlive = new Agent({ keepAlive: true, maxSockets: 16 });
const pooledFetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
  new Promise((resolve, reject) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const req = request(
      url,
      { method: init?.method ?? 'GET', headers: Object.fromEntries(new Headers(init?.headers).entries()), agent: keepAlive },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 0, headers: res.headers as Record<string, string> })),
        );
        res.on('error', reject);
      },
    );
    req.on('error', (e) => reject(Object.assign(new TypeError('fetch failed'), { cause: e })));
    if (init?.body) req.write(init.body as string);
    req.end();
  });

async function runClients(job: Job): Promise<WorkerResult> {
  const key = new TextEncoder().encode(job.secret);
  const rooms: Room[] = [];
  const joinMs: number[] = [];
  const lags: number[] = [];
  const errors: string[] = [];
  let failed = 0;
  let drops = 0;
  let leaving = false;
  // Rampa: o cliente i entra em t0 + i/ramp segundos.
  await Promise.all(
    Array.from({ length: job.count }, async (_, k) => {
      const i = job.first + k;
      await sleep(Math.max(0, job.t0 + (i / job.ramp) * 1000 - Date.now()));
      const district = 5000 + Math.floor(i / job.perRoom);
      const c = new Client(job.urls[district % job.urls.length]!, { fetchFn: pooledFetch as typeof fetch });
      c.auth.token = await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(randomUUID())
        .setIssuer('scc-gateway')
        .setAudience('scc-api')
        .setExpirationTime('1h')
        .sign(key);
      const start = Date.now();
      try {
        const room = await c.joinOrCreate('district', { city: 'carga', district, name: `Bot ${i}`, x: 0, z: 0 });
        joinMs.push(Date.now() - start);
        room.onLeave(() => {
          if (!leaving) drops++;
        });
        // O primeiro de cada bairro observa: o atraso é o instante de chegada menos o de envio.
        if (i % job.perRoom === 0) {
          const seen = new Map<string, number>();
          room.onStateChange((state: { players: Map<string, { x: number }> }) => {
            const now = Date.now();
            state.players.forEach((p, id) => {
              if (id === room.sessionId || p.x < 1 || p.x === seen.get(id)) return;
              seen.set(id, p.x);
              lags.push(now - (job.t0 + p.x));
            });
          });
        }
        rooms.push(room);
      } catch (error) {
        failed++;
        // A causa de rede (ECONNRESET, ETIMEDOUT...) diz mais que o "fetch failed" do undici.
        const e = error as Error & { cause?: { code?: string; message?: string } };
        const why = `${e.message ?? e}${e.cause ? ` (${e.cause.code ?? e.cause.message})` : ''}`;
        if (errors.length < 5) errors.push(why.slice(0, 160));
      }
    }),
  );
  // Todos andando: x é o instante do envio (ms desde t0) e o observador calcula o atraso.
  const timers = rooms.map((r) => setInterval(() => r.send('move', { x: Date.now() - job.t0, z: Math.random() * 100, rot: 0 }), 1000 / job.rate));
  await sleep(job.hold * 1000);
  timers.forEach(clearInterval);
  leaving = true;
  await Promise.allSettled(rooms.map((r) => r.leave()));
  return { joined: rooms.length, failed, joinMs, lags, drops, errors };
}

if (!isMainThread) {
  parentPort!.postMessage(await runClients(workerData as Job));
} else {
  const args = process.argv.slice(2);
  const flag = (name: string, fallback: string) => {
    const k = args.indexOf(`--${name}`);
    return k >= 0 ? args[k + 1]! : fallback;
  };
  const CLIENTS = Number(flag('clients', '1000'));
  const WORKERS = Number(flag('workers', '4'));
  const RAMP = Number(flag('ramp', '500'));
  const HOLD = Number(flag('hold', '30'));
  const RATE = Number(flag('rate', '2'));
  const PER_ROOM = Number(flag('per-room', '100'));
  const SECRET = process.env.JWT_SECRET ?? 'carga-local-segredo-com-mais-de-32-caracteres';

  const urlList = (flag('urls', '') || flag('url', '')).split(',').filter(Boolean);
  const own = urlList.length === 0;
  const server = own
    ? await startRealtime(configSchema.parse({ NODE_ENV: 'test', PORT: '0', JWT_SECRET: SECRET, MAX_CLIENTS: String(PER_ROOM) }))
    : null;
  const urls = own ? [`http://127.0.0.1:${server!.port}`] : urlList;
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  let peakRss = 0;
  const mem = setInterval(() => (peakRss = Math.max(peakRss, process.memoryUsage().rss)), 1000);

  const t0 = Date.now() + 500;
  const per = Math.ceil(CLIENTS / WORKERS);
  console.log(`carga: ${CLIENTS} clientes em ${WORKERS} threads, ${RAMP}/s, ${HOLD} s parados, ${RATE} mov/s, ${PER_ROOM} por bairro → ${urls.join(', ')}`);
  const results: WorkerResult[] = await Promise.all(
    Array.from({ length: WORKERS }, (_, w) => {
      const first = w * per;
      const count = Math.max(0, Math.min(per, CLIENTS - first));
      return new Promise<WorkerResult>((resolve, reject) => {
        const job: Job = { urls, secret: SECRET, first, count, perRoom: PER_ROOM, ramp: RAMP, hold: HOLD, rate: RATE, t0 };
        const worker = new Worker(new URL(import.meta.url), { workerData: job, execArgv: process.execArgv });
        worker.once('message', resolve);
        worker.once('error', reject);
      });
    }),
  );
  clearInterval(mem);
  loop.disable();
  await server?.stop();

  const all = <K extends keyof WorkerResult>(k: K) => results.flatMap((r) => r[k] as unknown as number[]);
  const sum = (k: 'joined' | 'failed' | 'drops') => results.reduce((s, r) => s + r[k], 0);
  const pct = (xs: number[], p: number) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]! : NaN;
  };
  const joinMs = all('joinMs');
  const lags = all('lags');
  const summary = {
    clients: CLIENTS,
    joined: sum('joined'),
    failed: sum('failed'),
    drops: sum('drops'),
    rooms: Math.ceil(CLIENTS / PER_ROOM),
    join_ms: { p50: pct(joinMs, 50), p95: pct(joinMs, 95), max: pct(joinMs, 100) },
    move_lag_ms: { samples: lags.length, p50: pct(lags, 50), p95: pct(lags, 95), p99: pct(lags, 99) },
    moves_per_second: CLIENTS * RATE,
    // Só com o servidor no mesmo processo: memória e event loop dele (e dos clientes da thread principal, nenhum).
    server: own ? { peak_rss_mb: Math.round(peakRss / 2 ** 20), loop_delay_p99_ms: Math.round(loop.percentile(99) / 1e6) } : null,
    errors: [...new Set(results.flatMap((r) => r.errors))].slice(0, 5),
  };
  console.log(JSON.stringify(summary, null, 2));
  const ok = summary.joined >= CLIENTS * 0.99 && summary.drops === 0 && summary.move_lag_ms.p95 < 500;
  console.log(ok ? 'OK: 99% entraram, ninguém caiu e o movimento chegou em menos de 500 ms (p95).' : 'FALHOU: veja os números acima.');
  process.exit(ok ? 0 : 1);
}
