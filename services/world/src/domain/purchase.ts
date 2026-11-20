import { AppError } from '@scc/shared';

import { type LandPayments, type Purchase, RESERVATION_MS, type WorldStore, priceOf } from './lots.js';

/**
 * Compra de lote em três passos, sem nunca cobrar sem entregar:
 *
 *   1. reserva  — trava o lote no world e fixa o preço;
 *   2. cobrança — SCITY do jogador para a Prefeitura no ledger, com a chave
 *                 `lot-buy:<compra>`: repetir nunca cobra duas vezes;
 *   3. posse    — o lote passa ao comprador.
 *
 * Se a cobrança for recusada (saldo), a reserva é desfeita. Se a reserva se
 * perdeu antes da posse, o valor volta (`lot-refund:<compra>`). Se a resposta
 * do ledger se perder, a compra fica pendente e o job `purchases.settle`
 * refaz os passos 2 e 3: como a cobrança é idempotente, o resultado é o mesmo.
 */
export async function settlePurchase(store: WorldStore, payments: LandPayments, purchase: Purchase, now: Date) {
  try {
    await payments.charge(purchase);
  } catch (error) {
    if ((error as AppError).code === 'insufficient_scity') await store.fail(purchase.id, 'failed');
    throw error;
  }
  if (await store.confirm(purchase.id, now)) return { ...purchase, status: 'paid' as const };
  await payments.refund(purchase);
  await store.fail(purchase.id, 'refunded');
  throw new AppError('reservation_lost', 'A reserva venceu e o lote foi para outro jogador; o valor foi devolvido.', 409);
}

export async function buyLot(
  store: WorldStore,
  payments: LandPayments,
  input: { city: string; lotId: number; accountId: string; scityUsd: number },
  now: () => Date,
) {
  const purchase = await store.reserve(input.city, input.lotId, input.accountId, now(), (lot, city) => {
    const zone = city.zones.find((z) => z.key === lot.zone);
    if (!zone) throw new AppError('invalid_zone', 'Zona do lote não existe.', 500);
    return priceOf(lot.areaM2, zone, input.scityUsd);
  });
  if (purchase.status === 'paid') return purchase;
  return settlePurchase(store, payments, purchase, now());
}

/** Job `purchases.settle`: resolve compras que ficaram pendentes além da reserva. */
export async function settleStale(store: WorldStore, payments: LandPayments, now: Date, limit = 50) {
  const stale = await store.stalePending(new Date(now.getTime() - RESERVATION_MS), limit);
  let settled = 0;
  for (const purchase of stale) {
    try {
      await settlePurchase(store, payments, purchase, now);
    } catch {
      // Recusada, devolvida ou ledger fora: o estado já ficou certo, ou tenta de novo na próxima.
    }
    settled++;
  }
  return settled;
}
