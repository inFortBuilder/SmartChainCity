import { AppError } from '@scc/shared';

import { ATTRIBUTE_MAX, type Avatar } from './avatar.js';
import { assertNotInHospital } from './hospital.js';

/**
 * O dia do avatar fora do trabalho (GDD §1, §2.3, §3.2 e §3.3): descansar, cuidar da higiene e ir ao
 * trabalho. Fecha o laço trabalhar → comer → descansar → se divertir → ir e voltar.
 *
 * Descanso ("comer · dormir", GDD §1; "descanso obrigatório após 16 h", §2.3):
 * - o avatar dorme 4 ou 8 h; enquanto dorme, não trabalha nem sai para o lazer;
 * - ao acordar, ganha a energia: +4 em 4 h e +8 em 8 h, até 10;
 * - sem moradia regular (casa própria regular, aluguel ou hotel), dorme mal: ganha metade.
 *
 * Higiene (GDD §2.3 e §4.5 "Atividades extras", grupo higiene do seed): tomar banho, escovar os dentes,
 * lavar as mãos e usar a ducha, de graça, em casa. Cada uma uma vez a cada 4 h. Precisa de moradia
 * regular (a de casa). Os efeitos vêm do seed, que só tem a direção (+1).
 *
 * Deslocamento (GDD §3.3): o modo escolhido no começo do turno atrasa o começo do ganho e pode custar.
 * O ganho do turno cai na proporção do atraso; a tarifa sai do pagamento do turno.
 *
 * PREMISSAS, a calibrar no simulador:
 * - descanso: +4/+8 de energia; metade sem moradia;
 * - higiene: +3 de higiene no banho e na ducha, +1 nos dentes e nas mãos, +1 de saúde no banho;
 * - deslocamento: a pé 15 min; skate ou bicicleta 10 min; ônibus 6 min e 3 THALER; carro 4 min e 2 THALER
 *   de combustível (precisa de habilitação e de um carro em dia); home office sem atraso, 2 THALER de
 *   internet e −1 de felicidade e de saúde (o GDD diz que perde as duas mais rápido), em qualquer profissão
 *   até o catálogo marcar quais podem;
 * - sem escolher, o avatar vai a pé.
 */
export const REST_HOURS = [4, 8] as const;
export type RestHours = (typeof REST_HOURS)[number];
export const REST_ENERGY: Record<RestHours, number> = { 4: 4, 8: 8 };
export const UNHOUSED_REST_SHARE = 0.5;
const HOUR = 3_600_000;

export interface Rest {
  startsAt: Date;
  endsAt: Date;
  /** Energia que entra ao acordar (já com o corte sem moradia). */
  energy: number;
}

export const resting = (a: Pick<Avatar, 'rest'>, now: Date) => !!a.rest && a.rest.endsAt > now;

export function assertNotResting(avatar: Pick<Avatar, 'rest'>, now: Date) {
  if (resting(avatar, now)) throw new AppError('resting', `O avatar está dormindo até ${avatar.rest!.endsAt.toISOString()}.`, 409);
}

/** Acorda quem já dormiu o bastante: a energia entra uma vez e o descanso sai do avatar. */
export function rested(avatar: Avatar, now: Date): Avatar {
  const r = avatar.rest;
  if (!r || r.endsAt > now) return avatar;
  return {
    ...avatar,
    attributes: { ...avatar.attributes, energy: Math.min(ATTRIBUTE_MAX, avatar.attributes.energy + r.energy) },
    rest: null,
  };
}

/** Começa o descanso. O avatar vem travado e com a queda até agora; `running`: há turno rodando. */
export function startRest(avatar: Avatar, input: { hours: number; housed: boolean; running: boolean }, now: Date): Avatar {
  if (!REST_HOURS.includes(input.hours as RestHours)) throw new AppError('invalid_rest', 'O descanso é de 4 ou de 8 horas.', 400);
  assertNotInHospital(avatar, now);
  assertNotResting(avatar, now);
  if (input.running) throw new AppError('shift_running', 'O avatar está trabalhando: descanse depois do turno.', 409);
  if (avatar.attributes.energy >= ATTRIBUTE_MAX) throw new AppError('not_tired', 'O avatar está com a energia cheia.', 409);
  const full = REST_ENERGY[input.hours as RestHours];
  const energy = input.housed ? full : Math.floor(full * UNHOUSED_REST_SHARE);
  return {
    ...avatar,
    rest: { startsAt: now, endsAt: new Date(now.getTime() + input.hours * HOUR), energy },
    updatedAt: now,
  };
}

export const restToJson = (r: Rest | null | undefined) =>
  r ? { startsAt: r.startsAt.toISOString(), endsAt: r.endsAt.toISOString(), energy: r.energy } : null;
export const restFromJson = (v: unknown): Rest | null => {
  if (!v) return null;
  const j = v as { startsAt: string; endsAt: string; energy: number };
  return { startsAt: new Date(j.startsAt), endsAt: new Date(j.endsAt), energy: j.energy };
};

// ---------------------------------------------------------------- higiene em casa

