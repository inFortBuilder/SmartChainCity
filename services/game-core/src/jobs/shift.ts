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
