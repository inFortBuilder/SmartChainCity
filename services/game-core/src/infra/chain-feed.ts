import type { ChainFeed, WalletOwners } from '../domain/chain-sync.js';

const base = (url: string) => url.replace(/\/$/, '');

/** Feed de eventos confirmados do chain-indexer (`/internal/v1/chain/events`). */
export class IndexerChainFeed implements ChainFeed {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async events(after: number, limit: number) {
    const r = await this.fetchFn(`${base(this.baseUrl)}/internal/v1/chain/events?after=${after}&limit=${limit}`, {
      headers: { 'x-service-token': this.token },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`chain-indexer respondeu ${r.status}`);
    const body = (await r.json()) as { events: { id: number; contract: string; event: string; args: Record<string, string> }[]; next_after: number };
    return { events: body.events, nextAfter: body.next_after };
  }
}

/** Conta dona da carteira pela rota interna do gateway. 404: ninguém ligou a carteira. */
export class GatewayWalletOwners implements WalletOwners {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async ownerOf(address: string) {
    const r = await this.fetchFn(`${base(this.baseUrl)}/internal/v1/wallets/${address}/account`, {
      headers: { 'x-service-token': this.token },
      signal: AbortSignal.timeout(10_000),
    });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`gateway respondeu ${r.status} ao procurar a carteira`);
    return ((await r.json()) as { account_id: string }).account_id;
  }
}
