import { AppError } from '@scc/shared';

import { type Rarity, isRarity, professionFits } from './catalog.js';
import { CONDITIONS, type Condition, activeConditions, drainDue, drainHealth } from './conditions.js';
import { type Pet, decayedPet } from './pet.js';
import { type School, inSchool, schooled } from './school.js';
import type { Leisure } from './leisure.js';
import { type License, inDrivingSchool } from './vehicle.js';
import type { Housing } from './housing.js';
import { type Chores, type Rest, mustRest, rested, resting } from './routine.js';
import type { Gear } from './shop.js';

/**
 * Avatar e atributos (doc 02 §2.3, doc 06 §2). Atributos de 0 a 10, educação
 * de 0 a 100 cumulativa (ADR-0013). Até 3 avatares por conta (ADR-0013).
 */
export const MAX_AVATARS_PER_ACCOUNT = 3;
export const ATTRIBUTE_MAX = 10;

const HOUR = 3_600_000;

/**
 * Queda com o tempo. Só a alimentação tem taxa no GDD ("48 h sem comer"):
 * de 10 a 0 em 48 h. Felicidade e higiene são premissas desta etapa, a
 * calibrar no simulador. Energia não cai sozinha: gasta com o turno de trabalho (E1.4) e atividades. A
 * saúde cai com as doenças graves (conditions.ts, drainHealth).
 */
export const DECAY = {
  food: { everyMs: 4.8 * HOUR, source: 'GDD §2.3: 48 h de 10 a 0' },
  happiness: { everyMs: 12 * HOUR, source: 'premissa: 5 dias de 10 a 0' },
  hygiene: { everyMs: 8 * HOUR, source: 'premissa: ~3 dias de 10 a 0' },
} as const;
export type DecayingAttribute = keyof typeof DECAY;
export const DECAYING = Object.keys(DECAY) as DecayingAttribute[];

export interface Attributes {
  energy: number;
  health: number;
  happiness: number;
  food: number;
  hygiene: number;
  education: number;
}

