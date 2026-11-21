import { createHash } from 'node:crypto';

import { AppError } from '@scc/shared';

/**
 * Eventos semanais por profissão e GamePass da temporada (E3.10; GDD §8, doc 04 §4 e §8).
 *
 * Do GDD e do doc 04:
 * - Toda semana um grupo de profissões recebe bônus, para equilibrar o valor das raridades.
 * - O bônus entra no ganho do turno como `fator_evento_semanal`.
 * - Grupos: Comida, Saúde e Lazer, com as profissões da tabela do GDD §8.
 * - GamePass sazonal com níveis 1 a 5, pago em SCITY (sink): reduz o risco de desastre e dá itens
 *   exclusivos.
 *
 * PREMISSAS desta etapa, a calibrar no simulador:
 * - Quarto grupo, "Cidade", com as 18 profissões que o GDD não pôs em nenhum grupo. Sem ele, elas nunca
 *   teriam evento.
 * - Bônus de 1,20× no turno da profissão em evento. A semana é a ISO (segunda a domingo, UTC). Os
 *   grupos se revezam em ordem fixa, um por semana, e o nome do evento gira na lista do grupo.
 * - O fator vale para o turno que começa na semana do evento (fica no retrato do turno).
 * - Temporada 1: 12 semanas a partir de 16/11/2026.
 * - GamePass: 5 SCITY por nível (o nível 5 custa 25 SCITY no total; subir paga só a diferença).
 *   Cada nível corta 10% da chance de dano no turno (nível 5 corta pela metade).
 * - Os itens exclusivos são distintivos da temporada, só para mostrar. Itens com efeito ficam para quando
 *   houver loja de itens.
 * - Eventos e temporadas moram aqui até o Strapi publicar o tipo `event` (doc 05 §3).
 */
export const EVENT_FACTOR = 1.2;
const WEEK = 7 * 86_400_000;
/** Segunda-feira, 00:00 UTC, de uma semana de referência: as semanas contam a partir dela. */
const EPOCH = Date.UTC(2026, 10, 16);

export const EVENT_GROUPS = [
  {
    code: 'comida',
    label: 'Comida',
    jobs: ['padeiro', 'agricultor', 'confeiteiro', 'pescador', 'recepcionista', 'garcom', 'cozinheiro', 'fazendeiro', 'chef', 'agronomo'],
    events: ['Evento gastronômico', 'Agroweek', 'Feira orgânica', 'Fim do defeso'],
  },
  {
    code: 'saude',
    label: 'Saúde',
    jobs: ['enfermeira', 'bombeiro', 'farmaceutico', 'dentista', 'medico', 'veterinario'],
    events: ['Semana da Saúde', 'Congresso de Saúde', 'Dia do Médico', 'Olimpíadas'],
  },
  {
    code: 'lazer',
    label: 'Lazer',
    jobs: ['alfaiate', 'professor', 'modelista', 'orientador_escolar', 'arquiteto', 'designer_acessorios', 'hoteleiro', 'concierge', 'estilista', 'astronauta'],
    events: ['Fashion week', 'Competição de arte', 'Feira literária', 'Voo para outro planeta'],
  },
  {
    // Premissa: o GDD não pôs estas profissões em nenhum grupo.
    code: 'cidade',
    label: 'Cidade',
    jobs: [
      'pedreiro',
      'motorista',
      'tosador',
      'corretor_imoveis',
      'construtor',
      'policial',
      'mecanico',
      'pet_sitter',
      'consultor_imoveis',
      'coordenador_escolar',
      'perito',
      'piloto',
      'adestrador',
      'administrador_condominio',
      'incorporador',
      'engenheiro_civil',
      'diretor',
      'delegado',
    ],
    events: ['Semana da Construção', 'Salão do Imóvel', 'Semana da Segurança', 'Feira de Serviços'],
  },
] as const;

export interface WeeklyEvent {
  /** Semana desde a referência (0 = 16/11/2026). */
  week: number;
  group: (typeof EVENT_GROUPS)[number]['code'];
  groupLabel: string;
  name: string;
  jobs: readonly string[];
  factor: number;
  startsAt: Date;
  endsAt: Date;
}

export const weekOf = (now: Date) => Math.floor((now.getTime() - EPOCH) / WEEK);

