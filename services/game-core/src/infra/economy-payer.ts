import { AppError, forwardRequestId } from '@scc/shared';

import type { Payer, Shift } from '../domain/shift.js';

/**
 * Paga o turno pelo ledger do economy: sai do pool P2E e entra na conta do
 * jogador. A chave de idempotência é o próprio turno (`shift:<id>`): se a
 * resposta se perder no caminho e o pagamento for repetido, o ledger devolve a
 * mesma transação em vez de pagar duas vezes.
 */
export class EconomyPayer implements Payer {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async payShift(shift: Shift, amountCents: bigint, requestId?: string) {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}/internal/v1/ledger/transactions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-service-token': this.token,
          'idempotency-key': `shift:${shift.id}`,
          ...forwardRequestId(requestId),
        },
        body: JSON.stringify({
          kind: 'shift_pay',
          ref_type: 'work_shift',
          ref_id: shift.id,
          legs: [
            { owner_type: 'pool', owner_id: 'p2e', currency: 'THALER', amount: `-${amountCents}` },
            { owner_type: 'player', owner_id: shift.accountId, currency: 'THALER', amount: `${amountCents}` },
          ],
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AppError('ledger_unavailable', 'O ledger não respondeu ao pagamento.', 502);
    }
    if (response.ok) return;
    const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    if (body?.error?.code === 'insufficient_funds') {
      throw new AppError('pool_empty', 'O pool P2E está sem saldo para pagar o turno.', 503);
    }
    throw new AppError('ledger_unavailable', 'O ledger recusou o pagamento do turno.', 502);
  }
}
