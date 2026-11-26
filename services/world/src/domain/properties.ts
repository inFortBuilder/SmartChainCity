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
 *
 * Regularização e infraestrutura (doc 03 §3, §4 e §6.3; doc 04 §4 "fator_regularizacao_moradia"):
 * - o imóvel pronto é regularizado na Prefeitura uma vez (residencial ou comercial, pelo tipo);
 * - água e energia são contratadas por períodos de 30 dias, com custo que cresce com a distância ao centro
 *   (o número do bairro, contado do centro para fora);
 * - sem regularização, água ou energia, o imóvel rende 50% (`UNREGULAR_FACTOR`, o mesmo do simulador).
 * Cada uma é uma obra (`PropertyWork`): fecha a renda até ali com o estado antigo e muda o imóvel.
 *
 * PREMISSAS (o simulador só tem o plano de energia, 5 THALER/dia, em sinks.energyPlan):
 * - taxa de regularização de 2% do preço do imóvel (Casa T1: 80 THALER);
 * - água 2 e energia 3 THALER/dia no centro, até o dobro no último bairro;
 * - no máximo 60 dias de serviço pagos adiantado.
 */

export interface PropertyLevel {
  level: number;
  /** Renda por dia com desgaste 100, em centavos de THALER. */
  incomeCentsPerDay: number;
  /** Custo para subir a este nível (a partir do anterior), em centavos de THALER. */
  upgradeCostCents?: number;
}

export type PropertyUse = 'residencial' | 'comercial';

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
  /** Regularização na Prefeitura (doc 03 §3): residencial ou comercial. */
  use: PropertyUse;
  /** Troca de tipo (doc 03 §6.1): T2 vem da T1, T3 da T2. A troca exige o tipo de origem no último nível. */
  upgradesFrom?: string;
  /** Falso quando o catálogo ainda não tem os valores (o tipo aparece, mas não constrói). */
  available?: boolean;
  /** Por que não está disponível. */
  unavailableReason?: string;
  /**
   * Negócio de lazer de jogador (E3.3): o avatar paga a entrada para usar, e ela vai
   * para o dono (sem renda do pool P2E). A atividade e o efeito moram no game-core.
   */
  venue?: { activity: string; feeCents: number };
}

/**
 * Catálogo de partida (o mesmo do seed do Strapi, cms-strapi/seed/imoveis.json). Com `CMS_URL`, o world
 * troca pelo catálogo publicado no Strapi (`setPropertyCatalog`), e este fica de reserva.
 */
