import { AppError } from '@scc/shared';

import { ATTRIBUTE_MAX, type Avatar } from './avatar.js';
import { assertNotInHospital } from './hospital.js';

/**
 * Moradia do avatar (GDD §4, doc 03 §3, doc 04 §4 "fator_regularizacao_moradia"): quem não mora numa casa
 * própria regular paga aluguel ou hotel. Sem moradia regular, o turno rende 50%, o mesmo fator do
 * simulador (`work.unregularizedFactor`).
 *
 * - **Casa própria:** uma casa pronta da conta, regularizada e com água e energia em dia. O world diz
 *   quais (`/internal/v1/accounts/:id/homes`).
 * - **Aluguel:** quarto num residencial da Prefeitura, por dia. Enquanto os prédios de jogadores não
 *   alugam unidades (E3.11), o aluguel segue o simulador: 40% vira queima (a parte do NPC) e 60% voltam
 *   ao pool P2E, de onde sai a renda dos imóveis.
 * - **Hotel do jogo:** 3 níveis, por dia, com refeições incluídas (GDD §6 "Hotel"). Tudo vira queima.
 * - **Hotel de jogador:** o hotel construído num lote (world). Mesma diária e refeições do nível do
 *   hotel; 90% da diária vão para o dono e 10% viram queima (taxa da Prefeitura, como no aluguel de
 *   unidade). É o "bônus por ocupação" do GDD: quanto mais hóspedes, mais o dono recebe. Quartos por
 *   nível (o world diz quantos); cheio, `409 hotel_full`. Não se hospeda no próprio hotel.
 *
 * Uma estadia por vez: a do mesmo tipo e nível estende; outra exige sair antes (sem reembolso).
 *
 * PREMISSAS, a calibrar no simulador:
 * - aluguel de 15 THALER/dia (simulador: sinks.rentRenter) e a divisão 40/60 (sinks.rentNpcShare);
 * - hotel de 25, 40 e 60 THALER/dia, com 1, 2 e 3 refeições grátis por dia;
 * - de 1 a 30 dias por vez, até 30 dias pagos adiantado;
 * - com o world fora do ar, o turno não perde o fator (vale 1) e o aviso fica no log;
 * - hotel de jogador: 90% ao dono e 10% de taxa; a lotação é conferida na hora da entrada (dois pedidos
 *   no mesmo instante podem passar de um quarto).
 */
export type StayKind = 'aluguel' | 'hotel';
export const STAY_KINDS: StayKind[] = ['aluguel', 'hotel'];

export interface Housing {
  kind: StayKind;
  /** Nível do hotel (1 a 3); 1 no aluguel. */
  level: number;
  since: Date;
  until: Date;
  /** Refeições do hotel já usadas no dia (UTC) `mealsDay`. */
  mealsDay?: string;
  mealsUsed?: number;
  /** Hotel de jogador (id do imóvel no world); sem ele, o hotel do jogo. */
  hotelId?: string;
}

export const DAY_MS = 24 * 3_600_000;
export const UNHOUSED_FACTOR = 0.5;
export const RENT_CENTS_PER_DAY = 15_00n;
/** Fração do aluguel que vira queima; o resto volta ao pool P2E. */
export const RENT_BURN_BPS = 4000n;
export const HOTEL_LEVELS: Record<number, { centsPerDay: bigint; meals: number }> = {
  1: { centsPerDay: 25_00n, meals: 1 },
  2: { centsPerDay: 40_00n, meals: 2 },
  3: { centsPerDay: 60_00n, meals: 3 },
};
export const MAX_STAY_DAYS = 30;
/** Pontos de alimentação de cada refeição do hotel (os mesmos do mercado, meal.ts). */
export const HOTEL_MEAL_FOOD = 3;

export const dailyCents = (kind: StayKind, level: number) =>
  kind === 'aluguel' ? RENT_CENTS_PER_DAY : (HOTEL_LEVELS[level]?.centsPerDay ?? 0n);

export const staying = (a: Pick<Avatar, 'housing'>, now: Date) => !!a.housing && a.housing.since <= now && a.housing.until > now;

/** Casas da conta pelo world. `null` quando o world não responde ou não está ligado. */
export interface HomeDirectory {
  homes(
    accountId: string,
    requestId?: string,
  ): Promise<{ id: string; label: string; regular: boolean; regularUntil: Date | null; /** Unidade alugada: só deste avatar. */ avatarId?: string | null; lease?: boolean }[]>;
}

