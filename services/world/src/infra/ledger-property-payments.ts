import { AppError, forwardRequestId } from '@scc/shared';

import type { Property, PropertyClaim, PropertyPayments, PropertyWork, WorkKind } from '../domain/properties.js';

/**
 * Lançamento e sink de cada obra (doc 04 §7): reparo é "reparos"; upgrade, "upgrades de imóvel";
 * a regularização é taxa da Prefeitura; água e energia, "serviços".
 */
const WORK_LEDGER: Record<WorkKind, { kind: string; sink: string; label: string }> = {
  repair: { kind: 'property_repair', sink: 'repair', label: 'o reparo' },
  upgrade: { kind: 'property_upgrade', sink: 'construction', label: 'o upgrade' },
  regularize: { kind: 'property_regularization', sink: 'prefeitura', label: 'a regularização' },
  water: { kind: 'property_water', sink: 'utilities', label: 'a água' },
  power: { kind: 'property_power', sink: 'utilities', label: 'a energia' },
};

type Leg = { owner_type: string; owner_id: string; currency: 'THALER'; amount: string };

/**
 * Obra e renda dos imóveis no ledger do economy, em THALER (centavos). As chaves
 * são o imóvel e a coleta, então repetir nunca cobra nem paga duas vezes.
 */
export class LedgerPropertyPayments implements PropertyPayments {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async post(key: string, kind: string, refId: string, legs: Leg[], requestId?: string) {
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
        body: JSON.stringify({ kind, ref_type: 'property', ref_id: refId, legs }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AppError('ledger_unavailable', 'O ledger não respondeu.', 502);
    }
    if (response.ok) return;
    const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    return body?.error?.code ?? 'unknown';
  }

  async chargeBuild(p: Property, requestId?: string) {
    const amount = String(p.priceCents);
    const code = await this.post(
      `property-build:${p.id}`,
      'property_build',
      p.id,
      [
        { owner_type: 'player', owner_id: p.ownerAccountId, currency: 'THALER', amount: `-${amount}` },
        { owner_type: 'burn', owner_id: 'construction', currency: 'THALER', amount },
      ],
      requestId,
    );
    if (!code) return;
    if (code === 'insufficient_funds') throw new AppError('insufficient_thaler', 'THALER insuficiente para a obra.', 409);
    throw new AppError('ledger_unavailable', 'O ledger recusou o lançamento.', 502);
  }

  async chargeWork(w: PropertyWork, requestId?: string) {
    const amount = String(w.costCents);
    const { kind, sink, label } = WORK_LEDGER[w.kind];
    const code = await this.post(
      `property-work:${w.id}`,
      kind,
      w.propertyId,
      [
        { owner_type: 'player', owner_id: w.accountId, currency: 'THALER', amount: `-${amount}` },
        { owner_type: 'burn', owner_id: sink, currency: 'THALER', amount },
      ],
      requestId,
    );
    if (!code) return;
    if (code === 'insufficient_funds') {
      throw new AppError('insufficient_thaler', `THALER insuficiente para ${label}.`, 409);
    }
    throw new AppError('ledger_unavailable', 'O ledger recusou o lançamento.', 502);
  }

  async payIncome(c: PropertyClaim, requestId?: string) {
    const amount = String(c.amountCents);
    const code = await this.post(
      `property-income:${c.id}`,
      'property_income',
      c.propertyId,
      [
        { owner_type: 'pool', owner_id: 'p2e', currency: 'THALER', amount: `-${amount}` },
        { owner_type: 'player', owner_id: c.accountId, currency: 'THALER', amount },
      ],
      requestId,
    );
    if (!code) return;
    if (code === 'insufficient_funds') {
      throw new AppError('pool_empty', 'O pool P2E está sem saldo; a renda fica guardada e é paga depois.', 503);
    }
    throw new AppError('ledger_unavailable', 'O ledger recusou o lançamento.', 502);
  }
}