export const DEFAULT_PROPERTY_TYPES: PropertyType[] = [
  {
    code: 't1',
    label: 'Casa T1',
    zones: ['residential', 'mixed'],
    use: 'residencial',
    priceCents: 4000_00,
    buildMinutes: 24 * 60,
    levels: [
      { level: 1, incomeCentsPerDay: 10_00 },
      { level: 2, incomeCentsPerDay: 15_00, upgradeCostCents: 2000_00 },
      { level: 3, incomeCentsPerDay: 20_00, upgradeCostCents: 4000_00 },
    ],
    provisional: [
      'preço e renda do nível 1 do simulador econômico',
      'obra de 24 h do protótipo',
      'renda e custo dos níveis 2 e 3',
      'custo do reparo',
    ],
  },
  // Troca de tipo (doc 03 §6.1). PREMISSAS: a "Figura 16" do GDD não veio no texto (doc 11, lacuna 3).
  // Preço total da casa (a troca cobra a diferença para o tipo de origem), renda e níveis.
  {
    code: 't2',
    label: 'Casa T2',
    zones: ['residential', 'mixed'],
    use: 'residencial',
    upgradesFrom: 't1',
    priceCents: 7000_00,
    buildMinutes: 24 * 60,
    levels: [
      { level: 1, incomeCentsPerDay: 24_00 },
      { level: 2, incomeCentsPerDay: 30_00, upgradeCostCents: 3000_00 },
      { level: 3, incomeCentsPerDay: 36_00, upgradeCostCents: 5000_00 },
    ],
    provisional: ['preço, renda e níveis da T2 (Figura 16 do GDD ausente)'],
  },
  {
    code: 't3',
    label: 'Casa T3',
    zones: ['residential', 'mixed'],
    use: 'residencial',
    upgradesFrom: 't2',
    priceCents: 12000_00,
    buildMinutes: 24 * 60,
    levels: [
      { level: 1, incomeCentsPerDay: 42_00 },
      { level: 2, incomeCentsPerDay: 50_00, upgradeCostCents: 5000_00 },
      { level: 3, incomeCentsPerDay: 58_00, upgradeCostCents: 8000_00 },
    ],
    provisional: ['preço, renda e níveis da T3 (Figura 16 do GDD ausente)', 'o pequeno negócio da T3'],
  },
  // Lazer (E3.3, GDD §6 "Lazer"): academias e galerias são negócios de jogador com custo de
  // entrada baixo. PREMISSAS: preço da obra, entrada e zonas; a renda é a entrada, não o pool.
  {
    code: 'academia',
    label: 'Academia',
    zones: ['commercial', 'mixed'],
    use: 'comercial',
    priceCents: 6000_00,
    buildMinutes: 24 * 60,
    levels: [{ level: 1, incomeCentsPerDay: 0 }],
    provisional: ['preço da obra', 'entrada de 5 THALER', 'zonas comercial e mista'],
    venue: { activity: 'academia', feeCents: 5_00 },
  },
  {
    code: 'galeria',
    label: 'Galeria de arte',
    zones: ['commercial', 'mixed'],
    use: 'comercial',
    priceCents: 5000_00,
    buildMinutes: 24 * 60,
    levels: [{ level: 1, incomeCentsPerDay: 0 }],
    provisional: ['preço da obra', 'entrada de 4 THALER', 'zonas comercial e mista'],
    venue: { activity: 'galeria', feeCents: 4_00 },
  },
];

let catalog: PropertyType[] = DEFAULT_PROPERTY_TYPES;
/** O catálogo em uso: o do Strapi, se carregou, ou o de partida. */
export const propertyTypes = () => catalog;
/** Troca o catálogo (Strapi). Lista vazia volta ao de partida. */
export function setPropertyCatalog(types: PropertyType[]) {
  catalog = types.length ? types : DEFAULT_PROPERTY_TYPES;
}

/** Tipos que são negócios de lazer de jogador. */
export const VENUE_TYPES = () => catalog.filter((t) => t.venue).map((t) => t.code);

/** O negócio abre com a obra pronta e o desgaste acima do mínimo (o mesmo da renda, doc 03 §6.3). */
export const venueOpen = (p: Property, now: Date) => phaseOf(p, now) === 'ready' && wearAt(p, now) >= MIN_WEAR_FOR_INCOME;

export const DAY_MS = 24 * 60 * 60 * 1000;
export const ACCRUAL_CAP_DAYS = 7;
export const WEAR_PER_DAY = 1;
export const MIN_WEAR_FOR_INCOME = 30;
/** Reparo: fração do preço do imóvel por ponto de desgaste recuperado (premissa: T1 = 2 THALER/ponto). */
export const REPAIR_SHARE_PER_POINT = 0.0005;

