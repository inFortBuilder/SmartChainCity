import { randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';

import type { City, Polygon, WorldStore } from './lots.js';
import type { PropertyStore } from './properties.js';

/**
 * Prédio de construtor sobre o lote (doc 13 §4, E2.10).
 *
 * O SCC Builder converte o modelo e confere a geometria (`validate-lot.php`),
 * mas quem manda o polígono e as regras do lote é o world, a partir do próprio
 * banco: o jogador não consegue validar contra um lote inventado. O Builder
 * confere que o modelo (job) é do jogador, pelo token dele, que o world repassa.
 *
 * Fluxo:
 * 1. Validação: cabe no lote com recuo, altura até o gabarito, triângulos e escala.
 *    Passar do coeficiente não reprova: exige outorga onerosa (doc 13 §4.1).
 * 2. Outorga: se houver, SCITY do jogador para a Prefeitura (`pool/treasury`)
 *    no ledger, antes de o prédio ir para o alvará.
 * 3. Alvará: moderação de conteúdo (doc 13 §4, passo 4). Aprovado ou recusado
 *    pela rota interna de revisão.
 *
 * Depois do alvará vêm as unidades, o `BuildingNFT` e a obra (E2.11, E3.11).
 */

export interface BuilderCheck {
  code: string;
  ok: boolean;
  severity?: string;
  [k: string]: unknown;
}

export interface BuilderValidation {
  valid: boolean;
  checks: BuilderCheck[];
  footprint: { hull: Polygon; area_m2: number };
  suggested_floors: number;
  placement: { position: [number, number]; rotation_deg: number; scale: number };
  job_id: string;
  model_id: string;
  version: number;
  artifacts: Record<string, string | null>;
}

export interface BuilderValidateInput {
  jobId: string;
  lot: { id: string; polygon: Polygon; setback_m: number; max_height_m: number; far: number };
  transform: { rotation_deg: number; units: string; position?: [number, number] };
}

/** O SCC Builder (`POST /api/validate-lot.php`), com o token do jogador. */
export interface BuilderClient {
  validate(input: BuilderValidateInput, authorization: string, requestId?: string): Promise<BuilderValidation>;
}

export type BuildingStatus = 'pending_payment' | 'pending_review' | 'approved' | 'rejected';

export interface Building {
  id: string;
  city: string;
  lotId: number;
  ownerAccountId: string;
  jobId: string;
  modelId: string;
  modelVersion: number;
  rotationDeg: number;
  position: [number, number];
  heightM: number;
  footprintM2: number;
  floors: number;
  gfaM2: number;
  /** Outorga onerosa em wei de SCITY (0 se coube no coeficiente). */
  outorgaWei: bigint;
  checks: BuilderCheck[];
  artifacts: Record<string, string | null>;
  status: BuildingStatus;
  reviewNote: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
}

export interface BuildingStore {
  /** `lot_has_building` (409) se o lote já tem um prédio que não foi recusado. */
  createBuilding(b: Building): Promise<void>;
  getBuilding(id: string): Promise<Building | null>;
  /** O prédio vigente do lote (o último que não foi recusado). */
  buildingOnLot(city: string, lotId: number): Promise<Building | null>;
  buildingsOf(accountId: string): Promise<Building[]>;
  /** Muda a situação só se ainda estiver em `from`; devolve se mudou. */
  moveBuilding(id: string, from: BuildingStatus, to: BuildingStatus, note: string | null, at: Date): Promise<boolean>;
  dropPendingBuilding(id: string): Promise<void>;
  pendingPaymentBuildings(olderThan: Date): Promise<Building[]>;
}

export interface OutorgaPayments {
  /** SCITY do jogador para a Prefeitura. Idempotente pelo prédio. */
  chargeOutorga(b: Building, requestId?: string): Promise<void>;
}

/** Validação reprovada: a API devolve as checagens para a tela mostrar o motivo. */
export class BuildingInvalidError extends AppError {
  constructor(readonly validation: BuilderValidation) {
    super('building_invalid', 'O prédio não passou na validação do lote.', 422);
  }
}

const WEI = 10n ** 18n;
const numberIn = (c: BuilderCheck | undefined, key: string) => (typeof c?.[key] === 'number' ? (c[key] as number) : 0);

export async function submitBuilding(
  lots: WorldStore,
  properties: PropertyStore | null,
  store: BuildingStore,
  builder: BuilderClient,
  payments: OutorgaPayments,
  input: {
    city: City;
    lotId: number;
    accountId: string;
    authorization: string;
    jobId: string;
    rotationDeg: number;
    units: string;
    position?: [number, number];
    requestId?: string;
  },
  now: () => Date,
): Promise<Building> {
  const lot = await lots.getLot(input.city.code, input.lotId);
  if (!lot) throw new AppError('not_found', 'Lote não encontrado.', 404);
  if (lot.status !== 'sold' || lot.ownerAccountId !== input.accountId) {
    throw new AppError('not_lot_owner', 'Só o dono do lote pode construir nele.', 403);
  }
  if (!lot.polygon) {
    throw new AppError('lot_without_polygon', 'Este lote ainda não tem o polígono no servidor; reimporte a cidade.', 409);
  }
  if (properties && (await properties.propertyOnLot(lot.city, lot.id))) {
    throw new AppError('lot_has_property', 'Este lote já tem um imóvel do catálogo.', 409);
  }
  if (await store.buildingOnLot(lot.city, lot.id)) {
    throw new AppError('lot_has_building', 'Este lote já tem um prédio.', 409);
  }
  const zone = input.city.zones.find((z) => z.key === lot.zone);
  if (!zone) throw new AppError('zone_not_allowed', 'Zona do lote sem regras.', 409);

  const v = await builder.validate(
    {
      jobId: input.jobId,
      lot: { id: `${lot.city}:${lot.id}`, polygon: lot.polygon, setback_m: zone.setbackM, max_height_m: zone.maxHeightM, far: zone.far },
      transform: { rotation_deg: input.rotationDeg, units: input.units, ...(input.position ? { position: input.position } : {}) },
    },
    input.authorization,
    input.requestId,
  );
  if (!v.valid) throw new BuildingInvalidError(v);

  const height = v.checks.find((c) => c.code === 'height');
  const far = v.checks.find((c) => c.code === 'far');
  const outorgaScity = far && !far.ok && far.severity === 'fee' ? Math.max(0, Math.round(numberIn(far, 'outorga_scity'))) : 0;

  const t = now();
  const building: Building = {
    id: randomUUID(),
    city: lot.city,
    lotId: lot.id,
    ownerAccountId: input.accountId,
    jobId: v.job_id,
    modelId: v.model_id,
    modelVersion: v.version,
    rotationDeg: v.placement.rotation_deg,
    position: v.placement.position,
    heightM: numberIn(height, 'value'),
    footprintM2: v.footprint.area_m2,
    floors: v.suggested_floors,
    gfaM2: numberIn(far, 'gfa_m2'),
    outorgaWei: BigInt(outorgaScity) * WEI,
    checks: v.checks,
    artifacts: v.artifacts,
    status: outorgaScity > 0 ? 'pending_payment' : 'pending_review',
    reviewNote: null,
    createdAt: t,
    reviewedAt: null,
  };
  await store.createBuilding(building);
  if (outorgaScity === 0) return building;

  try {
    await payments.chargeOutorga(building, input.requestId);
  } catch (error) {
    // Sem SCITY: o prédio não entra. Ledger fora: fica pendente e o job tenta de novo.
    if (error instanceof AppError && error.code === 'insufficient_scity') await store.dropPendingBuilding(building.id);
    throw error;
  }
  await store.moveBuilding(building.id, 'pending_payment', 'pending_review', null, t);
  return { ...building, status: 'pending_review' };
}

/** Alvará: a moderação aprova ou recusa o prédio que já passou na validação. */
export async function reviewBuilding(store: BuildingStore, id: string, approve: boolean, note: string | null, now: Date) {
  const b = await store.getBuilding(id);
  if (!b) throw new AppError('not_found', 'Prédio não encontrado.', 404);
  const moved = await store.moveBuilding(id, 'pending_review', approve ? 'approved' : 'rejected', note, now);
  if (!moved) throw new AppError('building_not_in_review', 'Este prédio não está esperando alvará.', 409);
  return (await store.getBuilding(id))!;
}

/** Job: outorgas que ficaram pendentes (resposta do ledger perdida). */
export async function settleBuildings(store: BuildingStore, payments: OutorgaPayments, now: Date): Promise<number> {
  let n = 0;
  for (const b of await store.pendingPaymentBuildings(new Date(now.getTime() - 30_000))) {
    try {
      await payments.chargeOutorga(b);
      await store.moveBuilding(b.id, 'pending_payment', 'pending_review', null, now);
      n++;
    } catch (error) {
      if (error instanceof AppError && error.code === 'insufficient_scity') {
        await store.dropPendingBuilding(b.id);
        n++;
      }
    }
  }
  return n;
}
