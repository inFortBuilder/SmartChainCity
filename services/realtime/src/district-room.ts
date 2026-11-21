import { type AuthContext, type Client, Room } from '@colyseus/core';
import { type MapSchema, schema, t } from '@colyseus/schema';
import { verifyAccessToken } from '@scc/shared';

import { MuteBook, RateLimiter, cleanName, moderateText } from './moderation.js';

/**
 * Sala de um bairro (ADR-0005; ADR-0012: o bairro é a unidade de carregamento
 * do mapa). Presença, chat moderado e eventos. O jogo é assíncrono: a sala só
 * mostra quem está por perto e o que dizem; nada aqui mexe em saldo ou posse.
 *
 * Cada instância aceita até `maxClients` (100, doc 05 §4). Lotada, o matchmaker
 * abre outra instância do mesmo bairro (`filterBy(['city', 'district'])`).
 */

export const Player = schema(
  {
    name: t.string().default('Visitante'),
    x: t.float32().default(0),
    z: t.float32().default(0),
    rot: t.float32().default(0),
    /** `map`: olhando o mapa de cima (alfinete). `street`: caminhando no street view (avatar). */
    mode: t.string().default('map'),
    /** Velocidade no street view, em m/s: escolhe a animação (parado, andando, correndo). */
    speed: t.float32().default(0),
    /** Tipo de avatar no street view: `man` ou `human` (manequins da Universal Animation Library). */
    skin: t.string().default('man'),
  },
  'Player',
);
export type Player = InstanceType<typeof Player>;

export const DistrictState = schema(
  {
    city: t.string().default(''),
    district: t.uint16().default(0),
    players: t.map(Player),
  },
  'DistrictState',
);
export type DistrictState = InstanceType<typeof DistrictState> & { players: MapSchema<Player> };

export interface RoomDeps {
  jwtSecret: string;
  jwtIssuer: string;
  maxClients: number;
  mutes: MuteBook;
  log: (event: string, data: Record<string, unknown>) => void;
  /** Salas vivas, para os eventos globais (`/internal/v1/broadcast`). */
  registry: Set<DistrictRoom>;
}

/** Limite do mapa em metros (Pittsburg tem 34,6 km de base). Fora disso, o movimento é ignorado. */
const MAX_COORD = 200_000;
const MODES = new Set(['map', 'street']);
const MAX_SPEED = 10; // m/s: acima disso não é caminhada
const SKINS = new Set(['man', 'human']);

export class DistrictRoom extends Room {
  static deps: RoomDeps;
  declare state: DistrictState;

  /** Qualquer cliente que passar disso cai (proteção do próprio Colyseus). */
  maxMessagesPerSecond = 40;
  private readonly moves = new RateLimiter(10, 15);
  private readonly chats = new RateLimiter(1, 3);
  private readonly accounts = new Map<string, string>();

  async onAuth(_client: Client, _options: unknown, context: AuthContext) {
    const { jwtSecret, jwtIssuer } = DistrictRoom.deps;
    const accountId = await verifyAccessToken(context.token ?? '', { secret: jwtSecret, issuer: jwtIssuer });
    return { accountId };
  }

  onCreate(options: { city?: unknown; district?: unknown }) {
    const deps = DistrictRoom.deps;
    const city = typeof options.city === 'string' && /^[a-z][a-z0-9-]{1,30}$/.test(options.city) ? options.city : null;
    const district = Number(options.district);
    if (!city || !Number.isInteger(district) || district < 0 || district > 65_535) {
      throw new Error('Informe city e district válidos.');
    }
    this.maxClients = deps.maxClients;
    this.setState(new DistrictState());
    this.state.city = city;
    this.state.district = district;
    this.setMetadata({ city, district });
    deps.registry.add(this);

    this.onMessage('move', (client, msg: { x?: unknown; z?: unknown; rot?: unknown; mode?: unknown; speed?: unknown; skin?: unknown }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !this.moves.take(client.sessionId)) return;
      const x = Number(msg?.x);
      const z = Number(msg?.z);
      const rot = Number(msg?.rot ?? 0);
      const speed = Number(msg?.speed ?? 0);
      if (![x, z, rot, speed].every(Number.isFinite) || Math.abs(x) > MAX_COORD || Math.abs(z) > MAX_COORD) return;
      p.x = x;
      p.z = z;
      p.rot = rot;
      // Modo desconhecido vira mapa; velocidade fica entre 0 e o limite.
      p.mode = typeof msg?.mode === 'string' && MODES.has(msg.mode) ? msg.mode : 'map';
      p.speed = p.mode === 'street' ? Math.min(MAX_SPEED, Math.max(0, speed)) : 0;
      // Tipo de avatar desconhecido não muda o atual.
      if (typeof msg?.skin === 'string' && SKINS.has(msg.skin)) p.skin = msg.skin;
    });

    this.onMessage('chat', (client, msg: { text?: unknown }) => {
      const p = this.state.players.get(client.sessionId);
      const account = this.accounts.get(client.sessionId);
      if (!p || !account) return;
      const muted = deps.mutes.isMuted(account);
      if (muted) return client.send('chat_error', { reason: 'muted', until: new Date(muted).toISOString() });
      if (!this.chats.take(client.sessionId)) return client.send('chat_error', { reason: 'too_fast' });

      const r = moderateText(typeof msg?.text === 'string' ? msg.text : '');
      if (!r.ok) {
        const until = r.reason === 'link' ? deps.mutes.violation(account) : 0;
        deps.log('chat.blocked', { account, reason: r.reason, room: this.roomId, muted: until > 0 });
        return client.send('chat_error', { reason: r.reason, ...(until ? { muted_until: new Date(until).toISOString() } : {}) });
      }
      if (r.masked) {
        const until = deps.mutes.violation(account);
        deps.log('chat.masked', { account, room: this.roomId, muted: until > 0 });
      }
      this.broadcast('chat', { from: client.sessionId, name: p.name, text: r.text, at: new Date().toISOString() });
    });

    // Denúncia: 3 jogadores diferentes silenciam o alvo (doc 10).
    this.onMessage('report', (client, msg: { sessionId?: unknown; reason?: unknown }) => {
      const by = this.accounts.get(client.sessionId);
      const target = typeof msg?.sessionId === 'string' ? this.accounts.get(msg.sessionId) : undefined;
      if (!by || !target) return;
      const until = deps.mutes.report(target, by);
      deps.log('chat.report', { by, target, room: this.roomId, reason: String(msg?.reason ?? '').slice(0, 100), muted: until > 0 });
      client.send('report_ok', {});
    });
  }

  onJoin(client: Client, options: { name?: unknown; x?: unknown; z?: unknown }) {
    const auth = client.auth as { accountId: string };
    this.accounts.set(client.sessionId, auth.accountId);
    const p = new Player();
    p.name = cleanName(options?.name);
    const x = Number(options?.x);
    const z = Number(options?.z);
    if (Number.isFinite(x) && Number.isFinite(z) && Math.abs(x) <= MAX_COORD && Math.abs(z) <= MAX_COORD) {
      p.x = x;
      p.z = z;
    }
    this.state.players.set(client.sessionId, p);
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.accounts.delete(client.sessionId);
    this.moves.forget(client.sessionId);
    this.chats.forget(client.sessionId);
  }

  onDispose() {
    DistrictRoom.deps.registry.delete(this);
  }

  /** Evento da Prefeitura (dirigível de promoções, corrida, aviso) para quem está na sala. */
  announce(event: { kind: string; text: string; at: string }) {
    this.broadcast('event', event);
  }
}
