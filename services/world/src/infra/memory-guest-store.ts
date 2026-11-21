import { AppError } from '@scc/shared';

import type { Guest, GuestStore, PlaceKind } from '../domain/visits.js';

/** Para testes e desenvolvimento. */
export class MemoryGuestStore implements GuestStore {
  private readonly rows = new Map<string, Guest>();
  private readonly key = (kind: PlaceKind, placeId: string, guest: string) => `${kind}:${placeId}:${guest}`;

  async addGuest(g: Guest, max: number) {
    const k = this.key(g.kind, g.placeId, g.guestAccountId);
    const others = [...this.rows.values()].filter((r) => r.kind === g.kind && r.placeId === g.placeId && r.invitedBy === g.invitedBy);
    if (!this.rows.has(k) && others.length >= max) throw new AppError('guest_limit', `Até ${max} convidados por imóvel.`, 409);
    this.rows.set(k, { ...g });
  }

  async removeGuest(kind: PlaceKind, placeId: string, guestAccountId: string) {
    return this.rows.delete(this.key(kind, placeId, guestAccountId));
  }

  async guestsOf(kind: PlaceKind, placeId: string, invitedBy: string) {
    return [...this.rows.values()].filter((r) => r.kind === kind && r.placeId === placeId && r.invitedBy === invitedBy).map((r) => ({ ...r }));
  }

  async isGuest(kind: PlaceKind, placeId: string, guestAccountId: string, invitedBy: string) {
    return this.rows.get(this.key(kind, placeId, guestAccountId))?.invitedBy === invitedBy;
  }

  async invitationsOf(guestAccountId: string) {
    return [...this.rows.values()].filter((r) => r.guestAccountId === guestAccountId).map((r) => ({ ...r }));
  }
}
