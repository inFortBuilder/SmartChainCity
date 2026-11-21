import { createHmac, randomBytes } from 'node:crypto';

import { AppError } from '@scc/shared';

import { type Avatar, status } from './avatar.js';
import { assertNotInHospital } from './hospital.js';
import { assertNotInSchool } from './school.js';
import { type Vehicle, attributesAt, licensed, stateOf } from './vehicle.js';

/**
 * Corridas diárias e oficina (E3.5, GDD §6 "Carros" e "Oficina"; doc 04 §7 para os sinks).
 *
 * Do GDD:
 * - Corridas diárias decididas por velocidade, força, experiência e sorte.
 * - Limite diário de corridas, porque o prêmio é emissão.
 * - Seguro e revisão reduzem as panes.
 * - Reparos leve, moderado e grave levam 1, 3 e 7 dias na oficina.
 *
 * Como funciona aqui:
 * - O piloto (um avatar habilitado da conta) corre com o carro contra 7 rivais do jogo. A semente da
 *   corrida é sorteada no servidor e fica no resultado: quem tem a semente refaz a conta.
 * - A gasolina é cobrada antes (queima `burn/fuel`). O prêmio sai do pool P2E, como o turno.
 * - A oficina aqui é a do jogo. A oficina como negócio de jogador fica para quando houver o serviço.
 *
 * PREMISSAS desta etapa, a calibrar no simulador:
 * - Nota do piloto: 30% velocidade, 25% força (de 0 a 100 cada), 20% experiência (educação de 0 a 100)
 *   e 25% sorte. Cada rival tem nota sorteada entre 0,30 e 0,75.
 * - Prêmios de 20, 10 e 5 THALER para o 1º, 2º e 3º. Gasolina de 3 THALER. Até 3 corridas por avatar
 *   por dia (UTC). A corrida tira 1 de energia e dá 1 de felicidade, e precisa de 2 de energia.
 * - Pane em 5% das corridas (2% com a revisão em dia): 60% leve, 30% moderada e 10% grave. O carro com
 *   pane não corre até o reparo.
 * - Reparo de 2%, 5% e 10% do preço do carro. Revisão de 1% do preço, válida por 30 dias.
 */
const DAY = 86_400_000;
export const RIVALS = 7;
export const RIVAL_RANGE = [0.3, 0.75] as const;
export const WEIGHTS = { speed: 0.3, power: 0.25, experience: 0.2, luck: 0.25 } as const;
export const PRIZES_CENTS = [2000n, 1000n, 500n] as const;
export const FUEL_CENTS = 300n;
export const RACES_PER_DAY = 3;
export const RACE_ENERGY = -1;
export const RACE_HAPPINESS = 1;
export const BREAKDOWN_CHANCE = 0.05;
export const BREAKDOWN_CHANCE_REVISED = 0.02;
export const SEVERITIES = {
  leve: { share: 0.6, days: 1, repairBps: 200 },
  moderado: { share: 0.3, days: 3, repairBps: 500 },
  grave: { share: 0.1, days: 7, repairBps: 1000 },
} as const;
export type Severity = keyof typeof SEVERITIES;
export const REVISION_BPS = 100;
export const REVISION_MS = 30 * DAY;

export type RaceStatus = 'pending' | 'charged' | 'done' | 'failed';

export interface RaceResult {
  /** 1 a 8. */
  position: number;
  score: number;
  rivals: number[];
  prizeCents: string;
  breakdown: Severity | null;
  factors: { speed: number; power: number; experience: number; luck: number };
}

export interface Race {
  id: string;
  vehicleId: string;
  avatarId: string;
  accountId: string;
  /** Dia (UTC, AAAA-MM-DD) para o limite diário. */
  day: string;
  seed: string;
  result: RaceResult;
  fuelCents: bigint;
  status: RaceStatus;
  createdAt: Date;
}

export const dayOf = (now: Date) => now.toISOString().slice(0, 10);

