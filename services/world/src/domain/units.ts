import { randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';

import type { Building, BuildingStore } from './buildings.js';

/**
 * Unidades dos prédios de construtores (doc 13 §4 e §4.1, E3.11), fora da blockchain por enquanto.
 *
 * 1. **Unidades:** com o alvará aprovado, o construtor gera as unidades: andares do prédio × unidades por
 *    andar, a mesma área para cada uma (área construída ÷ unidades), o térreo comercial se quiser, e o
 *    preço por m². As unidades vão à venda.
 * 2. **Venda primária:** o comprador paga em THALER; 95% vão ao construtor e 5% são a taxa da plataforma
 *    (queima, `burn/platform`).
 * 3. **Revenda:** o dono põe preço; 2% do valor é o royalty do construtor (doc 13 §4.1) e o resto vai ao
 *    vendedor.
 * 4. **Aluguel:** o dono oferece a unidade residencial por dia; um avatar de outra conta aluga de 1 a 30 dias.
 *    90% vão ao dono e 10% são a taxa da Prefeitura (`burn/rent`). A unidade alugada é a moradia regular do
 *    avatar (game-core, fator do turno).
 *
 * Venda e aluguel cobram em duas fases: a unidade (ou a vaga) fica segura, o ledger cobra com a chave da
 * venda ou do aluguel, e só então muda de dono. Ledger fora: fica pendente, e o job termina.
 *
 * PREMISSAS: taxa de 5%, royalty de 2%, taxa de 10% no aluguel, até 20 unidades por andar e 1.000 por
 * prédio, e a unidade conta como moradia regular sem a Prefeitura (o prédio já tem alvará).
 * Ficam para depois: `UnitNFT` e `UnitMarket` (contratos e auditoria), IPTU por unidade, condomínio e a
 * unidade sem dono que volta ao construtor.
 */
export const PLATFORM_FEE_BPS = 500n;
export const ROYALTY_BPS = 200n;
export const RENT_FEE_BPS = 1000n;
export const MAX_UNITS_PER_FLOOR = 20;
export const MAX_UNITS = 1000;
export const MAX_LEASE_DAYS = 30;
const DAY_MS = 24 * 3_600_000;

export type UnitKind = 'residencial' | 'comercial';

export interface Unit {
  id: string;
  buildingId: string;
  city: string;
  lotId: number;
  builderAccountId: string;
  floor: number;
  number: number;
  areaM2: number;
  kind: UnitKind;
  /** Dono; null enquanto é do construtor (venda primária). */
  ownerAccountId: string | null;
  /** À venda por este preço (centavos de THALER); null fora da venda. */
  priceCents: number | null;
  /** Para alugar por este preço por dia; null sem oferta. */
  rentCentsPerDay: number | null;
  /** Venda em curso que segura a unidade. */
  pendingSaleId: string | null;
  createdAt: Date;
}

export type PayStatus = 'pending' | 'paid' | 'failed';

export interface UnitSale {
  id: string;
  unitId: string;
  buyerAccountId: string;
  /** Quem recebe: o construtor na venda primária, o dono na revenda. */
  sellerAccountId: string;
  builderAccountId: string;
  primary: boolean;
  priceCents: number;
  status: PayStatus;
  createdAt: Date;
}

export interface UnitLease {
  id: string;
  unitId: string;
  ownerAccountId: string;
  tenantAccountId: string;
  avatarId: string;
  centsPerDay: number;
  days: number;
  startsAt: Date;
  endsAt: Date;
  status: PayStatus;
  createdAt: Date;
}

export interface UnitStore {
  /** Grava as unidades do prédio; \`units_exist\` (409) se ele já tem. */
  createUnits(units: Unit[]): Promise<void>;
  getUnit(id: string): Promise<Unit | null>;
  unitsOfBuilding(buildingId: string): Promise<Unit[]>;
  unitsOwnedBy(accountId: string): Promise<Unit[]>;
  /** Unidades residenciais com oferta de aluguel na cidade. */
  unitsForRent(city: string, limit: number): Promise<Unit[]>;
  /** Preço de venda e de aluguel; só o dono (ou o construtor, sem dono) muda. */
  setOffer(id: string, offer: { priceCents: number | null; rentCentsPerDay: number | null }): Promise<void>;
  /**
   * Segura a unidade para a venda, numa transação: só se ela não está segura por outra e o preço ainda é
   * \`sale.priceCents\`. Sem isso, \`null\`.
   */
  beginSale(sale: UnitSale): Promise<UnitSale | null>;
  /** Venda paga: muda o dono, tira da venda e solta a unidade. */
  finishSale(id: string): Promise<void>;
  failSale(id: string): Promise<void>;
  pendingSales(olderThan: Date): Promise<UnitSale[]>;
  /**
   * Grava o aluguel pendente, numa transação com a unidade travada: recusa (\`unit_rented\`) se outro avatar
   * tem aluguel em curso ou pendente nela. O mesmo avatar estende do fim do atual.
   */
  beginLease(lease: UnitLease, now: Date): Promise<UnitLease>;
  finishLease(id: string): Promise<void>;
  failLease(id: string): Promise<void>;
  pendingLeases(olderThan: Date): Promise<UnitLease[]>;
  /** Aluguéis pagos e em curso de uma conta (moradia) ou de uma unidade. */
  activeLeasesOf(accountId: string, now: Date): Promise<UnitLease[]>;
  activeLeaseOfUnit(unitId: string, now: Date): Promise<UnitLease | null>;
}

export interface UnitPayments {
  /** Comprador → vendedor, com a taxa ou o royalty. Idempotente pela venda. */
  chargeSale(sale: UnitSale, requestId?: string): Promise<void>;
  /** Inquilino → dono, com a taxa da Prefeitura. Idempotente pelo aluguel. */
  chargeLease(lease: UnitLease, requestId?: string): Promise<void>;
}

const bps = (cents: number, b: bigint) => Number((BigInt(cents) * b) / 10_000n);

/** Para quem vai o dinheiro da venda. */
export function saleSplit(s: Pick<UnitSale, 'priceCents' | 'primary' | 'sellerAccountId' | 'builderAccountId'>) {
  if (s.primary) {
    const fee = bps(s.priceCents, PLATFORM_FEE_BPS);
    return { seller: s.priceCents - fee, royalty: 0, fee };
  }
  const royalty = s.sellerAccountId === s.builderAccountId ? 0 : bps(s.priceCents, ROYALTY_BPS);
  return { seller: s.priceCents - royalty, royalty, fee: 0 };
}

export function leaseSplit(amountCents: number) {
  const fee = bps(amountCents, RENT_FEE_BPS);
  return { owner: amountCents - fee, fee };
}

export const leaseAmount = (l: Pick<UnitLease, 'centsPerDay' | 'days'>) => l.centsPerDay * l.days;

/** Código da unidade: andar e número, como "0302" (3º andar, unidade 2); o térreo é o andar 0. */
export const unitCode = (u: Pick<Unit, 'floor' | 'number'>) => `${String(u.floor).padStart(2, '0')}${String(u.number).padStart(2, '0')}`;

/** O construtor gera as unidades do prédio aprovado. */
export async function generateUnits(
  buildings: BuildingStore,
  store: UnitStore,
  input: { buildingId: string; accountId: string; unitsPerFloor: number; groundCommercial: boolean; priceCentsPerM2: number },
  now: Date,
): Promise<Unit[]> {
  const b = await buildings.getBuilding(input.buildingId);
  if (!b || b.ownerAccountId !== input.accountId) throw new AppError('not_found', 'Prédio não encontrado.', 404);
  if (b.status !== 'approved') throw new AppError('building_not_approved', 'O prédio precisa do alvará antes das unidades.', 409);
  if (!Number.isInteger(input.unitsPerFloor) || input.unitsPerFloor < 1 || input.unitsPerFloor > MAX_UNITS_PER_FLOOR) {
    throw new AppError('invalid_units', `De 1 a ${MAX_UNITS_PER_FLOOR} unidades por andar.`, 400);
  }
  if (!Number.isInteger(input.priceCentsPerM2) || input.priceCentsPerM2 < 1) {
    throw new AppError('invalid_units', 'Preço por m² inválido.', 400);
  }
  const floors = Math.max(1, b.floors);
  const total = floors * input.unitsPerFloor;
  if (total > MAX_UNITS) throw new AppError('invalid_units', `No máximo ${MAX_UNITS} unidades por prédio.`, 400);
  const gfa = b.gfaM2 > 0 ? b.gfaM2 : b.footprintM2 * floors;
  const area = Math.max(1, Math.round((gfa / total) * 10) / 10);
  const units: Unit[] = [];
  for (let floor = 0; floor < floors; floor++) {
    for (let n = 1; n <= input.unitsPerFloor; n++) {
      units.push({
        id: randomUUID(),
        buildingId: b.id,
        city: b.city,
        lotId: b.lotId,
        builderAccountId: b.ownerAccountId,
        floor,
        number: n,
        areaM2: area,
        kind: floor === 0 && input.groundCommercial ? 'comercial' : 'residencial',
        ownerAccountId: null,
        priceCents: Math.round(area * input.priceCentsPerM2),
        rentCentsPerDay: null,
        pendingSaleId: null,
        createdAt: now,
      });
    }
  }
  await store.createUnits(units);
  return units;
}

/** Quem manda na unidade agora: o dono, ou o construtor enquanto ninguém comprou. */
export const controllerOf = (u: Pick<Unit, 'ownerAccountId' | 'builderAccountId'>) => u.ownerAccountId ?? u.builderAccountId;

export async function setUnitOffer(
  store: UnitStore,
  input: { unitId: string; accountId: string; priceCents?: number | null; rentCentsPerDay?: number | null },
) {
  const u = await store.getUnit(input.unitId);
  if (!u || controllerOf(u) !== input.accountId) throw new AppError('not_found', 'Unidade não encontrada.', 404);
  if (u.pendingSaleId) throw new AppError('sale_in_progress', 'A unidade está sendo vendida agora.', 409);
  const price = input.priceCents === undefined ? u.priceCents : input.priceCents;
  const rent = input.rentCentsPerDay === undefined ? u.rentCentsPerDay : input.rentCentsPerDay;
  for (const v of [price, rent]) {
    if (v !== null && (!Number.isInteger(v) || v < 1)) throw new AppError('invalid_price', 'Preço inválido.', 400);
  }
  if (rent !== null && u.kind !== 'residencial') throw new AppError('not_residential', 'Só a unidade residencial se aluga para morar.', 409);
  await store.setOffer(u.id, { priceCents: price, rentCentsPerDay: rent });
  return { ...u, priceCents: price, rentCentsPerDay: rent };
}

export async function buyUnit(
  store: UnitStore,
  payments: UnitPayments,
  input: { unitId: string; accountId: string; requestId?: string },
  now: Date,
): Promise<{ sale: UnitSale; unit: Unit }> {
  const u = await store.getUnit(input.unitId);
  if (!u) throw new AppError('not_found', 'Unidade não encontrada.', 404);
  if (u.priceCents === null) throw new AppError('unit_not_for_sale', 'A unidade não está à venda.', 409);
  const seller = controllerOf(u);
  if (seller === input.accountId) throw new AppError('own_unit', 'A unidade já é sua.', 409);
  const sale = await store.beginSale({
    id: randomUUID(),
    unitId: u.id,
    buyerAccountId: input.accountId,
    sellerAccountId: seller,
    builderAccountId: u.builderAccountId,
    primary: u.ownerAccountId === null,
    priceCents: u.priceCents,
    status: 'pending',
    createdAt: now,
  });
  if (!sale) throw new AppError('sale_in_progress', 'Outra compra desta unidade está em andamento.', 409);
  try {
    await payments.chargeSale(sale, input.requestId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'insufficient_thaler') await store.failSale(sale.id);
    throw error;
  }
  await store.finishSale(sale.id);
  return { sale: { ...sale, status: 'paid' }, unit: (await store.getUnit(u.id))! };
}

export async function leaseUnit(
  store: UnitStore,
  payments: UnitPayments,
  input: { unitId: string; accountId: string; avatarId: string; days: number; requestId?: string },
  now: Date,
): Promise<UnitLease> {
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > MAX_LEASE_DAYS) {
    throw new AppError('invalid_lease', `De 1 a ${MAX_LEASE_DAYS} dias por vez.`, 400);
  }
  const u = await store.getUnit(input.unitId);
  if (!u) throw new AppError('not_found', 'Unidade não encontrada.', 404);
  if (u.rentCentsPerDay === null) throw new AppError('unit_not_for_rent', 'A unidade não está para alugar.', 409);
  const owner = controllerOf(u);
  if (owner === input.accountId) throw new AppError('own_unit', 'A unidade é sua: more nela de graça.', 409);
  const lease = await store.beginLease(
    {
      id: randomUUID(),
      unitId: u.id,
      ownerAccountId: owner,
      tenantAccountId: input.accountId,
      avatarId: input.avatarId,
      centsPerDay: u.rentCentsPerDay,
      days: input.days,
      startsAt: now,
      endsAt: new Date(now.getTime() + input.days * DAY_MS),
      status: 'pending',
      createdAt: now,
    },
    now,
  );
  if (lease.endsAt.getTime() - now.getTime() > MAX_LEASE_DAYS * DAY_MS) {
    await store.failLease(lease.id);
    throw new AppError('lease_prepaid', `No máximo ${MAX_LEASE_DAYS} dias pagos adiantado.`, 409);
  }
  try {
    await payments.chargeLease(lease, input.requestId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'insufficient_thaler') await store.failLease(lease.id);
    throw error;
  }
  await store.finishLease(lease.id);
  return { ...lease, status: 'paid' };
}

