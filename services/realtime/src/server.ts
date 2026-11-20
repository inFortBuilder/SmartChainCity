import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

import { Server, createEndpoint, createRouter, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { z } from 'zod';

import { DistrictRoom } from './district-room.js';
import { MuteBook, moderateText } from './moderation.js';

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
export async function startRealtime(config: Config, log: Log = () => {}) {
  const registry = new Set<DistrictRoom>();
  DistrictRoom.deps = {
    jwtSecret: config.JWT_SECRET,
    jwtIssuer: config.JWT_ISSUER,
    maxClients: config.MAX_CLIENTS,
    mutes: new MuteBook(),
    log,
    registry,
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

  const http = createServer();
  const gameServer = new Server({ transport: new WebSocketTransport({ server: http }), greet: false });
  gameServer.router = createRouter({ healthz, rooms, broadcast });
  gameServer.define('district', DistrictRoom).filterBy(['city', 'district']);
  await gameServer.listen(config.PORT, config.HOST);
  const address = http.address();
  const port = typeof address === 'object' && address ? address.port : config.PORT;
  return {
    port,
    registry,
    stop: async () => {
      await gameServer.gracefullyShutdown(false);
    },
  };
}
