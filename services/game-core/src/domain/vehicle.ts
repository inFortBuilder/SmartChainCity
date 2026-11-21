import { AppError } from '@scc/shared';

import type { Avatar } from './avatar.js';
import { assertNotInHospital } from './hospital.js';

/**
 * Veículos (E3.5, GDD §6 "Carros" e "Agência de carros e barcos"; doc 04 §7 para os sinks).
 *
 * Do GDD:
 * - Carros de 3 raridades, com vida útil média de 6 meses: os atributos ficam no máximo até 3 meses e
 *   depois caem.
 * - Autoescola obrigatória, com 3 h parado.
 * - IPVA semestral: a inadimplência suspende o uso.
 * - A agência é loja do jogo. Ela recompra pela depreciação e aluga por 3 dias a 5% do valor.
 * - No doc 07, o `VehicleNFT` é opcional na fase 2: aqui o carro existe só no jogo.
 *
 * PREMISSAS desta etapa, a calibrar no simulador:
 * - Modelos e preços em THALER: Hatch (comum) 3.000, Sedã esportivo (raro) 8.000, Superesportivo
 *   (épico) 20.000.
 * - Os atributos caem em linha reta de 100% (90 dias) a 50% (180 dias). Depois de 180 dias o carro está
 *   gasto: não corre, só vende.
 * - Valor depreciado: preço × (1 − idade / 180 dias). A agência paga 80% dele.
 * - IPVA de 2% do preço a cada 182 dias: o primeiro vence 182 dias depois da compra. Pagar cobre o
 *   próximo semestre e dá para adiantar até 30 dias antes. Atrasado, o carro fica suspenso e não vende
 *   até pagar.
 * - Autoescola: 50 THALER e 3 h sem trabalhar nem lazer. A habilitação vale para o avatar.
 * - O dinheiro da compra, do aluguel, do IPVA e da autoescola vai para a queima (sinks do doc 04 §7). A
 *   recompra sai da conta de sistema da agência.
 */
const DAY = 86_400_000;
export const FULL_DAYS = 90;
export const LIFE_DAYS = 180;
export const MIN_FACTOR = 0.5;
export const IPVA_BPS = 200;
export const IPVA_PERIOD_MS = 182 * DAY;
export const IPVA_ADVANCE_MS = 30 * DAY;
export const RENT_BPS = 500;
export const RENT_MS = 3 * DAY;
export const BUYBACK_BPS = 8000;
export const LICENSE_CENTS = 5000n;
export const LICENSE_MS = 3 * 3_600_000;

export const MODELS = {
  hatch: { label: 'Hatch', rarity: 'common', priceCents: 3000_00n, speed: 50, power: 40 },
  sedan: { label: 'Sedã esportivo', rarity: 'rare', priceCents: 8000_00n, speed: 70, power: 60 },
  super: { label: 'Superesportivo', rarity: 'epic', priceCents: 20000_00n, speed: 90, power: 80 },
} as const;
export type ModelCode = keyof typeof MODELS;
export const MODEL_CODES = Object.keys(MODELS) as ModelCode[];
export const isModel = (s: string): s is ModelCode => s in MODELS;

export type VehicleKind = 'owned' | 'rental';
export type VehicleStatus = 'pending' | 'active' | 'sold';

export interface Vehicle {
  id: string;
  accountId: string;
  model: ModelCode;
  kind: VehicleKind;
  /** O que foi pago: o preço na compra, 5% no aluguel. */
  paidCents: bigint;
  boughtAt: Date;
  /** Aluguel: até quando vale. */
  rentalUntil: Date | null;
  /** IPVA pago até aqui; depois disso, suspenso. Null no aluguel. */
  ipvaPaidUntil: Date | null;
  status: VehicleStatus;
  soldAt: Date | null;
  /** Pane da última corrida (E3.5): leve, moderada ou grave; null sem pane. */
  breakdown: 'leve' | 'moderado' | 'grave' | null;
  brokenAt: Date | null;
  /** Na oficina até aqui; passou, está consertado. */
  repairUntil: Date | null;
  /** Revisão em dia até aqui: menos panes. */
  revisionUntil: Date | null;
}

/** Com pane e sem conserto pronto? */
export const isBroken = (v: Pick<Vehicle, 'breakdown' | 'repairUntil'>, now: Date) =>
  !!v.breakdown && (!v.repairUntil || v.repairUntil > now);

/** Fator dos atributos pela idade: 1 até 90 dias, cai a 0,5 em 180 dias. */
export function conditionFactor(v: Pick<Vehicle, 'boughtAt'>, now: Date) {
  const days = (now.getTime() - v.boughtAt.getTime()) / DAY;
  if (days <= FULL_DAYS) return 1;
  if (days >= LIFE_DAYS) return MIN_FACTOR;
  return 1 - ((days - FULL_DAYS) / (LIFE_DAYS - FULL_DAYS)) * (1 - MIN_FACTOR);
}

