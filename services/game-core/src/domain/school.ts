import { AppError } from '@scc/shared';

import type { Avatar } from './avatar.js';
import { profession, professionFits } from './catalog.js';
import { assertNotInHospital } from './hospital.js';

/**
 * Escola (E3.2, GDD §2.3, §3.2 e §6 "Escola"; ADR-0013 para a escala).
 *
 * Do GDD e da ADR-0013:
 * - Educação de 0 a 100, cumulativa: nunca se perde, nem ao trocar de profissão.
 *   Multiplica o turno de 1× a 3× (0, 50 e 100).
 * - A escola dá os graus 1 a 3 como marcos (33, 66 e 100).
 * - Trocar de profissão leva 4 dias de escola, com +felicidade nos 2 primeiros dias.
 *
 * PREMISSAS desta etapa, a calibrar no simulador:
 * - Aula: +2 de educação, −2 de energia, 15 THALER, uma por dia (UTC). Chegar a 100 leva 50 dias de aula.
 * - Troca de profissão: 100 THALER, só para outra profissão da mesma raridade (a raridade é do NFT).
 *   Durante os 4 dias, o avatar não trabalha nem assiste aula.
 * - "+felicidade nos 2 primeiros dias" vira +2 de felicidade na matrícula e de novo 24 h depois. O segundo
 *   ponto cai na leitura, como a queda dos atributos.
 * - A nova profissão vale quando os 4 dias acabam, na primeira leitura ou gravação depois disso.
 * - Pagamentos vão para a queima (sink da escola, doc 04 §7).
 */
export const EDUCATION_MAX = 100;
export const GRADES = [33, 66, 100] as const;
export const CLASS = { education: 2, energy: -2, cents: 1500n } as const;
export const CHANGE_CENTS = 10_000n;
export const CHANGE_MS = 4 * 24 * 3_600_000;
export const CHANGE_HAPPINESS = 2;
const DAY = 24 * 3_600_000;

/** Grau escolar de 0 a 3 pelos marcos da ADR-0013. */
export const grade = (education: number) => GRADES.filter((g) => education >= g).length;

export interface School {
  /** Última aula: uma por dia (UTC). */
  lastClassAt: Date | null;
  /** Troca de profissão em curso. `bonusGiven` conta os pontos de felicidade já dados (1 ou 2). */
  change: { toJob: string; startsAt: Date; endsAt: Date; bonusGiven: number } | null;
}

export const emptySchool = (): School => ({ lastClassAt: null, change: null });

/** Em troca de profissão agora? */
export const inSchool = (avatar: Pick<Avatar, 'school'>, now: Date) =>
  !!avatar.school?.change && avatar.school.change.endsAt.getTime() > now.getTime();

const sameUtcDay = (a: Date, b: Date) => Math.floor(a.getTime() / DAY) === Math.floor(b.getTime() / DAY);

/**
 * A escola até agora: dá o segundo ponto de felicidade depois de 24 h e, com os 4 dias completos,
 * troca a profissão. Puro: quem grava é o store, junto com o resto do avatar.
 */
export function schooled(avatar: Avatar, now: Date): Avatar {
  const change = avatar.school?.change;
  if (!change) return avatar;
  let happiness = avatar.attributes.happiness;
  let bonusGiven = change.bonusGiven;
  if (bonusGiven < 2 && now.getTime() >= change.startsAt.getTime() + DAY) {
    happiness = Math.min(10, happiness + CHANGE_HAPPINESS);
    bonusGiven = 2;
  }
  const attributes = { ...avatar.attributes, happiness };
  if (now.getTime() >= change.endsAt.getTime()) {
    return { ...avatar, attributes, jobCode: change.toJob, school: { ...avatar.school!, change: null } };
  }
  return { ...avatar, attributes, school: { ...avatar.school!, change: { ...change, bonusGiven } } };
}

/** O turno e a aula recusam durante a troca. */
export function assertNotInSchool(avatar: Pick<Avatar, 'school'>, now: Date) {
  if (inSchool(avatar, now)) {
    throw new AppError('in_school', `Na escola trocando de profissão até ${avatar.school!.change!.endsAt.toISOString()}.`, 409);
  }
}

export type SchoolEffect = { kind: 'class' } | { kind: 'change'; toJob: string };

