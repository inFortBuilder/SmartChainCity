import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

import { Server, createEndpoint, createRouter, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { z } from 'zod';

import { DistrictRoom } from './district-room.js';
import { HttpVisitChecker, InteriorRoom, type VisitChecker } from './interior-room.js';
import { MuteBook, moderateText } from './moderation.js';
import { parseShard } from './shard.js';
import { DEFAULT_UTC_OFFSET_MIN, type WeeklyEvent, airshipText, dueEvents, eventsBetween } from './schedule.js';

export const configSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().nonnegative().default(8050),
  HOST: z.string().default('127.0.0.1'),
  /** O mesmo segredo do gateway: o realtime só valida o token. */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa de pelo menos 32 caracteres'),
  JWT_ISSUER: z.string().default('scc-gateway'),
  /** Jogadores por instância de sala (doc 05 §4: 50–100). */
  MAX_CLIENTS: z.coerce.number().int().positive().default(100),
  /** Token dos outros serviços para os eventos globais. Sem ele, /internal responde 503. */
  INTERNAL_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(32).optional()),
  /** Serviço world: diz quem pode entrar na sala do interior de um imóvel. Sem ele, a sala recusa. */
  WORLD_URL: z.preprocess((v) => (v === '' ? undefined : v), z.url().optional()),
  /** Divisão por bairro (E3.9): `i/n`, este processo é o i de n e recusa os bairros dos outros. */
  SHARD: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  /** Agenda de eventos ao vivo (schedule.ts): liga e desliga o dirigível e as datas marcadas. */
  EVENTS_ENABLED: z
    .preprocess((v) => (v === undefined || v === '' ? 'true' : v), z.enum(['true', 'false']))
    .transform((v) => v === 'true'),
  /** Fuso da cidade, em minutos (Brasília: −180). */
  EVENTS_UTC_OFFSET_MIN: z.coerce.number().int().min(-720).max(840).default(DEFAULT_UTC_OFFSET_MIN),
  /** De quanto em quanto tempo a agenda confere o que venceu. */
  EVENTS_TICK_SECONDS: z.coerce.number().int().positive().default(30),
  /** game-core: o evento da semana para o texto do dirigível. Sem ele, avisos da Prefeitura. */
  GAME_CORE_URL: z.preprocess((v) => (v === '' ? undefined : v), z.url().optional()),
});
export type Config = z.infer<typeof configSchema>;