/** Número de 0 a 1 tirado da semente: quem tem a semente revelada refaz a conta. */
export const draw = (seed: string, raceId: string, label: string) =>
  createHmac('sha256', Buffer.from(seed, 'hex')).update(`${raceId}:${label}`).digest().readUInt32BE(0) / 2 ** 32;

const round = (n: number) => Math.round(n * 10_000) / 10_000;

/** Resultado da corrida, todo pela semente. */
export function runRace(input: { id: string; seed: string; vehicle: Vehicle; education: number; revised: boolean }, now: Date): RaceResult {
  const attrs = attributesAt(input.vehicle, now);
  const luck = draw(input.seed, input.id, 'luck');
  const factors = { speed: attrs.speed / 100, power: attrs.power / 100, experience: Math.min(100, input.education) / 100, luck: round(luck) };
  const score = round(
    WEIGHTS.speed * factors.speed + WEIGHTS.power * factors.power + WEIGHTS.experience * factors.experience + WEIGHTS.luck * luck,
  );
  const rivals = Array.from({ length: RIVALS }, (_, i) => round(RIVAL_RANGE[0] + (RIVAL_RANGE[1] - RIVAL_RANGE[0]) * draw(input.seed, input.id, `rival:${i}`)));
  const position = 1 + rivals.filter((r) => r > score).length;
  const chance = input.revised ? BREAKDOWN_CHANCE_REVISED : BREAKDOWN_CHANCE;
  let breakdown: Severity | null = null;
  if (draw(input.seed, input.id, 'breakdown') < chance) {
    const s = draw(input.seed, input.id, 'severity');
    breakdown = s < SEVERITIES.leve.share ? 'leve' : s < SEVERITIES.leve.share + SEVERITIES.moderado.share ? 'moderado' : 'grave';
  }
  return { position, score, rivals, prizeCents: (PRIZES_CENTS[position - 1] ?? 0n).toString(), breakdown, factors };
}

/** Confere a corrida: carro ok sem pane, piloto habilitado e com energia, dentro do limite do dia. */
export function checkRace(vehicle: Vehicle, avatar: Avatar, racesToday: number, now: Date) {
  const state = stateOf(vehicle, now);
  if (state !== 'ok') {
    const why: Record<string, string> = {
      suspended: 'O carro está suspenso: pague o IPVA.',
      worn_out: 'O carro passou da vida útil: só vende.',
      expired: 'O aluguel venceu.',
      broken: 'O carro está com pane: leve à oficina.',
      repairing: 'O carro está na oficina.',
      pending: 'O carro ainda está sendo processado.',
    };
    throw new AppError('vehicle_unavailable', why[state] ?? 'O carro não pode correr agora.', 409);
  }
  if (avatar.accountId !== vehicle.accountId) throw new AppError('not_found', 'Avatar não encontrado.', 404);
  if (!licensed(avatar, now)) throw new AppError('not_licensed', 'O piloto precisa de habilitação (autoescola).', 409);
  assertNotInHospital(avatar, now);
  assertNotInSchool(avatar, now);
  if (!status(avatar, now).canLeisure) throw new AppError('too_tired', 'Correr precisa de pelo menos 2 de energia.', 409);
  if (racesToday >= RACES_PER_DAY) throw new AppError('race_limit', `Até ${RACES_PER_DAY} corridas por dia para cada piloto.`, 409);
}

export function newRace(input: { id: string; vehicle: Vehicle; avatar: Avatar }, now: Date, seed = randomBytes(32).toString('hex')): Race {
  const revised = !!input.vehicle.revisionUntil && input.vehicle.revisionUntil > now;
  return {
    id: input.id,
    vehicleId: input.vehicle.id,
    avatarId: input.avatar.id,
    accountId: input.avatar.accountId,
    day: dayOf(now),
    seed,
    result: runRace({ id: input.id, seed, vehicle: input.vehicle, education: input.avatar.attributes.education, revised }, now),
    fuelCents: FUEL_CENTS,
    status: 'pending',
    createdAt: now,
  };
}

