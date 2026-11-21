import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import type { GamePassStore } from '../../domain/events.js';
import { gamePass } from './schema.js';

export class PostgresGamePassStore implements GamePassStore {
  private readonly db;

  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  async level(accountId: string, season: string) {
    const [r] = await this.db
      .select({ level: gamePass.level })
      .from(gamePass)
      .where(and(eq(gamePass.accountId, accountId), eq(gamePass.season, season)));
    return r?.level ?? 0;
  }

  async setLevel(accountId: string, season: string, expected: number, level: number, now: Date) {
    if (expected === 0) {
      // Primeiro nível: dois pedidos juntos, um grava e o outro não.
      const rows = await this.db
        .insert(gamePass)
        .values({ accountId, season, level, updatedAt: now })
        .onConflictDoNothing()
        .returning({ level: gamePass.level });
      return rows.length > 0;
    }
    const rows = await this.db
      .update(gamePass)
      .set({ level, updatedAt: now })
      .where(and(eq(gamePass.accountId, accountId), eq(gamePass.season, season), eq(gamePass.level, expected)))
      .returning({ level: gamePass.level });
    return rows.length > 0;
  }
}
