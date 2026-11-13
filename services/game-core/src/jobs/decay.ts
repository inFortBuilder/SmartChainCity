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

/**
 * Agenda o job no próprio processo. Serve para uma instância; com várias, o
 * `SKIP LOCKED` do Postgres já impede trabalho dobrado, e a fila do BullMQ
 * (trilha do backend) entra quando houver Redis no ambiente.
 */
export function scheduleDecay(
  store: AvatarStore,
  everyMs: number,
  log: (msg: string) => void,
  now: () => Date = () => new Date(),
) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const n = await runDecay(store, now());
      if (n) log(`attributes.decay: ${n} avatar(es) atualizado(s)`);
    } catch (error) {
      log(`attributes.decay falhou: ${(error as Error).message}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, everyMs);
  timer.unref();
  return { tick, stop: () => clearInterval(timer) };
}