/** Job: vendas e aluguéis que ficaram pendentes (resposta do ledger perdida). */
export async function settleUnits(store: UnitStore, payments: UnitPayments, now: Date): Promise<number> {
  const olderThan = new Date(now.getTime() - 30_000);
  let n = 0;
  for (const s of await store.pendingSales(olderThan)) {
    try {
      await payments.chargeSale(s);
      await store.finishSale(s.id);
      n++;
    } catch (error) {
      if (error instanceof AppError && error.code === 'insufficient_thaler') {
        await store.failSale(s.id);
        n++;
      }
    }
  }
  for (const l of await store.pendingLeases(olderThan)) {
    try {
      await payments.chargeLease(l);
      await store.finishLease(l.id);
      n++;
    } catch (error) {
      if (error instanceof AppError && error.code === 'insufficient_thaler') {
        await store.failLease(l.id);
        n++;
      }
    }
  }
  return n;
}

export const unitDto = (u: Unit, me: string | null, lease: UnitLease | null, now: Date) => ({
  id: u.id,
  building_id: u.buildingId,
  city: u.city,
  lot_id: u.lotId,
  code: unitCode(u),
  floor: u.floor,
  number: u.number,
  area_m2: u.areaM2,
  kind: u.kind,
  owned: u.ownerAccountId !== null,
  mine: me !== null && controllerOf(u) === me,
  price_cents: u.priceCents,
  rent_cents_per_day: u.rentCentsPerDay,
  rented_until: lease && lease.endsAt > now ? lease.endsAt.toISOString() : null,
  rented_by_me: !!lease && me !== null && lease.tenantAccountId === me && lease.endsAt > now,
  selling: u.pendingSaleId !== null,
});

/** Para o tipo do prédio: o nome curto que a moradia mostra. */
export const unitLabel = (u: Pick<Unit, 'floor' | 'number'>, b?: Pick<Building, 'lotId'> | null) =>
  `Apartamento ${unitCode(u)}${b ? ` (lote ${b.lotId + 1})` : ''}`;
