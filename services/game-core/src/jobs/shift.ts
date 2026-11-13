import type { ShiftStore } from '../domain/shift.js';

/**
 * Job `shift.complete` (trilha do backend): conclui os turnos vencidos, mesmo
 * com o cliente fechado (E1.4). O resultado sai da semente guardada no começo,
 * então concluir agora ou daqui a uma hora dá o mesmo valor.
 */
export async function completeShifts(store: ShiftStore, now: Date, batch = 200): Promise<number> {
  let total = 0;
  for (;;) {
    const done = await store.completeDue(now, batch);
    total += done;
    if (done < batch) return total;
  }
}

/** Roda no próprio processo, como o job de queda (fila do BullMQ quando houver Redis). */
export function scheduleShifts(
  store: ShiftStore,
  everyMs: number,
  log: (msg: string) => void,
  now: () => Date = () => new Date(),
) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const n = await completeShifts(store, now());
      if (n) log(`shift.complete: ${n} turno(s) concluído(s)`);
    } catch (error) {
      log(`shift.complete falhou: ${(error as Error).message}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, everyMs);
  timer.unref();
  return { tick, stop: () => clearInterval(timer) };
}
