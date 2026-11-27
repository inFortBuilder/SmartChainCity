import { createHash } from 'node:crypto';

/**
 * Jobs periódicos dos serviços (trilha do backend; doc 06 §5).
 *
 * Cada job roda num intervalo fixo dentro do processo, mas com mais de uma instância do serviço só uma
 * roda cada passada: antes de rodar, o job pega um *advisory lock* do Postgres com a chave do serviço e
 * do nome. Quem não pega pula a vez (`locked`). Sem Postgres (modo memória), roda sem trava, como antes.
 *
 * Por que não BullMQ: ele pede Redis, e o MVP roda na máquina, sem serviço a mais. Os jobs daqui são
 * varreduras idempotentes ("resolve o que venceu"), então uma trava por job basta. Uma fila com
 * mensagens por item entra quando houver trabalho que não seja varredura.
 *
 * - Uma passada por vez no processo: se a anterior ainda roda, a nova pula (`busy`).
 * - `local: true` para o que é do próprio processo (cache de catálogo, cotação em memória): roda em
 *   todas as instâncias, sem trava.
 * - Métricas no /metrics: `job_runs_total{job,result}`, `job_last_success_timestamp_seconds{job}` e
 *   `job_last_duration_seconds{job}`. O alerta de job parado olha a última passada boa.
 * - `stop()` para os timers e espera as passadas em andamento (desligamento limpo).
 *
 * A trava é de sessão: segura uma conexão do pool enquanto o job roda. Com PgBouncer, use o modo
 * `session` para a conexão dos serviços.
 */

/** O mínimo do `pg.Pool` que a trava usa (sem depender do pacote aqui). */
export interface LockPool {
  connect(): Promise<{ query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>; release(err?: boolean | Error): void }>;
}

/** O mínimo das métricas do serviço (`HttpMetrics`). */
export interface JobMetrics {
  inc(name: string, help: string, labels?: Record<string, string>, by?: number): void;
  set(name: string, help: string, labels: Record<string, string>, value: number): void;
}

export type JobResult = 'ok' | 'failed' | 'busy' | 'locked' | 'stopped';

/** O job devolve uma linha para o log quando fez algo (ou nada, quando não havia o que fazer). */
export type JobFn = () => Promise<string | void | null | undefined>;

export interface JobOptions {
  /** Roda em toda instância, sem trava (estado do próprio processo). */
  local?: boolean;
  /** Roda uma vez logo no começo, além do intervalo. */
  runAtStart?: boolean;
}

export interface JobStatus {
  name: string;
  every_seconds: number;
  local: boolean;
  running: boolean;
  runs: Record<JobResult, number>;
  last_started_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
}

interface Job extends JobOptions {
  name: string;
  everyMs: number;
  fn: JobFn;
  timer: ReturnType<typeof setInterval> | null;
  current: Promise<JobResult> | null;
  runs: Record<JobResult, number>;
  lastStartedAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
}

export interface JobRunnerOptions {
  service: string;
  pool?: LockPool | null;
  log?: { info(msg: string): void; error(msg: string): void };
  metrics?: JobMetrics | null;
  now?: () => Date;
}

/** Chave do advisory lock: 64 bits do sha-256 de `scc-job:<serviço>:<job>`, como texto (bigint). */
export function jobLockKey(service: string, name: string): string {
  return createHash('sha256').update(`scc-job:${service}:${name}`).digest().readBigInt64BE(0).toString();
}

export class JobRunner {
  private readonly jobs = new Map<string, Job>();
  private stopped = false;
  private readonly now: () => Date;

  constructor(private readonly opts: JobRunnerOptions) {
    this.now = opts.now ?? (() => new Date());
  }

