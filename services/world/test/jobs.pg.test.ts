import { JobRunner } from '@scc/shared';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * A trava dos jobs no Postgres de verdade: duas "instâncias" do world (dois pools) e o mesmo job.
 * Só uma roda a passada; a outra pula (`locked`) e roda depois que a trava solta.
 */
const url = process.env.TEST_DATABASE_URL;
const pools = url ? [new Pool({ connectionString: url, max: 3 }), new Pool({ connectionString: url, max: 3 })] : [];
afterAll(async () => {
  await Promise.all(pools.map((p) => p.end()));
});

describe.skipIf(!url)('JobRunner com Postgres', () => {
  it('com duas instâncias, só uma roda cada passada', async () => {
    const [a, b] = pools.map((pool) => new JobRunner({ service: 'world-teste', pool }));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let ran = 0;
    const fn = async () => {
      ran++;
      await gate;
    };
    a!.add('trava.teste', 3_600_000, fn);
    b!.add('trava.teste', 3_600_000, fn);

    const first = a!.run('trava.teste');
    // Espera a instância A pegar a trava.
    for (let i = 0; i < 100 && ran === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(await b!.run('trava.teste')).toBe('locked');
    release();
    expect(await first).toBe('ok');
    expect(await b!.run('trava.teste')).toBe('ok');
    expect(ran).toBe(2);

    // Jobs com nomes diferentes não se travam.
    let other = 0;
    b!.add('outra.trava', 3_600_000, async () => void other++);
    a!.add('mais.uma', 3_600_000, async () => {
      expect(await b!.run('outra.trava')).toBe('ok');
    });
    expect(await a!.run('mais.uma')).toBe('ok');
    expect(other).toBe(1);
    await Promise.all([a!.stop(), b!.stop()]);
  });
});
