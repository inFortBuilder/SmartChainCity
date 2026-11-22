#!/usr/bin/env node
/**
 * Carga da API (E3.9, doc 10: "1 mil req/s na API"; testes-qualidade: p95 < 200 ms nas rotas de leitura).
 *
 *   LOAD_JWT_SECRET=<o JWT_SECRET dos serviços> node tools/load-test/api.mjs --rate 1000 --seconds 30
 *
 * Opções:
 * - --rate 1000: pedidos por segundo;
 * - --seconds 30: duração;
 * - --accounts 200: contas sintéticas;
 * - --gateway, --economy, --game, --world: URLs (padrão: as portas locais 8000/8010/8020/8030);
 * - --city pittsburg e --lots 100000: para a rota do lote;
 * - --only game,economy: só as rotas destes serviços (para achar o gargalo);
 * - --json arquivo: grava o resumo.
 *
 * Carga aberta (open loop): os pedidos saem no ritmo pedido, respondidos ou não, como em produção. Um
 * servidor lento não diminui a carga, então a fila aparece na latência.
 *
 * Sem dependências: node:http com keep-alive (poucas conexões por serviço, para não esgotar as portas)
 * e o JWT HS256 assinado com node:crypto, como o gateway assina. Contas sintéticas: as rotas de leitura
 * respondem 200 para quem ainda não tem avatar, saldo ou fazenda.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { Agent, request } from 'node:http';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const k = args.indexOf(`--${name}`);
  return k >= 0 ? args[k + 1] : fallback;
};
const RATE = Number(flag('rate', '1000'));
const SECONDS = Number(flag('seconds', '30'));
const ACCOUNTS = Number(flag('accounts', '200'));
const CITY = flag('city', 'pittsburg');
const LOTS = Number(flag('lots', '100000'));
const URLS = {
  gateway: flag('gateway', 'http://127.0.0.1:8000'),
  economy: flag('economy', 'http://127.0.0.1:8010'),
  game: flag('game', 'http://127.0.0.1:8020'),
  world: flag('world', 'http://127.0.0.1:8030'),
};
const SECRET = process.env.LOAD_JWT_SECRET;
if (!SECRET || SECRET.length < 32) {
  console.error('Defina LOAD_JWT_SECRET com o JWT_SECRET dos serviços (32+ caracteres).');
  process.exit(2);
}

const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
const jwt = (sub) => {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, iss: 'scc-gateway', aud: 'scc-api', iat: now, exp: now + 3600 })}`;
  return `${body}.${createHmac('sha256', SECRET).update(body).digest('base64url')}`;
};
const tokens = Array.from({ length: ACCOUNTS }, () => jwt(randomUUID()));
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];

/** A mistura das rotas: leitura, como o painel do mapa faz a cada atualização. Pesos somam 100. */
const ROUTES = [
  { name: 'game GET /v1/avatars', weight: 20, base: 'game', path: () => '/v1/avatars', auth: true },
  { name: 'economy GET /v1/economy/balances', weight: 20, base: 'economy', path: () => '/v1/economy/balances', auth: true },
  { name: 'world GET /v1/world/cities/:c/lots/:id', weight: 15, base: 'world', path: () => `/v1/world/cities/${CITY}/lots/${Math.floor(Math.random() * LOTS)}`, auth: false },
  { name: 'game GET /v1/catalog/foods', weight: 10, base: 'game', path: () => '/v1/catalog/foods', auth: false },
  { name: 'game GET /v1/events', weight: 10, base: 'game', path: () => '/v1/events', auth: false },
  { name: 'game GET /v1/farm', weight: 10, base: 'game', path: () => '/v1/farm', auth: true },
  { name: 'economy GET /v1/economy/fx', weight: 10, base: 'economy', path: () => '/v1/economy/fx', auth: false },
  { name: 'gateway GET /healthz', weight: 5, base: 'gateway', path: () => '/healthz', auth: false },
];
const ONLY = flag('only', '').split(',').filter(Boolean);
if (ONLY.length) ROUTES.splice(0, ROUTES.length, ...ROUTES.filter((r) => ONLY.includes(r.base)));
const totalWeight = ROUTES.reduce((s, r) => s + r.weight, 0);
const pickRoute = () => {
  let x = Math.random() * totalWeight;
  for (const r of ROUTES) if ((x -= r.weight) < 0) return r;
  return ROUTES[0];
};

