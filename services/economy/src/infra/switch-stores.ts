import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import type { Switch, SwitchName, SwitchStore } from '../domain/switches.js';
import { incidentSwitch } from './db/schema.js';

/** Travas em memória (dev e testes). */
export class MemorySwitchStore implements SwitchStore {
  private readonly map = new Map<SwitchName, Switch>();

  async all() {
    return [...this.map.values()].map((s) => ({ ...s }));
  }

  async set(s: Switch) {
    this.map.set(s.name, { ...s });
  }
}

/** Travas no Postgres: valem para todas as instâncias do economy e sobrevivem a reinício. */
export class PostgresSwitchStore implements SwitchStore {
  private readonly db;

  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  async all() {
    const rows = await this.db.select().from(incidentSwitch);
    return rows.map((r) => ({ name: r.name as SwitchName, frozen: r.frozen, reason: r.reason, by: r.changedBy, since: r.since }));
  }

  async set(s: Switch) {
    const row = { name: s.name, frozen: s.frozen, reason: s.reason, changedBy: s.by, since: s.since };
    await this.db.insert(incidentSwitch).values(row).onConflictDoUpdate({ target: incidentSwitch.name, set: row });
  }
}
