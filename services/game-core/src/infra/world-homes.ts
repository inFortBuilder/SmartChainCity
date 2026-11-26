import { AppError, forwardRequestId } from '@scc/shared';

import type { HomeDirectory } from '../domain/housing.js';

/** Casas da conta pela rota interna do world (regularizadas, com água e energia). */
export class WorldHomes implements HomeDirectory {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async homes(accountId: string, requestId?: string) {
    let r: Response;
    try {
      r = await this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}/internal/v1/accounts/${encodeURIComponent(accountId)}/homes`, {
        headers: { 'x-service-token': this.token, ...forwardRequestId(requestId) },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AppError('world_unavailable', 'O world não respondeu.', 503);
    }
    if (!r.ok) throw new AppError('world_unavailable', 'O world não respondeu.', 503);
    const { homes } = (await r.json()) as { homes: { id: string; label: string; regular: boolean; regular_until: string | null }[] };
    return homes.map((h) => ({ id: h.id, label: h.label, regular: h.regular, regularUntil: h.regular_until ? new Date(h.regular_until) : null }));
  }
}
