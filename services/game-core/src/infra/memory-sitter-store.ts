import { AppError } from '@scc/shared';

import type { PetSitterStore, SitterOffer, Sitting, SittingStatus } from '../domain/sitter.js';

const full = () => new AppError('sitter_full', 'Este Pet Sitter já está com todos os pets que pode cuidar.', 409);

/** Pet Sitter em memória (dev e testes). Mesmo contrato do Postgres. */
export class MemoryPetSitterStore implements PetSitterStore {
  private readonly offers = new Map<string, SitterOffer>();
  private readonly sittings = new Map<string, Sitting>();

  async offer(avatarId: string) {
    const o = this.offers.get(avatarId);
    return o ? { ...o } : null;
  }

  async setOffer(offer: SitterOffer) {
    this.offers.set(offer.avatarId, { ...offer });
  }

  async openOffers() {
    return [...this.offers.values()].filter((o) => o.open).map((o) => ({ ...o }));
  }

  private live(sitterAvatarId: string, now: Date) {
    return [...this.sittings.values()].filter(
      (s) => s.sitterAvatarId === sitterAvatarId && s.status !== 'cancelled' && s.endsAt.getTime() > now.getTime(),
    );
  }

  /** Sem await entre contar e gravar: duas reservas juntas não passam da capacidade. */
  async reserve(sitting: Sitting, capacity: number, now: Date) {
    if (this.live(sitting.sitterAvatarId, now).length >= capacity) throw full();
    this.sittings.set(sitting.id, { ...sitting });
    return { ...sitting };
  }

  async setStatus(id: string, status: SittingStatus) {
    const s = this.sittings.get(id);
    if (s) s.status = status;
  }

  async current(sitterAvatarId: string, now: Date) {
    return this.live(sitterAvatarId, now).map((s) => ({ ...s }));
  }

  async latestOf(ownerAvatarId: string) {
    const mine = [...this.sittings.values()].filter((s) => s.ownerAvatarId === ownerAvatarId);
    mine.sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
    return mine[0] ? { ...mine[0] } : null;
  }
}
