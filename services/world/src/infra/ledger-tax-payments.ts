import { AppError, forwardRequestId } from '@scc/shared';

import { type TaxBill, type TaxPayments, totalOf } from '../domain/taxes.js';

/**
 * Impostos no ledger do economy: THALER do jogador para `burn/tax`. A chave leva
 * a conta e o total; a multa só entra depois de uma recusa definitiva, então o
 * mesmo total nunca é cobrado duas vezes.
 */
export class LedgerTaxPayments implements TaxPayments {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async pay(bill: TaxBill, requestId?: string) {
    const amount = String(totalOf(bill));
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}/internal/v1/ledger/transactions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-service-token': this.token,
          'idempotency-key': `tax:${bill.id}:${amount}`,
          ...forwardRequestId(requestId),
        },
        body: JSON.stringify({
          kind: bill.kind === 'iptu' ? 'tax_iptu' : 'tax_pt',
          ref_type: 'tax_bill',
          ref_id: bill.id,
          legs: [
            { owner_type: 'player', owner_id: bill.accountId, currency: 'THALER', amount: `-${amount}` },
            { owner_type: 'burn', owner_id: 'tax', currency: 'THALER', amount },
          ],
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AppError('ledger_unavailable', 'O ledger não respondeu.', 502);
    }
    if (response.ok) return;
    const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    if (body?.error?.code === 'insufficient_funds') {
      throw new AppError('insufficient_thaler', 'THALER insuficiente para o imposto.', 409);
    }
    throw new AppError('ledger_unavailable', 'O ledger recusou o lançamento.', 502);
  }
}
