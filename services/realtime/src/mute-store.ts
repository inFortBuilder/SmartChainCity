import type { Pool } from 'pg';

/**
 * Silenciamentos guardados em banco (doc 10, moderação do chat). Sem banco, eles moram só na memória do
 * processo: reiniciar o realtime soltava todo mundo, e outro processo (outro shard) não sabia do silêncio.
 * Com `DATABASE_URL`, cada silenciamento vira uma linha; o processo carrega os vigentes ao subir e busca os
 * novos de tempos em tempos. As linhas também servem de registro para a moderação (motivo e quando).
 */
export interface Mute {
  account: string;
  until: Date;
  reason: 'violations' | 'reports';
}

export interface MuteStore {
  save(m: Mute): Promise<void>;
  /** Os que ainda valem, gravados depois da linha `afterId` (null: todos). O id é o cursor exato. */
  active(now: Date, afterId: number | null): Promise<(Mute & { id: number; createdAt: Date })[]>;
}

/** Cria o esquema e a tabela (idempotente). O `db:migrate` e a subida do servidor chamam. */
export async function migrateMutes(pool: Pick<Pool, 'query'>) {
  await pool.query('CREATE SCHEMA IF NOT EXISTS realtime');
  await pool.query(`CREATE TABLE IF NOT EXISTS realtime.mute (
    id bigserial PRIMARY KEY,
    account_id text NOT NULL,
    until timestamptz NOT NULL,
    reason text NOT NULL CHECK (reason IN ('violations', 'reports')),
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS mute_until_idx ON realtime.mute (until)');
}

export class PostgresMuteStore implements MuteStore {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async save(m: Mute) {
    await this.pool.query('INSERT INTO realtime.mute (account_id, until, reason) VALUES ($1, $2, $3)', [m.account, m.until, m.reason]);
  }

  async active(now: Date, afterId: number | null) {
    const r = await this.pool.query<{ id: string; account_id: string; until: Date; reason: Mute['reason']; created_at: Date }>(
      `SELECT id, account_id, until, reason, created_at FROM realtime.mute
        WHERE until > $1 AND ($2::bigint IS NULL OR id > $2) ORDER BY id`,
      [now, afterId],
    );
    return r.rows.map((x) => ({ id: Number(x.id), account: x.account_id, until: x.until, reason: x.reason, createdAt: x.created_at }));
  }
}

/** Em memória (testes): o mesmo contrato do Postgres. */
export class MemoryMuteStore implements MuteStore {
  readonly rows: (Mute & { id: number; createdAt: Date })[] = [];
  constructor(private readonly now: () => Date = () => new Date()) {}
  async save(m: Mute) {
    this.rows.push({ ...m, id: this.rows.length + 1, createdAt: this.now() });
  }
  async active(now: Date, afterId: number | null) {
    return this.rows.filter((r) => r.until > now && (afterId === null || r.id > afterId)).map((r) => ({ ...r }));
  }
}
