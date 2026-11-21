import { AppError } from '@scc/shared';

import { ATTRIBUTE_MAX, type Avatar, status } from './avatar.js';
import { assertNotInHospital } from './hospital.js';

/**
 * Lazer (E3.3, GDD §2.3 e §6 "Lazer").
 *
 * Do GDD:
 * - Parque com skate e basquete (+2 de felicidade).
 * - Ginásios, galerias de arte e academias são negócios de jogador com custo de entrada baixo.
 * - Precisa de 2 de energia para o lazer.
 * - A felicidade sobe com o lazer, e a educação com atividades educativas.
 *
 * PREMISSAS desta etapa, a calibrar no simulador:
 * - Parque, de graça: skate (−1 de energia, +2 de felicidade) e basquete (−1 de energia, +2 de felicidade,
 *   +1 de saúde).
 * - Academia: −2 de energia, +2 de saúde e +1 de felicidade.
 * - Galeria: −1 de energia, +2 de felicidade e +1 de educação.
 * - A entrada é o preço do tipo do imóvel no world (academia 5, galeria 4 THALER). 90% vão para o dono e
 *   10% para a queima (taxa da Prefeitura, sink do lazer). No negócio próprio, não paga.
 * - Cada atividade uma vez a cada 4 h.
 */
export const COOLDOWN_MS = 4 * 3_600_000;
export const OWNER_SHARE_BPS = 9000;

export interface ActivityRule {
  label: string;
  /** Onde: o parque público ou um negócio de jogador desse tipo (o tipo do imóvel no world). */
  place: 'parque' | 'academia' | 'galeria';
  energy: number;
  happiness: number;
  health: number;
  education: number;
}

export const ACTIVITIES = {
  skate: { label: 'Skate no parque', place: 'parque', energy: -1, happiness: 2, health: 0, education: 0 },
  basquete: { label: 'Basquete no parque', place: 'parque', energy: -1, happiness: 2, health: 1, education: 0 },
  academia: { label: 'Treino na academia', place: 'academia', energy: -2, happiness: 1, health: 2, education: 0 },
  galeria: { label: 'Visita à galeria', place: 'galeria', energy: -1, happiness: 2, health: 0, education: 1 },
} as const satisfies Record<string, ActivityRule>;
export type ActivityCode = keyof typeof ACTIVITIES;
export const ACTIVITY_CODES = Object.keys(ACTIVITIES) as ActivityCode[];
export const isActivity = (s: string): s is ActivityCode => s in ACTIVITIES;

/** Negócio de lazer como o world responde. */
export interface Venue {
  id: string;
  activity: string;
  feeCents: bigint;
  ownerAccountId: string;
  open: boolean;
}

export interface VenueDirectory {
  venue(id: string): Promise<Venue | null>;
}

export interface Leisure {
  /** Última vez de cada atividade (para o intervalo de 4 h). */
  lastAt: Partial<Record<ActivityCode, Date>>;
}

/** O que a atividade paga guarda até a cobrança passar: a regra, o negócio e quem recebe. */
export interface LeisureEffect {
  activity: ActivityCode;
  venueId: string | null;
  ownerAccountId: string | null;
  feeCents: string;
}

/** Divide a entrada: dono e queima. */
export const feeSplit = (fee: bigint) => {
  const owner = (fee * BigInt(OWNER_SHARE_BPS)) / 10_000n;
  return { owner, burn: fee - owner };
};

/**
 * Confere a atividade. O avatar vem travado e com a queda até agora. Negócio de jogador: `venue` já
 * consultado no world; no próprio, a entrada é 0.
 */
export function checkActivity(
  avatar: Avatar,
  input: { activity: string; venue: Venue | null; venueId?: string | null },
  now: Date,
): { effect: LeisureEffect; cents: bigint } {
  if (!isActivity(input.activity)) throw new AppError('invalid_activity', 'Atividade de lazer desconhecida.', 400);
  const rule = ACTIVITIES[input.activity];
  assertNotInHospital(avatar, now);
  const last = avatar.leisure?.lastAt[input.activity];
  if (last && now.getTime() - last.getTime() < COOLDOWN_MS) {
    throw new AppError('leisure_cooldown', `${rule.label}: de novo em ${Math.ceil((COOLDOWN_MS - (now.getTime() - last.getTime())) / 60_000)} min.`, 409);
  }
  if (!status(avatar, now).canLeisure || avatar.attributes.energy < -rule.energy) {
    throw new AppError('too_tired', 'Lazer precisa de pelo menos 2 de energia.', 409);
  }
  if (rule.place === 'parque') return { effect: { activity: input.activity, venueId: null, ownerAccountId: null, feeCents: '0' }, cents: 0n };

  if (!input.venueId) throw new AppError('venue_required', `Escolha ${rule.place === 'academia' ? 'uma academia' : 'uma galeria'}.`, 400);
  const v = input.venue;
  if (!v || v.activity !== input.activity) throw new AppError('venue_not_found', 'Negócio não encontrado.', 404);
  if (!v.open) throw new AppError('venue_closed', 'Fechado: em obra ou precisando de reforma.', 409);
  const own = v.ownerAccountId === avatar.accountId;
  const cents = own ? 0n : v.feeCents;
  return { effect: { activity: input.activity, venueId: v.id, ownerAccountId: v.ownerAccountId, feeCents: cents.toString() }, cents };
}

const clamp = (n: number, max = ATTRIBUTE_MAX) => Math.max(0, Math.min(max, n));

/** Aplica a atividade ao avatar (com a queda até agora). */
export function applyLeisure(avatar: Avatar, effect: Pick<LeisureEffect, 'activity'>, now: Date): Avatar {
  const rule = ACTIVITIES[effect.activity];
  const a = avatar.attributes;
  return {
    ...avatar,
    attributes: {
      ...a,
      energy: clamp(a.energy + rule.energy),
      happiness: clamp(a.happiness + rule.happiness),
      health: clamp(a.health + rule.health),
      education: clamp(a.education + rule.education, 100),
    },
    // Felicidade que estava em 0 recomeça a contagem cheia, como a comida.
    anchors: a.happiness === 0 && rule.happiness > 0 ? { ...avatar.anchors, happiness: now } : avatar.anchors,
    leisure: { lastAt: { ...(avatar.leisure?.lastAt ?? {}), [effect.activity]: now } },
    updatedAt: now,
  };
}

/** Lazer como a API mostra: quando cada atividade libera de novo. */
export function leisureDto(avatar: Pick<Avatar, 'leisure'>, now: Date) {
  return Object.fromEntries(
    ACTIVITY_CODES.map((code) => {
      const last = avatar.leisure?.lastAt[code];
      const next = last ? new Date(last.getTime() + COOLDOWN_MS) : null;
      return [code, next && next > now ? next.toISOString() : null];
    }),
  );
}

export const leisureToJson = (l: Leisure | null | undefined) =>
  l ? { lastAt: Object.fromEntries(Object.entries(l.lastAt).map(([k, v]) => [k, (v as Date).toISOString()])) } : null;

export function leisureFromJson(v: unknown): Leisure | null {
  if (!v) return null;
  const j = v as { lastAt?: Record<string, string> };
  return { lastAt: Object.fromEntries(Object.entries(j.lastAt ?? {}).filter(([k]) => isActivity(k)).map(([k, d]) => [k, new Date(d)])) };
}

export const cloneLeisure = (l: Leisure | null | undefined) => leisureFromJson(leisureToJson(l));
