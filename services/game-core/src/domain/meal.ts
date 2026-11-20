import { AppError } from '@scc/shared';

import { ATTRIBUTE_MAX, type Avatar } from './avatar.js';
import { type Food, food as findFood } from './foods.js';
import { CONDITIONS, type ConditionCode, activeConditions, catchCondition, cure, isConditionCode } from './conditions.js';
import { assertNotInHospital } from './hospital.js';

/**
 * Refeição no mercado do jogo (E2.3, GDD §2.3 e §4): o avatar compra uma
 * unidade do alimento e come na hora. O THALER vai para a queima: comida é um
 * sink (doc 04 §7).
 *
 * Premissas desta etapa, a calibrar no simulador (o GDD não tem o número):
 * - Cada refeição sobe 3 pontos de alimentação. O GDD pede 3 refeições por dia
 *   e a alimentação cai 5 pontos por dia (de 10 a 0 em 48 h).
 * - Sem preço no catálogo, a unidade custa 4 THALER: o simulador conta 12
 *   THALER por dia de comida, em 3 refeições.
 */
export const MEAL_FOOD_POINTS = 3;
export const DEFAULT_UNIT_PRICE_CENTS = 400n;

export type MealStatus = 'pending' | 'eaten' | 'failed';

export interface MealEffects {
  food: number;
  energy: number;
  health: number;
  /** Doença que a refeição trouxe (dor de barriga, 3%). Sorteada ao montar a refeição. */
  condition?: ConditionCode;
  /** Só remédio: a doença tratada e se curou (70%). */
  cure?: { code: ConditionCode; success: boolean };
  /** Só pacote: as unidades vão para a despensa em vez de serem comidas. */
  pantry?: { code: string; units: number };
}

/**
 * Despensa (E2.3, GDD §4 e §7): o pacote do catálogo (maçã vem em 5) é
 * comprado de uma vez, pago pelo ledger, e as unidades ficam guardadas no
 * avatar. Comer da despensa não cobra de novo. Premissas desta etapa: sem
 * preço no catálogo, o pacote custa as unidades pelo preço provisório (sem
 * desconto); a despensa não tem limite até existirem casas (E2.5); o tempo de
 * compra do mercado (4 min + volume) ainda não entra.
 */
export const packPriceCents = (f: Food) =>
  f.price === null ? DEFAULT_UNIT_PRICE_CENTS * BigInt(f.pack) : BigInt(f.price) * 100n;

export const isPack = (m: Pick<Meal, 'effects'>) => m.effects?.pantry !== undefined;

/**
 * Farmácia (E2.3, GDD §5): o remédio passa pelo mesmo caminho da refeição
 * (mesma tabela, mesma cobrança em duas fases), com o código `remedio`.
 * Cura com 70% de chance; sem cura, o THALER não volta. Premissa: 10 THALER
 * o remédio (o GDD não tem o preço). A exigência de enfermeiro como dono vale
 * quando as farmácias forem de jogadores; esta é a farmácia do jogo.
 */
export const MEDICINE_CODE = 'remedio';
export const MEDICINE_PRICE_CENTS = 1000n;
export const CURE_CHANCE = 0.7;
export const isMedicine = (m: Pick<Meal, 'foodCode'>) => m.foodCode === MEDICINE_CODE;

export interface Meal {
  id: string;
  avatarId: string;
  accountId: string;
  foodCode: string;
  priceCents: bigint;
  effects: MealEffects;
  /**
   * pending: gravada, ainda sem cobrança confirmada. eaten: paga e aplicada.
   * failed: o ledger recusou (sem THALER); nada foi cobrado nem aplicado.
   */
  status: MealStatus;
  /** Idempotency-Key do cliente: repetir o pedido devolve a mesma refeição. */
  clientKey: string | null;
  createdAt: Date;
  eatenAt: Date | null;
}

/** Preço de uma unidade: o do pacote dividido pelas unidades, ou a premissa. */
export const unitPriceCents = (f: Food) =>
  f.price === null ? DEFAULT_UNIT_PRICE_CENTS : (BigInt(f.price) * 100n + BigInt(f.pack) / 2n) / BigInt(f.pack);

/** Confere e monta a refeição. O avatar já vem travado e com a queda até agora. */
export function planMeal(
  avatar: Avatar,
  input: { id: string; foodCode: string; clientKey: string | null; roll?: number },
  now: Date,
): Meal {
  const f = findFood(input.foodCode);
  if (!f) throw new AppError('unknown_food', 'Alimento não existe no mercado.', 404);
  // No hospital o avatar não vai ao mercado.
  assertNotInHospital(avatar, now);
  if (avatar.attributes.food >= ATTRIBUTE_MAX) {
    throw new AppError('not_hungry', 'O avatar está satisfeito. Coma quando a alimentação baixar.', 409);
  }
  return {
    id: input.id,
    avatarId: avatar.id,
    accountId: avatar.accountId,
    foodCode: f.code,
    priceCents: unitPriceCents(f),
    effects: {
      food: MEAL_FOOD_POINTS,
      energy: f.energy,
      health: f.health,
      // GDD: dor de barriga em 3% das refeições.
      ...((input.roll ?? 1) < CONDITIONS.dor_de_barriga.chance ? { condition: 'dor_de_barriga' as const } : {}),
    },
    status: 'pending',
    clientKey: input.clientKey,
    createdAt: now,
    eatenAt: null,
  };
}

