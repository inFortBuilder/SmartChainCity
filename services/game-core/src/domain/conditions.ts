import { AppError } from '@scc/shared';

/**
 * Doenças leves que a farmácia cura (E2.3, GDD §5 "Farmácia"). Ficam no
 * próprio avatar, como a tabela `avatar_condition` do doc 06 §2 pede: uma de
 * cada tipo por vez, com instante de começo e de fim.
 *
 * Do GDD: dor de barriga 3% depois de comer (1 dia de cama); gripe 1% (24 h
 * isolado); dor de cabeça −10% de rendimento. Premissas desta etapa, a
 * calibrar no simulador (o GDD não diz quando a gripe e a dor de cabeça
 * aparecem, nem quanto dura a dor de cabeça):
 * - Gripe e dor de cabeça são sorteadas no turno, com a semente do próprio
 *   turno (auditável), e começam quando o turno acaba.
 * - Dor de cabeça: 5% por turno, dura 12 h.
 * - "De cama" e "isolado" impedem trabalhar; comer continua permitido.
 */
const HOUR = 3_600_000;

/** Doença grave tira 1 de saúde a cada 15 min (GDD §5, "Hospital"). */
export const SERIOUS_DRAIN_MS = 15 * 60_000;

export const CONDITIONS = {
  dor_de_barriga: {
    label: 'Dor de barriga',
    chance: 0.03,
    trigger: 'meal',
    durationMs: 24 * HOUR,
    blocksWork: true,
    yieldFactor: 1,
    serious: false,
  },
  gripe: { label: 'Gripe', chance: 0.01, trigger: 'shift', durationMs: 24 * HOUR, blocksWork: true, yieldFactor: 1, serious: false },
  dor_de_cabeca: {
    label: 'Dor de cabeça',
    chance: 0.05,
    trigger: 'shift',
    durationMs: 12 * HOUR,
    blocksWork: false,
    yieldFactor: 0.9,
    serious: false,
  },
  // Doenças do hospital (GDD §5): a farmácia não trata. PREMISSAS: chance por turno, 3 dias sem
  // tratamento e quem fica de cama; o GDD só dá a perda de saúde.
  febre: { label: 'Febre', chance: 0.01, trigger: 'shift', durationMs: 72 * HOUR, blocksWork: true, yieldFactor: 1, serious: true },
  enxaqueca: {
    label: 'Enxaqueca',
    chance: 0.01,
    trigger: 'shift',
    durationMs: 72 * HOUR,
    blocksWork: false,
    yieldFactor: 0.8,
    serious: true,
  },
  virose: { label: 'Virose', chance: 0.005, trigger: 'shift', durationMs: 72 * HOUR, blocksWork: true, yieldFactor: 1, serious: true },
} as const;

export type ConditionCode = keyof typeof CONDITIONS;
export const CONDITION_CODES = Object.keys(CONDITIONS) as ConditionCode[];
export const isConditionCode = (code: string): code is ConditionCode => code in CONDITIONS;

export interface Condition {
  code: ConditionCode;
  startsAt: Date;
  endsAt: Date;
  /** Doença grave: quantos pontos de saúde ela já tirou (a queda é calculada pelo tempo). */
  drained?: number;
}

/** Em curso agora? A doença sorteada no turno só começa quando o turno acaba. */
export const isActive = (c: Condition, now: Date) =>
  c.startsAt.getTime() <= now.getTime() && c.endsAt.getTime() > now.getTime();

export const activeConditions = (conditions: Condition[], now: Date) => conditions.filter((c) => isActive(c, now));

/** Pega a doença: uma de cada tipo por vez; se já tem, não soma. Tira as que já passaram. */
export function catchCondition(conditions: Condition[], code: ConditionCode, startsAt: Date): Condition[] {
  const kept = conditions.filter((c) => c.endsAt.getTime() > startsAt.getTime());
  if (kept.some((c) => c.code === code)) return kept;
  return [...kept, { code, startsAt, endsAt: new Date(startsAt.getTime() + CONDITIONS[code].durationMs) }];
}

/** Cura: tira a doença da lista. */
export const cure = (conditions: Condition[], code: ConditionCode) => conditions.filter((c) => c.code !== code);

/** Alguma doença em curso impede trabalhar? */
export function assertCanWorkHealthy(conditions: Condition[], now: Date) {
  const blocking = activeConditions(conditions, now).find((c) => CONDITIONS[c.code].blocksWork);
  if (blocking) {
    throw new AppError(
      'sick',
      `${CONDITIONS[blocking.code].label}: o avatar não trabalha até ${blocking.endsAt.toISOString()}. ${CONDITIONS[blocking.code].serious ? 'Só o hospital trata.' : 'A farmácia pode curar.'}`,
      409,
    );
  }
}

/** Fator de rendimento do turno pelas doenças em curso no começo dele. */
export const yieldFactor = (conditions: Condition[], now: Date) =>
  activeConditions(conditions, now).reduce((f, c) => f * CONDITIONS[c.code].yieldFactor, 1);

/** Doenças que só o hospital trata (febre, enxaqueca, virose). */
export const isSerious = (code: ConditionCode) => CONDITIONS[code].serious;
export const SERIOUS_CODES = CONDITION_CODES.filter(isSerious);

/**
 * Perda de saúde das doenças graves até `now`: 1 ponto a cada 15 min desde o
 * começo da doença (até o fim dela), menos o que já foi tirado. Calcular pelo
 * tempo, e não pela vez que o job roda, deixa a leitura, o job e o banco iguais.
 */
export function drainHealth(conditions: Condition[], health: number, now: Date): { health: number; conditions: Condition[] } {
  let h = health;
  const next = conditions.map((c) => {
    if (!isSerious(c.code) || now.getTime() <= c.startsAt.getTime()) return c;
    const until = Math.min(now.getTime(), c.endsAt.getTime());
    const total = Math.floor((until - c.startsAt.getTime()) / SERIOUS_DRAIN_MS);
    const steps = total - (c.drained ?? 0);
    if (steps <= 0) return c;
    h = Math.max(0, h - steps);
    return { ...c, drained: total };
  });
  return { health: h, conditions: next };
}

/** Alguma doença grave ainda vai tirar saúde (para o job da queda achar o avatar). */
export const drainDue = (conditions: Condition[], health: number, now: Date) =>
  health > 0 && drainHealth(conditions, health, now).health < health;

/** O hospital cura as graves: na internação compulsória e no tratamento. */
export const cureSerious = (conditions: Condition[]) => conditions.filter((c) => !isSerious(c.code));
