import { createHash, createHmac, randomBytes } from 'node:crypto';

import { AppError } from '@scc/shared';

import { type Attributes, type Avatar, status } from './avatar.js';
import type { Rarity } from './catalog.js';

/**
 * Turno de trabalho (E1.4; doc 02 §3.2, doc 04 §4). O ganho segue a mesma
 * fórmula e os mesmos parâmetros do simulador econômico
 * (tools/econ-sim/params/base.json), que é o que a ADR-0010 aprovou: se um
 * mudar, o outro muda junto.
 */
export const SHIFT_HOURS = [6, 12] as const;
export type ShiftHours = (typeof SHIFT_HOURS)[number];

/** No máximo 12 h por dia: um turno de 12 h ou dois de 6 h (GDD §3.2). */
export const MAX_HOURS_PER_DAY = 12;

/** Energia gasta no turno. Premissa: o GDD dá o custo por tarefa, não por turno. */
export const ENERGY_COST: Record<ShiftHours, number> = { 6: 3, 12: 6 };

/** Ganho base por dia (THALER), da tabela de atributos (doc 02 §2.2). */
export const BASE_RANGE: Record<Rarity, [number, number]> = {
  common: [100, 125],
  rare: [140, 165],
  epic: [180, 205],
  legendary: [225, 250],
};

/** doc 02 §2.4, índice = nível 0..10 (nível 0 tratado como 1), como no simulador. */
export const HEALTH_MULT = [0.5, 0.5, 0.55, 0.6, 0.7, 0.8, 0.9, 1, 1.2, 1.4, 1.5];
export const HAPPINESS_MULT = [1, 1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2];
/** Experiência: educação 0 / 50 / 100 → 1× / 2× / 3×; com o pet, teto conjunto de 2,5× (ADR-0013). */
export const EXP_PET_CAP = 2.5;

/** Danos do turno: premissas do simulador (params work.damageChance / damageFraction). */
export const DAMAGE_CHANCE = 0.05;
export const DAMAGE_FRACTION = 0.3;

/**
 * Base do avatar dentro da faixa da raridade. O simulador sorteia uma base por
 * avatar; aqui ela sai do id, então é sempre a mesma para o mesmo avatar.
 */
export function baseOf(avatarId: string, rarity: Rarity): number {
  const [min, max] = BASE_RANGE[rarity];
  const n = createHash('sha256').update(`base:${avatarId}`).digest().readUInt32BE(0);
  return min + (n % (max - min + 1));
}

export const expMultiplier = (education: number) => 1 + Math.min(100, Math.max(0, education)) / 50;

export interface Snapshot {
  /** Atributos no começo do turno: o resultado não muda se a queda continuar durante o turno. */
  health: number;
  happiness: number;
  education: number;
  earnsReward: boolean;
  base: number;
}

export interface ShiftResult {
  damaged: boolean;
  /** Valor do turno em centavos de THALER. */
  thalerCents: bigint;
  /** Fatores usados, para a tela e para auditoria. */
  factors: { base: number; hours: number; health: number; happiness: number; expPet: number; damage: number };
}

export type ShiftStatus = 'running' | 'done' | 'claimed';

export interface Shift {
  id: string;
  avatarId: string;
  accountId: string;
  jobCode: string;
  hours: ShiftHours;
  startsAt: Date;
  endsAt: Date;
  /** sha256 da semente, publicado no começo. */
  seedCommit: string;
  /** A semente: secreta enquanto o turno roda, revelada quando acaba. */
  seed: string;
  snapshot: Snapshot;
  result: ShiftResult | null;
  status: ShiftStatus;
}

const HOUR = 3_600_000;
const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * Confere se o avatar (já com a queda até agora) pode começar o turno e devolve
 * o turno e o avatar com a energia gasta. `hoursToday` são as horas de turnos
 * já começados hoje (UTC).
 */
