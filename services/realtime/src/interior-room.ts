import { type AuthContext, type Client, Room, ServerError } from '@colyseus/core';
import { type MapSchema, schema, t } from '@colyseus/schema';
import { verifyAccessToken } from '@scc/shared';

import { type MuteBook, RateLimiter, cleanName } from './moderation.js';
import { interiorKey, owns } from './shard.js';
import { registerChat } from './room-chat.js';

/**
 * Sala do interior de um imóvel (residência ou escritório): quem está dentro
 * se vê andando, sentado, interagindo ou conversando, e conversa pelo chat.
 *
 * Só entra quem o world deixa visitar o imóvel do lote (o dono ou um convidado
 * do dono atual): no \`onAuth\`, o realtime pergunta ao world com o próprio token
 * do jogador (\`GET /v1/world/cities/:city/lots/:lot/visit\`). Uma sala por lote.
 */
export const Visitor = schema(
  {
    name: t.string().default('Visitante'),
    x: t.float32().default(0),
    z: t.float32().default(0),
    rot: t.float32().default(0),
    skin: t.string().default('man'),
    /** idle, walk, run, sit, interact ou talk: escolhe a animação nos outros. */
    pose: t.string().default('idle'),
    role: t.string().default('guest'),
  },
  'Visitor',
);
export type Visitor = InstanceType<typeof Visitor>;

export const InteriorState = schema(
  {
    city: t.string().default(''),
    lot: t.uint32().default(0),
    interior: t.string().default('home'),
    players: t.map(Visitor),
  },
  'InteriorState',
);
export type InteriorState = InstanceType<typeof InteriorState> & { players: MapSchema<Visitor> };

/** O world responde se o jogador pode entrar; `null` se não. */
export interface VisitChecker {
  check(token: string, city: string, lot: number): Promise<{ placeId: string; interior: string; role: 'owner' | 'guest' } | null>;
}

export interface InteriorDeps {
  jwtSecret: string;
  jwtIssuer: string;
  mutes: MuteBook;
  log: (event: string, data: Record<string, unknown>) => void;
  visits: VisitChecker | null;
  /** Divisão por bairro (SHARD=i/n): o interior vai pela chave do lote. */
  shard?: { index: number; count: number } | null;
}

/** O interior tem 12 × 9 m; com folga para a calçada da porta. */
const MAX_COORD = 20;
const POSES = new Set(['idle', 'walk', 'run', 'sit', 'interact', 'talk']);
const SKINS = new Set(['man', 'woman']);
/** Nome antigo do manequim feminino, de clientes que ainda não atualizaram. */
const skinOf = (v: unknown) => (v === 'human' ? 'woman' : v);
const MAX_VISITORS = 25; // o dono e até 20 convidados, com folga

const validCity = (c: unknown) => (typeof c === 'string' && /^[a-z][a-z0-9-]{1,30}$/.test(c) ? c : null);
const validLot = (l: unknown) => {
  const n = Number(l);
  return Number.isInteger(n) && n >= 0 && n < 2 ** 31 ? n : null;
};

export class InteriorRoom extends Room {
  static deps: InteriorDeps;
  declare state: InteriorState;

  maxMessagesPerSecond = 40;
  private readonly moves = new RateLimiter(10, 15);
  private readonly chats = new RateLimiter(1, 3);
  private readonly accounts = new Map<string, string>();

  async onAuth(_client: Client, options: { city?: unknown; lot?: unknown }, context: AuthContext) {
    const { jwtSecret, jwtIssuer, visits, shard } = InteriorRoom.deps;
    const token = context.token ?? '';
    const accountId = await verifyAccessToken(token, { secret: jwtSecret, issuer: jwtIssuer });
    if (!visits) throw new ServerError(503, 'visits_disabled');
    const city = validCity(options?.city);
    const lot = validLot(options?.lot);
    if (!city || lot === null) throw new ServerError(400, 'invalid_place');
    if (shard && !owns(shard, interiorKey(city, lot))) throw new ServerError(421, 'wrong_shard');
    const v = await visits.check(token, city, lot);
    if (!v) throw new ServerError(403, 'not_invited');
    return { accountId, role: v.role, interior: v.interior };
  }

  onCreate(options: { city?: unknown; lot?: unknown }) {
    const deps = InteriorRoom.deps;
    const city = validCity(options.city);
    const lot = validLot(options.lot);
    if (!city || lot === null) throw new Error('Informe city e lot válidos.');
    this.maxClients = MAX_VISITORS;
    this.setState(new InteriorState());
    this.state.city = city;
    this.state.lot = lot;
    this.setMetadata({ city, lot });

    this.onMessage('move', (client, msg: { x?: unknown; z?: unknown; rot?: unknown; pose?: unknown; skin?: unknown }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !this.moves.take(client.sessionId)) return;
      const x = Number(msg?.x);
      const z = Number(msg?.z);
      const rot = Number(msg?.rot ?? 0);
      if (![x, z, rot].every(Number.isFinite) || Math.abs(x) > MAX_COORD || Math.abs(z) > MAX_COORD) return;
      p.x = x;
      p.z = z;
      p.rot = rot;
      p.pose = typeof msg?.pose === 'string' && POSES.has(msg.pose) ? msg.pose : 'idle';
      const skin = skinOf(msg?.skin);
      if (typeof skin === 'string' && SKINS.has(skin)) p.skin = skin;
    });

    registerChat(this, {
      mutes: deps.mutes,
      log: deps.log,
      chats: this.chats,
      accounts: this.accounts,
      nameOf: (id) => this.state.players.get(id)?.name,
    });
  }

  onJoin(client: Client, options: { name?: unknown; skin?: unknown }) {
    const auth = client.auth as { accountId: string; role: string; interior: string };
    this.accounts.set(client.sessionId, auth.accountId);
    this.state.interior = auth.interior;
    const p = new Visitor();
    p.name = cleanName(options?.name);
    p.role = auth.role;
    const skin = skinOf(options?.skin);
    if (typeof skin === 'string' && SKINS.has(skin)) p.skin = skin;
    this.state.players.set(client.sessionId, p);
    InteriorRoom.deps.log('interior.join', { room: this.roomId, city: this.state.city, lot: this.state.lot, role: auth.role });
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.accounts.delete(client.sessionId);
    this.moves.forget(client.sessionId);
    this.chats.forget(client.sessionId);
  }
}

/** Pergunta ao world, com o token do jogador, se ele pode entrar no imóvel do lote. */
export class HttpVisitChecker implements VisitChecker {
  constructor(private readonly worldUrl: string) {}

  async check(token: string, city: string, lot: number) {
    const r = await fetch(`${this.worldUrl}/v1/world/cities/${encodeURIComponent(city)}/lots/${lot}/visit`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);
    if (!r?.ok) return null;
    const body = (await r.json()) as { place: { id: string; interior: string }; role: 'owner' | 'guest' };
    return { placeId: body.place.id, interior: body.place.interior, role: body.role };
  }
}