export const attributesAt = (v: Pick<Vehicle, 'model' | 'boughtAt'>, now: Date) => {
  const f = conditionFactor(v, now);
  const m = MODELS[v.model];
  return { speed: Math.round(m.speed * f), power: Math.round(m.power * f), factor: Math.round(f * 1000) / 1000 };
};

/** Valor depreciado: preço × (1 − idade/180 dias), em centavos. */
export function depreciatedCents(v: Pick<Vehicle, 'model' | 'boughtAt'>, now: Date) {
  const days = (now.getTime() - v.boughtAt.getTime()) / DAY;
  const left = Math.max(0, 1 - days / LIFE_DAYS);
  return (MODELS[v.model].priceCents * BigInt(Math.floor(left * 10_000))) / 10_000n;
}

export const buybackCents = (v: Pick<Vehicle, 'model' | 'boughtAt'>, now: Date) => (depreciatedCents(v, now) * BigInt(BUYBACK_BPS)) / 10_000n;
export const ipvaCents = (model: ModelCode) => (MODELS[model].priceCents * BigInt(IPVA_BPS)) / 10_000n;
export const rentCents = (model: ModelCode) => (MODELS[model].priceCents * BigInt(RENT_BPS)) / 10_000n;

export type VehicleState = 'pending' | 'ok' | 'suspended' | 'worn_out' | 'expired' | 'sold' | 'broken' | 'repairing';

/** Situação de agora: o que a tela mostra e o que as corridas vão conferir. */
export function stateOf(v: Vehicle, now: Date): VehicleState {
  if (v.status === 'sold') return 'sold';
  if (v.status === 'pending') return 'pending';
  if (v.kind === 'rental' && !(v.rentalUntil && v.rentalUntil > now)) return 'expired';
  if (v.breakdown && v.repairUntil && v.repairUntil > now) return 'repairing';
  if (v.breakdown && !v.repairUntil) return 'broken';
  if (v.kind === 'rental') return 'ok';
  if (v.ipvaPaidUntil && v.ipvaPaidUntil <= now) return 'suspended';
  if (now.getTime() - v.boughtAt.getTime() >= LIFE_DAYS * DAY) return 'worn_out';
  return 'ok';
}

/** Compra ou aluguel na agência: o carro nasce `pending` e vira `active` com a cobrança. */
export function newVehicle(input: { id: string; accountId: string; model: string; rent: boolean }, now: Date): Vehicle {
  if (!isModel(input.model)) throw new AppError('invalid_model', 'Modelo desconhecido na agência.', 400);
  return {
    id: input.id,
    accountId: input.accountId,
    model: input.model,
    kind: input.rent ? 'rental' : 'owned',
    paidCents: input.rent ? rentCents(input.model) : MODELS[input.model].priceCents,
    boughtAt: now,
    rentalUntil: input.rent ? new Date(now.getTime() + RENT_MS) : null,
    ipvaPaidUntil: input.rent ? null : new Date(now.getTime() + IPVA_PERIOD_MS),
    status: 'pending',
    soldAt: null,
    breakdown: null,
    brokenAt: null,
    repairUntil: null,
    revisionUntil: null,
  };
}

/** Confere o IPVA: só carro próprio ativo, no máximo 30 dias antes de vencer. Devolve o novo prazo. */
export function checkIpva(v: Vehicle, now: Date) {
  if (v.kind !== 'owned' || v.status !== 'active' || !v.ipvaPaidUntil) {
    throw new AppError('no_ipva', 'Este carro não paga IPVA.', 409);
  }
  if (v.ipvaPaidUntil.getTime() - now.getTime() > IPVA_ADVANCE_MS) {
    throw new AppError('ipva_not_due', `IPVA em dia até ${v.ipvaPaidUntil.toISOString()}. Dá para pagar 30 dias antes.`, 409);
  }
  // O semestre que este pagamento cobre: a chave do ledger, para não cobrar duas vezes o mesmo.
  const period = Math.round((v.ipvaPaidUntil.getTime() - v.boughtAt.getTime()) / IPVA_PERIOD_MS);
  return { cents: ipvaCents(v.model), period, until: new Date(v.ipvaPaidUntil.getTime() + IPVA_PERIOD_MS) };
}

/** Confere a venda para a agência: carro próprio ativo, sem IPVA atrasado. */
export function checkSale(v: Vehicle, now: Date) {
  if (v.kind !== 'owned') throw new AppError('rental_not_for_sale', 'Carro alugado não se vende.', 409);
  if (v.status !== 'active') throw new AppError('not_active', 'Este carro não está ativo.', 409);
  if (stateOf(v, now) === 'suspended') throw new AppError('ipva_overdue', 'Pague o IPVA atrasado antes de vender.', 409);
  return { cents: buybackCents(v, now) };
}

// ---------------------------------------------------------------- habilitação

export interface License {
  /** Quando a autoescola termina; depois disso, habilitado. */
  readyAt: Date;
}

