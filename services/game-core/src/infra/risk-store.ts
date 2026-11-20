import { and, asc, eq, gte, ne, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import type { RiskDecision, RiskSignal, RiskStore } from '../domain/risk.js';
import { riskDecision as decisionT, riskSignal as signalT } from './db/schema.js';

/** Sem aparelho, a coluna guarda '' (a chave única não aceita null repetido). */
const NO_DEVICE = '';

/** Para testes e desenvolvimento. */
export class MemoryRiskStore implements RiskStore {
  private readonly signals = new Map<string, { accountId: string; device: string; network: string; firstSeen: Date; lastSeen: Date }>();
  private readonly decisions = new Map<string, { decision: RiskDecision; note: string | null; at: Date }>();

  async record(s: RiskSignal) {
    const device = s.device ?? NO_DEVICE;
    const key = `${s.accountId}|${device}|${s.network}`;
    const cur = this.signals.get(key);
    if (cur) cur.lastSeen = s.at;
    else this.signals.set(key, { accountId: s.accountId, device, network: s.network, firstSeen: s.at, lastSeen: s.at });
  }

  private accountsWhere(match: (x: { device: string; network: string }) => boolean, since: Date) {
    const first = new Map<string, number>();
    for (const x of this.signals.values()) {
      if (!match(x) || x.lastSeen < since) continue;
      const t = first.get(x.accountId);
      if (t === undefined || x.firstSeen.getTime() < t) first.set(x.accountId, x.firstSeen.getTime());
    }
    return [...first.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([id]) => id);
  }

  async accountsOnDevice(device: string, since: Date) {
    return this.accountsWhere((x) => x.device === device, since);
  }

  async accountsOnNetwork(network: string, since: Date) {
    return this.accountsWhere((x) => x.network === network, since);
  }

  async decision(accountId: string) {
    return this.decisions.get(accountId) ?? null;
  }

  async decide(accountId: string, decision: RiskDecision, note: string | null, at: Date) {
    this.decisions.set(accountId, { decision, note, at });
  }

  async sharedDevices(since: Date, minAccounts: number) {
    const devices = new Set([...this.signals.values()].filter((x) => x.device !== NO_DEVICE).map((x) => x.device));
    return [...devices]
      .map((device) => ({ device, accounts: this.accountsWhere((x) => x.device === device, since) }))
      .filter((d) => d.accounts.length >= minAccounts);
  }
}

type Db = ReturnType<typeof drizzle>;

export class PostgresRiskStore implements RiskStore {
  private readonly db: Db;

  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  async record(s: RiskSignal) {
    await this.db
      .insert(signalT)
      .values({ accountId: s.accountId, device: s.device ?? NO_DEVICE, network: s.network, firstSeen: s.at, lastSeen: s.at })
      .onConflictDoUpdate({
        target: [signalT.accountId, signalT.device, signalT.network],
        set: { lastSeen: sql`greatest(${signalT.lastSeen}, excluded.last_seen)` },
      });
  }

  /** Contas em ordem da primeira vez que apareceram ali (as primeiras ficam com a vaga). */
  private async accountsWhere(column: typeof signalT.device | typeof signalT.network, value: string, since: Date) {
    const rows = await this.db
      .select({ accountId: signalT.accountId, first: sql<Date>`min(${signalT.firstSeen})`.as('first') })
      .from(signalT)
      .where(and(eq(column, value), gte(signalT.lastSeen, since)))
      .groupBy(signalT.accountId)
      .orderBy(asc(sql`first`), asc(signalT.accountId));
    return rows.map((r) => r.accountId);
  }

  accountsOnDevice(device: string, since: Date) {
    return this.accountsWhere(signalT.device, device, since);
  }

  accountsOnNetwork(network: string, since: Date) {
    return this.accountsWhere(signalT.network, network, since);
  }

  async decision(accountId: string) {
    const [r] = await this.db.select().from(decisionT).where(eq(decisionT.accountId, accountId));
    return r ? { decision: r.decision as RiskDecision, note: r.note, at: r.at } : null;
  }

  async decide(accountId: string, decision: RiskDecision, note: string | null, at: Date) {
    await this.db
      .insert(decisionT)
      .values({ accountId, decision, note, at })
      .onConflictDoUpdate({ target: decisionT.accountId, set: { decision, note, at } });
  }

  async sharedDevices(since: Date, minAccounts: number) {
    const rows = await this.db
      .select({ device: signalT.device, accounts: sql<string[]>`array_agg(distinct ${signalT.accountId})` })
      .from(signalT)
      .where(and(ne(signalT.device, NO_DEVICE), gte(signalT.lastSeen, since)))
      .groupBy(signalT.device)
      .having(sql`count(distinct ${signalT.accountId}) >= ${minAccounts}`);
    return rows.map((r) => ({ device: r.device, accounts: r.accounts }));
  }
}