const agents = Object.fromEntries(Object.keys(URLS).map((k) => [k, new Agent({ keepAlive: true, maxSockets: 128 })]));
const stats = new Map(ROUTES.map((r) => [r.name, { ms: [], codes: {}, errors: 0 }]));
let inflight = 0;
let sent = 0;

function fire() {
  const route = pickRoute();
  const url = new URL(route.path(), URLS[route.base]);
  const s = stats.get(route.name);
  const t = process.hrtime.bigint();
  inflight++;
  sent++;
  const req = request(url, { agent: agents[route.base], headers: route.auth ? { authorization: `Bearer ${pick(tokens)}` } : {} }, (res) => {
    res.resume();
    res.on('end', () => {
      inflight--;
      s.ms.push(Number(process.hrtime.bigint() - t) / 1e6);
      s.codes[res.statusCode] = (s.codes[res.statusCode] ?? 0) + 1;
    });
  });
  req.setTimeout(10_000, () => req.destroy(new Error('timeout')));
  req.on('error', () => {
    inflight--;
    s.errors++;
  });
  req.end();
}

console.log(`carga: ${RATE} req/s por ${SECONDS} s em ${Object.values(URLS).join(', ')}`);
const start = Date.now();
// A cada 10 ms, dispara o que falta para o ritmo até agora (o relógio manda, não as respostas).
await new Promise((resolve) => {
  const timer = setInterval(() => {
    const elapsed = (Date.now() - start) / 1000;
    if (elapsed >= SECONDS) {
      clearInterval(timer);
      resolve();
      return;
    }
    const due = Math.floor(elapsed * RATE) - sent;
    for (let i = 0; i < due; i++) fire();
  }, 10);
});
// Espera as respostas que ainda estão a caminho (até 15 s).
const drainUntil = Date.now() + 15_000;
while (inflight > 0 && Date.now() < drainUntil) await new Promise((r) => setTimeout(r, 50));

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] * 10) / 10 : null;
};
const all = [...stats.values()].flatMap((s) => s.ms);
const ok = [...stats.values()].reduce((n, s) => n + Object.entries(s.codes).filter(([c]) => Number(c) < 400).reduce((m, [, v]) => m + v, 0), 0);
const bad = sent - ok;
const summary = {
  target_rps: RATE,
  achieved_rps: Math.round(all.length / SECONDS),
  sent,
  ok,
  errors: bad,
  error_rate: Math.round((bad / Math.max(1, sent)) * 10_000) / 100,
  latency_ms: { p50: pct(all, 50), p95: pct(all, 95), p99: pct(all, 99), max: pct(all, 100) },
  routes: Object.fromEntries(
    [...stats.entries()].map(([name, s]) => [name, { n: s.ms.length, p50: pct(s.ms, 50), p95: pct(s.ms, 95), codes: s.codes, network_errors: s.errors }]),
  ),
};
console.log(JSON.stringify(summary, null, 2));
const json = flag('json', '');
if (json) writeFileSync(json, JSON.stringify(summary, null, 2));
const pass = summary.achieved_rps >= RATE * 0.95 && summary.latency_ms.p95 < 200 && summary.error_rate < 1;
console.log(pass ? 'OK: ritmo pedido, p95 abaixo de 200 ms e menos de 1% de erros.' : 'FALHOU: veja os números acima.');
process.exit(pass ? 0 : 1);