export function startShift(
  avatar: Avatar,
  input: { id: string; hours: number; hoursToday: number; running: boolean; durationMs?: number },
  now: Date,
): { shift: Shift; avatar: Avatar } {
  if (!SHIFT_HOURS.includes(input.hours as ShiftHours)) {
    throw new AppError('invalid_shift', 'O turno é de 6 ou de 12 horas.', 400);
  }
  const hours = input.hours as ShiftHours;
  if (input.running) throw new AppError('shift_running', 'O avatar já está trabalhando.', 409);
  if (input.hoursToday + hours > MAX_HOURS_PER_DAY) {
    throw new AppError('daily_limit', `No máximo ${MAX_HOURS_PER_DAY} h de trabalho por dia.`, 409);
  }
  const cost = ENERGY_COST[hours];
  const a = avatar.attributes;
  if (!status(avatar).canWork || a.energy < cost) {
    throw new AppError('too_tired', `Energia ou saúde insuficiente: o turno de ${hours} h gasta ${cost} de energia.`, 409);
  }

  const seed = randomBytes(32).toString('hex');
  const shift: Shift = {
    id: input.id,
    avatarId: avatar.id,
    accountId: avatar.accountId,
    jobCode: avatar.jobCode,
    hours,
    startsAt: now,
    endsAt: new Date(now.getTime() + (input.durationMs ?? hours * HOUR)),
    seedCommit: createHash('sha256').update(seed).digest('hex'),
    seed,
    snapshot: {
      health: a.health,
      happiness: a.happiness,
      education: a.education,
      earnsReward: status(avatar).earnsReward,
      base: baseOf(avatar.id, avatar.rarity),
    },
    result: null,
    status: 'running',
  };
  const attributes: Attributes = { ...a, energy: a.energy - cost };
  return { shift, avatar: { ...avatar, attributes, updatedAt: now } };
}

/** Número de 0 a 1 tirado da semente e do turno: quem tem a semente revelada refaz a conta. */
export function draw(seed: string, shiftId: string, label: string): number {
  return createHmac('sha256', Buffer.from(seed, 'hex')).update(`${shiftId}:${label}`).digest().readUInt32BE(0) / 2 ** 32;
}

/** Resultado do turno: a fórmula do doc 04 §4, com os fatores que já existem no jogo. */
export function settle(shift: Pick<Shift, 'id' | 'hours' | 'seed' | 'snapshot'>): ShiftResult {
  const s = shift.snapshot;
  const level = (v: number) => Math.min(10, Math.max(1, v));
  const health = HEALTH_MULT[level(s.health)]!;
  const happiness = HAPPINESS_MULT[level(s.happiness)]!;
  // Pet ainda não existe: só a experiência entra, com o teto conjunto.
  const expPet = Math.min(expMultiplier(s.education), EXP_PET_CAP);
  const damaged = draw(shift.seed, shift.id, 'damage') < DAMAGE_CHANCE;
  const damage = damaged ? 1 - DAMAGE_FRACTION : 1;
  const dayShare = shift.hours / MAX_HOURS_PER_DAY;
  // GDD: 48 h sem comer não gera recompensa.
  const thaler = s.earnsReward ? s.base * dayShare * health * happiness * expPet * damage : 0;
  return {
    damaged,
    thalerCents: BigInt(Math.round(thaler * 100)),
    factors: { base: s.base, hours: shift.hours, health, happiness, expPet, damage },
  };
}

export const hoursSince = (shifts: Pick<Shift, 'startsAt' | 'hours'>[], now: Date) => {
  const day = startOfUtcDay(now).getTime();
  return shifts.filter((s) => s.startsAt.getTime() >= day).reduce((sum, s) => sum + s.hours, 0);
};

/** Quem paga o turno: o ledger do economy. Separado para os testes trocarem por um falso. */
export interface Payer {
  /** Paga do pool P2E para o jogador. Idempotente pela chave `shift:<id>`. */
  payShift(shift: Shift, amountCents: bigint, requestId?: string): Promise<void>;
}

/** O plano do turno recebe o avatar já travado e com a queda até agora. */
export type ShiftPlanner = (avatar: Avatar, context: { hoursToday: number; running: boolean }) => {
  shift: Shift;
  avatar: Avatar;
};

/** Persistência dos turnos. Mora no mesmo banco do avatar: começar o turno grava os dois juntos. */
export interface ShiftStore {
  /** Trava o avatar da conta, aplica o plano e grava turno e avatar numa transação. */
  beginShift(avatarId: string, accountId: string, now: Date, plan: ShiftPlanner): Promise<Shift>;
  /** Conclui até `batch` turnos vencidos; devolve quantos concluiu. Job `shift.complete`. */
  completeDue(now: Date, batch: number): Promise<number>;
  listShifts(avatarId: string, limit: number): Promise<Shift[]>;
  /** done → claimed. Repetir não faz nada. */
  markClaimed(shiftId: string): Promise<void>;
}
