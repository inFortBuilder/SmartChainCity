import { createHash, createHmac, randomBytes } from 'node:crypto';

import { AppError } from '@scc/shared';

import type { Attributes } from './avatar.js';

/**
 * Campeonato mensal de futebol de botão (E3.3, GDD §6 "Lazer").
 *
 * Do GDD:
 * - Times de 6.
 * - 75% das inscrições vão para os 3 primeiros (50%, 35% e 15%) e 25% são queimados.
 *
 * Como funciona aqui:
 * - Um campeonato por mês (UTC). A inscrição abre no mês e fecha na virada para o mês seguinte, quando o
 *   campeonato é disputado (job \`championship.settle\` ou a primeira leitura depois disso).
 * - A semente é sorteada na criação e só o hash dela é publicado (\`seed_commit\`). Na disputa, ela é
 *   revelada: quem tem a semente refaz a classificação.
 * - Cada conta joga com um avatar, num time só. A inscrição é paga pelo ledger para o escrow do
 *   campeonato (\`escrow/championship-<mês>\`). O prêmio do time é dividido igualmente entre os 6.
 *
 * PREMISSAS desta etapa, a calibrar no simulador:
 * - Inscrição de 10 THALER por jogador.
 * - Força do time: média de (energia + saúde + felicidade) / 30 dos 6 avatares na hora da disputa. A nota
 *   é 60% força e 40% sorte da semente. Time incompleto não joga e recebe a inscrição de volta.
 * - Com menos de 3 times completos não há disputa: todos recebem a inscrição de volta, sem queima.
 * - O resto da divisão (centavos) vai para a queima.
 */
export const TEAM_SIZE = 6;
export const ENTRY_CENTS = 1000n;
export const PRIZE_BPS = [5000, 3500, 1500] as const;
export const PRIZE_SHARE_BPS = 7500;
export const MIN_TEAMS = PRIZE_BPS.length;
export const STRENGTH_WEIGHT = 0.6;

export type ChampionshipStatus = 'open' | 'settled';
export type MemberStatus = 'pending' | 'paid';

export interface Championship {
  /** O mês, \`AAAA-MM\` (UTC). */
  id: string;
  seed: string;
  seedCommit: string;
  status: ChampionshipStatus;
  endsAt: Date;
  settledAt: Date | null;
  result: ChampionshipResult | null;
}

export interface Team {
  id: string;
  championshipId: string;
  name: string;
  captainAccountId: string;
  createdAt: Date;
}

export interface Member {
  championshipId: string;
  teamId: string;
  accountId: string;
  avatarId: string;
  feeCents: bigint;
  status: MemberStatus;
  joinedAt: Date;
}

export interface ChampionshipResult {
  /** Sem disputa (menos de 3 times completos): todos recebem a inscrição de volta. */
  played: boolean;
  ranking: { teamId: string; name: string; strength: number; luck: number; score: number; complete: boolean }[];
  /** Pagamentos por conta, em centavos: prêmio ou devolução. */
  payouts: { accountId: string; cents: string; reason: 'prize' | 'refund' }[];
  burnCents: string;
  poolCents: string;
}

/** Mês (UTC) do instante. */
export const monthOf = (now: Date) => now.toISOString().slice(0, 7);
/** A virada para o mês seguinte: fecha a inscrição e é a hora da disputa. */
export const endOfMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 1));
};

export function newChampionship(month: string, seed = randomBytes(32).toString('hex')): Championship {
  return {
    id: month,
    seed,
    seedCommit: createHash('sha256').update(seed).digest('hex'),
    status: 'open',
    endsAt: endOfMonth(month),
    settledAt: null,
    result: null,
  };
}

/** Sorte do time de 0 a 1, tirada da semente: quem tem a semente revelada refaz a conta. */
export const luckOf = (seed: string, teamId: string) =>
  createHmac('sha256', Buffer.from(seed, 'hex')).update(`team:${teamId}`).digest().readUInt32BE(0) / 2 ** 32;

/** Força de 0 a 1: média de (energia + saúde + felicidade) / 30. */
export const strengthOf = (attrs: Pick<Attributes, 'energy' | 'health' | 'happiness'>[]) =>
  attrs.length ? attrs.reduce((sum, a) => sum + (a.energy + a.health + a.happiness) / 30, 0) / attrs.length : 0;

const round = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * Disputa: classifica os times completos e reparte o bolo. `attrsOf` dá os atributos atuais de cada
 * avatar (na hora da disputa). Só membros pagos contam.
 */
