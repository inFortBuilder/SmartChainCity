import { AppError, forwardRequestId } from '@scc/shared';

import type { Building, OutorgaPayments } from '../domain/buildings.js';

/**
 * Outorga onerosa no ledger do economy: SCITY do jogador para a Prefeitura
 * (`pool/treasury`, doc 13 §4.1). A chave é o prédio: repetir nunca cobra duas vezes.
 */
export class LedgerOutorgaPayments implements OutorgaPayments {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async chargeOutorga(b: Building, requestId?: string) {
    const amount = b.outorgaWei.toString();
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}/internal/v1/ledger/transactions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-service-token': this.token,
          'idempotency-key': `building-outorga:${b.id}`,
          ...forwardRequestId(requestId),
        },
        body: JSON.stringify({
          kind: 'building_outorga',
          ref_type: 'building',
          ref_id: b.id,
          legs: [
            { owner_type: 'player', owner_id: b.ownerAccountId, currency: 'SCITY', amount: `-${amount}` },
            { owner_type: 'pool', owner_id: 'treasury', currency: 'SCITY', amount },
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
      throw new AppError('insufficient_scity', 'SCITY insuficiente para a outorga onerosa.', 409);
    }
    throw new AppError('ledger_unavailable', 'O ledger recusou o lançamento.', 502);
  }
}
