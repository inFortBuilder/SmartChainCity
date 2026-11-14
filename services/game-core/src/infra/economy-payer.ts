import { AppError, forwardRequestId } from '@scc/shared';

import type { HospitalPayer, HospitalStay } from '../domain/hospital.js';
import type { Meal, MealPayer } from '../domain/meal.js';
import type { Payer, Shift } from '../domain/shift.js';

/**
 * Lança no ledger do economy o que o game-core paga e cobra. A chave de
 * idempotência é a própria entidade (`shift:<id>`, `meal:<id>`, `hospital:<id>`): se a resposta
 * se perder no caminho e o lançamento for repetido, o ledger devolve a mesma
 * transação em vez de lançar duas vezes.
 */
export class EconomyPayer implements Payer, MealPayer, HospitalPayer {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  /** Lança; devolve o código de erro do ledger, ou null se entrou. */
  private async post(key: string, body: object, requestId?: string): Promise<string | null> {
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
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AppError('ledger_unavailable', 'O ledger não respondeu.', 502);
    }
    if (response.ok) return null;
    const answer = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    return answer?.error?.code ?? 'ledger_error';
  }

  /** Turno: sai do pool P2E e entra na conta do jogador. */
  async payShift(shift: Shift, amountCents: bigint, requestId?: string) {
    const error = await this.post(
      `shift:${shift.id}`,
      {
        kind: 'shift_pay',
        ref_type: 'work_shift',
        ref_id: shift.id,
        legs: [
          { owner_type: 'pool', owner_id: 'p2e', currency: 'THALER', amount: `-${amountCents}` },
          { owner_type: 'player', owner_id: shift.accountId, currency: 'THALER', amount: `${amountCents}` },
        ],
      },
      requestId,
    );
    if (error === null) return;
    if (error === 'insufficient_funds') {
      throw new AppError('pool_empty', 'O pool P2E está sem saldo para pagar o turno.', 503);
    }
    throw new AppError('ledger_unavailable', 'O ledger recusou o pagamento do turno.', 502);
  }

  /** Refeição: comida é sink (doc 04 §7), o THALER do jogador vai para a queima. */
  async chargeMeal(meal: Meal, requestId?: string) {
    const error = await this.post(
      `meal:${meal.id}`,
      {
        kind: 'meal_buy',
        ref_type: 'meal',
        ref_id: meal.id,
        legs: [
          { owner_type: 'player', owner_id: meal.accountId, currency: 'THALER', amount: `-${meal.priceCents}` },
          { owner_type: 'burn', owner_id: 'food', currency: 'THALER', amount: `${meal.priceCents}` },
        ],
      },
      requestId,
    );
    if (error === null) return;
    if (error === 'insufficient_funds') {
      throw new AppError('insufficient_thaler', 'THALER insuficiente para esta refeição.', 409);
    }
    throw new AppError('ledger_unavailable', 'O ledger recusou a cobrança da refeição.', 502);
  }

  /** Taxa do hospital: sink, como a comida. */
  async chargeHospital(stay: HospitalStay, requestId?: string) {
    const error = await this.post(
      `hospital:${stay.id}`,
      {
        kind: 'hospital_fee',
        ref_type: 'hospital_stay',
        ref_id: stay.id,
        legs: [
          { owner_type: 'player', owner_id: stay.accountId, currency: 'THALER', amount: `-${stay.feeCents}` },
          { owner_type: 'burn', owner_id: 'hospital', currency: 'THALER', amount: `${stay.feeCents}` },
        ],
      },
      requestId,
    );
    if (error === null) return;
    if (error === 'insufficient_funds') {
      throw new AppError('insufficient_thaler', 'THALER insuficiente para a taxa do hospital.', 409);
    }
    throw new AppError('ledger_unavailable', 'O ledger recusou a taxa do hospital.', 502);
  }
}
