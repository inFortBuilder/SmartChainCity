import { describe, expect, it } from 'vitest';

import { publicStatsSource } from '../src/public-stats.js';

const T0 = new Date('2026-11-22T12:00:00Z');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('números públicos da cidade (site)', () => {
  it('junta game-core e world, guarda 1 minuto e segura o último número se um serviço cair', async () => {
    let clock = T0;
    let calls = 0;
    let worldUp = true;
    const fetchFn = (async (url: string) => {
      calls++;
      if (url.startsWith('http://game')) return json({ avatars: 12, work_accidents: 3 });
      return worldUp ? json({ lands: 7, taxes: 450 }) : json({}, 500);
    }) as unknown as typeof fetch;
    const stats = publicStatsSource({ game: 'http://game/', world: 'http://world' }, () => clock, fetchFn);

    expect(await stats()).toEqual({ avatars: 12, lands: 7, taxes: 450, work_accidents: 3, updated_at: T0.toISOString() });
    clock = new Date(T0.getTime() + 30_000);
    await stats();
    expect(calls).toBe(2);

    // O world caiu: até 10 minutos, vale o último número bom; depois, 503.
    worldUp = false;
    clock = new Date(T0.getTime() + 61_000);
    expect((await stats()).lands).toBe(7);
    clock = new Date(T0.getTime() + 11 * 60_000);
    await expect(stats()).rejects.toMatchObject({ code: 'stats_unavailable', status: 503 });
  });

  it('sem as URLs, desligado', async () => {
    const stats = publicStatsSource({ game: undefined, world: 'http://world' }, () => T0);
    await expect(stats()).rejects.toMatchObject({ code: 'stats_disabled' });
  });
});
