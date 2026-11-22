import { AppError } from '@scc/shared';

/**
 * Números públicos da cidade para o site (E4.5, trilha do site passo 6): o gateway junta o que o game-core
 * (avatares e acidentes de trabalho) e o world (lotes vendidos e impostos pagos) publicam em
 * `/v1/public/stats`. Guarda por 1 minuto: a home consulta a cada 60 s, e um serviço fora não derruba os
 * outros (o site usa o último número bom ou cai nos dados de exemplo).
 */
export interface PublicStats {
  avatars: number;
  lands: number;
  taxes: number;
  work_accidents: number;
  updated_at: string;
}

export function publicStatsSource(
  urls: { game: string | undefined; world: string | undefined },
  now: () => Date,
  fetchFn: typeof fetch = fetch,
  ttlMs = 60_000,
) {
  let cache: { at: number; body: PublicStats } | null = null;
  const get = async <T>(base: string, label: string): Promise<T> => {
    const r = await fetchFn(`${base.replace(/\/$/, '')}/v1/public/stats`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error(`${label} respondeu ${r.status}`);
    return (await r.json()) as T;
  };
  return async (): Promise<PublicStats> => {
    const t = now().getTime();
    if (cache && t - cache.at < ttlMs) return cache.body;
    if (!urls.game || !urls.world) {
      throw new AppError('stats_disabled', 'Números públicos desligados: defina GAME_CORE_URL e WORLD_URL.', 503);
    }
    try {
      const [g, w] = await Promise.all([
        get<{ avatars: number; work_accidents: number }>(urls.game, 'game-core'),
        get<{ lands: number; taxes: number }>(urls.world, 'world'),
      ]);
      const body: PublicStats = {
        avatars: Number(g.avatars),
        lands: Number(w.lands),
        taxes: Number(w.taxes),
        work_accidents: Number(g.work_accidents),
        updated_at: new Date(t).toISOString(),
      };
      cache = { at: t, body };
      return body;
    } catch (error) {
      // Serviço fora: o último número bom ainda vale (até 10 minutos), melhor que nada.
      if (cache && t - cache.at < 10 * ttlMs) return cache.body;
      throw new AppError('stats_unavailable', `Números públicos indisponíveis: ${(error as Error).message}`, 503);
    }
  };
}
