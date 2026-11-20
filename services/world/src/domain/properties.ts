import { randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';

import type { WorldStore } from './lots.js';

/**
 * Imóveis sobre os lotes (doc 03 §6, E2.5): obra, desgaste e renda.
 *
 * O dinheiro é THALER em centavos, como no game-core. Obra: THALER do jogador
 * para a queima (`burn/construction`, sink de "upgrades de imóvel", doc 04 §7).
 * Renda: do pool P2E para o jogador (faucet "renda de imóveis", doc 04 §7).
 *
 * PREMISSAS (sem fonte no GDD; a "Figura 16" não veio no texto, doc 11):
 * - Casa T1: 4.000 THALER e 10 THALER/dia no nível 1 (seed do CMS, que copiou o simulador).
 * - Obra de 24 h (protótipo de gestão, docs/proposta-cidade-realista/negocios.js).
 * - A renda acumula até 7 dias sem coletar (mesmo protótipo).
 * - O desgaste cai 1 ponto por dia depois da obra.
 *
 * Do doc 03 §6.3: renda × desgaste/100, e abaixo de 30 o imóvel para de render.
 */

export interface PropertyLevel {
  level: number;
  /** Renda por dia com desgaste 100, em centavos de THALER. */
  incomeCentsPerDay: number;
}

export interface PropertyType {
  code: string;
  label: string;
  /** Zonas em que o imóvel pode ser construído. */
  zones: string[];
  priceCents: number;
  buildMinutes: number;
  levels: PropertyLevel[];
  /** Valores provisórios, para a API e a tela avisarem. */
  provisional: string[];
}

export const PROPERTY_TYPES: PropertyType[] = [
  {
    code: 't1',
    label: 'Casa T1',
    zones: ['residential', 'mixed'],
    priceCents: 4000_00,
    buildMinutes: 24 * 60,
    levels: [{ level: 1, incomeCentsPerDay: 10_00 }],
    provisional: ['preço e renda do simulador econômico', 'obra de 24 h do protótipo'],
  },
];

export const DAY_MS = 24 * 60 * 60 * 1000;
export const ACCRUAL_CAP_DAYS = 7;
export const WEAR_PER_DAY = 1;
export const MIN_WEAR_FOR_INCOME = 30;

/** `pending`: obra criada, esperando a cobrança no ledger. `active`: pago (em obra ou pronto). */
export type PropertyStatus = 'pending' | 'active';

export interface Property {
  id: string;
  city: string;
  lotId: number;
  ownerAccountId: string;
  type: string;
  level: number;
  status: PropertyStatus;
  priceCents: number;
  createdAt: Date;
  readyAt: Date;
  /** Desgaste no instante `wearSince` (100 ao fim da obra; o reparo volta a 100). */
  wearBase: number;
  wearSince: Date;
  /** Até onde a renda já foi coletada. */
  lastClaimAt: Date;
}

export type ClaimStatus = 'pending' | 'paid';

export interface PropertyClaim {
  id: string;
  propertyId: string;
  accountId: string;
  amountCents: number;
  status: ClaimStatus;
  createdAt: Date;
}

export interface PropertyStore {
  /** Cria a obra; `lot_has_property` (409) se o lote já tem imóvel. */
  createProperty(p: Property): Promise<void>;
  getProperty(id: string): Promise<Property | null>;
  propertyOnLot(city: string, lotId: number): Promise<Property | null>;
  propertiesOf(accountId: string): Promise<Property[]>;
  activateProperty(id: string): Promise<void>;
  /** Apaga a obra que não foi paga (só em `pending`). */
  dropPendingProperty(id: string): Promise<void>;
  pendingProperties(olderThan: Date): Promise<Property[]>;
  /**
   * Fecha a renda até `until` e cria a coleta, numa transação só, se ninguém
   * coletou antes (`lastClaimAt` ainda igual a `expected`). Sem isso, `null`.
   */
  startClaim(claim: PropertyClaim, expected: Date, until: Date): Promise<PropertyClaim | null>;
  markClaimPaid(id: string): Promise<void>;
  pendingClaims(olderThan: Date): Promise<PropertyClaim[]>;
}

export interface PropertyPayments {
  /** THALER do jogador para a queima. Idempotente pelo imóvel. */
  chargeBuild(p: Property, requestId?: string): Promise<void>;
  /** THALER do pool P2E para o jogador. Idempotente pela coleta. */
  payIncome(c: PropertyClaim, requestId?: string): Promise<void>;
}

export const typeOf = (code: string) => PROPERTY_TYPES.find((t) => t.code === code);

const daysBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / DAY_MS;

/** Desgaste em `at` (0 a 100). Não cai durante a obra. */
export function wearAt(p: Property, at: Date): number {
  if (at <= p.wearSince) return p.wearBase;
  return Math.max(0, p.wearBase - WEAR_PER_DAY * daysBetween(p.wearSince, at));
}

export function incomePerDay(p: Property): number {
  const t = typeOf(p.type);
  return t?.levels.find((l) => l.level === p.level)?.incomeCentsPerDay ?? 0;
}

/**
 * Renda acumulada em centavos, entre a última coleta e `now`, com teto de 7 dias.
 * O desgaste cai em linha reta, então a renda é a integral de M × w(t)/100
 * enquanto w ≥ 30.
 */
export function accrued(p: Property, now: Date): { cents: number; until: Date; capped: boolean } {
  const start = new Date(Math.max(p.lastClaimAt.getTime(), p.readyAt.getTime()));
  if (p.status !== 'active' || now <= start) return { cents: 0, until: now, capped: false };
  const capEnd = new Date(start.getTime() + ACCRUAL_CAP_DAYS * DAY_MS);
  const end = now < capEnd ? now : capEnd;

  // Tempo em dias a partir de wearSince; w(x) = W0 - k·x.
  const W0 = p.wearBase;
  const k = WEAR_PER_DAY;
  const xa = Math.max(0, daysBetween(p.wearSince, start));
  const xEnd = Math.max(0, daysBetween(p.wearSince, end));
  const xStop = (W0 - MIN_WEAR_FOR_INCOME) / k; // daqui em diante o imóvel não rende
  const xb = Math.min(xEnd, xStop);
  const M = incomePerDay(p);
  const integral = (x: number) => W0 * x - (k * x * x) / 2;
  const cents = xb > xa ? Math.floor((M / 100) * (integral(xb) - integral(xa))) : 0;
  return { cents, until: now, capped: now > capEnd };
}

export type PropertyPhase = 'pending_payment' | 'building' | 'ready';

export function phaseOf(p: Property, now: Date): PropertyPhase {
  if (p.status === 'pending') return 'pending_payment';
  return now < p.readyAt ? 'building' : 'ready';
}

// ---------------------------------------------------------------- casos de uso

export async function buildProperty(
  lots: WorldStore,
  store: PropertyStore,
  payments: PropertyPayments,
  input: { city: string; lotId: number; accountId: string; type: string; requestId?: string },
  now: () => Date,
): Promise<Property> {
  const type = typeOf(input.type);
  if (!type) throw new AppError('unknown_property_type', 'Tipo de imóvel desconhecido.', 400);
  const lot = await lots.getLot(input.city, input.lotId);
  if (!lot) throw new AppError('not_found', 'Lote não encontrado.', 404);
  if (lot.status !== 'sold' || lot.ownerAccountId !== input.accountId) {
    throw new AppError('not_lot_owner', 'Só o dono do lote pode construir nele.', 403);
  }
  if (!type.zones.includes(lot.zone)) {
    throw new AppError('zone_not_allowed', `${type.label} não pode ser construído nesta zona.`, 409);
  }

  const t0 = now();
  const readyAt = new Date(t0.getTime() + type.buildMinutes * 60_000);
  const property: Property = {
    id: randomUUID(),
    city: input.city,
    lotId: input.lotId,
    ownerAccountId: input.accountId,
    type: type.code,
    level: 1,
    status: 'pending',
    priceCents: type.priceCents,
    createdAt: t0,
    readyAt,
    wearBase: 100,
    wearSince: readyAt,
    lastClaimAt: readyAt,
  };
  await store.createProperty(property);

  try {
    await payments.chargeBuild(property, input.requestId);
  } catch (error) {
    // Sem saldo: a obra não existe. Ledger fora: fica pendente e o job tenta de novo.
    if (error instanceof AppError && error.code === 'insufficient_thaler') {
      await store.dropPendingProperty(property.id);
    }
    throw error;
  }
  await store.activateProperty(property.id);
  return { ...property, status: 'active' };
}

export async function claimIncome(
  store: PropertyStore,
  payments: PropertyPayments,
  input: { propertyId: string; accountId: string; requestId?: string },
  now: () => Date,
): Promise<{ claim: PropertyClaim; property: Property }> {
  const property = await store.getProperty(input.propertyId);
  if (!property || property.ownerAccountId !== input.accountId) {
    throw new AppError('not_found', 'Imóvel não encontrado.', 404);
  }
  const t = now();
  if (phaseOf(property, t) !== 'ready') throw new AppError('property_not_ready', 'O imóvel ainda está em obra.', 409);
  const { cents, until } = accrued(property, t);
  if (cents <= 0) throw new AppError('nothing_to_claim', 'Não há renda para coletar.', 409);

  const claim = await store.startClaim(
    { id: randomUUID(), propertyId: property.id, accountId: input.accountId, amountCents: cents, status: 'pending', createdAt: t },
    property.lastClaimAt,
    until,
  );
  if (!claim) throw new AppError('claim_in_progress', 'Outra coleta deste imóvel acabou de acontecer.', 409);

  // Se o ledger falhar, a coleta fica pendente e o job paga depois (mesma chave).
  await payments.payIncome(claim, input.requestId);
  await store.markClaimPaid(claim.id);
  return { claim: { ...claim, status: 'paid' }, property: { ...property, lastClaimAt: until } };
}

/** Job: paga obras e coletas que ficaram pendentes (resposta do ledger perdida). */
export async function settleProperties(store: PropertyStore, payments: PropertyPayments, now: Date): Promise<number> {
  const olderThan = new Date(now.getTime() - 30_000);
  let n = 0;
  for (const p of await store.pendingProperties(olderThan)) {
    try {
      await payments.chargeBuild(p);
      await store.activateProperty(p.id);
      n++;
    } catch (error) {
      if (error instanceof AppError && error.code === 'insufficient_thaler') {
        await store.dropPendingProperty(p.id);
        n++;
      }
    }
  }
  for (const c of await store.pendingClaims(olderThan)) {
    try {
      await payments.payIncome(c);
      await store.markClaimPaid(c.id);
      n++;
    } catch {
      // Tenta de novo na próxima rodada.
    }
  }
  return n;
}
