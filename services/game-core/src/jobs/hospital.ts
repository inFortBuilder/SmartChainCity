import { AppError } from '@scc/shared';

import type { HospitalPayer, HospitalStay, HospitalStore } from '../domain/hospital.js';

/**
 * Cobra a taxa de uma internação. Sem THALER, a taxa fica perdoada (premissa
 * do doc do domínio); ledger fora, ela continua `pending` e a próxima passada
 * tenta de novo. A chave `hospital:<id>` impede cobrar duas vezes.
 */
export async function chargeStay(store: HospitalStore, payer: HospitalPayer, stay: HospitalStay, requestId?: string) {
  if (stay.feeStatus !== 'pending') return stay.feeStatus;
  try {
    await payer.chargeHospital(stay, requestId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'insufficient_thaler') {
      await store.settleFee(stay.id, 'waived');
      return 'waived';
    }
    throw error;
  }
  await store.settleFee(stay.id, 'paid');
  return 'paid';
}

/**
 * Job `hospital.admit`: interna em lotes quem chegou a saúde 0 ou energia 0
 * (inclusive quem zerou a energia num turno que acabou) e cobra as taxas que
 * ficaram para trás. Sem ledger, só interna: a taxa espera.
 */
export async function runHospital(store: HospitalStore, payer: HospitalPayer | null, now: Date, batch = 200) {
  let admitted = 0;
  for (;;) {
    const created = await store.admitDue(now, batch);
    admitted += created.length;
    if (created.length < batch) break;
  }
  let charged = 0;
  if (payer) {
    for (const stay of await store.pendingFees(batch)) {
      try {
        await chargeStay(store, payer, stay);
        charged++;
      } catch {
        // Ledger fora: para aqui e tenta tudo de novo na próxima passada.
        break;
      }
    }
  }
  return { admitted, charged };
}

/** Roda no próprio processo, como os outros jobs (fila do BullMQ quando houver Redis). */
export function scheduleHospital(
  store: HospitalStore,
  payer: HospitalPayer | null,
  everyMs: number,
  log: (msg: string) => void,
  now: () => Date = () => new Date(),
) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { admitted, charged } = await runHospital(store, payer, now());
      if (admitted || charged) log(`hospital.admit: ${admitted} internação(ões), ${charged} taxa(s) acertada(s)`);
    } catch (error) {
      log(`hospital.admit falhou: ${(error as Error).message}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, everyMs);
  timer.unref();
  return { tick, stop: () => clearInterval(timer) };
}
