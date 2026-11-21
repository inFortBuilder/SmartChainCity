import type { DepositLedger, WalletOwners } from '../domain/deposits.js';

const base = (url: string) => url.replace(/\/$/, '');

/** Dono da carteira pela rota interna do gateway. 404 é "ninguém ligou esta carteira". */
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

/**
 * Crédito no ledger do economy: o SCITY sai de `system/vault` (o que está
 * guardado no contrato) para o jogador. A chave faz o crédito acontecer uma vez.
 */
export class EconomyDepositLedger implements DepositLedger {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async credit(key: string, accountId: string, amountWei: string, ref: string) {
    const r = await this.fetchFn(`${base(this.baseUrl)}/internal/v1/ledger/transactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-service-token': this.token, 'idempotency-key': key },
      body: JSON.stringify({
        kind: 'scity_deposit',
        ref_type: 'chain_log',
        ref_id: ref,
        legs: [
          { owner_type: 'system', owner_id: 'vault', currency: 'SCITY', amount: `-${amountWei}` },
          { owner_type: 'player', owner_id: accountId, currency: 'SCITY', amount: amountWei },
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`ledger respondeu ${r.status} ao creditar o depósito`);
  }
}