/** O evento de uma semana: os grupos se revezam; o nome gira na lista do grupo. */
export function eventOfWeek(week: number): WeeklyEvent {
  const n = EVENT_GROUPS.length;
  const g = EVENT_GROUPS[((week % n) + n) % n]!;
  const round = Math.floor(week / n);
  const names = g.events;
  return {
    week,
    group: g.code,
    groupLabel: g.label,
    name: names[((round % names.length) + names.length) % names.length]!,
    jobs: g.jobs,
    factor: EVENT_FACTOR,
    startsAt: new Date(EPOCH + week * WEEK),
    endsAt: new Date(EPOCH + (week + 1) * WEEK),
  };
}

export const eventAt = (now: Date) => eventOfWeek(weekOf(now));

/** Fator do evento para a profissão agora (1 fora do evento). */
export const eventFactor = (jobCode: string, now: Date) => {
  const e = eventAt(now);
  return (e.jobs as readonly string[]).includes(jobCode) ? e.factor : 1;
};

export const eventDto = (e: WeeklyEvent) => ({
  week: e.week,
  group: e.group,
  group_label: e.groupLabel,
  name: e.name,
  jobs: e.jobs,
  factor: e.factor,
  starts_at: e.startsAt.toISOString(),
  ends_at: e.endsAt.toISOString(),
});

// ---------------------------------------------------------------- GamePass

export interface Season {
  code: string;
  label: string;
  startsAt: Date;
  endsAt: Date;
}

export const SEASONS: Season[] = [
  { code: 's1', label: 'Temporada 1', startsAt: new Date(EPOCH), endsAt: new Date(EPOCH + 12 * WEEK) },
];

export const seasonAt = (now: Date) => SEASONS.find((s) => s.startsAt <= now && now < s.endsAt) ?? null;

export const PASS_MAX_LEVEL = 5;
/** SCITY em wei por nível. */
export const PASS_LEVEL_WEI = 5n * 10n ** 18n;
/** Cada nível corta 10% da chance de dano no turno. */
export const PASS_DAMAGE_CUT_PER_LEVEL = 0.1;
export const PASS_ITEMS: { level: number; code: string; label: string }[] = [
  { level: 1, code: 'adesivo-t1', label: 'Adesivo da Temporada 1' },
  { level: 2, code: 'bone-t1', label: 'Boné da Temporada 1' },
  { level: 3, code: 'camiseta-t1', label: 'Camiseta da Temporada 1' },
  { level: 4, code: 'trofeu-t1', label: 'Troféu da Temporada 1' },
  { level: 5, code: 'placa-t1', label: 'Placa dourada da Temporada 1' },
];

export const passPriceWei = (level: number) => BigInt(level) * PASS_LEVEL_WEI;
export const damageCut = (level: number) => Math.min(PASS_MAX_LEVEL, Math.max(0, level)) * PASS_DAMAGE_CUT_PER_LEVEL;

/** Confere a subida de nível e devolve quanto cobrar (só a diferença). */
export function checkPassUpgrade(current: number, target: number, season: Season | null) {
  if (!season) throw new AppError('no_season', 'Não há temporada aberta agora.', 409);
  if (!Number.isInteger(target) || target < 1 || target > PASS_MAX_LEVEL) {
    throw new AppError('invalid_level', `O GamePass vai do nível 1 ao ${PASS_MAX_LEVEL}.`, 400);
  }
  if (target <= current) throw new AppError('level_owned', `Você já tem o nível ${current}.`, 409);
  return { wei: passPriceWei(target) - passPriceWei(current) };
}

export interface GamePassStore {
  level(accountId: string, season: string): Promise<number>;
  /** Sobe para `level` se o atual ainda for `expected`. */
  setLevel(accountId: string, season: string, expected: number, level: number, now: Date): Promise<boolean>;
}

/** Quem cobra o GamePass: SCITY do jogador para a queima. Chave `gamepass:<temporada>:<conta>:<nível>`. */
export interface GamePassPayer {
  chargePass(input: { key: string; accountId: string; wei: bigint; season: string }, requestId?: string): Promise<void>;
}

/** A chave do sorteio do dano não muda com o GamePass: só o limite da chance. */
export const passKey = (season: string, accountId: string, level: number) =>
  `gamepass:${season}:${createHash('sha256').update(accountId).digest('hex').slice(0, 16)}:${level}`;
