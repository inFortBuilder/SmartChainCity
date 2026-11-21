import type { Race, RaceStatus, RaceStore } from '../domain/race.js';

const clone = (r: Race): Race => ({ ...r, result: { ...r.result, rivals: [...r.result.rivals], factors: { ...r.result.factors } } });

/** Para testes e desenvolvimento. Uma thread só: cada operação é atômica. */
export class MemoryRaceStore implements RaceStore {
  private readonly races = new Map<string, Race>();

  async createWithinLimit(race: Race, limit: number) {
    // Sem await entre contar e gravar: atômico na memória.
    if (this.count(race.avatarId, race.day) >= limit) return false;
    this.races.set(race.id, clone(race));
    return true;
  }

  async countToday(avatarId: string, day: string) {
    return this.count(avatarId, day);
  }

  private count(avatarId: string, day: string) {
    return [...this.races.values()].filter((r) => r.avatarId === avatarId && r.day === day && r.status !== 'failed').length;
  }

  async get(id: string) {
    const r = this.races.get(id);
    return r ? clone(r) : null;
  }

  async listByAccount(accountId: string, limit: number) {
    return [...this.races.values()]
      .filter((r) => r.accountId === accountId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map(clone);
  }

  async transition(id: string, from: RaceStatus, to: RaceStatus) {
    const r = this.races.get(id);
    if (!r || r.status !== from) return false;
    r.status = to;
    return true;
  }

  async stuck(olderThan: Date) {
    return [...this.races.values()].filter((r) => (r.status === 'pending' || r.status === 'charged') && r.createdAt <= olderThan).map(clone);
  }
}
