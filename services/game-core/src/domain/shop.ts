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
 *
 * PREMISSAS, a calibrar no simulador:
 * - preços: roupas 300, 800 e 1.500 THALER (cada nível pelo preço cheio); ferramenta 50 THALER;
 *   cama 250 THALER;
 * - a ferramenta serve a qualquer profissão (um item genérico por profissão até o catálogo ter os itens);
 * - no máximo 6 dias de ferramenta adiantados;
 * - tudo vira queima (`burn/shop`): a loja é do jogo na fase 1.
 * Ficam para depois: móveis (casa completa +1 de felicidade), eletrodomésticos (cozinhar), calçados e as
 * edições sazonais de roupa.
 */
export const CLOTHES = [
  { level: 1, bonus: 0.1, cents: 300_00n },
  { level: 2, bonus: 0.15, cents: 800_00n },
  { level: 3, bonus: 0.2, cents: 1500_00n },
] as const;
export const TOOL = { bonus: 0.3, days: 3, maxDays: 6, cents: 50_00n } as const;
export const BED_CENTS = 250_00n;
const DAY_MS = 24 * 3_600_000;

export interface Gear {
  /** Nível da melhor roupa (1 a 3); 0 sem roupa. */
  clothes: number;
  /** Ferramenta de trabalho: a profissão e até quando vale. */
  tool: { job: string; until: Date } | null;
  bed: boolean;
}

export type ShopItem = 'roupa' | 'ferramenta' | 'cama';
export const SHOP_ITEMS: ShopItem[] = ['roupa', 'ferramenta', 'cama'];

export interface ShopEffect {
  item: ShopItem;
  /** Nível da roupa. */
  level?: number;
  /** Profissão da ferramenta. */
  job?: string;
}

export const gearOf = (a: Pick<Avatar, 'gear'>): Gear => a.gear ?? { clothes: 0, tool: null, bed: false };

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
  throw new AppError('invalid_item', 'Item desconhecido na loja.', 400);
}

/** Depois da cobrança. */
export function applyShop(avatar: Avatar, e: ShopEffect, now: Date): Avatar {
  const g = gearOf(avatar);
  let gear: Gear = g;
  if (e.item === 'roupa') gear = { ...g, clothes: Math.max(g.clothes, e.level ?? 0) };
  if (e.item === 'cama') gear = { ...g, bed: true };
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
  g ? { clothes: g.clothes, tool: g.tool ? { job: g.tool.job, until: g.tool.until.toISOString() } : null, bed: g.bed } : null;
export const gearFromJson = (v: unknown): Gear | null => {
  if (!v) return null;
  const j = v as { clothes?: number; tool?: { job: string; until: string } | null; bed?: boolean };
  return { clothes: j.clothes ?? 0, tool: j.tool ? { job: j.tool.job, until: new Date(j.tool.until) } : null, bed: !!j.bed };
};

export function gearDto(a: Pick<Avatar, 'gear' | 'jobCode'>, now: Date) {
  const g = gearOf(a);
  const toolOn = !!g.tool && g.tool.job === a.jobCode && g.tool.until > now;
  return {
    clothes: g.clothes,
    tool: g.tool && g.tool.until > now ? { job: g.tool.job, until: g.tool.until.toISOString(), active: toolOn } : null,
    bed: g.bed,
    factor: gearFactor(a, now),
  };
}

export const shopCatalog = () => ({
  clothes: CLOTHES.map((c) => ({ level: c.level, bonus: c.bonus, price: c.cents.toString() })),
  tool: { bonus: TOOL.bonus, days: TOOL.days, max_days: TOOL.maxDays, price: TOOL.cents.toString() },
  bed: { price: BED_CENTS.toString() },
});