export const CHORE_COOLDOWN_MS = 4 * HOUR;
export const CHORES = {
  banho: { label: 'Tomar banho', hygiene: 3, health: 1, happiness: 0 },
  ducha: { label: 'Usar a ducha', hygiene: 3, health: 0, happiness: 1 },
  dentes: { label: 'Escovar os dentes', hygiene: 1, health: 1, happiness: 0 },
  maos: { label: 'Lavar as mãos', hygiene: 1, health: 0, happiness: 0 },
} as const;
export type ChoreCode = keyof typeof CHORES;
export const CHORE_CODES = Object.keys(CHORES) as ChoreCode[];
export const isChore = (s: string): s is ChoreCode => s in CHORES;

/** Última vez de cada atividade de casa, {código: instante}. */
export type Chores = Partial<Record<ChoreCode, Date>>;

const clamp = (n: number) => Math.max(0, Math.min(ATTRIBUTE_MAX, n));

export function doChore(avatar: Avatar, code: string, housed: boolean, now: Date): Avatar {
  if (!isChore(code)) throw new AppError('unknown_chore', 'Atividade de casa desconhecida.', 404);
  assertNotInHospital(avatar, now);
  assertNotResting(avatar, now);
  if (!housed) throw new AppError('no_home', 'Sem moradia regular: alugue, vá para o hotel ou regularize a sua casa.', 409);
  const last = avatar.chores?.[code];
  if (last && now.getTime() - last.getTime() < CHORE_COOLDOWN_MS) {
    throw new AppError('chore_cooldown', `De novo a partir de ${new Date(last.getTime() + CHORE_COOLDOWN_MS).toISOString()}.`, 409);
  }
  const c = CHORES[code];
  const a = avatar.attributes;
  return {
    ...avatar,
    attributes: { ...a, hygiene: clamp(a.hygiene + c.hygiene), health: clamp(a.health + c.health), happiness: clamp(a.happiness + c.happiness) },
    chores: { ...avatar.chores, [code]: now },
    updatedAt: now,
  };
}

export const choresToJson = (c: Chores | null | undefined) =>
  c && Object.keys(c).length ? Object.fromEntries(Object.entries(c).map(([k, v]) => [k, (v as Date).toISOString()])) : null;
export const choresFromJson = (v: unknown): Chores | null =>
  v ? (Object.fromEntries(Object.entries(v as Record<string, string>).map(([k, s]) => [k, new Date(s)])) as Chores) : null;

/** Quando cada atividade de casa libera (null: já pode). */
export const choresDto = (a: Pick<Avatar, 'chores'>, now: Date) =>
  Object.fromEntries(
    CHORE_CODES.map((code) => {
      const last = a.chores?.[code];
      const next = last ? last.getTime() + CHORE_COOLDOWN_MS : 0;
      return [code, next > now.getTime() ? new Date(next).toISOString() : null];
    }),
  );

// ---------------------------------------------------------------- deslocamento

export const COMMUTES = {
  a_pe: { label: 'A pé', delayMin: 15, costCents: 0n, needsCar: false, homeOffice: false },
  skate: { label: 'Skate ou bicicleta', delayMin: 10, costCents: 0n, needsCar: false, homeOffice: false },
  onibus: { label: 'Ônibus', delayMin: 6, costCents: 3_00n, needsCar: false, homeOffice: false },
  carro: { label: 'Carro', delayMin: 4, costCents: 2_00n, needsCar: true, homeOffice: false },
  home_office: { label: 'Home office', delayMin: 0, costCents: 2_00n, needsCar: false, homeOffice: true },
} as const;
export type CommuteMode = keyof typeof COMMUTES;
export const COMMUTE_MODES = Object.keys(COMMUTES) as CommuteMode[];
export const DEFAULT_COMMUTE: CommuteMode = 'a_pe';
/** Home office: perde felicidade e saúde mais rápido (GDD §3.2). */
export const HOME_OFFICE_COST = { happiness: 1, health: 1 };

export interface Commute {
  mode: CommuteMode;
  /** Fração do turno que rende (1 − atraso/duração). */
  factor: number;
  /** Tarifa, combustível ou internet: sai do pagamento do turno. */
  costCents: bigint;
}

/** Confere o modo e calcula o fator; `carReady`: a conta tem carro em dia e o avatar é habilitado. */
export function planCommute(mode: string | undefined, hours: number, carReady: boolean): Commute {
  const m = (mode ?? DEFAULT_COMMUTE) as CommuteMode;
  if (!(m in COMMUTES)) throw new AppError('invalid_commute', 'Modo de ir ao trabalho desconhecido.', 400);
  const c = COMMUTES[m];
  if (c.needsCar && !carReady) throw new AppError('no_car', 'Para ir de carro, o avatar precisa de habilitação e de um carro em dia.', 409);
  return { mode: m, factor: 1 - c.delayMin / (hours * 60), costCents: c.costCents };
}

/** Efeito do home office no avatar, no começo do turno. */
export function applyHomeOffice(avatar: Avatar, commute: Commute): Avatar {
  if (!COMMUTES[commute.mode].homeOffice) return avatar;
  const a = avatar.attributes;
  return {
    ...avatar,
    attributes: { ...a, happiness: clamp(a.happiness - HOME_OFFICE_COST.happiness), health: clamp(a.health - HOME_OFFICE_COST.health) },
  };
}

export const commuteCatalog = () =>
  COMMUTE_MODES.map((m) => ({
    mode: m,
    label: COMMUTES[m].label,
    delay_min: COMMUTES[m].delayMin,
    cost: COMMUTES[m].costCents.toString(),
    needs_car: COMMUTES[m].needsCar,
    home_office: COMMUTES[m].homeOffice,
  }));
