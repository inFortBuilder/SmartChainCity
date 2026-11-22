import { AppError } from '@scc/shared';

import type { Avatar } from './avatar.js';

/**
 * Pet Sitter como serviço de jogador (E3.1, GDD §2 "Pets e Pet Shop": "Pet sitter recebe produtividade
 * + 20%").
 *
 * - O avatar com a profissão Pet Sitter abre a oferta e escolhe o preço da diária.
 * - Outro jogador deixa o pet com ele por 24 h, com o mesmo cuidado do hotel do Pet Shop: alimentação e
 *   água cheias, +2 de felicidade e nenhuma queda enquanto estiver lá.
 * - O dono paga pelo ledger: 90% vão para o sitter e 10% para a queima (taxa da Prefeitura, como no lazer).
 * - Enquanto cuida de pelo menos um pet, o turno do sitter rende +20% (`snapshot.sitter`).
 *
 * PREMISSAS desta etapa, a calibrar no simulador:
 * - Diária de 10 a 40 THALER (o hotel do Pet Shop custa 20).
 * - Até 3 pets por sitter ao mesmo tempo.
 * - O bônus vale para o turno que começa com algum pet sob cuidado.
 * - O sitter não atende o próprio pet nem outro avatar da própria conta.
 */
export const SITTER_JOB = 'pet_sitter';
export const SITTER_PRICE_MIN_CENTS = 10_00n;
export const SITTER_PRICE_MAX_CENTS = 40_00n;
export const SITTER_CAPACITY = 3;
export const SITTER_STAY_MS = 24 * 3_600_000;
export const SITTER_SHARE_BPS = 9000n;
export const SITTER_BONUS = 1.2;

export interface SitterOffer {
  avatarId: string;
  accountId: string;
  priceCents: bigint;
  open: boolean;
  updatedAt: Date;
}

export type SittingStatus = 'reserved' | 'active' | 'cancelled';

export interface Sitting {
  id: string;
  sitterAvatarId: string;
  sitterAccountId: string;
  ownerAvatarId: string;
  ownerAccountId: string;
  priceCents: bigint;
  startsAt: Date;
  endsAt: Date;
  /** reserved: vaga segura, pagamento em curso. active: pago. cancelled: o pagamento falhou. */
  status: SittingStatus;
}

export interface PetSitterStore {
  offer(avatarId: string): Promise<SitterOffer | null>;
  setOffer(offer: SitterOffer): Promise<void>;
  openOffers(): Promise<SitterOffer[]>;
  /**
   * Segura a vaga: confere, com o sitter travado, que ele tem menos de `capacity` pets agora
   * (reservas e ativas que ainda não acabaram). Sem vaga, `sitter_full`.
   */
  reserve(sitting: Sitting, capacity: number, now: Date): Promise<Sitting>;
  setStatus(id: string, status: SittingStatus): Promise<void>;
  /** Estadias que ainda não acabaram e não foram canceladas, do sitter. */
  current(sitterAvatarId: string, now: Date): Promise<Sitting[]>;
  /** A estadia mais recente do pet do avatar dono. */
  latestOf(ownerAvatarId: string): Promise<Sitting | null>;
}

/** Só quem tem a profissão abre a oferta, com o preço dentro da faixa. */
export function checkOffer(avatar: Avatar, priceCents: bigint) {
  if (avatar.jobCode !== SITTER_JOB) {
    throw new AppError('not_pet_sitter', 'Só o avatar com a profissão Pet Sitter oferece o serviço.', 409);
  }
  if (priceCents < SITTER_PRICE_MIN_CENTS || priceCents > SITTER_PRICE_MAX_CENTS) {
    throw new AppError('invalid_price', 'A diária do Pet Sitter vai de 10 a 40 THALER.', 400);
  }
}

/** Confere a contratação; o pet em si passa pelo `checkService(…, 'hotel')` (vivo e fora do hotel). */
export function checkBooking(owner: Avatar, offer: SitterOffer | null) {
  if (!offer || !offer.open) throw new AppError('sitter_closed', 'Este Pet Sitter não está atendendo agora.', 409);
  if (offer.accountId === owner.accountId) {
    throw new AppError('own_sitter', 'O Pet Sitter não atende os pets da própria conta.', 409);
  }
}

export const sitterSplit = (cents: bigint) => {
  const sitter = (cents * SITTER_SHARE_BPS) / 10_000n;
  return { sitter, burn: cents - sitter };
};

/** Fator do turno do sitter: +20% se começa com algum pet sob cuidado. */
export const sitterFactor = (avatar: Pick<Avatar, 'jobCode'>, caring: number) =>
  avatar.jobCode === SITTER_JOB && caring > 0 ? SITTER_BONUS : 1;

export const offerDto = (o: SitterOffer, caring: number) => ({
  avatar_id: o.avatarId,
  price: o.priceCents.toString(),
  open: o.open,
  slots: Math.max(0, SITTER_CAPACITY - caring),
  capacity: SITTER_CAPACITY,
});

export const sittingDto = (s: Sitting) => ({
  id: s.id,
  sitter_avatar_id: s.sitterAvatarId,
  owner_avatar_id: s.ownerAvatarId,
  price: s.priceCents.toString(),
  starts_at: s.startsAt.toISOString(),
  ends_at: s.endsAt.toISOString(),
  status: s.status,
});
