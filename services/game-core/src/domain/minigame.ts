import { profession } from './catalog.js';
import { type Shift, draw } from './shift.js';

/**
 * Minigame do turno (E2.2, doc 02 §3 e §3.2): o turno percorre as tarefas da
 * profissão, no servidor, sem precisar do jogo aberto. Cada tarefa ocupa uma
 * parte do turno proporcional à duração dela no GDD (Pedreiro: "Construir a
 * casa" leva 160 de 265 min, então 60% do turno).
 *
 * O minigame não muda a economia: o ganho e a energia do turno seguem a
 * fórmula do simulador aprovada na ADR-0010 (shift.ts). O GDD dá custos de
 * energia por tarefa (5 a 20 no minigame inteiro) que não cabem no atributo de
 * 0 a 10; até o game designer acertar o catálogo, as tarefas mostram só a
 * direção do efeito (+/−), como a rota do catálogo já faz.
 *
 * Danos (doc 02 §3.2: ferramenta quebrada, roubo no trajeto, escassez…): o
 * sorteio do dano já existe no turno; aqui ele ganha uma tarefa e um motivo,
 * tirados da mesma semente. Só aparecem quando o turno termina e a semente é
 * revelada (commit-reveal): durante o turno, ninguém sabe se vai haver dano.
 */

/** As 12 profissões do MVP (ROADMAP E2.2): as 11 comuns e o Cozinheiro. */
export const MVP_PROFESSIONS = [
  'pedreiro',
  'alfaiate',
  'padeiro',
  'agricultor',
  'enfermeira',
  'professor',
  'bombeiro',
  'motorista',
  'tosador',
  'corretor_imoveis',
  'recepcionista',
  'cozinheiro',
] as const;

/** Motivos de dano do GDD §3.2 (os que cabem em qualquer profissão). */
export const DAMAGE_EVENTS = [
  'Ferramenta quebrada',
  'Roubo no trajeto',
  'Escassez de material',
  'Chuva forte atrapalhou',
  'Princípio de incêndio',
] as const;

const sign = (n: number) => (n > 0 ? '+' : n < 0 ? '-' : '');

export type TaskState = 'done' | 'current' | 'next';

export interface MinigameTask {
  name: string;
  energy: '' | '+' | '-';
  happiness: '' | '+' | '-';
  startsAt: Date;
  endsAt: Date;
  state: TaskState;
}

export interface Minigame {
  job: string;
  tasks: MinigameTask[];
  /** Índice da tarefa em andamento (null fora do turno). */
  current: number | null;
  /** 0 a 1. */
  progress: number;
  /** Só depois do fim, com a semente revelada. */
  damage: { task: string; event: string } | null;
}

export function minigameOf(shift: Shift, now: Date): Minigame | null {
  const p = profession(shift.jobCode);
  if (!p || p.tasks.length === 0) return null;
  const start = shift.startsAt.getTime();
  const span = shift.endsAt.getTime() - start;
  const total = p.tasks.reduce((s, t) => s + Math.max(0, t.minutes), 0);
  const share = (t: { minutes: number }) => (total > 0 ? Math.max(0, t.minutes) / total : 1 / p.tasks.length);

  const running = shift.status === 'running';
  const t = running ? Math.min(Math.max(now.getTime(), start), shift.endsAt.getTime()) : shift.endsAt.getTime();
  let acc = 0;
  let current: number | null = null;
  const tasks = p.tasks.map((task, i) => {
    const s = start + acc * span;
    acc += share(task);
    // A última termina exatamente no fim do turno (sem sobra de arredondamento).
    const e = i === p.tasks.length - 1 ? shift.endsAt.getTime() : start + acc * span;
    let state: TaskState = 'next';
    if (!running || t >= e) state = 'done';
    else if (t >= s) {
      state = 'current';
      current = i;
    }
    return { name: task.name, energy: sign(task.energy), happiness: sign(task.happiness), startsAt: new Date(s), endsAt: new Date(e), state } as MinigameTask;
  });

  let damage: Minigame['damage'] = null;
  if (!running && shift.result?.damaged) {
    const at = Math.floor(draw(shift.seed, shift.id, 'damage_task') * tasks.length);
    const why = Math.floor(draw(shift.seed, shift.id, 'damage_event') * DAMAGE_EVENTS.length);
    damage = { task: tasks[at]!.name, event: DAMAGE_EVENTS[why]! };
  }

  return {
    job: p.label,
    tasks,
    current,
    progress: span > 0 ? Math.min(1, Math.max(0, (t - start) / span)) : 1,
    damage,
  };
}
