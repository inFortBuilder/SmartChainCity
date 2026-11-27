import type { AvatarStore } from '../domain/avatar.js';

/**
 * Job `attributes.decay` (trilha do backend: a cada 15 min, em lote). Grava a
 * queda dos atributos de quem tem queda pendente, em lotes, até não sobrar
 * ninguém. Rodar duas vezes no mesmo instante não derruba nada a mais: a
 * queda é calculada pelo instante de referência, não pela vez que o job roda.
 */
export async function runDecay(store: AvatarStore, now: Date, batch = 500): Promise<number> {
  let total = 0;
  for (;;) {
    const done = await store.applyDecay(now, batch);
    total += done;
    if (done < batch) return total;
  }
}
