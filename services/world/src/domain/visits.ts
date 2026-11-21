import { AppError } from '@scc/shared';

import type { BuildingStore } from './buildings.js';
import { type PropertyStore, phaseOf } from './properties.js';

/**
 * Visitas: entrar no interior de um imóvel pelo street view.
 *
 * - Residência: o imóvel do lote (a Casa T1 e os próximos tipos residenciais).
 * - Escritório: o prédio de construtor aprovado no lote (E2.11).
 *
 * Entra o dono e quem ele convidou. O convite vale só enquanto quem convidou
 * ainda é o dono: se o imóvel ou o prédio muda de dono (venda na blockchain,
 * leilão), os convites antigos param de valer sem precisar apagar nada.
 */
export type PlaceKind = 'property' | 'building';
export type Interior = 'home' | 'office';
export const MAX_GUESTS = 20; // PREMISSA

export interface Guest {
  kind: PlaceKind;
  placeId: string;
  guestAccountId: string;
  invitedBy: string;
  createdAt: Date;
}

export interface GuestStore {
  /** Grava ou renova o convite; `guest_limit` (409) se o lugar já tem `max` convidados de `invitedBy`. */
  addGuest(g: Guest, max: number): Promise<void>;
  removeGuest(kind: PlaceKind, placeId: string, guestAccountId: string): Promise<boolean>;
  guestsOf(kind: PlaceKind, placeId: string, invitedBy: string): Promise<Guest[]>;
  isGuest(kind: PlaceKind, placeId: string, guestAccountId: string, invitedBy: string): Promise<boolean>;
  invitationsOf(guestAccountId: string): Promise<Guest[]>;
}

export interface Place {
  kind: PlaceKind;
  id: string;
  city: string;
  lotId: number;
  ownerAccountId: string;
  interior: Interior;
  label: string;
}

interface Deps {
  properties: PropertyStore | null;
  buildings: BuildingStore | null;
}

/** O lugar visitável do lote: o prédio aprovado ou o imóvel pronto. */
export async function placeOnLot(deps: Deps, city: string, lotId: number, now: Date): Promise<Place> {
  const b = await deps.buildings?.buildingOnLot(city, lotId);
  if (b && b.status === 'approved') {
    return { kind: 'building', id: b.id, city, lotId, ownerAccountId: b.ownerAccountId, interior: 'office', label: 'Escritório' };
  }
  const p = await deps.properties?.propertyOnLot(city, lotId);
  if (p && p.status === 'active') {
    if (phaseOf(p, now) !== 'ready') throw new AppError('under_construction', 'Este imóvel ainda está em obra.', 409);
    return { kind: 'property', id: p.id, city, lotId, ownerAccountId: p.ownerAccountId, interior: 'home', label: 'Residência' };
  }
  throw new AppError('nothing_to_visit', 'Não há imóvel para visitar neste lote.', 404);
}

export async function placeById(deps: Deps, kind: PlaceKind, id: string, now: Date): Promise<Place> {
  const where = kind === 'building' ? await deps.buildings?.getBuilding(id) : await deps.properties?.getProperty(id);
  const place = where ? await placeOnLot(deps, where.city, where.lotId, now).catch(() => null) : null;
  // O lugar precisa ser o visitável do lote (prédio aprovado ou imóvel pronto).
  if (!place || place.id !== id || place.kind !== kind) throw new AppError('not_found', 'Imóvel não encontrado.', 404);
  return place;
}

/** Quem pode entrar: o dono ou um convidado do dono atual. */
export async function visit(deps: Deps & { guests: GuestStore }, city: string, lotId: number, accountId: string, now: Date) {
  const place = await placeOnLot(deps, city, lotId, now);
  if (place.ownerAccountId === accountId) return { place, role: 'owner' as const };
  if (await deps.guests.isGuest(place.kind, place.id, accountId, place.ownerAccountId)) return { place, role: 'guest' as const };
  throw new AppError('not_invited', 'Só o dono e quem ele convidou podem entrar.', 403);
}

export async function invite(
  deps: Deps & { guests: GuestStore },
  input: { kind: PlaceKind; placeId: string; ownerAccountId: string; guestAccountId: string },
  now: Date,
): Promise<Guest> {
  const place = await placeById(deps, input.kind, input.placeId, now);
  if (place.ownerAccountId !== input.ownerAccountId) throw new AppError('not_found', 'Imóvel não encontrado.', 404);
  if (input.guestAccountId === input.ownerAccountId) throw new AppError('self_invite', 'Você já pode entrar: o imóvel é seu.', 400);
  const g: Guest = { kind: input.kind, placeId: input.placeId, guestAccountId: input.guestAccountId, invitedBy: input.ownerAccountId, createdAt: now };
  await deps.guests.addGuest(g, MAX_GUESTS);
  return g;
}

export async function ownedPlace(deps: Deps, kind: PlaceKind, placeId: string, accountId: string, now: Date) {
  const place = await placeById(deps, kind, placeId, now);
  if (place.ownerAccountId !== accountId) throw new AppError('not_found', 'Imóvel não encontrado.', 404);
  return place;
}

export const guestDto = (g: Guest) => ({ kind: g.kind, place_id: g.placeId, account_id: g.guestAccountId, invited_at: g.createdAt.toISOString() });
export const placeDto = (p: Place) => ({ kind: p.kind, id: p.id, city: p.city, lot_id: p.lotId, interior: p.interior, label: p.label });
