import { AppError, forwardRequestId } from '@scc/shared';

import type { Auction, AuctionPayments } from '../domain/auctions.js';

/**
 * Leilão no ledger do economy, numa transação só: o lance sai do vencedor, a
 * dívida vai para `burn/tax` e o resto para o antigo dono. A chave leva o
 * leilão, o vencedor e o preço, então a mesma cobrança não acontece duas vezes.
 */
export class LedgerAuctionPayments implements AuctionPayments {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async settle(a: Auction, winner: string, priceCents: number, debtCents: number, requestId?: string) {
    const debt = Math.min(debtCents, priceCents);
    const rest = priceCents - debt;
    const legs = [
      { owner_type: 'player', owner_id: winner, currency: 'THALER', amount: `-${priceCents}` },
      ...(debt > 0 ? [{ owner_type: 'burn', owner_id: 'tax', currency: 'THALER', amount: String(debt) }] : []),
      ...(rest > 0 ? [{ owner_type: 'player', owner_id: a.sellerAccountId, currency: 'THALER', amount: String(rest) }] : []),
    ];
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}/internal/v1/ledger/transactions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-service-token': this.token,
          'idempotency-key': `auction:${a.id}:${winner}:${priceCents}`,
          ...forwardRequestId(requestId),
        },
        body: JSON.stringify({ kind: 'lot_auction', ref_type: 'auction', ref_id: a.id, legs }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AppError('ledger_unavailable', 'O ledger não respondeu.', 502);
    }
    if (response.ok) return;
    const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    if (body?.error?.code === 'insufficient_funds') {
      throw new AppError('insufficient_thaler', 'THALER insuficiente para o lance.', 409);
    }
    throw new AppError('ledger_unavailable', 'O ledger recusou o lançamento.', 502);
  }
}