export interface Log {
  (event: string, data: Record<string, unknown>): void;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const sameToken = (given: string | null, expected: string) => {
  const a = Buffer.from(given ?? '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

const broadcastBody = z.object({ kind: z.string().regex(/^[a-z_]{1,32}$/), text: z.string(), city: z.string().optional() });

/**
 * Sobe o servidor. As rotas HTTP (`/healthz`, `/v1/realtime/rooms`,
 * `/internal/v1/broadcast`) entram no roteador do próprio Colyseus, junto das de
 * matchmaking: um servidor HTTP só, e uma resposta por requisição.
 */
export async function startRealtime(
  config: Config,
  log: Log = () => {},
  overrides: { visits?: VisitChecker; now?: () => Date; weekly?: () => Promise<WeeklyEvent | null> } = {},
) {
  const now = overrides.now ?? (() => new Date());
  const registry = new Set<DistrictRoom>();
  const worldUrl = config.WORLD_URL ?? (config.NODE_ENV === 'production' ? undefined : 'http://127.0.0.1:8030');
  // Um silêncio vale em todas as salas: bairro e interior.
  const mutes = new MuteBook();
  const shard = parseShard(config.SHARD);
  DistrictRoom.deps = {
    shard,
    jwtSecret: config.JWT_SECRET,
    jwtIssuer: config.JWT_ISSUER,
    maxClients: config.MAX_CLIENTS,
    mutes,
    log,
    registry,
  };
  InteriorRoom.deps = {
    shard,
    jwtSecret: config.JWT_SECRET,
    jwtIssuer: config.JWT_ISSUER,
    mutes,
    log,
    // Na máquina local, sem WORLD_URL, o world fica na porta padrão; em produção, só com WORLD_URL.
    visits: overrides.visits ?? (worldUrl ? new HttpVisitChecker(worldUrl) : null),
  };

  const healthz = createEndpoint('/healthz', { method: 'GET' }, async () => json(200, { status: 'ok' }));

  // Quantos jogadores há em cada bairro (para o mapa mostrar o movimento da cidade).
  const rooms = createEndpoint('/v1/realtime/rooms', { method: 'GET' }, async () => {
    const list = await matchMaker.query({ name: 'district' });
    const byDistrict = new Map<string, { city: string; district: number; players: number; rooms: number }>();
    for (const r of list) {
      const m = r.metadata as { city: string; district: number };
      const k = `${m.city}:${m.district}`;
      const cur = byDistrict.get(k) ?? { city: m.city, district: m.district, players: 0, rooms: 0 };
      cur.players += r.clients;
      cur.rooms += 1;
      byDistrict.set(k, cur);
    }
    return json(200, { districts: [...byDistrict.values()] });
  });

  // Evento global da Prefeitura (doc 08: dirigível de promoções 3×/dia).
  const broadcast = createEndpoint('/internal/v1/broadcast', { method: 'POST' }, async (ctx) => {
    if (!config.INTERNAL_TOKEN) return json(503, { error: { code: 'internal_disabled' } });
    if (!sameToken(ctx.request?.headers.get('x-service-token') ?? null, config.INTERNAL_TOKEN)) {
      return json(403, { error: { code: 'forbidden' } });
    }
    const body = broadcastBody.safeParse(ctx.body);
    if (!body.success) return json(400, { error: { code: 'invalid_request' } });
    const text = moderateText(body.data.text, 280);
    if (!text.ok) return json(400, { error: { code: 'invalid_text' } });
    const event = { kind: body.data.kind, text: text.text, at: new Date().toISOString() };
    let reached = 0;
    for (const room of registry) {
      if (body.data.city && room.state.city !== body.data.city) continue;
      room.announce(event);
      reached++;
    }
    log('event.broadcast', { kind: body.data.kind, rooms: reached });
    return json(200, { rooms: reached });
  });

  // ---------------------------------------------------------------- agenda de eventos ao vivo
  const offset = config.EVENTS_UTC_OFFSET_MIN;
  const gameCoreUrl = config.GAME_CORE_URL ?? (config.NODE_ENV === 'production' ? undefined : 'http://127.0.0.1:8020');
  const weekly =
    overrides.weekly ??
    (async (): Promise<WeeklyEvent | null> => {
      if (!gameCoreUrl) return null;
      try {
        const r = await fetch(`${gameCoreUrl.replace(/\/$/, '')}/v1/events`, { signal: AbortSignal.timeout(5_000) });
        if (!r.ok) return null;
        const body = (await r.json()) as { current?: { name: string; factor: number; ends_at: string } | null };
        return body.current ? { label: body.current.name, factor: body.current.factor, ends_at: body.current.ends_at } : null;
      } catch {
        return null;
      }
    });
  const sent = new Set<string>();
  let lastRun = now();
  /** Manda o que venceu desde a última passada. Devolve os eventos mandados (os testes conferem). */
  const tick = async () => {
    const t = now();
    const due = dueEvents(lastRun, t, sent, offset);
    lastRun = t;
    const out: { key: string; kind: string; title: string; text: string; rooms: number }[] = [];
    for (const e of due) {
      sent.add(e.key);
      const text = e.text ?? airshipText(await weekly(), e.at);
      const event = { kind: e.kind, title: e.title, text, at: e.at.toISOString() };
      for (const room of registry) room.announce(event);
      log('event.scheduled', { key: e.key, rooms: registry.size });
      out.push({ key: e.key, kind: e.kind, title: e.title, text, rooms: registry.size });
    }
    // A lista de chaves não cresce sem fim: as antigas já não vencem de novo.
    if (sent.size > 500) for (const k of [...sent].slice(0, sent.size - 200)) sent.delete(k);
    return out;
  };
  const timer = config.EVENTS_ENABLED ? setInterval(() => void tick(), config.EVENTS_TICK_SECONDS * 1000) : null;
  timer?.unref();

  // A agenda das próximas 48 h (o mapa mostra o próximo evento).
  const schedule = createEndpoint('/v1/realtime/schedule', { method: 'GET' }, async () => {
    const t = now();
    const next = config.EVENTS_ENABLED ? eventsBetween(t, new Date(t.getTime() + 48 * 3_600_000), offset) : [];
    return json(200, {
      enabled: config.EVENTS_ENABLED,
      utc_offset_min: offset,
      next: next.slice(0, 8).map((e) => ({ kind: e.kind, title: e.title, at: e.at.toISOString() })),
    });
  });

  const http = createServer();
  const gameServer = new Server({ transport: new WebSocketTransport({ server: http }), greet: false });
  gameServer.router = createRouter({ healthz, rooms, broadcast, schedule });
  gameServer.define('district', DistrictRoom).filterBy(['city', 'district']);
  gameServer.define('interior', InteriorRoom).filterBy(['city', 'lot']);
  await gameServer.listen(config.PORT, config.HOST);
  const address = http.address();
  const port = typeof address === 'object' && address ? address.port : config.PORT;
  return {
    port,
    registry,
    tick,
    stop: async () => {
      if (timer) clearInterval(timer);
      await gameServer.gracefullyShutdown(false);
    },
  };
}
