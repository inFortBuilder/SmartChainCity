import { AppError, forwardRequestId } from '@scc/shared';

import type { HospitalPayer, HospitalStay } from '../domain/hospital.js';
import { type Meal, type MealPayer, isLeisure, isMedicine, isPack, isPetShop, isSchool } from '../domain/meal.js';
import { feeSplit } from '../domain/leisure.js';
import type { Championship, ChampionshipPayer, ChampionshipResult, Member } from '../domain/championship.js';
import type { Payer, Shift } from '../domain/shift.js';

/**
 * Lança no ledger do economy o que o game-core paga e cobra. A chave de
 * idempotência é a própria entidade (`shift:<id>`, `meal:<id>`, `hospital:<id>`): se a resposta
 * se perder no caminho e o lançamento for repetido, o ledger devolve a mesma
 * transação em vez de lançar duas vezes.
 */
export class EconomyPayer implements Payer, MealPayer, HospitalPayer, ChampionshipPayer {
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

  /** Refeição ou remédio: os dois são sink (doc 04 §7), o THALER do jogador vai para a queima. */
  async chargeMeal(meal: Meal, requestId?: string) {
    if (isLeisure(meal)) return this.chargeLeisure(meal, requestId);
    const medicine = isMedicine(meal);
    const petShop = isPetShop(meal);
    const school = isSchool(meal);
    const error = await this.post(
      `meal:${meal.id}`,
      {
        kind: school ? 'school_buy' : petShop ? 'petshop_buy' : medicine ? 'medicine_buy' : isPack(meal) ? 'pack_buy' : 'meal_buy',
        ref_type: 'meal',
        ref_id: meal.id,
        legs: [
          { owner_type: 'player', owner_id: meal.accountId, currency: 'THALER', amount: `-${meal.priceCents}` },
          { owner_type: 'burn', owner_id: school ? 'school' : petShop ? 'petshop' : medicine ? 'pharmacy' : 'food', currency: 'THALER', amount: `${meal.priceCents}` },
        ],
      },
      requestId,
    );
    if (error === null) return;
    if (error === 'insufficient_funds') {
      throw new AppError('insufficient_thaler', `THALER insuficiente para ${school ? 'a escola' : petShop ? 'o Pet Shop' : medicine ? 'o remédio' : isPack(meal) ? 'o pacote' : 'esta refeição'}.`, 409);
    }
    throw new AppError('ledger_unavailable', 'O ledger recusou a cobrança.', 502);
  }

  /**
   * Entrada de um negócio de lazer (E3.3): a maior parte vai para o dono e o resto para a
   * queima (taxa da Prefeitura). No negócio próprio a entrada é 0 e nada é lançado.
   */
  private async chargeLeisure(meal: Meal, requestId?: string) {
    const owner = meal.effects.leisure?.ownerAccountId;
    if (meal.priceCents <= 0n || !owner) return;
    const split = feeSplit(meal.priceCents);
    const legs = [
      { owner_type: 'player', owner_id: meal.accountId, currency: 'THALER', amount: `-${meal.priceCents}` },
      { owner_type: 'player', owner_id: owner, currency: 'THALER', amount: `${split.owner}` },
      ...(split.burn > 0n ? [{ owner_type: 'burn', owner_id: 'leisure', currency: 'THALER', amount: `${split.burn}` }] : []),
    ];
    const error = await this.post(`meal:${meal.id}`, { kind: 'leisure_fee', ref_type: 'meal', ref_id: meal.id, legs }, requestId);
    if (error === null) return;
    if (error === 'insufficient_funds') throw new AppError('insufficient_thaler', 'THALER insuficiente para a entrada.', 409);
    throw new AppError('ledger_unavailable', 'O ledger recusou a cobrança.', 502);
  }

  /** Inscrição no campeonato de botão (E3.3): do jogador para o escrow do campeonato. */
  async chargeEntry(m: Member, requestId?: string) {
    const error = await this.post(
      `championship-entry:${m.championshipId}:${m.accountId}`,
      {
        kind: 'championship_entry',
        ref_type: 'championship',
        ref_id: m.championshipId,
        legs: [
          { owner_type: 'player', owner_id: m.accountId, currency: 'THALER', amount: `-${m.feeCents}` },
          { owner_type: 'escrow', owner_id: `championship-${m.championshipId}`, currency: 'THALER', amount: `${m.feeCents}` },
        ],
      },
      requestId,
    );
    if (error === null) return;
    if (error === 'insufficient_funds') throw new AppError('insufficient_thaler', 'THALER insuficiente para a inscrição.', 409);
    throw new AppError('ledger_unavailable', 'O ledger recusou a inscrição.', 502);
  }

  /** Disputa: prêmios, devoluções e queima saem do escrow numa transação só. */
  async payOut(c: Championship, result: ChampionshipResult, requestId?: string) {
    const pool = BigInt(result.poolCents);
    if (pool === 0n) return;
    // Uma perna por conta (a mesma conta não aparece duas vezes).
    const byAccount = new Map<string, bigint>();
    for (const p of result.payouts) byAccount.set(p.accountId, (byAccount.get(p.accountId) ?? 0n) + BigInt(p.cents));
    const burn = BigInt(result.burnCents);
    const legs = [
      { owner_type: 'escrow', owner_id: `championship-${c.id}`, currency: 'THALER', amount: `-${pool}` },
      ...[...byAccount].filter(([, v]) => v > 0n).map(([id, v]) => ({ owner_type: 'player', owner_id: id, currency: 'THALER', amount: `${v}` })),
      ...(burn > 0n ? [{ owner_type: 'burn', owner_id: 'championship', currency: 'THALER', amount: `${burn}` }] : []),
    ];
    const error = await this.post(
      `championship-payout:${c.id}`,
      { kind: 'championship_payout', ref_type: 'championship', ref_id: c.id, legs },
      requestId,
    );
    if (error !== null) throw new AppError('ledger_unavailable', 'O ledger recusou o pagamento do campeonato.', 502);
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
