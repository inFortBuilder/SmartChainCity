/**
 * Preço do SCITY em dólar, da cotação do câmbio do economy (`GET /v1/economy/fx`,
 * passo 11 da trilha). O lote tem preço em dólar e é pago em SCITY: com a
 * cotação do dia, o preço em dólar fica estável quando o SCITY oscila.
 *
 * A leitura é síncrona (o valor guardado); `refresh` busca de novo e o `main`
 * chama a cada minuto. Sem o economy, fica o último valor conhecido, ou o
 * `SCITY_USD` do `.env` se nunca houve um.
 */
export class EconomyScityPrice {
  private value: number;
  lastRefresh: Date | null = null;

  constructor(
    private readonly baseUrl: string,
    fallbackUsd: number,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.value = fallbackUsd;
  }

  usd = () => this.value;

  async refresh(now = new Date()) {
    try {
      const r = await this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}/v1/economy/fx`, { signal: AbortSignal.timeout(5_000) });
      if (!r.ok) return false;
      const body = (await r.json()) as { scity_usd?: number };
      if (typeof body.scity_usd !== 'number' || !(body.scity_usd > 0)) return false;
      this.value = body.scity_usd;
      this.lastRefresh = now;
      return true;
    } catch {
      return false;
    }
  }
}