export const licensed = (a: Pick<Avatar, 'license'>, now: Date) => !!a.license && a.license.readyAt <= now;
export const inDrivingSchool = (a: Pick<Avatar, 'license'>, now: Date) => !!a.license && a.license.readyAt > now;

export function checkLicense(avatar: Avatar, now: Date) {
  assertNotInHospital(avatar, now);
  if (avatar.license) {
    throw new AppError(licensed(avatar, now) ? 'already_licensed' : 'in_driving_school', 'O avatar já tem habilitação (ou está na autoescola).', 409);
  }
  return { cents: LICENSE_CENTS };
}

export const applyLicense = (avatar: Avatar, now: Date): Avatar => ({
  ...avatar,
  license: { readyAt: new Date(now.getTime() + LICENSE_MS) },
  updatedAt: now,
});

export const licenseToJson = (l: License | null | undefined) => (l ? { readyAt: l.readyAt.toISOString() } : null);
export const licenseFromJson = (v: unknown): License | null => (v ? { readyAt: new Date((v as { readyAt: string }).readyAt) } : null);

// ---------------------------------------------------------------- persistência e cobrança

export interface VehicleStore {
  create(v: Vehicle): Promise<void>;
  get(id: string): Promise<Vehicle | null>;
  listByAccount(accountId: string): Promise<Vehicle[]>;
  /** pending → active. */
  activate(id: string): Promise<void>;
  /** Apaga o `pending` que não foi pago. */
  dropPending(id: string): Promise<void>;
  /** Muda o fim do IPVA se ainda for `expected` (dois pagamentos juntos: um só vale). */
  extendIpva(id: string, expected: Date, until: Date): Promise<boolean>;
  /** active → sold. */
  markSold(id: string, now: Date): Promise<boolean>;
  pendingOlderThan(t: Date): Promise<Vehicle[]>;
  /** Pane da corrida: grava se o carro não tem pane aberta (sem pane, ou com o conserto já pronto em `now`). */
  setBreakdown(id: string, severity: 'leve' | 'moderado' | 'grave', now: Date): Promise<boolean>;
  /** Entra na oficina: só a pane de `brokenAt`, ainda sem conserto marcado. */
  startRepair(id: string, brokenAt: Date, until: Date): Promise<boolean>;
  /** Revisão: só se a de agora ainda for `expected` (null sem revisão). */
  setRevision(id: string, expected: Date | null, until: Date): Promise<boolean>;
}

/** Quem cobra e paga no ledger. Cada chamada tem a sua chave de idempotência. */
export interface VehiclePayer {
  /** THALER do jogador para a queima `burn/<sink>`. */
  chargeVehicle(input: { key: string; kind: string; accountId: string; cents: bigint; sink: string; refId: string }, requestId?: string): Promise<void>;
  /** Recompra: da agência (conta de sistema) para o jogador. */
  payBuyback(input: { key: string; accountId: string; cents: bigint; refId: string }, requestId?: string): Promise<void>;
}

/** O carro pendente: cobra e ativa; sem THALER, apaga. Ledger fora: continua pendente. */
export async function settleVehicle(deps: { store: VehicleStore; payer: VehiclePayer }, v: Vehicle, requestId?: string) {
  try {
    await deps.payer.chargeVehicle(
      { key: `vehicle-buy:${v.id}`, kind: v.kind === 'rental' ? 'vehicle_rent' : 'vehicle_buy', accountId: v.accountId, cents: v.paidCents, sink: 'vehicles', refId: v.id },
      requestId,
    );
  } catch (error) {
    if (error instanceof AppError && error.code === 'insufficient_thaler') await deps.store.dropPending(v.id);
    throw error;
  }
  await deps.store.activate(v.id);
  return { ...v, status: 'active' as const };
}

export function vehicleDto(v: Vehicle, now: Date) {
  const m = MODELS[v.model];
  const state = stateOf(v, now);
  return {
    id: v.id,
    model: v.model,
    label: m.label,
    rarity: m.rarity,
    kind: v.kind,
    state,
    bought_at: v.boughtAt.toISOString(),
    rental_until: v.rentalUntil?.toISOString() ?? null,
    ipva_paid_until: v.ipvaPaidUntil?.toISOString() ?? null,
    ipva_cents: v.kind === 'owned' ? ipvaCents(v.model).toString() : null,
    ipva_payable: v.kind === 'owned' && v.status === 'active' && !!v.ipvaPaidUntil && v.ipvaPaidUntil.getTime() - now.getTime() <= IPVA_ADVANCE_MS,
    attributes: attributesAt(v, now),
    value_cents: v.kind === 'owned' ? depreciatedCents(v, now).toString() : null,
    buyback_cents: v.kind === 'owned' && v.status === 'active' ? buybackCents(v, now).toString() : null,
    breakdown: isBroken(v, now) ? v.breakdown : null,
    repair_until: state === 'repairing' ? v.repairUntil!.toISOString() : null,
    revision_until: v.revisionUntil && v.revisionUntil > now ? v.revisionUntil.toISOString() : null,
  };
}