/** Confere a aula. O avatar vem travado e com a queda até agora. */
export function checkClass(avatar: Avatar, now: Date): SchoolEffect & { cents: bigint } {
  assertNotInHospital(avatar, now);
  assertNotInSchool(avatar, now);
  if (avatar.attributes.education >= EDUCATION_MAX) throw new AppError('max_education', 'A educação já está no máximo (100).', 409);
  const last = avatar.school?.lastClassAt;
  if (last && sameUtcDay(last, now)) throw new AppError('class_taken', 'Uma aula por dia: volte amanhã.', 409);
  if (avatar.attributes.energy < -CLASS.energy) throw new AppError('too_tired', `A aula gasta ${-CLASS.energy} de energia.`, 409);
  return { kind: 'class', cents: CLASS.cents };
}

/** Confere a troca de profissão. `running`: há turno rodando (a escola espera ele acabar). */
export function checkChange(avatar: Avatar, toJob: string, running: boolean, now: Date): SchoolEffect & { cents: bigint } {
  assertNotInHospital(avatar, now);
  assertNotInSchool(avatar, now);
  if (running) throw new AppError('shift_running', 'Termine o turno antes de ir para a escola.', 409);
  if (!profession(toJob)) throw new AppError('invalid_job', 'Profissão desconhecida.', 400);
  if (toJob === avatar.jobCode) throw new AppError('same_job', 'O avatar já tem essa profissão.', 409);
  if (!professionFits(avatar.rarity, toJob)) {
    throw new AppError('invalid_job', 'Só dá para trocar por uma profissão da mesma raridade do avatar.', 409);
  }
  return { kind: 'change', toJob, cents: CHANGE_CENTS };
}

/** Aplica o que foi pago (o avatar já vem com a queda até agora). */
export function applySchoolEffect(avatar: Avatar, effect: SchoolEffect, now: Date): Avatar {
  const school = avatar.school ?? emptySchool();
  if (effect.kind === 'class') {
    const a = avatar.attributes;
    return {
      ...avatar,
      attributes: {
        ...a,
        education: Math.min(EDUCATION_MAX, a.education + CLASS.education),
        energy: Math.max(0, a.energy + CLASS.energy),
      },
      school: { ...school, lastClassAt: now },
      updatedAt: now,
    };
  }
  return {
    ...avatar,
    attributes: { ...avatar.attributes, happiness: Math.min(10, avatar.attributes.happiness + CHANGE_HAPPINESS) },
    school: { ...school, change: { toJob: effect.toJob, startsAt: now, endsAt: new Date(now.getTime() + CHANGE_MS), bonusGiven: 1 } },
    updatedAt: now,
  };
}

/** A escola como a API mostra. */
export function schoolDto(avatar: Pick<Avatar, 'school' | 'attributes' | 'rarity'>, now: Date) {
  const s = avatar.school;
  const change = s?.change && s.change.endsAt.getTime() > now.getTime() ? s.change : null;
  return {
    grade: grade(avatar.attributes.education),
    next_grade_at: GRADES.find((g) => avatar.attributes.education < g) ?? null,
    class_today: !!s?.lastClassAt && sameUtcDay(s.lastClassAt, now),
    changing_to: change ? { job: change.toJob, label: profession(change.toJob)?.label ?? change.toJob, ends_at: change.endsAt.toISOString() } : null,
  };
}

/** Datas em JSON (banco) e de volta. */
export const schoolToJson = (s: School | null | undefined) =>
  s
    ? {
        lastClassAt: s.lastClassAt?.toISOString() ?? null,
        change: s.change
          ? { ...s.change, startsAt: s.change.startsAt.toISOString(), endsAt: s.change.endsAt.toISOString() }
          : null,
      }
    : null;

export function schoolFromJson(v: unknown): School | null {
  if (!v) return null;
  const j = v as { lastClassAt: string | null; change: { toJob: string; startsAt: string; endsAt: string; bonusGiven: number } | null };
  return {
    lastClassAt: j.lastClassAt ? new Date(j.lastClassAt) : null,
    change: j.change
      ? { toJob: j.change.toJob, startsAt: new Date(j.change.startsAt), endsAt: new Date(j.change.endsAt), bonusGiven: j.change.bonusGiven ?? 1 }
      : null,
  };
}

export const cloneSchool = (s: School | null | undefined) => schoolFromJson(schoolToJson(s));
