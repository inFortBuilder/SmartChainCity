import { AppError } from '@scc/shared';

import { ATTRIBUTE_MAX, type Avatar } from './avatar.js';
import { type Food, food as findFood } from './foods.js';

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
}

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
  input: { id: string; foodCode: string; clientKey: string | null },
  now: Date,
): Meal {
  const f = findFood(input.foodCode);
  if (!f) throw new AppError('unknown_food', 'Alimento não existe no mercado.', 404);
  if (avatar.attributes.food >= ATTRIBUTE_MAX) {
    throw new AppError('not_hungry', 'O avatar está satisfeito. Coma quando a alimentação baixar.', 409);
  }
  return {
    id: input.id,
    avatarId: avatar.id,
    accountId: avatar.accountId,
    foodCode: f.code,
    priceCents: unitPriceCents(f),
    effects: { food: MEAL_FOOD_POINTS, energy: f.energy, health: f.health },
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
  return {
    ...avatar,
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
  listMeals(avatarId: string, limit: number): Promise<Meal[]>;
}
