import { type AuthContext, type Client, Room, ServerError } from '@colyseus/core';
import { type MapSchema, schema, t } from '@colyseus/schema';
import { verifyAccessToken } from '@scc/shared';

import { MuteBook, RateLimiter, cleanName } from './moderation.js';
import { districtKey, owns } from './shard.js';
import { registerChat } from './room-chat.js';

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
    /** `map`: olhando o mapa de cima (alfinete). `street`: caminhando no street view (avatar). `drive`: dirigindo o próprio carro. */
    mode: t.string().default('map'),
    /** Velocidade no street view, em m/s: escolhe a animação (parado, andando, correndo). */
    speed: t.float32().default(0),
    /** Tipo de avatar no street view: `man` ou `woman` (manequins da Universal Animation Library). */
    skin: t.string().default('man'),
    /**
     * O carro do jogador na rua: o modelo (`hatch`, `sedan`, `super`), dirigindo (`drive`) ou estacionado (a pé,
     * com o carro chamado); vazio sem carro. `carX`, `carZ` e `carRot` dizem onde ele está.
     */
    vehicle: t.string().default(''),
    carX: t.float32().default(0),
    carZ: t.float32().default(0),
    carRot: t.float32().default(0),
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
  /** Divisão por bairro (SHARD=i/n): null cuida de tudo. */
  shard?: { index: number; count: number } | null;
}

/** Limite do mapa em metros (Pittsburg tem 34,6 km de base). Fora disso, o movimento é ignorado. */
const MAX_COORD = 200_000;
const MODES = new Set(['map', 'street', 'drive']);
const MAX_SPEED = 10; // m/s: acima disso não é caminhada
/** Dirigindo: até 30 m/s (108 km/h, acima dos 90 km/h do superesportivo). */
const MAX_DRIVE_SPEED = 30;
const VEHICLES = new Set(['hatch', 'sedan', 'super']);
/** O carro estacionado fica a até 200 m de quem anda (senão, não vale). */
const MAX_CAR_DISTANCE = 200;
const SKINS = new Set(['man', 'woman']);
/** Nome antigo do manequim feminino, de clientes que ainda não atualizaram. */
const skinOf = (v: unknown) => (v === 'human' ? 'woman' : v);

export class DistrictRoom extends Room {
  static deps: RoomDeps;
  declare state: DistrictState;

  /** Qualquer cliente que passar disso cai (proteção do próprio Colyseus). */
  maxMessagesPerSecond = 40;
  private readonly moves = new RateLimiter(10, 15);
  private readonly chats = new RateLimiter(1, 3);
  private readonly accounts = new Map<string, string>();

  async onAuth(_client: Client, options: { city?: unknown; district?: unknown }, context: AuthContext) {
    const { jwtSecret, jwtIssuer, shard } = DistrictRoom.deps;
    // Bairro de outro processo: o cliente escolheu o processo errado (lista de URLs diferente).
    if (shard && !owns(shard, districtKey(String(options?.city), Number(options?.district)))) {
      throw new ServerError(421, 'wrong_shard');
    }
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

    this.onMessage('move', (client, msg: { x?: unknown; z?: unknown; rot?: unknown; mode?: unknown; speed?: unknown; skin?: unknown; vehicle?: unknown; car?: { x?: unknown; z?: unknown; rot?: unknown; model?: unknown } }) => {
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
      const limit = p.mode === 'drive' ? MAX_DRIVE_SPEED : p.mode === 'street' ? MAX_SPEED : 0;
      p.speed = Math.min(limit, Math.max(0, speed));
      // Dirigindo: o carro é o do jogador (o modelo desconhecido vira hatch). A pé, no street view: o carro
      // estacionado, se veio um válido perto dele. No mapa, ou sem carro: nenhum.
      if (p.mode === 'drive') {
        p.vehicle = typeof msg?.vehicle === 'string' && VEHICLES.has(msg.vehicle) ? msg.vehicle : 'hatch';
        p.carX = x;
        p.carZ = z;
        p.carRot = rot;
      } else {
        const c = p.mode === 'street' ? msg?.car : null;
        const cx = Number(c?.x), cz = Number(c?.z), cr = Number(c?.rot ?? 0);
        const ok =
          c && typeof c.model === 'string' && VEHICLES.has(c.model) && [cx, cz, cr].every(Number.isFinite) && Math.hypot(cx - x, cz - z) <= MAX_CAR_DISTANCE;
        p.vehicle = ok ? (c.model as string) : '';
        if (ok) {
          p.carX = cx;
          p.carZ = cz;
          p.carRot = cr;
        }
      }
      // Tipo de avatar desconhecido não muda o atual.
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
  announce(event: { kind: string; text: string; at: string; title?: string }) {
    this.broadcast('event', event);
  }
}
