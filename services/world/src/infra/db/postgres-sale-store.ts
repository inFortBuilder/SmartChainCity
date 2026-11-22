import { randomInt } from 'node:crypto';

import { and, desc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import type { QueueTicket, SaleConfig, SaleStore } from '../../domain/sale.js';
import { sale as saleT, saleTicket as tT } from './schema.js';

type Db = ReturnType<typeof drizzle>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Row = typeof tT.$inferSelect;

/** Sorteio da posição de quem entrou antes da abertura: aleatório do sistema, não do relógio. */
const lottery = () => randomInt(0, 2 ** 47) / 2 ** 47;

export class PostgresSaleStore implements SaleStore {
  private readonly db;

  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  async getSale(city: string) {
    const [r] = await this.db.select().from(saleT).where(eq(saleT.city, city));
    return r ? { ...r } : null;
  }

  async setSale(s: SaleConfig) {
    await this.db.insert(saleT).values(s).onConflictDoUpdate({ target: saleT.city, set: s });
  }

  async clearSale(city: string) {
    await this.db.delete(saleT).where(eq(saleT.city, city));
  }

  /** Posição calculada: sorteados antes da abertura primeiro, depois por ordem de chegada. */
  private async ticket(db: Db | Tx, r: Row): Promise<QueueTicket> {
    const res = await db.execute<{ position: number }>(
      r.preOpen
        ? sql`select 1 + count(*)::int as position from world.sale_ticket
              where city = ${r.city} and pre_open and (lottery, id) < (${r.lottery}, ${r.id})`
        : sql`select 1 + count(*)::int as position from world.sale_ticket
              where city = ${r.city} and (pre_open or id < ${r.id})`,
    );
    const position = Number((res.rows[0] as { position: number }).position);
    return { id: r.id, city: r.city, accountId: r.accountId, joinedAt: r.joinedAt, preOpen: r.preOpen, position };
  }

  private async latest(db: Db | Tx, city: string, accountId: string) {
    const [r] = await db
      .select()
      .from(tT)
      .where(and(eq(tT.city, city), eq(tT.accountId, accountId)))
      .orderBy(desc(tT.id))
      .limit(1);
    return r ?? null;
  }

  async latestTicket(city: string, accountId: string) {
    const r = await this.latest(this.db, city, accountId);
    return r ? this.ticket(this.db, r) : null;
  }

  async join(city: string, accountId: string, now: Date, preOpen: boolean, stillValid: (t: QueueTicket) => boolean) {
    return this.db.transaction(async (tx) => {
      // Uma entrada por vez por conta: dois cliques juntos não criam duas fichas.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`world-queue:${city}:${accountId}`}))`);
      const current = await this.latest(tx, city, accountId);
      if (current) {
        const t = await this.ticket(tx, current);
        if (stillValid(t)) return t;
      }
      const [row] = await tx
        .insert(tT)
        .values({ city, accountId, joinedAt: now, preOpen, lottery: lottery() })
        .returning();
      return this.ticket(tx, row!);
    });
  }
}