/** Fator da renda sem regularização, água ou energia (doc 03 §3; simulador: work.unregularizedFactor). */
export const UNREGULAR_FACTOR = 0.5;
/** Taxa de regularização: fração do preço do imóvel (premissa). */
export const REGULARIZATION_SHARE = 0.02;
export type Utility = 'water' | 'power';
export const UTILITIES: Utility[] = ['water', 'power'];
/** Período de cada contratação de água ou energia. */
export const UTILITY_PERIOD_DAYS = 30;
/** No máximo este tanto de serviço pago adiantado. */
export const UTILITY_MAX_AHEAD_DAYS = 60;
/** Diária no bairro central, em centavos (premissa; soma 5 THALER/dia, o plano de energia do simulador). */
export const UTILITY_DAILY_CENTS: Record<Utility, number> = { water: 2_00, power: 3_00 };
/** Acréscimo no último bairro: o custo vai de 1× no centro a (1 + isto)× na borda (premissa). */
export const UTILITY_EDGE_EXTRA = 1;

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
  /** Regularizado na Prefeitura desde (null: não regularizado). Imóveis antigos não têm o campo. */
  regularizedAt?: Date | null;
  /** Água contratada: janela [desde, até). */
  waterFrom?: Date | null;
  waterUntil?: Date | null;
  /** Energia contratada: janela [desde, até). */
  powerFrom?: Date | null;
  powerUntil?: Date | null;
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
  /** Imóveis ativos da cidade com um destes tipos (negócios de lazer), os mais antigos primeiro. */
  propertiesOfTypes(city: string, types: string[], limit: number): Promise<Property[]>;
  activateProperty(id: string): Promise<void>;
  /** Leilão (E2.6): o imóvel vai com o lote. Só muda se o dono ainda for `from`. */
  transferProperty(id: string, from: string, to: string): Promise<void>;
  /** Apaga a obra que não foi paga (só em `pending`). */
  dropPendingProperty(id: string): Promise<void>;
  pendingProperties(olderThan: Date): Promise<Property[]>;
  /**
   * Fecha a renda até `until` e cria a coleta, numa transação só, se ninguém
   * coletou antes (`lastClaimAt` ainda igual a `expected`). Sem isso, `null`.
   */
  startClaim(claim: PropertyClaim, expected: Date, until: Date): Promise<PropertyClaim | null>;
  /** Fecha o período até `until` sem renda (donos separados), se `lastClaimAt` ainda é `expected`. */
  skipIncome(propertyId: string, expected: Date, until: Date): Promise<boolean>;
  markClaimPaid(id: string): Promise<void>;
  pendingClaims(olderThan: Date): Promise<PropertyClaim[]>;
  /** Reparo ou upgrade; `work_in_progress` (409) se o imóvel já tem um pendente. */
  createWork(w: PropertyWork): Promise<void>;
  /**
   * Aplica a obra pendente numa transação, com o imóvel travado: `apply` recebe o
   * estado atual e devolve o novo imóvel e a coleta da renda até ali. `null` se a
   * obra não está mais pendente.
   */
  applyWork(
    workId: string,
    apply: (p: Property) => { property: Property; claim: PropertyClaim | null },
  ): Promise<{ property: Property; claim: PropertyClaim | null } | null>;
  failWork(id: string): Promise<void>;
  pendingWorks(olderThan: Date): Promise<PropertyWork[]>;
}

export interface PropertyPayments {
  /** THALER do jogador para a queima. Idempotente pelo imóvel. */
  chargeBuild(p: Property, requestId?: string): Promise<void>;
  /** THALER do pool P2E para o jogador. Idempotente pela coleta. */
  payIncome(c: PropertyClaim, requestId?: string): Promise<void>;
  /** Reparo ou upgrade: THALER do jogador para a queima. Idempotente pela obra. */
  chargeWork(w: PropertyWork, requestId?: string): Promise<void>;
}

/**
 * Obras sobre um imóvel pronto: reparo (desgaste volta a 100), upgrade (sobe um nível), regularização
 * na Prefeitura e contratação de água ou energia por 30 dias.
 */
export type WorkKind = 'repair' | 'upgrade' | 'regularize' | Utility | 'retype';
export const WORK_KINDS: WorkKind[] = ['repair', 'upgrade', 'regularize', 'water', 'power', 'retype'];
export type WorkStatus = 'pending' | 'applied' | 'failed';

export interface PropertyWork {
  id: string;
  propertyId: string;
  accountId: string;
  kind: WorkKind;
  costCents: number;
  /** Nível de destino do upgrade. */
  toLevel: number | null;
  /** Tipo de destino da troca de tipo (T1 → T2); null nas outras obras. */
  toType?: string | null;
  status: WorkStatus;
  createdAt: Date;
}