/** Fator de moradia do turno: 1 com casa própria regular ou estadia em curso; 0,5 sem. */
export const housingFactor = (avatar: Pick<Avatar, 'housing'>, ownRegular: boolean, now: Date) =>
  ownRegular || staying(avatar, now) ? 1 : UNHOUSED_FACTOR;

export interface HousingEffect {
  kind: StayKind;
  level: number;
  days: number;
  /** Hotel de jogador: a diária vai para o dono. */
  hotel?: { id: string; ownerAccountId: string };
}

/** Hotel de jogador, como o world informa. */
export interface PlayerHotel {
  id: string;
  city: string;
  label: string;
  level: number;
  rooms: number;
  lotCode: string;
  open: boolean;
  ownerAccountId: string;
}

/** Hotéis de jogador pelo world. */
export interface HotelDirectory {
  hotel(id: string, requestId?: string): Promise<PlayerHotel | null>;
  hotels(city: string, requestId?: string): Promise<PlayerHotel[]>;
}

/** Parte do dono no hotel de jogador; o resto é a taxa da Prefeitura (queima). */
export const HOTEL_OWNER_BPS = 9000n;
export const hotelSplit = (cents: bigint) => {
  const owner = (cents * HOTEL_OWNER_BPS) / 10_000n;
  return { owner, burn: cents - owner };
};

/** Confere o hotel de jogador antes da estadia: aberto, não é do próprio e com quarto livre. */
export function checkPlayerHotel(hotel: PlayerHotel | null, accountId: string, guests: number, staysHere: boolean): PlayerHotel {
  if (!hotel) throw new AppError('hotel_not_found', 'Hotel não encontrado.', 404);
  if (!hotel.open) throw new AppError('hotel_closed', 'O hotel está fechado (em obra ou precisando de reparo).', 409);
  if (hotel.ownerAccountId === accountId) throw new AppError('own_hotel', 'Não dá para se hospedar no próprio hotel.', 409);
  // Quem já está hospedado aqui estende sem ocupar outro quarto.
  if (!staysHere && guests >= hotel.rooms) throw new AppError('hotel_full', `O hotel está cheio: ${hotel.rooms} quarto(s).`, 409);
  return hotel;
}

/** Confere a estadia e devolve o preço. O avatar já vem travado e com a queda até agora. */
export function checkStay(avatar: Avatar, input: HousingEffect, now: Date): { cents: bigint } {
  assertNotInHospital(avatar, now);
  if (!STAY_KINDS.includes(input.kind)) throw new AppError('invalid_stay', 'Escolha aluguel ou hotel.', 400);
  if (input.kind === 'hotel' && !HOTEL_LEVELS[input.level]) throw new AppError('invalid_stay', 'O hotel tem os níveis 1, 2 e 3.', 400);
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > MAX_STAY_DAYS) {
    throw new AppError('invalid_stay', `De 1 a ${MAX_STAY_DAYS} dias por vez.`, 400);
  }
  const level = input.kind === 'hotel' ? input.level : 1;
  const h = avatar.housing;
  if (h && h.until > now) {
    if (h.kind !== input.kind || h.level !== level || (h.hotelId ?? null) !== (input.hotel?.id ?? null)) {
      throw new AppError('housing_active', 'O avatar já tem outra moradia em curso: saia dela antes.', 409);
    }
    const ahead = h.until.getTime() + input.days * DAY_MS - now.getTime();
    if (ahead > MAX_STAY_DAYS * DAY_MS) {
      throw new AppError('housing_prepaid', `No máximo ${MAX_STAY_DAYS} dias pagos adiantado.`, 409);
    }
  }
  return { cents: dailyCents(input.kind, level) * BigInt(input.days) };
}

/** Depois da cobrança: a mesma estadia estende; senão, começa agora. */
export function applyStay(avatar: Avatar, effect: HousingEffect, now: Date): Avatar {
  const level = effect.kind === 'hotel' ? effect.level : 1;
  const h = avatar.housing;
  const extend = h && h.until > now && h.kind === effect.kind && h.level === level && (h.hotelId ?? null) === (effect.hotel?.id ?? null);
  const since = extend ? h.since : now;
  const base = extend ? h.until : now;
  const housing: Housing = {
    ...(extend ? h : {}),
    kind: effect.kind,
    level,
    since,
    until: new Date(base.getTime() + effect.days * DAY_MS),
  };
  if (effect.hotel) housing.hotelId = effect.hotel.id;
  else delete housing.hotelId;
  return { ...avatar, housing, updatedAt: now };
}

