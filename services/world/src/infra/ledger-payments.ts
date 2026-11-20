import { AppError, forwardRequestId } from '@scc/shared';

import type { LandPayments, Purchase } from '../domain/lots.js';

/**
 * Cobra o lote no ledger do economy: SCITY do jogador para a Prefeitura
 * (`pool/treasury`, receita da venda primária, doc 04). As chaves são a
 * própria compra, então repetir a cobrança ou a devolução nunca dobra o valor.
 */
export class LedgerLandPayments implements LandPayments {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async post(key: string, kind: string, purchase: Purchase, fromPlayer: boolean, requestId?: string) {
    const amount = purchase.priceWei.toString();
    const player = { owner_type: 'player', owner_id: purchase.accountId, currency: 'SCITY' };
    const treasury = { owner_type: 'pool', owner_id: 'treasury', currency: 'SCITY' };
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}/internal/v1/ledger/transactions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-service-token': this.token,
          'idempotency-key': key,
          ...forwardRequestId(requestId),
        },
        body: JSON.stringify({
          kind,
          ref_type: 'lot_purchase',
          ref_id: purchase.id,
          legs: fromPlayer
            ? [
                { ...player, amount: `-${amount}` },
                { ...treasury, amount },
              ]
            : [
                { ...treasury, amount: `-${amount}` },
                { ...player, amount },
              ],
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AppError('ledger_unavailable', 'O ledger não respondeu.', 502);
    }
    if (response.ok) return;
    const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    if (body?.error?.code === 'insufficient_funds' && fromPlayer) {
      throw new AppError('insufficient_scity', 'SCITY insuficiente para este lote.', 409);
    }
    throw new AppError('ledger_unavailable', 'O ledger recusou o lançamento.', 502);
  }

  charge(purchase: Purchase, requestId?: string) {
    return this.post(`lot-buy:${purchase.id}`, 'lot_buy', purchase, true, requestId);
  }

  refund(purchase: Purchase, requestId?: string) {
    return this.post(`lot-refund:${purchase.id}`, 'lot_refund', purchase, false, requestId);
  }
}
