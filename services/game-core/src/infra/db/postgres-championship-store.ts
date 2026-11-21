import { AppError } from '@scc/shared';
import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import {
  type Championship,
  type ChampionshipResult,
  type ChampionshipStore,
  type Member,
  TEAM_SIZE,
  type Team,
  newChampionship,
} from '../../domain/championship.js';
import { championship, championshipMember, championshipTeam } from './schema.js';

const isUniqueViolation = (error: unknown, constraint: string) => {
  const e = error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } } | null;
  const inner = e?.code === '23505' ? e : e?.cause?.code === '23505' ? e.cause : null;
  return !!inner && inner.constraint === constraint;
};

const toChampionship = (r: typeof championship.$inferSelect): Championship => ({
  id: r.id,
  seed: r.seed,
  seedCommit: r.seedCommit,
  status: r.status as Championship['status'],
  endsAt: r.endsAt,
  settledAt: r.settledAt,
  result: (r.result as ChampionshipResult | null) ?? null,
});

const toTeam = (r: typeof championshipTeam.$inferSelect): Team => ({ ...r });

const toMember = (r: typeof championshipMember.$inferSelect): Member => ({
  ...r,
  feeCents: BigInt(r.feeCents),
  status: r.status as Member['status'],
});

const memberRow = (m: Member) => ({ ...m, feeCents: m.feeCents.toString() });

const registered = () => new AppError('already_registered', 'Você já está num time deste campeonato.', 409);

export class PostgresChampionshipStore implements ChampionshipStore {
  private readonly db;

  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  async getOrCreate(month: string) {
    const c = newChampionship(month);
    // Dois pedidos juntos: o segundo não grava e lê o primeiro (a semente fica uma só).
    await this.db
      .insert(championship)
      .values({ ...c, result: null })
      .onConflictDoNothing();
    return (await this.get(month))!;
  }

  async get(month: string) {
    const [r] = await this.db.select().from(championship).where(eq(championship.id, month));
    return r ? toChampionship(r) : null;
  }

  async teams(championshipId: string) {
    const rows = await this.db
      .select()
      .from(championshipTeam)
      .where(eq(championshipTeam.championshipId, championshipId))
      .orderBy(asc(championshipTeam.createdAt), asc(championshipTeam.id));
    return rows.map(toTeam);
  }

  async members(championshipId: string) {
    const rows = await this.db
      .select()
      .from(championshipMember)
      .where(eq(championshipMember.championshipId, championshipId))
      .orderBy(asc(championshipMember.joinedAt));
    return rows.map(toMember);
  }

  async createTeam(team: Team, captain: Member) {
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(championshipTeam).values(team);
        await tx.insert(championshipMember).values(memberRow(captain));
      });
    } catch (error) {
      if (isUniqueViolation(error, 'championship_team_name_unique')) throw new AppError('team_name_taken', 'Já existe um time com esse nome.', 409);
      if (isUniqueViolation(error, 'championship_member_account_unique')) throw registered();
      throw error;
    }
  }

  async addMember(member: Member) {
    try {
      await this.db.transaction(async (tx) => {
        // Trava o time: dois pedidos juntos não passam de 6.
        const [team] = await tx
          .select()
          .from(championshipTeam)
          .where(and(eq(championshipTeam.id, member.teamId), eq(championshipTeam.championshipId, member.championshipId)))
          .for('update');
        if (!team) throw new AppError('not_found', 'Time não encontrado.', 404);
        const [{ n } = { n: 0 }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(championshipMember)
          .where(eq(championshipMember.teamId, member.teamId));
        if (n >= TEAM_SIZE) throw new AppError('team_full', `O time já tem ${TEAM_SIZE} jogadores.`, 409);
        await tx.insert(championshipMember).values(memberRow(member));
      });
    } catch (error) {
      if (isUniqueViolation(error, 'championship_member_account_unique')) throw registered();
      throw error;
    }
  }

  async markPaid(championshipId: string, accountId: string) {
    await this.db
      .update(championshipMember)
      .set({ status: 'paid' })
      .where(and(eq(championshipMember.championshipId, championshipId), eq(championshipMember.accountId, accountId)));
  }

  async dropPending(championshipId: string, accountId: string) {
    await this.db.transaction(async (tx) => {
      const [gone] = await tx
        .delete(championshipMember)
        .where(
          and(
            eq(championshipMember.championshipId, championshipId),
            eq(championshipMember.accountId, accountId),
            eq(championshipMember.status, 'pending'),
          ),
        )
        .returning();
      if (!gone) return;
      // O time sem ninguém some (o nome volta a ficar livre).
      await tx.execute(
        sql`delete from ${championshipTeam} where ${championshipTeam.id} = ${gone.teamId}
            and not exists (select 1 from ${championshipMember} where ${championshipMember.teamId} = ${gone.teamId})`,
      );
    });
  }

  async pendingMembers(olderThan: Date) {
    const rows = await this.db
      .select()
      .from(championshipMember)
      .where(and(eq(championshipMember.status, 'pending'), lte(championshipMember.joinedAt, olderThan)))
      .limit(200);
    return rows.map(toMember);
  }

  async due(now: Date) {
    const rows = await this.db
      .select()
      .from(championship)
      .where(and(eq(championship.status, 'open'), lte(championship.endsAt, now)));
    return rows.map(toChampionship);
  }

  async settle(championshipId: string, result: ChampionshipResult, now: Date) {
    const rows = await this.db
      .update(championship)
      .set({ status: 'settled', settledAt: now, result })
      .where(and(eq(championship.id, championshipId), eq(championship.status, 'open')))
      .returning({ id: championship.id });
    return rows.length > 0;
  }
}
