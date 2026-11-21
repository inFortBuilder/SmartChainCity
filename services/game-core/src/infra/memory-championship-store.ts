import { AppError } from '@scc/shared';

import {
  type Championship,
  type ChampionshipResult,
  type ChampionshipStore,
  type Member,
  TEAM_SIZE,
  type Team,
  newChampionship,
} from '../domain/championship.js';

/** Para testes e desenvolvimento. Uma thread só: cada operação é atômica. */
export class MemoryChampionshipStore implements ChampionshipStore {
  private readonly championships = new Map<string, Championship>();
  private readonly teamList: Team[] = [];
  private memberList: Member[] = [];

  async getOrCreate(month: string) {
    if (!this.championships.has(month)) this.championships.set(month, newChampionship(month));
    return { ...this.championships.get(month)! };
  }

  async get(month: string) {
    const c = this.championships.get(month);
    return c ? { ...c } : null;
  }

  async teams(championshipId: string) {
    return this.teamList.filter((t) => t.championshipId === championshipId).map((t) => ({ ...t }));
  }

  async members(championshipId: string) {
    return this.memberList.filter((m) => m.championshipId === championshipId).map((m) => ({ ...m }));
  }

  private assertFree(m: Member) {
    if (this.memberList.some((x) => x.championshipId === m.championshipId && x.accountId === m.accountId)) {
      throw new AppError('already_registered', 'Você já está num time deste campeonato.', 409);
    }
  }

  async createTeam(team: Team, captain: Member) {
    if (this.teamList.some((t) => t.championshipId === team.championshipId && t.name.toLowerCase() === team.name.toLowerCase())) {
      throw new AppError('team_name_taken', 'Já existe um time com esse nome.', 409);
    }
    this.assertFree(captain);
    this.teamList.push({ ...team });
    this.memberList.push({ ...captain });
  }

  async addMember(member: Member) {
    if (!this.teamList.some((t) => t.id === member.teamId && t.championshipId === member.championshipId)) {
      throw new AppError('not_found', 'Time não encontrado.', 404);
    }
    this.assertFree(member);
    if (this.memberList.filter((m) => m.teamId === member.teamId).length >= TEAM_SIZE) {
      throw new AppError('team_full', `O time já tem ${TEAM_SIZE} jogadores.`, 409);
    }
    this.memberList.push({ ...member });
  }

  async markPaid(championshipId: string, accountId: string) {
    const m = this.memberList.find((x) => x.championshipId === championshipId && x.accountId === accountId);
    if (m) m.status = 'paid';
  }

  async dropPending(championshipId: string, accountId: string) {
    const m = this.memberList.find((x) => x.championshipId === championshipId && x.accountId === accountId && x.status === 'pending');
    if (!m) return;
    this.memberList = this.memberList.filter((x) => x !== m);
    if (!this.memberList.some((x) => x.teamId === m.teamId)) {
      const i = this.teamList.findIndex((t) => t.id === m.teamId);
      if (i >= 0) this.teamList.splice(i, 1);
    }
  }

  async pendingMembers(olderThan: Date) {
    return this.memberList.filter((m) => m.status === 'pending' && m.joinedAt <= olderThan).map((m) => ({ ...m }));
  }

  async due(now: Date) {
    return [...this.championships.values()].filter((c) => c.status === 'open' && c.endsAt <= now).map((c) => ({ ...c }));
  }

  async settle(championshipId: string, result: ChampionshipResult, now: Date) {
    const c = this.championships.get(championshipId);
    if (!c || c.status !== 'open') return false;
    this.championships.set(championshipId, { ...c, status: 'settled', settledAt: now, result });
    return true;
  }
}