/** Confere e monta a compra de um pacote para a despensa. Satisfeito também compra. */
export function planPack(avatar: Avatar, input: { id: string; foodCode: string; clientKey: string | null }, now: Date): Meal {
  const f = findFood(input.foodCode);
  if (!f) throw new AppError('unknown_food', 'Alimento não existe no mercado.', 404);
  assertNotInHospital(avatar, now);
  return {
    id: input.id,
    avatarId: avatar.id,
    accountId: avatar.accountId,
    foodCode: f.code,
    priceCents: packPriceCents(f),
    effects: { food: 0, energy: 0, health: 0, pantry: { code: f.code, units: f.pack } },
    status: 'pending',
    clientKey: input.clientKey,
    createdAt: now,
    eatenAt: null,
  };
}

/**
 * Come uma unidade da despensa: as mesmas regras e efeitos da refeição do
 * mercado (inclusive a dor de barriga), sem cobrança. O avatar já vem travado
 * e com a queda até agora.
 */
export function eatFromPantry(avatar: Avatar, input: { foodCode: string; roll?: number }, now: Date): Avatar {
  if ((avatar.pantry[input.foodCode] ?? 0) < 1) {
    throw new AppError('not_in_pantry', 'Esse alimento não está na despensa.', 409);
  }
  const meal = planMeal(avatar, { id: 'despensa', foodCode: input.foodCode, clientKey: null, roll: input.roll }, now);
  const fed = eat(avatar, meal.effects, now);
  const left = (avatar.pantry[input.foodCode] ?? 0) - 1;
  const pantry = { ...fed.pantry };
  if (left > 0) pantry[input.foodCode] = left;
  else delete pantry[input.foodCode];
  return { ...fed, pantry };
}

/** Confere e monta a compra do remédio. `roll` de 0 a 1 decide a cura. */
export function planMedicine(
  avatar: Avatar,
  input: { id: string; condition: string; clientKey: string | null; roll: number },
  now: Date,
): Meal {
  if (!isConditionCode(input.condition)) throw new AppError('invalid_condition', 'Doença desconhecida.', 400);
  assertNotInHospital(avatar, now);
  if (!activeConditions(avatar.conditions, now).some((c) => c.code === input.condition)) {
    throw new AppError('not_sick', 'O avatar não está com essa doença.', 409);
  }
  return {
    id: input.id,
    avatarId: avatar.id,
    accountId: avatar.accountId,
    foodCode: MEDICINE_CODE,
    priceCents: MEDICINE_PRICE_CENTS,
    effects: { food: 0, energy: 0, health: 0, cure: { code: input.condition, success: input.roll < CURE_CHANCE } },
    status: 'pending',
    clientKey: input.clientKey,
    createdAt: now,
    eatenAt: null,
  };
}

const clamp = (n: number) => Math.max(0, Math.min(ATTRIBUTE_MAX, n));

/**
 * Aplica os efeitos ao avatar (com a queda até agora). A alimentação volta a
 * contar do instante de referência que tinha; se estava em 0, `decayed` já o
 * pôs no agora, e a contagem recomeça cheia.
 */
export function eat(avatar: Avatar, effects: MealEffects, now: Date): Avatar {
  const a = avatar.attributes;
  let conditions = avatar.conditions;
  if (effects.condition) conditions = catchCondition(conditions, effects.condition, now);
  if (effects.cure?.success) conditions = cure(conditions, effects.cure.code);
  const pantry = effects.pantry
    ? { ...avatar.pantry, [effects.pantry.code]: (avatar.pantry[effects.pantry.code] ?? 0) + effects.pantry.units }
    : avatar.pantry;
  return {
    ...avatar,
    conditions,
    pantry,
    attributes: {
      ...a,
      food: clamp(a.food + effects.food),
      energy: clamp(a.energy + effects.energy),
      health: clamp(a.health + effects.health),
    },
    updatedAt: now,
  };
}

/** Quem cobra a refeição: o ledger do economy. Separado para os testes trocarem por um falso. */
export interface MealPayer {
  /** THALER do jogador para a queima. Idempotente pela chave `meal:<id>`. */
  chargeMeal(meal: Meal, requestId?: string): Promise<void>;
}

export type MealPlanner = (avatar: Avatar) => Meal;

/** Persistência das refeições. Mora no banco do avatar: comer grava os dois juntos. */
export interface MealStore {
  /**
   * Trava o avatar e grava a refeição como `pending`. Com `clientKey` já usado
   * pela conta, devolve a refeição daquela chave em vez de criar outra.
   */
  beginMeal(avatarId: string, accountId: string, clientKey: string | null, now: Date, plan: MealPlanner): Promise<Meal>;
  /** pending → eaten, aplicando os efeitos ao avatar na mesma transação. Repetir não faz nada. */
  finishMeal(mealId: string, now: Date): Promise<Meal>;
  /** pending → failed. Repetir não faz nada. */
  failMeal(mealId: string): Promise<Meal>;
  /** Trava o avatar da conta, aplica o plano (comer da despensa) e grava. */
  updateAvatar(avatarId: string, accountId: string, now: Date, plan: (avatar: Avatar) => Avatar): Promise<Avatar>;
  listMeals(avatarId: string, limit: number): Promise<Meal[]>;
}