export const typeOf = (code: string) => catalog.find((t) => t.code === code);
/** Constrói-se direto: disponível e sem tipo de origem (T2 e T3 vêm por troca). */
export const buildable = (t: PropertyType) => t.available !== false && !t.upgradesFrom;

/** O próximo tipo da família (T1 → T2 → T3), se o catálogo tem os valores. */
export const nextTypeOf = (code: string) => catalog.find((t) => t.upgradesFrom === code && t.available !== false);

/** A família do tipo, da raiz até ele: [t1, t2] para a T2. */
export function familyOf(code: string): PropertyType[] {
  const chain: PropertyType[] = [];
  let t = typeOf(code);
  while (t && chain.length < 10) {
    chain.unshift(t);
    t = t.upgradesFrom ? typeOf(t.upgradesFrom) : undefined;
  }
  return chain;
}

/**
 * Tipo e nível no `PropertyNFT`. O contrato guarda o `typeCode` do mint e só aceita nível maior, então a
 * família da casa vai como o tipo da raiz (`t1`) e o nível corrido: T1 1–3, T2 4–6, T3 7–9.
 */
export function chainTypeAndLevel(p: Pick<Property, 'type' | 'level'>): { typeCode: string; level: number } {
  const family = familyOf(p.type);
  if (family.length <= 1) return { typeCode: p.type, level: p.level };
  const before = family.slice(0, -1).reduce((sum, t) => sum + t.levels.length, 0);
  return { typeCode: family[0]!.code, level: before + p.level };
}

const daysBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / DAY_MS;

/** Desgaste em `at` (0 a 100). Não cai durante a obra. */
export function wearAt(p: Property, at: Date): number {
  if (at <= p.wearSince) return p.wearBase;
  return Math.max(0, p.wearBase - WEAR_PER_DAY * daysBetween(p.wearSince, at));
}

/**
 * Janela em que o imóvel rende 100%: regularizado, com água e com energia. A interseção de
 * intervalos é um intervalo; sem algum dos três, `null`.
 */
export function regularWindow(p: Property): [Date, Date] | null {
  if (!p.regularizedAt || !p.waterFrom || !p.waterUntil || !p.powerFrom || !p.powerUntil) return null;
  const from = Math.max(p.regularizedAt.getTime(), p.waterFrom.getTime(), p.powerFrom.getTime());
  const until = Math.min(p.waterUntil.getTime(), p.powerUntil.getTime());
  return from < until ? [new Date(from), new Date(until)] : null;
}

/** Regular em `at`: regularizado e com água e energia em dia. */
export function isRegular(p: Property, at: Date): boolean {
  const w = regularWindow(p);
  return !!w && at >= w[0] && at < w[1];
}

/** Fator da renda em `at` (1 ou 0,5). */
export const regularFactor = (p: Property, at: Date) => (isRegular(p, at) ? 1 : UNREGULAR_FACTOR);

export function incomePerDay(p: Property): number {
  const t = typeOf(p.type);
  return t?.levels.find((l) => l.level === p.level)?.incomeCentsPerDay ?? 0;
}

/**
 * Renda acumulada em centavos, entre a última coleta e `now`, com teto de 7 dias.
 * O desgaste cai em linha reta, então a renda é a integral de M × w(t)/100
 * enquanto w ≥ 30, vezes o fator de regularização: 0,5 no período todo e mais
 * 0,5 dentro da janela regular.
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
  const part = (a: number, b: number) => (b > a ? integral(b) - integral(a) : 0);
  const total = part(xa, xb);
  const w = regularWindow(p);
  const inWindow = w
    ? part(Math.max(xa, Math.max(0, daysBetween(p.wearSince, w[0]))), Math.min(xb, Math.max(0, daysBetween(p.wearSince, w[1]))))
    : 0;
  const factored = UNREGULAR_FACTOR * total + (1 - UNREGULAR_FACTOR) * inWindow;
  const cents = Math.floor((M / 100) * factored + 1e-9);
  return { cents, until: now, capped: now > capEnd };
}

/** Regra do doc 07 §2.2: o imóvel só rende se o dono dele também for o dono do lote. */
export const rentsHere = (lotOwner: string | null | undefined, propertyOwner: string) => lotOwner === propertyOwner;