export function play(
  c: Pick<Championship, 'seed'>,
  teams: Team[],
  members: Member[],
  attrsOf: (avatarId: string) => Pick<Attributes, 'energy' | 'health' | 'happiness'> | null,
): ChampionshipResult {
  const paid = members.filter((m) => m.status === 'paid');
  const pool = paid.reduce((sum, m) => sum + m.feeCents, 0n);
  const of = (teamId: string) => paid.filter((m) => m.teamId === teamId);
  const ranking = teams
    .map((t) => {
      const team = of(t.id);
      const complete = team.length === TEAM_SIZE;
      const strength = round(strengthOf(team.map((m) => attrsOf(m.avatarId) ?? { energy: 0, health: 0, happiness: 0 })));
      const luck = round(luckOf(c.seed, t.id));
      return { teamId: t.id, name: t.name, strength, luck, score: round(STRENGTH_WEIGHT * strength + (1 - STRENGTH_WEIGHT) * luck), complete };
    })
    .sort((a, b) => Number(b.complete) - Number(a.complete) || b.score - a.score || a.teamId.localeCompare(b.teamId));

  const complete = ranking.filter((r) => r.complete);
  const refund = (ms: Member[]) => ms.map((m) => ({ accountId: m.accountId, cents: m.feeCents.toString(), reason: 'refund' as const }));
  if (complete.length < MIN_TEAMS) {
    return { played: false, ranking, payouts: refund(paid), burnCents: '0', poolCents: pool.toString() };
  }
  // Time incompleto não joga: devolve a inscrição. O bolo é o dos times completos.
  const payouts: ChampionshipResult['payouts'] = refund(ranking.filter((r) => !r.complete).flatMap((r) => of(r.teamId)));
  const played = complete.flatMap((r) => of(r.teamId));
  const prizePool = played.reduce((sum, m) => sum + m.feeCents, 0n);
  const prizes = (prizePool * BigInt(PRIZE_SHARE_BPS)) / 10_000n;
  let given = 0n;
  PRIZE_BPS.forEach((bps, place) => {
    const teamPrize = (prizes * BigInt(bps)) / 10_000n;
    const each = teamPrize / BigInt(TEAM_SIZE);
    for (const m of of(complete[place]!.teamId)) {
      payouts.push({ accountId: m.accountId, cents: each.toString(), reason: 'prize' });
      given += each;
    }
  });
  return { played: true, ranking, payouts, burnCents: (prizePool - given).toString(), poolCents: pool.toString() };
}

/** Confere a criação do time e o nome. */
export function checkTeamName(name: string) {
  const n = name.trim().replace(/\s+/g, ' ');
  if (n.length < 2 || n.length > 30) throw new AppError('invalid_team_name', 'O nome do time vai de 2 a 30 letras.', 400);
  return n;
}

export const assertOpen = (c: Championship, now: Date) => {
  if (c.status !== 'open' || now.getTime() >= c.endsAt.getTime()) {
    throw new AppError('championship_closed', 'As inscrições deste campeonato fecharam.', 409);
  }
};

/** Persistência. Memória e Postgres passam pelo mesmo teste. */
export interface ChampionshipStore {
  /** O campeonato do mês; cria se ainda não existe (com a semente nova). */
  getOrCreate(month: string): Promise<Championship>;
  get(month: string): Promise<Championship | null>;
  teams(championshipId: string): Promise<Team[]>;
  members(championshipId: string): Promise<Member[]>;
  /**
   * Cria o time com o capitão como primeiro membro (\`pending\`). \`team_name_taken\` (409) e
   * \`already_registered\` (409) se a conta já está num time deste campeonato.
   */
  createTeam(team: Team, captain: Member): Promise<void>;
  /** Entra no time (\`pending\`), com o time travado: \`team_full\` (409) com 6, \`already_registered\` (409). */
  addMember(member: Member): Promise<void>;
  markPaid(championshipId: string, accountId: string): Promise<void>;
  /** Tira o membro que não pagou; o time sem ninguém some. */
  dropPending(championshipId: string, accountId: string): Promise<void>;
  pendingMembers(olderThan: Date): Promise<Member[]>;
  /** Campeonatos abertos cujo prazo passou. */
  due(now: Date): Promise<Championship[]>;
  /** open → settled com o resultado; false se outro já fechou. */
  settle(championshipId: string, result: ChampionshipResult, now: Date): Promise<boolean>;
}

/** Quem cobra e paga: o ledger do economy. Idempotente pelas chaves do campeonato. */
export interface ChampionshipPayer {
  /** Inscrição: do jogador para o escrow do campeonato. */
  chargeEntry(m: Member, requestId?: string): Promise<void>;
  /** Prêmios, devoluções e queima, saindo do escrow numa transação só. */
  payOut(c: Championship, result: ChampionshipResult, requestId?: string): Promise<void>;
}

/**
 * Cobra a inscrição pendente: paga vira `paid`; sem THALER, o membro sai. Ledger fora: continua
 * pendente (a cobrança é idempotente, então a próxima tentativa não cobra duas vezes).
 */
export async function settleEntry(deps: { store: ChampionshipStore; payer: ChampionshipPayer }, m: Member, requestId?: string) {
  try {
    await deps.payer.chargeEntry(m, requestId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'insufficient_thaler') {
      await deps.store.dropPending(m.championshipId, m.accountId);
    }
    throw error;
  }
  await deps.store.markPaid(m.championshipId, m.accountId);
}

/**
 * Disputa os campeonatos vencidos: classifica, paga pelo ledger (uma transação, idempotente) e marca
 * como disputado. O ledger fora deixa o campeonato aberto, e a próxima passada tenta de novo.
 */
export async function settleDue(
  deps: { store: ChampionshipStore; payer: ChampionshipPayer; attrsOf: (avatarId: string) => Promise<Attributes | null> },
  now: Date,
) {
  let settled = 0;
  for (const c of await deps.store.due(now)) {
    // Inscrições paradas no meio (ledger fora na hora): termina antes de disputar.
    for (const m of (await deps.store.members(c.id)).filter((x) => x.status === 'pending')) {
      await settleEntry(deps, m).catch((error) => {
        if (!(error instanceof AppError && error.code === 'insufficient_thaler')) throw error;
      });
    }
    const [teams, members] = await Promise.all([deps.store.teams(c.id), deps.store.members(c.id)]);
    const attrs = new Map<string, Attributes | null>();
    for (const m of members) attrs.set(m.avatarId, await deps.attrsOf(m.avatarId));
    const result = play(c, teams, members, (id) => attrs.get(id) ?? null);
    await deps.payer.payOut(c, result);
    if (await deps.store.settle(c.id, result, now)) settled++;
  }
  return settled;
}
