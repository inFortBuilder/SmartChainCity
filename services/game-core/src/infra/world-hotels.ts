import { AppError, forwardRequestId } from '@scc/shared';

import type { HotelDirectory, PlayerHotel } from '../domain/housing.js';

interface HotelJson {
  id: string;
  city: string;
  label: string;
  level: number;
  rooms: number;
  lot_code: string;
  open: boolean;
  owner_account_id: string;
}
const fromJson = (h: HotelJson): PlayerHotel => ({
  id: h.id,
  city: h.city,
  label: h.label,
  level: h.level,
  rooms: h.rooms,
  lotCode: h.lot_code,
  open: h.open,
  ownerAccountId: h.owner_account_id,
});

/** Hotéis de jogador pelas rotas internas do world (GDD §6 "Hotel"). */
export class WorldHotels implements HotelDirectory {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async get(path: string, requestId?: string): Promise<Response | null> {
    let r: Response;
    try {
      r = await this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
        headers: { 'x-service-token': this.token, ...forwardRequestId(requestId) },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AppError('world_unavailable', 'O world não respondeu.', 503);
    }
    if (r.status === 404 || r.status === 400) return null;
    if (!r.ok) throw new AppError('world_unavailable', 'O world não respondeu.', 503);
    return r;
  }

  async hotel(id: string, requestId?: string): Promise<PlayerHotel | null> {
    const r = await this.get(`/internal/v1/hotels/${encodeURIComponent(id)}`, requestId);
    return r ? fromJson(((await r.json()) as { hotel: HotelJson }).hotel) : null;
  }

  async hotels(city: string, requestId?: string): Promise<PlayerHotel[]> {
    const r = await this.get(`/internal/v1/cities/${encodeURIComponent(city)}/hotels`, requestId);
    return r ? ((await r.json()) as { hotels: HotelJson[] }).hotels.map(fromJson) : [];
  }
}
