import { AppError } from '@scc/shared';

import { ATTRIBUTE_MAX, type Avatar, inHospital } from './avatar.js';

/**
 * Hospital compulsório (E2.3, GDD §2.3 e §5): com saúde 0 ou energia 0, o
 * avatar é internado, paga a taxa de 30 THALER e perde 1 dia. A taxa vai para
 * a queima: hospital é um sink (doc 04 §7).
 *
 * Premissas desta etapa, a calibrar no simulador (o GDD não tem o número):
 * - Na alta, energia e saúde voltam cheias. Quem perde é o dia parado e a taxa.
 * - A alimentação continua caindo durante a internação.
 * - Sem THALER para a taxa, a internação segue e a taxa fica perdoada
 *   (`waived`): o jogador não pode ficar preso sem trabalhar para pagar. A
 *   inadimplência de verdade entra com os impostos (E2.6).
 * - Com um turno rodando, a internação espera o horário de fim do turno.
 */
export const HOSPITAL_FEE_CENTS = 3000n;
export const HOSPITAL_STAY_MS = 24 * 3_600_000;

export type HospitalReason = 'health' | 'energy';
export type FeeStatus = 'pending' | 'paid' | 'waived';

export interface HospitalStay {
  id: string;
  avatarId: string;
  accountId: string;
  reason: HospitalReason;
  feeCents: bigint;
  /** pending: ainda não cobrada no ledger. paid: cobrada. waived: sem THALER, perdoada. */
  feeStatus: FeeStatus;
  admittedAt: Date;
  dischargeAt: Date;
}

/** Precisa ser internado agora? Energia e saúde não caem com o tempo, então o valor gravado basta. */
export function needsHospital(avatar: Avatar, now: Date): HospitalReason | null {
  if (inHospital(avatar, now)) return null;
  if (avatar.attributes.health === 0) return 'health';
  if (avatar.attributes.energy === 0) return 'energy';
  return null;
}

/** Interna: devolve a internação e o avatar já com a alta marcada e os atributos da alta. */
export function admit(avatar: Avatar, id: string, now: Date): { stay: HospitalStay; avatar: Avatar } | null {
  const reason = needsHospital(avatar, now);
  if (!reason) return null;
  const dischargeAt = new Date(now.getTime() + HOSPITAL_STAY_MS);
  return {
    stay: {
      id,
      avatarId: avatar.id,
      accountId: avatar.accountId,
      reason,
      feeCents: HOSPITAL_FEE_CENTS,
      feeStatus: 'pending',
      admittedAt: now,
      dischargeAt,
    },
    avatar: {
      ...avatar,
      attributes: { ...avatar.attributes, energy: ATTRIBUTE_MAX, health: ATTRIBUTE_MAX },
      hospitalUntil: dischargeAt,
      updatedAt: now,
    },
  };
}

/** Recusa a ação de quem está internado. */
export function assertNotInHospital(avatar: Avatar, now: Date) {
  if (inHospital(avatar, now)) {
    throw new AppError(
      'in_hospital',
      `O avatar está internado até ${avatar.hospitalUntil!.toISOString()}.`,
      409,
    );
  }
}

/** Quem cobra a taxa: o ledger do economy. Separado para os testes trocarem por um falso. */
export interface HospitalPayer {
  /** THALER do jogador para a queima. Idempotente pela chave `hospital:<id>`. */
  chargeHospital(stay: HospitalStay, requestId?: string): Promise<void>;
}

/** Persistência das internações. Mora no banco do avatar: internar grava os dois juntos. */
export interface HospitalStore {
  /**
   * Interna quem precisa (só `avatarId`, se vier), sem turno rodando, e devolve
   * as internações criadas. Duas chamadas ao mesmo tempo não internam duas vezes.
   */
  admitDue(now: Date, batch: number, avatarId?: string): Promise<HospitalStay[]>;
  /** Internações com a taxa ainda não cobrada, as mais antigas primeiro. */
  pendingFees(batch: number): Promise<HospitalStay[]>;
  /** pending → paid ou waived. Repetir não faz nada. */
  settleFee(stayId: string, status: 'paid' | 'waived'): Promise<void>;
  listStays(avatarId: string, limit: number): Promise<HospitalStay[]>;
}
