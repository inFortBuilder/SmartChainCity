import { describe, expect, it } from 'vitest';

import { HttpMetrics, JobRunner, jobLockKey, type LockPool } from '../src/index.js';

/** Pool falso com advisory locks de verdade entre "instâncias" (mesmo mapa de travas). */
function fakePostgres() {
  const held = new Map<string, number>();
  let nextSession = 1;
  const queries: string[] = [];
  const pool = (): LockPool => ({
    connect: async () => {
      const session = nextSession++;
      return {
        query: async (sql: string, params?: unknown[]) => {
          queries.push(sql);
          const key = String(params?.[0]);
          if (sql.includes('pg_try_advisory_lock')) {
            if (held.has(key) && held.get(key) !== session) return { rows: [{ ok: false }] };
            held.set(key, session);
            return { rows: [{ ok: true }] };
          }
          if (sql.includes('pg_advisory_unlock')) held.delete(key);
          return { rows: [] };
        },
        release: () => undefined,
      };
    },
  });
  return { pool, held, queries };
}

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

describe('JobRunner', () => {
  it('a chave da trava é estável e separa serviço e job', () => {
    expect(jobLockKey('world', 'tax.charge')).toBe(jobLockKey('world', 'tax.charge'));
    expect(jobLockKey('world', 'tax.charge')).not.toBe(jobLockKey('game-core', 'tax.charge'));
    expect(BigInt(jobLockKey('world', 'chain.sync'))).toBeLessThan(2n ** 63n);
  });

  it('roda, loga o que fez e conta no /metrics', async () => {
    const logs: string[] = [];
    const metrics = new HttpMetrics('world');
    const runner = new JobRunner({ service: 'world', metrics, log: { info: (m) => logs.push(m), error: (m) => logs.push(m) } });
    runner.add('tax.charge', 60_000, async () => '2 conta(s) nova(s)');
    expect(await runner.run('tax.charge')).toBe('ok');
    expect(logs).toEqual(['tax.charge: 2 conta(s) nova(s)']);
    const text = metrics.render();
    expect(text).toContain('job_runs_total{service="world",job="tax.charge",result="ok"} 1');
    expect(text).toMatch(/job_last_success_timestamp_seconds\{service="world",job="tax.charge"\} \d+/);
    await runner.stop();
  });

  it('erro não derruba o runner: conta como falha e guarda a mensagem', async () => {
    const errors: string[] = [];
    const runner = new JobRunner({ service: 'x', log: { info: () => {}, error: (m) => errors.push(m) } });
    let fail = true;
    runner.add('a', 60_000, async () => {
      if (fail) throw new Error('ledger fora');
    });
    expect(await runner.run('a')).toBe('failed');
    expect(runner.status()[0]).toMatchObject({ last_error: 'ledger fora', last_success_at: null });
    fail = false;
    expect(await runner.run('a')).toBe('ok');
    expect(runner.status()[0]).toMatchObject({ last_error: null, runs: { ok: 1, failed: 1 } });
    expect(errors).toEqual(['a falhou: ledger fora']);
    await runner.stop();
  });

  it('uma passada por vez no processo', async () => {
    const runner = new JobRunner({ service: 'x' });
    const gate = deferred();
    runner.add('lento', 60_000, () => gate.promise);
    const first = runner.run('lento');
    expect(await runner.run('lento')).toBe('busy');
    gate.resolve();
    expect(await first).toBe('ok');
  });

  it('com duas instâncias, só uma roda o job; a trava solta no fim', async () => {
    const pg = fakePostgres();
    const a = new JobRunner({ service: 'world', pool: pg.pool() });
    const b = new JobRunner({ service: 'world', pool: pg.pool() });
    const gate = deferred();
    let ran = 0;
    const fn = async () => {
      ran++;
      await gate.promise;
    };
    a.add('auctions.tick', 60_000, fn);
    b.add('auctions.tick', 60_000, fn);
    const first = a.run('auctions.tick');
    await new Promise((r) => setTimeout(r, 5));
    expect(await b.run('auctions.tick')).toBe('locked');
    gate.resolve();
    expect(await first).toBe('ok');
    expect(pg.held.size).toBe(0);
    expect(await b.run('auctions.tick')).toBe('ok');
    expect(ran).toBe(2);
  });

  it('job local roda em toda instância, sem trava', async () => {
    const pg = fakePostgres();
    const runner = new JobRunner({ service: 'world', pool: pg.pool() });
    runner.add('catalog.refresh', 60_000, async () => undefined, { local: true });
    expect(await runner.run('catalog.refresh')).toBe('ok');
    expect(pg.queries).toEqual([]);
  });

  it('stop espera a passada em andamento e não roda mais nada', async () => {
    const runner = new JobRunner({ service: 'x' });
    const gate = deferred();
    let done = false;
    runner.add('a', 60_000, async () => {
      await gate.promise;
      done = true;
    });
    const running = runner.run('a');
    const stopping = runner.stop();
    gate.resolve();
    await stopping;
    expect(done).toBe(true);
    expect(await running).toBe('ok');
    expect(await runner.run('a')).toBe('stopped');
  });

  it('nome repetido e intervalo inválido são erro de programação', () => {
    const runner = new JobRunner({ service: 'x' });
    runner.add('a', 1000, async () => undefined);
    expect(() => runner.add('a', 1000, async () => undefined)).toThrow(/repetido/);
    expect(() => runner.add('b', 0, async () => undefined)).toThrow(/Intervalo/);
    void runner.stop();
  });
});
