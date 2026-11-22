import { type Farm, type FarmStore, farmFromJson, farmToJson } from '../domain/farm.js';

const clone = (f: Farm): Farm => ({ ...f, ...farmFromJson(farmToJson(f)) });

/** Para testes e desenvolvimento. Uma thread só: cada operação é atômica. */
export class MemoryFarmStore implements FarmStore {
  private readonly farms = new Map<string, Farm>();

  async get(accountId: string) {
    const f = this.farms.get(accountId);
    return f ? clone(f) : null;
  }

  async create(f: Farm) {
    if (this.farms.has(f.accountId)) return false;
    this.farms.set(f.accountId, clone(f));
    return true;
  }

  async save(f: Farm) {
    const current = this.farms.get(f.accountId);
    if (!current || current.version !== f.version) return false;
    this.farms.set(f.accountId, { ...clone(f), version: f.version + 1 });
    return true;
  }
}
