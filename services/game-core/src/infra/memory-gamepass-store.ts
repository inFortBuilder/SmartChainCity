import type { GamePassStore } from '../domain/events.js';

/** Para testes e desenvolvimento. Uma thread só: cada operação é atômica. */
export class MemoryGamePassStore implements GamePassStore {
  private readonly levels = new Map<string, number>();

  async level(accountId: string, season: string) {
    return this.levels.get(`${season}:${accountId}`) ?? 0;
  }

  async setLevel(accountId: string, season: string, expected: number, level: number) {
    const key = `${season}:${accountId}`;
    if ((this.levels.get(key) ?? 0) !== expected) return false;
    this.levels.set(key, level);
    return true;
  }
}
