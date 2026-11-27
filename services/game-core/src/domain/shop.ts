import { AppError } from '@scc/shared';

import type { Avatar } from './avatar.js';
import { assertNotInHospital } from './hospital.js';

/**
 * Loja do jogo, fase 1 (GDD §6 "Lojas" e §3.2; doc 04 §4 "M_itens"). Os itens ficam no avatar e entram no
 * ganho do turno junto dos itens sazonais do GamePass.
 *
 * - **Roupas** níveis 1, 2 e 3: +10%, +15% e +20% no ganho, sem depreciação. Vale a melhor que o avatar tem.
 * - **Ferramenta de trabalho** da profissão: +30% por 3 dias (o GDD dá o estetoscópio do médico). Vale só
 *   para a profissão de quando foi comprada; comprar de novo estende.
 * - **Cama**: libera o segundo turno de 6 h no dia (GDD §3.2: "2 turnos de 6 h, requer item cama").
 * - **Móveis** (GDD §6 "Lojas": "casa completa = +1 felicidade"): sofá, mesa e guarda-roupa. Com a cama,
 *   são a casa completa: ao acordar de um descanso numa moradia regular, +1 de felicidade (routine.ts).
 * - **Eletrodomésticos** ("fogão, geladeira, micro-ondas permitem cozinhar"): com fogão ou micro-ondas, o
 *   avatar cozinha em casa um alimento da despensa (meal.ts, `cookFromPantry`): rende mais que comer cru
 *   e não dá dor de barriga. A geladeira guarda melhor: +1 de saúde na comida feita em casa.
 *
 * PREMISSAS, a calibrar no simulador:
 * - preços: roupas 300, 800 e 1.500 THALER (cada nível pelo preço cheio); ferramenta 50 THALER;
 *   cama 250 THALER;
 * - a ferramenta serve a qualquer profissão (um item genérico por profissão até o catálogo ter os itens);
 * - no máximo 6 dias de ferramenta adiantados;
 * - móveis: sofá 200, mesa 150 e guarda-roupa 180 THALER; eletrodomésticos: fogão 300, geladeira 400 e
 *   micro-ondas 150 THALER; a felicidade da casa completa só ao acordar, uma vez por descanso;
 * - cozinhar: +5 de alimentação no fogão, +4 no micro-ondas (comer cru da despensa dá +3); +1 de saúde
 *   com a geladeira;
 * - tudo vira queima (`burn/shop`): a loja é do jogo na fase 1.
 * Ficam para depois: calçados e as edições sazonais de roupa.
 */
export const CLOTHES = [
  { level: 1, bonus: 0.1, cents: 300_00n },
  { level: 2, bonus: 0.15, cents: 800_00n },
  { level: 3, bonus: 0.2, cents: 1500_00n },
] as const;
export const TOOL = { bonus: 0.3, days: 3, maxDays: 6, cents: 50_00n } as const;
export const BED_CENTS = 250_00n;

/** Móveis e eletrodomésticos: comprados uma vez, ficam no avatar. */
export const HOME_ITEMS = {
  sofa: { label: 'Sofá', kind: 'movel', cents: 200_00n },
  mesa: { label: 'Mesa e cadeiras', kind: 'movel', cents: 150_00n },
  guarda_roupa: { label: 'Guarda-roupa', kind: 'movel', cents: 180_00n },
  fogao: { label: 'Fogão', kind: 'eletro', cents: 300_00n },
  geladeira: { label: 'Geladeira', kind: 'eletro', cents: 400_00n },
  micro_ondas: { label: 'Micro-ondas', kind: 'eletro', cents: 150_00n },
} as const;
export type HomeItem = keyof typeof HOME_ITEMS;
export const HOME_ITEM_CODES = Object.keys(HOME_ITEMS) as HomeItem[];
export const isHomeItem = (s: string): s is HomeItem => s in HOME_ITEMS;
/** Os móveis da casa completa, além da cama. */
export const COMPLETE_HOME: HomeItem[] = ['sofa', 'mesa', 'guarda_roupa'];
export const COMPLETE_HOME_HAPPINESS = 1;
/** Alimentação de uma refeição feita em casa (comer cru da despensa dá MEAL_FOOD_POINTS = 3). */
export const COOK_FOOD = { fogao: 5, micro_ondas: 4 } as const;
export const FRIDGE_HEALTH = 1;
const DAY_MS = 24 * 3_600_000;

export interface Gear {
  /** Nível da melhor roupa (1 a 3); 0 sem roupa. */
  clothes: number;
  /** Ferramenta de trabalho: a profissão e até quando vale. */
  tool: { job: string; until: Date } | null;
  bed: boolean;
  /** Móveis e eletrodomésticos comprados. */
  home?: HomeItem[];
}

export type ShopItem = 'roupa' | 'ferramenta' | 'cama' | HomeItem;
export const SHOP_ITEMS: ShopItem[] = ['roupa', 'ferramenta', 'cama', ...HOME_ITEM_CODES];

export interface ShopEffect {
  item: ShopItem;
  /** Nível da roupa. */
  level?: number;
  /** Profissão da ferramenta. */
  job?: string;
}

export const gearOf = (a: Pick<Avatar, 'gear'>): Gear => a.gear ?? { clothes: 0, tool: null, bed: false };
export const hasItem = (a: Pick<Avatar, 'gear'>, item: HomeItem) => (gearOf(a).home ?? []).includes(item);
/** Cama, sofá, mesa e guarda-roupa. */
export const completeHome = (a: Pick<Avatar, 'gear'>) => gearOf(a).bed && COMPLETE_HOME.every((i) => hasItem(a, i));
/** O melhor jeito de cozinhar que o avatar tem (null: não cozinha). */
export const cooker = (a: Pick<Avatar, 'gear'>): keyof typeof COOK_FOOD | null =>
  hasItem(a, 'fogao') ? 'fogao' : hasItem(a, 'micro_ondas') ? 'micro_ondas' : null;