  /** Registra e agenda um job. O nome segue o das docs (`shift.complete`, `tax.charge`...). */
  add(name: string, everyMs: number, fn: JobFn, options: JobOptions = {}) {
    if (this.jobs.has(name)) throw new Error(`Job repetido: ${name}`);
    if (!(everyMs > 0)) throw new Error(`Intervalo inválido para ${name}: ${everyMs}`);
    const job: Job = {
      name,
      everyMs,
      fn,
      ...options,
      timer: null,
      current: null,
      runs: { ok: 0, failed: 0, busy: 0, locked: 0, stopped: 0 },
      lastStartedAt: null,
      lastSuccessAt: null,
      lastError: null,
    };
    this.jobs.set(name, job);
    if (!this.stopped) {
      job.timer = setInterval(() => void this.run(name), everyMs);
      job.timer.unref();
      if (options.runAtStart) void this.run(name);
    }
    return this;
  }

  /** Uma passada agora (os testes e o `runAtStart` usam). */
  async run(name: string): Promise<JobResult> {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Job desconhecido: ${name}`);
    if (this.stopped) return this.count(job, 'stopped');
    if (job.current) return this.count(job, 'busy');
    job.current = this.pass(job);
    try {
      return await job.current;
    } finally {
      job.current = null;
    }
  }

  private async pass(job: Job): Promise<JobResult> {
    const pool = job.local ? null : this.opts.pool;
    const client = pool ? await pool.connect().catch((e: Error) => e) : null;
    if (client instanceof Error) return this.fail(job, client, Date.now());
    const key = jobLockKey(this.opts.service, job.name);
    let locked = false;
    try {
      if (client) {
        const r = await client.query('SELECT pg_try_advisory_lock($1::bigint) AS ok', [key]);
        if (r.rows[0]?.ok !== true) return this.count(job, 'locked');
        locked = true;
      }
      const t0 = Date.now();
      job.lastStartedAt = this.now();
      try {
        const msg = await job.fn();
        job.lastSuccessAt = this.now();
        job.lastError = null;
        if (msg) this.opts.log?.info(`${job.name}: ${msg}`);
        this.opts.metrics?.set('job_last_success_timestamp_seconds', 'Hora da última passada boa do job', { job: job.name }, job.lastSuccessAt.getTime() / 1000);
        this.opts.metrics?.set('job_last_duration_seconds', 'Duração da última passada do job', { job: job.name }, (Date.now() - t0) / 1000);
        return this.count(job, 'ok');
      } catch (error) {
        return this.fail(job, error as Error, t0);
      }
    } finally {
      if (client) {
        let broken = false;
        if (locked) await client.query('SELECT pg_advisory_unlock($1::bigint)', [key]).catch(() => (broken = true));
        // Conexão que não destravou volta ao pool como quebrada: o Postgres solta a trava ao fechar.
        client.release(broken || undefined);
      }
    }
  }

  private fail(job: Job, error: Error, t0: number): JobResult {
    job.lastError = error.message;
    this.opts.log?.error(`${job.name} falhou: ${error.message}`);
    this.opts.metrics?.set('job_last_duration_seconds', 'Duração da última passada do job', { job: job.name }, (Date.now() - t0) / 1000);
    return this.count(job, 'failed');
  }

  private count(job: Job, result: JobResult): JobResult {
    job.runs[result]++;
    this.opts.metrics?.inc('job_runs_total', 'Passadas dos jobs, por resultado', { job: job.name, result });
    return result;
  }

  status(): JobStatus[] {
    return [...this.jobs.values()].map((j) => ({
      name: j.name,
      every_seconds: j.everyMs / 1000,
      local: Boolean(j.local),
      running: j.current !== null,
      runs: { ...j.runs },
      last_started_at: j.lastStartedAt?.toISOString() ?? null,
      last_success_at: j.lastSuccessAt?.toISOString() ?? null,
      last_error: j.lastError,
    }));
  }

  /** Para os timers e espera o que está rodando. Depois disso, nada mais roda. */
  async stop() {
    this.stopped = true;
    for (const j of this.jobs.values()) if (j.timer) clearInterval(j.timer);
    await Promise.allSettled([...this.jobs.values()].map((j) => j.current).filter(Boolean));
  }
}