export interface Avatar {
  id: string;
  /** Token do AvatarNFT (texto, uint256); null no avatar que só existe no jogo. */
  tokenId: string | null;
  accountId: string;
  /** Desde quando é desta conta: na conta com mais avatares que o limite, trabalham os mais antigos. */
  ownedSince: Date;
  rarity: Rarity;
  jobCode: string;
  attributes: Attributes;
  /**
   * Instante de referência de cada atributo que cai: o próximo ponto cai em
   * `anchor + período`. Guardar o instante (e não só o valor) é o que deixa a
   * leitura e o job concordarem sem perder frações de tempo.
   */
  anchors: Record<DecayingAttribute, Date>;
  /** Internado até este instante (hospital compulsório, E2.3); null fora do hospital. */
  hospitalUntil: Date | null;
  /** Doenças leves (farmácia), inclusive a que começa quando o turno acabar. */
  conditions: Condition[];
  /** Despensa: unidades guardadas de cada alimento, compradas em pacote. */
  pantry: Record<string, number>;
  /** Pet do avatar (E3.1): gato ou cachorro, vivo ou morto até ser enterrado; null sem pet. */
  pet?: Pet | null;
  /** Escola (E3.2): última aula e troca de profissão em curso; null sem histórico. */
  school?: School | null;
  /** Lazer (E3.3): última vez de cada atividade; null sem histórico. */
  leisure?: Leisure | null;
  /** Habilitação (E3.5): o fim da autoescola; null sem habilitação. */
  license?: License | null;
  /** Moradia paga (aluguel ou hotel); null sem estadia. A casa própria vem do world. */
  housing?: Housing | null;
  /** Descanso em curso: a energia entra ao acordar; null acordado. */
  rest?: Rest | null;
  /** Desde quando está acordado (fim do último descanso); o descanso é obrigatório após 16 h. */
  awakeSince?: Date | null;
  /** Higiene em casa: última vez de cada atividade. */
  chores?: Chores | null;
  /** Itens da loja do jogo: roupa, ferramenta de trabalho e cama. */
  gear?: Gear | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Valores de agora, sem gravar: a API mostra sempre o atual, entre uma passada do job e outra. */
export function decayed(avatar: Avatar, now: Date): Avatar {
  const attributes = { ...avatar.attributes };
  const anchors = { ...avatar.anchors };
  for (const name of DECAYING) {
    const { everyMs } = DECAY[name];
    const elapsed = now.getTime() - anchors[name].getTime();
    if (elapsed < everyMs) continue;
    const steps = Math.floor(elapsed / everyMs);
    const lost = Math.min(steps, attributes[name]);
    attributes[name] -= lost;
    // Zerado, o relógio para no agora: comer de novo recomeça a contagem cheia.
    anchors[name] = attributes[name] === 0 ? now : new Date(anchors[name].getTime() + steps * everyMs);
  }
  // Doenças graves tiram saúde com o tempo (febre, enxaqueca, virose: 1 a cada 15 min).
  const drained = drainHealth(avatar.conditions, attributes.health, now);
  attributes.health = drained.health;
  // O pet cai junto (pet.ts): alimentação em 0 o mata.
  const pet = avatar.pet ? decayedPet(avatar.pet, now) : (avatar.pet ?? null);
  // A escola anda junto: o bônus de felicidade do 2º dia e a troca de profissão no fim dos 4 dias.
  // Quem já dormiu o bastante acorda com a energia (routine.ts).
  return rested(schooled({ ...avatar, attributes, anchors, conditions: drained.conditions, pet }, now), now);
}

/** Algo caiu desde a última gravação? É o que o job procura. */
export const decayDue = (avatar: Avatar, now: Date) =>
  DECAYING.some((name) => avatar.attributes[name] > 0 && now.getTime() - avatar.anchors[name].getTime() >= DECAY[name].everyMs) ||
  drainDue(avatar.conditions, avatar.attributes.health, now);

/** Internado agora? A alta é pelo relógio: passou de `hospitalUntil`, está livre. */
export const inHospital = (avatar: Avatar, now: Date) =>
  avatar.hospitalUntil !== null && avatar.hospitalUntil.getTime() > now.getTime();

/** Situação que a tela mostra e que o turno de trabalho vai consultar. */
export function status(avatar: Avatar, now: Date = new Date()) {
  const a = avatar.attributes;
  // De cama ou isolado (dor de barriga, gripe) também não trabalha nem sai para o lazer.
  const bedridden = activeConditions(avatar.conditions, now).some((c) => CONDITIONS[c.code].blocksWork);
  // Na escola trocando de profissão também não trabalha (E3.2).
  // Na autoescola (3 h parado, GDD) também.
  // Dormindo também não (routine.ts).
  // Com 16 h acordado, só depois de dormir (routine.ts).
  const free =
    !inHospital(avatar, now) && !bedridden && !inSchool(avatar, now) && !inDrivingSchool(avatar, now) && !resting(avatar, now) && !mustRest(avatar, now);
  return {
    // GDD: 48 h sem comer não gera recompensa.
    earnsReward: a.food > 0,
    // GDD: 1 nível de energia = só trabalhar; 2 = trabalhar e lazer. No hospital, nenhum dos dois.
    canWork: free && a.energy >= 1 && a.health >= 1,
    canLeisure: free && a.energy >= 2 && a.health >= 1,
    inHospital: inHospital(avatar, now),
    resting: resting(avatar, now),
    mustRest: mustRest(avatar, now),
  };
}

export function newAvatar(
  input: { id: string; accountId: string; rarity: string; jobCode: string; tokenId?: string },
  now: Date,
): Avatar {
  if (!isRarity(input.rarity)) throw new AppError('invalid_rarity', 'Raridade inválida.', 400);
  if (!professionFits(input.rarity, input.jobCode)) {
    throw new AppError('invalid_job', 'Profissão não existe nessa raridade.', 400);
  }
  return {
    id: input.id,
    tokenId: input.tokenId ?? null,
    accountId: input.accountId,
    ownedSince: now,
    rarity: input.rarity,
    jobCode: input.jobCode,
    attributes: { energy: 10, health: 10, happiness: 10, food: 10, hygiene: 10, education: 0 },
    anchors: { food: now, happiness: now, hygiene: now },
    hospitalUntil: null,
    conditions: [],
    pantry: {},
    pet: null,
    school: null,
    leisure: null,
    license: null,
    housing: null,
    rest: null,
    awakeSince: now,
    chores: null,
    gear: null,
    createdAt: now,
    updatedAt: now,
  };
}

export const tooManyAvatars = () =>
  new AppError('avatar_limit', `Cada conta pode ter até ${MAX_AVATARS_PER_ACCOUNT} avatares.`, 409);

/**
 * O avatar que chega da blockchain (mint da Lucky Box ou compra de outro
 * jogador) entra mesmo com a conta no limite: o NFT é do jogador. Para o
 * antifraude continuar valendo, só os 3 (MAX_AVATARS_PER_ACCOUNT) mais antigos na conta trabalham.
 */
export function mayWork(owned: Avatar[], avatarId: string) {
  if (owned.length <= MAX_AVATARS_PER_ACCOUNT) return true;
  return [...owned]
    .sort((a, b) => a.ownedSince.getTime() - b.ownedSince.getTime() || a.id.localeCompare(b.id))
    .slice(0, MAX_AVATARS_PER_ACCOUNT)
    .some((a) => a.id === avatarId);
}

export const overAvatarLimit = () =>
  new AppError(
    'avatar_limit',
    `A conta tem mais de ${MAX_AVATARS_PER_ACCOUNT} avatares: só os ${MAX_AVATARS_PER_ACCOUNT} que estão nela há mais tempo trabalham.`,
    409,
  );

/** Persistência dos avatares. Memória e Postgres passam pelo mesmo teste de contrato. */
export interface AvatarStore {
  /** Cria respeitando o limite por conta, mesmo com pedidos em paralelo. */
  create(avatar: Avatar): Promise<Avatar>;
  /**
   * Avatar mintado na blockchain: entra fora do limite e uma vez só por token.
   * Se o token já tem avatar, devolve o que existe.
   */
  createFromChain(avatar: Avatar & { tokenId: string }): Promise<Avatar>;
  getByToken(tokenId: string): Promise<Avatar | null>;
  /** Passa o avatar de `from` para `to`; não faz nada se o dono já não for `from`. */
  transfer(id: string, from: string, to: string, now: Date): Promise<boolean>;
  get(id: string): Promise<Avatar | null>;
  listByAccount(accountId: string): Promise<Avatar[]>;
  /**
   * Grava a queda de até `batch` avatares com queda pendente e devolve quantos
   * gravou. O job chama em laço até devolver 0.
   */
  applyDecay(now: Date, batch: number): Promise<number>;
  /** Hóspedes com estadia em curso num hotel de jogador (a lotação). */
  hotelGuests(hotelId: string, now: Date): Promise<number>;
  /** Números públicos da cidade (site): avatares e acidentes de trabalho (turnos com dano). */
  publicStats(): Promise<{ avatars: number; workAccidents: number }>;
}