/** Confere a compra e devolve o preço. O avatar vem travado e com a queda até agora. */
export function checkShop(avatar: Avatar, input: { item: string; level?: number }, now: Date): { cents: bigint; effect: ShopEffect } {
  assertNotInHospital(avatar, now);
  const g = gearOf(avatar);
  if (input.item === 'roupa') {
    const c = CLOTHES.find((x) => x.level === input.level);
    if (!c) throw new AppError('invalid_item', 'As roupas têm os níveis 1, 2 e 3.', 400);
    if (g.clothes >= c.level) throw new AppError('already_owned', 'O avatar já tem roupa deste nível ou melhor.', 409);
    return { cents: c.cents, effect: { item: 'roupa', level: c.level } };
  }
  if (input.item === 'ferramenta') {
    const t = g.tool;
    if (t && t.job === avatar.jobCode && t.until.getTime() + TOOL.days * DAY_MS - now.getTime() > TOOL.maxDays * DAY_MS) {
      throw new AppError('already_owned', `No máximo ${TOOL.maxDays} dias de ferramenta adiantados.`, 409);
    }
    return { cents: TOOL.cents, effect: { item: 'ferramenta', job: avatar.jobCode } };
  }
  if (input.item === 'cama') {
    if (g.bed) throw new AppError('already_owned', 'O avatar já tem cama.', 409);
    return { cents: BED_CENTS, effect: { item: 'cama' } };
  }
  if (isHomeItem(input.item)) {
    if (hasItem(avatar, input.item)) throw new AppError('already_owned', `O avatar já tem ${HOME_ITEMS[input.item].label.toLowerCase()}.`, 409);
    return { cents: HOME_ITEMS[input.item].cents, effect: { item: input.item } };
  }
  throw new AppError('invalid_item', 'Item desconhecido na loja.', 400);
}

/** Depois da cobrança. */
export function applyShop(avatar: Avatar, e: ShopEffect, now: Date): Avatar {
  const g = gearOf(avatar);
  let gear: Gear = g;
  if (e.item === 'roupa') gear = { ...g, clothes: Math.max(g.clothes, e.level ?? 0) };
  if (e.item === 'cama') gear = { ...g, bed: true };
  if (isHomeItem(e.item)) gear = { ...g, home: [...new Set([...(g.home ?? []), e.item])] };
  if (e.item === 'ferramenta') {
    const job = e.job ?? avatar.jobCode;
    const base = g.tool && g.tool.job === job && g.tool.until > now ? g.tool.until : now;
    gear = { ...g, tool: { job, until: new Date(base.getTime() + TOOL.days * DAY_MS) } };
  }
  return { ...avatar, gear, updatedAt: now };
}

/** Bônus dos itens da loja no turno: roupa × ferramenta da profissão em dia. */
export function gearFactor(avatar: Pick<Avatar, 'gear' | 'jobCode'>, now: Date): number {
  const g = gearOf(avatar);
  const clothes = CLOTHES.find((c) => c.level === g.clothes)?.bonus ?? 0;
  const tool = g.tool && g.tool.job === avatar.jobCode && g.tool.until > now ? TOOL.bonus : 0;
  return Math.round((1 + clothes) * (1 + tool) * 1000) / 1000;
}

export const gearToJson = (g: Gear | null | undefined) =>
  g
    ? {
        clothes: g.clothes,
        tool: g.tool ? { job: g.tool.job, until: g.tool.until.toISOString() } : null,
        bed: g.bed,
        ...(g.home?.length ? { home: g.home } : {}),
      }
    : null;
export const gearFromJson = (v: unknown): Gear | null => {
  if (!v) return null;
  const j = v as { clothes?: number; tool?: { job: string; until: string } | null; bed?: boolean; home?: string[] };
  const home = (j.home ?? []).filter(isHomeItem);
  return {
    clothes: j.clothes ?? 0,
    tool: j.tool ? { job: j.tool.job, until: new Date(j.tool.until) } : null,
    bed: !!j.bed,
    ...(home.length ? { home } : {}),
  };
};

export function gearDto(a: Pick<Avatar, 'gear' | 'jobCode'>, now: Date) {
  const g = gearOf(a);
  const toolOn = !!g.tool && g.tool.job === a.jobCode && g.tool.until > now;
  return {
    clothes: g.clothes,
    tool: g.tool && g.tool.until > now ? { job: g.tool.job, until: g.tool.until.toISOString(), active: toolOn } : null,
    bed: g.bed,
    home: g.home ?? [],
    complete_home: completeHome(a),
    cooks_with: cooker(a),
    factor: gearFactor(a, now),
  };
}

export const shopCatalog = () => ({
  clothes: CLOTHES.map((c) => ({ level: c.level, bonus: c.bonus, price: c.cents.toString() })),
  tool: { bonus: TOOL.bonus, days: TOOL.days, max_days: TOOL.maxDays, price: TOOL.cents.toString() },
  bed: { price: BED_CENTS.toString() },
  home: HOME_ITEM_CODES.map((code) => ({ code, label: HOME_ITEMS[code].label, kind: HOME_ITEMS[code].kind, price: HOME_ITEMS[code].cents.toString() })),
  complete_home: { items: ['cama', ...COMPLETE_HOME], happiness_on_wake: COMPLETE_HOME_HAPPINESS },
  cooking: { food: COOK_FOOD, fridge_health: FRIDGE_HEALTH },
});
