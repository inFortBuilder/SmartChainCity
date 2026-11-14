import { AppError } from '@scc/shared';

import { type Rarity, isRarity, professionFits } from './catalog.js';

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
 * calibrar no simulador. Energia e saúde não caem sozinhas: gastam com o
 * turno de trabalho (E1.4), atividades e doenças.
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
  accountId: string;
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
  return { ...avatar, attributes, anchors };
}

/** Algo caiu desde a última gravação? É o que o job procura. */
export const decayDue = (avatar: Avatar, now: Date) =>
  DECAYING.some((name) => avatar.attributes[name] > 0 && now.getTime() - avatar.anchors[name].getTime() >= DECAY[name].everyMs);

/** Internado agora? A alta é pelo relógio: passou de `hospitalUntil`, está livre. */
export const inHospital = (avatar: Avatar, now: Date) =>
  avatar.hospitalUntil !== null && avatar.hospitalUntil.getTime() > now.getTime();

/** Situação que a tela mostra e que o turno de trabalho vai consultar. */
export function status(avatar: Avatar, now: Date = new Date()) {
  const a = avatar.attributes;
  const free = !inHospital(avatar, now);
  return {
    // GDD: 48 h sem comer não gera recompensa.
    earnsReward: a.food > 0,
    // GDD: 1 nível de energia = só trabalhar; 2 = trabalhar e lazer. No hospital, nenhum dos dois.
    canWork: free && a.energy >= 1 && a.health >= 1,
    canLeisure: free && a.energy >= 2 && a.health >= 1,
    inHospital: !free,
  };
}

export function newAvatar(input: { id: string; accountId: string; rarity: string; jobCode: string }, now: Date): Avatar {
  if (!isRarity(input.rarity)) throw new AppError('invalid_rarity', 'Raridade inválida.', 400);
  if (!professionFits(input.rarity, input.jobCode)) {
    throw new AppError('invalid_job', 'Profissão não existe nessa raridade.', 400);
  }
  return {
    id: input.id,
    accountId: input.accountId,
    rarity: input.rarity,
    jobCode: input.jobCode,
    attributes: { energy: 10, health: 10, happiness: 10, food: 10, hygiene: 10, education: 0 },
    anchors: { food: now, happiness: now, hygiene: now },
    hospitalUntil: null,
    createdAt: now,
    updatedAt: now,
  };
}

export const tooManyAvatars = () =>
  new AppError('avatar_limit', `Cada conta pode ter até ${MAX_AVATARS_PER_ACCOUNT} avatares.`, 409);

/** Persistência dos avatares. Memória e Postgres passam pelo mesmo teste de contrato. */
export interface AvatarStore {
  /** Cria respeitando o limite por conta, mesmo com pedidos em paralelo. */
  create(avatar: Avatar): Promise<Avatar>;
  get(id: string): Promise<Avatar | null>;
  listByAccount(accountId: string): Promise<Avatar[]>;
  /**
   * Grava a queda de até `batch` avatares com queda pendente e devolve quantos
   * gravou. O job chama em laço até devolver 0.
   */
  applyDecay(now: Date, batch: number): Promise<number>;
}