/** O imóvel rende agora? (dono do imóvel = dono do lote). Sem `lots`, sim. */
async function rentsNow(lots: Pick<WorldStore, 'getLot'> | undefined, p: Property) {
  return !lots || rentsHere((await lots.getLot(p.city, p.lotId))?.ownerAccountId, p.ownerAccountId);
}

export type IncomeClose = { kind: 'claimed'; claim: PropertyClaim } | { kind: 'forfeited'; cents: number } | { kind: 'none' };

/**
 * Fecha a renda do imóvel do lote antes de o lote ou o imóvel mudar de dono, para
 * a renda ser proporcional ao tempo em que os donos coincidiram. Como todo
 * período entre duas mudanças tem os mesmos donos, basta olhar os donos de agora:
 * - iguais: a renda até aqui vira uma coleta do dono do imóvel, que o job
 *   properties.settle paga;
 * - diferentes: o período não rende e fica fechado.
 * Chame antes de `transferLot` ou `transferProperty`.
 */
export async function closeIncomeBeforeTransfer(
  deps: { lots: Pick<WorldStore, 'getLot'>; properties: PropertyStore },
  city: string,
  lotId: number,
  now: Date,
): Promise<IncomeClose> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const p = await deps.properties.propertyOnLot(city, lotId);
    if (!p || phaseOf(p, now) !== 'ready' || now <= p.lastClaimAt) return { kind: 'none' };
    const { cents, until } = accrued(p, now);
    if (await rentsNow(deps.lots, p)) {
      if (cents <= 0) return { kind: 'none' };
      const claim = await deps.properties.startClaim(
        { id: randomUUID(), propertyId: p.id, accountId: p.ownerAccountId, amountCents: cents, status: 'pending', createdAt: now },
        p.lastClaimAt,
        until,
      );
      if (claim) return { kind: 'claimed', claim };
    } else if (await deps.properties.skipIncome(p.id, p.lastClaimAt, until)) return { kind: 'forfeited', cents };
    // Uma coleta entrou no meio: lê de novo.
  }
  throw new AppError('claim_in_progress', 'A renda deste imóvel mudou durante a passagem.', 409);
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
  if (type.available === false) throw new AppError('type_unavailable', type.unavailableReason ?? `${type.label} ainda não está à venda.`, 409);
  if (type.upgradesFrom) {
    throw new AppError('type_by_upgrade', `${type.label} vem da troca de tipo de ${typeOf(type.upgradesFrom)?.label ?? type.upgradesFrom}.`, 409);
  }
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
export async function settleProperties(
  store: PropertyStore,
  payments: PropertyPayments,
  now: Date,
  lots?: Pick<WorldStore, 'getLot'>,
): Promise<number> {
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
  for (const w of await store.pendingWorks(olderThan)) {
    try {
      await payments.chargeWork(w);
      await finishWork(store, payments, w, () => now, undefined, lots);
      n++;
    } catch (error) {
      if (error instanceof AppError && error.code === 'insufficient_thaler') {
        await store.failWork(w.id);
        n++;
      }
    }
  }
  // Por último: as coletas criadas pelas obras acima também entram.
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

// ---------------------------------------------------------------- reparo e upgrade

export function repairCostCents(p: Property, at: Date): number {
  const type = typeOf(p.type);
  if (!type) return 0;
  const lost = 100 - wearAt(p, at);
  return lost < 0.5 ? 0 : Math.ceil(type.priceCents * REPAIR_SHARE_PER_POINT * lost);
}

export function regularizationCostCents(p: Property): number {
  const type = typeOf(p.type);
  return type ? Math.ceil(type.priceCents * REGULARIZATION_SHARE) : 0;
}

/**
 * Custo de 30 dias de água ou energia. `district` é o bairro do lote (0 = centro) e
 * `districts` quantos a cidade tem: o custo sobe em linha reta até a borda.
 */
export function utilityCostCents(service: Utility, district: number, districts: number): number {
  const edge = districts > 1 ? Math.min(1, Math.max(0, district / (districts - 1))) : 0;
  return Math.round(UTILITY_DAILY_CENTS[service] * UTILITY_PERIOD_DAYS * (1 + UTILITY_EDGE_EXTRA * edge));
}

const untilOf = (p: Property, s: Utility) => (s === 'water' ? p.waterUntil : p.powerUntil) ?? null;
const fromOf = (p: Property, s: Utility) => (s === 'water' ? p.waterFrom : p.powerFrom) ?? null;

/** Contrata mais 30 dias: em dia, estende; vencido (ou nunca contratado), começa agora. */
export function extendUtility(p: Property, s: Utility, t: Date): { from: Date; until: Date } {
  const until = untilOf(p, s);
  const active = until !== null && until > t;
  const from = active ? (fromOf(p, s) ?? t) : t;
  const base = active ? until! : t;
  return { from, until: new Date(base.getTime() + UTILITY_PERIOD_DAYS * DAY_MS) };
}

export function nextLevel(p: Property): PropertyLevel | undefined {
  return typeOf(p.type)?.levels.find((l) => l.level === p.level + 1 && l.upgradeCostCents !== undefined);
}

/**
 * Estado depois da obra. A renda até o instante da obra é fechada numa coleta,
 * com o desgaste e o nível antigos; daí em diante vale o novo estado.
 */
export function applyWorkAt(
  p: Property,
  w: PropertyWork,
  at: Date,
  /** Os donos do lote e do imóvel coincidem? Se não, o período fecha sem renda. */
  rents = true,
): { property: Property; claim: PropertyClaim | null } {
  // Nunca antes da última coleta: o período já fechado não se repete.
  const t = new Date(Math.max(at.getTime(), p.lastClaimAt.getTime()));
  const { cents } = accrued(p, t);
  const claim: PropertyClaim | null =
    cents > 0 && rents
      ? { id: randomUUID(), propertyId: p.id, accountId: p.ownerAccountId, amountCents: cents, status: 'pending', createdAt: t }
      : null;
  // Daqui em diante vale o novo estado; o desgaste segue de onde estava (menos no reparo).
  const kept: Property = { ...p, lastClaimAt: t, wearBase: wearAt(p, t), wearSince: t };
  let property: Property;
  switch (w.kind) {
    case 'repair':
      property = { ...kept, wearBase: 100 };
      break;
    case 'upgrade':
      property = { ...kept, level: w.toLevel ?? p.level };
      break;
    case 'regularize':
      property = { ...kept, regularizedAt: p.regularizedAt ?? t };
      break;
    case 'retype': {
      // Troca de tipo: começa no nível 1 do tipo novo; o preço de referência (reparo) passa a ser o dele.
      const to = typeOf(w.toType ?? '');
      property = { ...kept, type: w.toType ?? p.type, level: 1, priceCents: to?.priceCents ?? p.priceCents };
      break;
    }
    case 'water': {
      const { from, until } = extendUtility(p, 'water', t);
      property = { ...kept, waterFrom: from, waterUntil: until };
      break;
    }
    case 'power': {
      const { from, until } = extendUtility(p, 'power', t);
      property = { ...kept, powerFrom: from, powerUntil: until };
      break;
    }
  }
  return { property, claim };
}

async function finishWork(
  store: PropertyStore,
  payments: PropertyPayments,
  w: PropertyWork,
  now: () => Date,
  requestId?: string,
  lots?: Pick<WorldStore, 'getLot'>,
) {
  const current = await store.getProperty(w.propertyId);
  const rents = current ? await rentsNow(lots, current) : true;
  const result = await store.applyWork(w.id, (p) => applyWorkAt(p, w, now(), rents));
  if (!result) throw new AppError('work_not_pending', 'Esta obra já foi resolvida.', 409);
  if (result.claim) {
    try {
      await payments.payIncome(result.claim, requestId);
      await store.markClaimPaid(result.claim.id);
      result.claim = { ...result.claim, status: 'paid' };
    } catch {
      // Pool vazio ou ledger fora: a coleta fica guardada e o job paga depois.
    }
  }
  return result;
}

/** Custo de 30 dias do serviço no lote do imóvel; sem o mapa da cidade, o preço do centro. */
export async function utilityCostOf(
  lots: (Pick<WorldStore, 'getLot'> & Partial<Pick<WorldStore, 'getCity'>>) | undefined,
  p: Property,
  service: Utility,
): Promise<number> {
  const lot = lots ? await lots.getLot(p.city, p.lotId) : null;
  const city = lots?.getCity ? await lots.getCity(p.city) : null;
  return utilityCostCents(service, lot?.district ?? 0, city?.districtCount ?? 1);
}

export async function startWork(
  store: PropertyStore,
  payments: PropertyPayments,
  input: { propertyId: string; accountId: string; kind: WorkKind; requestId?: string },
  now: () => Date,
  lots?: Pick<WorldStore, 'getLot'> & Partial<Pick<WorldStore, 'getCity'>>,
): Promise<{ work: PropertyWork; property: Property; claim: PropertyClaim | null }> {
  const p = await store.getProperty(input.propertyId);
  if (!p || p.ownerAccountId !== input.accountId) throw new AppError('not_found', 'Imóvel não encontrado.', 404);
  const t = now();
  if (phaseOf(p, t) !== 'ready') throw new AppError('property_not_ready', 'O imóvel ainda está em obra.', 409);

  let costCents: number;
  let toLevel: number | null = null;
  let toType: string | null = null;
  if (input.kind === 'repair') {
    costCents = repairCostCents(p, t);
    if (costCents <= 0) throw new AppError('nothing_to_repair', 'O imóvel não precisa de reparo.', 409);
  } else if (input.kind === 'upgrade') {
    const next = nextLevel(p);
    if (!next) throw new AppError('max_level', 'O imóvel já está no nível máximo.', 409);
    costCents = next.upgradeCostCents!;
    toLevel = next.level;
  } else if (input.kind === 'retype') {
    const current = typeOf(p.type);
    const next = nextTypeOf(p.type);
    if (!current || !next) throw new AppError('no_next_type', 'Este imóvel não tem troca de tipo disponível.', 409);
    if (p.level < current.levels.length) {
      throw new AppError('max_level_first', `Suba a ${current.label} até o nível ${current.levels.length} antes de trocar de tipo.`, 409);
    }
    costCents = Math.max(0, next.priceCents - current.priceCents);
    toType = next.code;
  } else if (input.kind === 'regularize') {
    if (p.regularizedAt) throw new AppError('already_regularized', 'O imóvel já está regularizado.', 409);
    costCents = regularizationCostCents(p);
  } else {
    const until = untilOf(p, input.kind);
    if (until && until.getTime() - t.getTime() > (UTILITY_MAX_AHEAD_DAYS - UTILITY_PERIOD_DAYS) * DAY_MS) {
      throw new AppError('utility_prepaid', `Já há serviço pago para mais de ${UTILITY_MAX_AHEAD_DAYS - UTILITY_PERIOD_DAYS} dias.`, 409);
    }
    costCents = await utilityCostOf(lots, p, input.kind);
  }

  const work: PropertyWork = {
    id: randomUUID(),
    propertyId: p.id,
    accountId: input.accountId,
    kind: input.kind,
    costCents,
    toLevel,
    toType,
    status: 'pending',
    createdAt: t,
  };
  await store.createWork(work);
  try {
    await payments.chargeWork(work, input.requestId);
  } catch (error) {
    // Sem saldo: a obra não acontece. Ledger fora: fica pendente e o job tenta de novo.
    if (error instanceof AppError && error.code === 'insufficient_thaler') await store.failWork(work.id);
    throw error;
  }
  const { property, claim } = await finishWork(store, payments, work, now, input.requestId, lots);
  return { work: { ...work, status: 'applied' }, property, claim };
}
