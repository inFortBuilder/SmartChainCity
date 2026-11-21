import { AppError } from '@scc/shared';

import type { Venue, VenueDirectory } from '../domain/leisure.js';

/** Negócios de lazer de jogador pela rota interna do world (E3.3). */
export class WorldVenues implements VenueDirectory {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async venue(id: string): Promise<Venue | null> {
    let r: Response;
    try {
      r = await this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}/internal/v1/venues/${encodeURIComponent(id)}`, {
        headers: { 'x-service-token': this.token },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AppError('world_unavailable', 'O world não respondeu.', 503);
    }
    if (r.status === 404 || r.status === 400) return null;
    if (!r.ok) throw new AppError('world_unavailable', 'O world não respondeu.', 503);
    const { venue: v } = (await r.json()) as {
      venue: { id: string; activity: string; fee_cents: number; owner_account_id: string; open: boolean };
    };
    return { id: v.id, activity: v.activity, feeCents: BigInt(v.fee_cents), ownerAccountId: v.owner_account_id, open: v.open };
  }
}
