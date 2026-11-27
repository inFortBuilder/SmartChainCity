import { AppError, forwardRequestId } from '@scc/shared';

import { type UnitLease, type UnitPayments, type UnitSale, leaseAmount, leaseSplit, saleSplit } from '../domain/units.js';

type Leg = { owner_type: string; owner_id: string; currency: 'THALER'; amount: string };

/**
 * Venda e aluguel das unidades no ledger do economy, em THALER (centavos). As chaves são a venda e o
 * aluguel: repetir nunca cobra duas vezes.
 */
export class LedgerUnitPayments implements UnitPayments {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async post(key: string, kind: string, refId: string, legs: Leg[], what: string, requestId?: string) {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}/internal/v1/ledger/transactions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-service-token': this.token, 'idempotency-key': key, ...forwardRequestId(requestId) },
        body: JSON.stringify({ kind, ref_type: 'unit', ref_id: refId, legs }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AppError('ledger_unavailable', 'O ledger não respondeu.', 502);
    }
    if (response.ok) return;
    const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    if (body?.error?.code === 'insufficient_funds') throw new AppError('insufficient_thaler', `THALER insuficiente para ${what}.`, 409);
    throw new AppError('ledger_unavailable', 'O ledger recusou o lançamento.', 502);
  }

  async chargeSale(s: UnitSale, requestId?: string) {
    const split = saleSplit(s);
    const legs: Leg[] = [
      { owner_type: 'player', owner_id: s.buyerAccountId, currency: 'THALER', amount: `-${s.priceCents}` },
      { owner_type: 'player', owner_id: s.sellerAccountId, currency: 'THALER', amount: `${split.seller}` },
    ];
    if (split.royalty > 0) legs.push({ owner_type: 'player', owner_id: s.builderAccountId, currency: 'THALER', amount: `${split.royalty}` });
    if (split.fee > 0) legs.push({ owner_type: 'burn', owner_id: 'platform', currency: 'THALER', amount: `${split.fee}` });
    await this.post(`unit-sale:${s.id}`, s.primary ? 'unit_primary_sale' : 'unit_resale', s.unitId, legs, 'a unidade', requestId);
  }

  async chargeLease(l: UnitLease, requestId?: string) {
    const amount = leaseAmount(l);
    const split = leaseSplit(amount);
    const legs: Leg[] = [
      { owner_type: 'player', owner_id: l.tenantAccountId, currency: 'THALER', amount: `-${amount}` },
      { owner_type: 'player', owner_id: l.ownerAccountId, currency: 'THALER', amount: `${split.owner}` },
    ];
    if (split.fee > 0) legs.push({ owner_type: 'burn', owner_id: 'rent', currency: 'THALER', amount: `${split.fee}` });
    await this.post(`unit-lease:${l.id}`, 'unit_rent', l.unitId, legs, 'o aluguel', requestId);
  }
}