/** Sai da estadia agora, sem reembolso (para trocar de moradia). */
export function leaveStay(avatar: Avatar, now: Date): Avatar {
  if (!staying(avatar, now)) throw new AppError('not_staying', 'O avatar não está num aluguel nem num hotel.', 409);
  return { ...avatar, housing: { ...avatar.housing!, until: now }, updatedAt: now };
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** Refeição incluída no hotel: até o número do nível por dia (UTC), sem cobrança. */
export function hotelMeal(avatar: Avatar, now: Date): Avatar {
  assertNotInHospital(avatar, now);
  const h = avatar.housing;
  if (!h || h.kind !== 'hotel' || !staying(avatar, now)) {
    throw new AppError('not_in_hotel', 'Só quem está hospedado no hotel come de graça.', 409);
  }
  const day = utcDay(now);
  const used = h.mealsDay === day ? (h.mealsUsed ?? 0) : 0;
  const allowed = HOTEL_LEVELS[h.level]!.meals;
  if (used >= allowed) throw new AppError('hotel_meals_used', `O hotel nível ${h.level} inclui ${allowed} refeição(ões) por dia.`, 409);
  if (avatar.attributes.food >= ATTRIBUTE_MAX) {
    throw new AppError('not_hungry', 'O avatar está satisfeito. Coma quando a alimentação baixar.', 409);
  }
  return {
    ...avatar,
    attributes: { ...avatar.attributes, food: Math.min(ATTRIBUTE_MAX, avatar.attributes.food + HOTEL_MEAL_FOOD) },
    housing: { ...h, mealsDay: day, mealsUsed: used + 1 },
    updatedAt: now,
  };
}

export const rentSplit = (cents: bigint) => {
  const burn = (cents * RENT_BURN_BPS) / 10_000n;
  return { burn, pool: cents - burn };
};

export const housingToJson = (h: Housing | null | undefined) =>
  h
    ? {
        kind: h.kind,
        level: h.level,
        since: h.since.toISOString(),
        until: h.until.toISOString(),
        ...(h.mealsDay ? { mealsDay: h.mealsDay, mealsUsed: h.mealsUsed ?? 0 } : {}),
        ...(h.hotelId ? { hotelId: h.hotelId } : {}),
      }
    : null;

export const housingFromJson = (v: unknown): Housing | null => {
  if (!v) return null;
  const j = v as { kind: StayKind; level: number; since: string; until: string; mealsDay?: string; mealsUsed?: number; hotelId?: string };
  return {
    kind: j.kind,
    level: j.level,
    since: new Date(j.since),
    until: new Date(j.until),
    ...(j.mealsDay ? { mealsDay: j.mealsDay, mealsUsed: j.mealsUsed ?? 0 } : {}),
    ...(j.hotelId ? { hotelId: j.hotelId } : {}),
  };
};

export function housingDto(a: Pick<Avatar, 'housing'>, now: Date) {
  const h = a.housing;
  if (!h || h.until <= now) return null;
  const day = utcDay(now);
  const used = h.mealsDay === day ? (h.mealsUsed ?? 0) : 0;
  return {
    kind: h.kind,
    level: h.level,
    since: h.since.toISOString(),
    until: h.until.toISOString(),
    meals_left_today: h.kind === 'hotel' ? Math.max(0, HOTEL_LEVELS[h.level]!.meals - used) : 0,
    hotel_id: h.hotelId ?? null,
  };
}

export const housingPrices = () => ({
  aluguel: { cents_per_day: RENT_CENTS_PER_DAY.toString(), burn_share: Number(RENT_BURN_BPS) / 10_000 },
  hotel: Object.entries(HOTEL_LEVELS).map(([level, v]) => ({ level: Number(level), cents_per_day: v.centsPerDay.toString(), meals_per_day: v.meals })),
  max_days: MAX_STAY_DAYS,
  player_hotel_owner_share: Number(HOTEL_OWNER_BPS) / 10_000,
  unhoused_factor: UNHOUSED_FACTOR,
});