/** Efeito no piloto: −1 de energia, +1 de felicidade. */
export const applyRaceToAvatar = (avatar: Avatar, now: Date): Avatar => ({
  ...avatar,
  attributes: {
    ...avatar.attributes,
    energy: Math.max(0, avatar.attributes.energy + RACE_ENERGY),
    happiness: Math.min(10, avatar.attributes.happiness + RACE_HAPPINESS),
  },
  updatedAt: now,
});

// ---------------------------------------------------------------- oficina

export const repairCents = (v: Vehicle, severity: Severity, priceCents: bigint) => (priceCents * BigInt(SEVERITIES[severity].repairBps)) / 10_000n;

export interface RaceStore {
  /**
   * Grava a corrida se o piloto ainda cabe no limite do dia (atômico por avatar). Devolve false se não
   * coube (outra corrida entrou antes).
   */
  createWithinLimit(race: Race, limit: number): Promise<boolean>;
  countToday(avatarId: string, day: string): Promise<number>;
  get(id: string): Promise<Race | null>;
  listByAccount(accountId: string, limit: number): Promise<Race[]>;
  /** Muda a situação se ainda for `from`. */
  transition(id: string, from: RaceStatus, to: RaceStatus): Promise<boolean>;
  /** Corridas paradas (`pending` ou `charged`) há mais de um tempo, para o job. */
  stuck(olderThan: Date): Promise<Race[]>;
}

/** Quem cobra e paga: o ledger do economy. */
export interface RacePayer {
  /** Gasolina: do jogador para a queima. Chave `race-fuel:<id>`. */
  chargeFuel(race: Race, requestId?: string): Promise<void>;
  /** Prêmio: do pool P2E para o jogador. Chave `race-prize:<id>`. */
  payPrize(race: Race, requestId?: string): Promise<void>;
}

/**
 * Leva a corrida até o fim: gasolina, efeitos no piloto e no carro (uma vez só, na passagem
 * pending → charged) e o prêmio. Pode repetir: cada cobrança tem a sua chave. Sem THALER para a
 * gasolina, a corrida falha e nada acontece. Pool P2E vazio: fica `charged` e o job paga depois.
 */
export async function settleRace(
  deps: {
    races: RaceStore;
    payer: RacePayer;
    vehicles: { setBreakdown(id: string, severity: Severity, now: Date): Promise<boolean> };
    updateAvatar: (race: Race, apply: (a: Avatar) => Avatar) => Promise<unknown>;
  },
  race: Race,
  now: Date,
  requestId?: string,
): Promise<Race> {
  let current = race;
  if (current.status === 'pending') {
    try {
      await deps.payer.chargeFuel(current, requestId);
    } catch (error) {
      if (error instanceof AppError && error.code === 'insufficient_thaler') {
        await deps.races.transition(current.id, 'pending', 'failed');
        throw new AppError('insufficient_thaler', 'THALER insuficiente para a gasolina.', 409);
      }
      throw error;
    }
    if (await deps.races.transition(current.id, 'pending', 'charged')) {
      await deps.updateAvatar(current, (a) => applyRaceToAvatar(a, now));
      if (current.result.breakdown) await deps.vehicles.setBreakdown(current.vehicleId, current.result.breakdown, now);
    }
    current = { ...current, status: 'charged' };
  }
  if (current.status === 'charged') {
    if (BigInt(current.result.prizeCents) > 0n) await deps.payer.payPrize(current, requestId);
    await deps.races.transition(current.id, 'charged', 'done');
    current = { ...current, status: 'done' };
  }
  return current;
}

export function raceDto(r: Race) {
  return {
    id: r.id,
    vehicle_id: r.vehicleId,
    avatar_id: r.avatarId,
    day: r.day,
    status: r.status,
    position: r.result.position,
    of: RIVALS + 1,
    prize: r.result.prizeCents,
    fuel: r.fuelCents.toString(),
    breakdown: r.result.breakdown,
    score: r.result.score,
    rivals: r.result.rivals,
    factors: r.result.factors,
    // A semente fica à mostra: a corrida já aconteceu e qualquer um refaz a conta.
    seed: r.seed,
    created_at: r.createdAt.toISOString(),
  };
}
