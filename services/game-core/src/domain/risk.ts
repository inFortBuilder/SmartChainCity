import { createHmac } from 'node:crypto';

import { AppError } from '@scc/shared';

/**
 * Antifraude v1 (E2.9, doc 10 §2 "multi-contas / bots farmando P2E").
 *
 * O limite de 3 avatares por conta (ADR-0013) já vale na criação do avatar. Isto
 * cuida do resto: várias contas no mesmo aparelho ou na mesma rede, e pedidos
 * rápidos demais, nas rotas que emitem P2E (começar turno e coletar).
 *
 * - Sinais: o id do aparelho (`x-device-id`, gerado e guardado pelo cliente) e a
 *   rede (IPv4 /24 ou IPv6 /64). Os dois entram como HMAC: o banco não guarda IP
 *   nem id puro (LGPD). O HMAC usa um segredo do servidor, então não dá para
 *   montar a tabela de volta a partir de IPs conhecidos.
 * - Regra do aparelho (bloqueia): no máximo 3 contas ganhando P2E no mesmo
 *   aparelho em 30 dias. É o "3 por IP" do GDD adaptado (doc 02 §2: "por conta +
 *   antifraude"). As 3 primeiras contas seguem; da 4ª em diante, o turno fica
 *   em revisão (`403 risk_review`) até a moderação liberar.
 * - Regra da rede (só alerta): mais de 10 contas na mesma rede em 24 h. Lan
 *   house, escola e operadora com NAT juntam muita gente; vira métrica e log
 *   para a revisão humana, sem bloquear.
 * - Decisão manual vence as regras: `allow` libera a conta, `block` bloqueia.
 *
 * PREMISSAS (sem dados ainda): 3 contas por aparelho, 30 dias, 10 contas por
 * rede em 24 h. Ajustar com as métricas do alpha.
 */

export const DEVICE_ACCOUNT_LIMIT = 3;
export const DEVICE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const NETWORK_ACCOUNT_ALERT = 10;
export const NETWORK_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface RiskSignal {
  accountId: string;
  /** HMAC do id do aparelho, ou null se o cliente não mandou. */
  device: string | null;
  /** HMAC da rede (/24 ou /64). */
  network: string;
  at: Date;
}

export type RiskDecision = 'allow' | 'block';

export interface RiskStore {
  /** Guarda o sinal (primeira e última vez de cada par conta + aparelho + rede). */
  record(s: RiskSignal): Promise<void>;
  /** Contas vistas no aparelho desde `since`, em ordem da primeira vez. */
  accountsOnDevice(device: string, since: Date): Promise<string[]>;
  accountsOnNetwork(network: string, since: Date): Promise<string[]>;
  decision(accountId: string): Promise<{ decision: RiskDecision; note: string | null; at: Date } | null>;
  decide(accountId: string, decision: RiskDecision, note: string | null, at: Date): Promise<void>;
  /** Contas com sinal recente que dividem aparelho com outras (para a revisão). */
  sharedDevices(since: Date, minAccounts: number): Promise<{ device: string; accounts: string[] }[]>;
}

export interface RiskVerdict {
  ok: boolean;
  rule: 'manual_allow' | 'manual_block' | 'device_limit' | 'none';
  networkAlert: boolean;
  device: string | null;
}

export interface RiskMetrics {
  inc(name: string, help: string, labels?: Record<string, string>): void;
}

/** Rede do cliente: IPv4 /24 ou IPv6 /64 (o resto do endereço muda à toa). */
export function networkOf(ip: string): string {
  const v4 = /^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.\d+$/.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  const parts = ip.split(':');
  if (parts.length >= 4) return `${parts.slice(0, 4).join(':')}::/64`;
  return ip;
}

/** Id do aparelho aceito: 16 a 64 caracteres seguros. Qualquer outra coisa conta como ausente. */
export const deviceIdOf = (header: unknown): string | null =>
  typeof header === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(header) ? header : null;

export class RiskGuard {
  constructor(
    private readonly store: RiskStore,
    private readonly pepper: string,
    private readonly metrics: RiskMetrics | null = null,
    private readonly log: (msg: string, data: Record<string, unknown>) => void = () => {},
  ) {}

  private hmac = (kind: string, value: string) => createHmac('sha256', this.pepper).update(`${kind}:${value}`).digest('hex').slice(0, 32);

  /**
   * Registra o pedido e decide se a conta pode ganhar P2E agora. Chamado ao
   * começar o turno e ao coletar.
   */
  async check(input: { accountId: string; deviceHeader: unknown; ip: string; action: 'work' | 'claim' | 'race' }, now: Date): Promise<RiskVerdict> {
    const rawDevice = deviceIdOf(input.deviceHeader);
    const device = rawDevice ? this.hmac('device', rawDevice) : null;
    const network = this.hmac('network', networkOf(input.ip));
    await this.store.record({ accountId: input.accountId, device, network, at: now });
    this.metrics?.inc('risk_signals_total', 'Pedidos de P2E vistos pelo antifraude.', { action: input.action, device: device ? 'sim' : 'nao' });

    const manual = await this.store.decision(input.accountId);
    const net = await this.store.accountsOnNetwork(network, new Date(now.getTime() - NETWORK_WINDOW_MS));
    const networkAlert = net.length > NETWORK_ACCOUNT_ALERT;
    if (networkAlert) {
      this.metrics?.inc('risk_flags_total', 'Alertas do antifraude (sem bloqueio).', { rule: 'network' });
      this.log('risk.network_alert', { account: input.accountId, accounts_on_network: net.length });
    }

    if (manual?.decision === 'allow') return { ok: true, rule: 'manual_allow', networkAlert, device };
    if (manual?.decision === 'block') {
      this.metrics?.inc('risk_blocks_total', 'Pedidos de P2E barrados pelo antifraude.', { rule: 'manual' });
      return { ok: false, rule: 'manual_block', networkAlert, device };
    }

    if (device) {
      const accounts = await this.store.accountsOnDevice(device, new Date(now.getTime() - DEVICE_WINDOW_MS));
      const position = accounts.indexOf(input.accountId);
      if (position >= DEVICE_ACCOUNT_LIMIT) {
        this.metrics?.inc('risk_blocks_total', 'Pedidos de P2E barrados pelo antifraude.', { rule: 'device' });
        this.log('risk.device_limit', { account: input.accountId, accounts_on_device: accounts.length });
        return { ok: false, rule: 'device_limit', networkAlert, device };
      }
    }
    return { ok: true, rule: 'none', networkAlert, device };
  }

  /** Lança `403 risk_review` quando a conta não pode ganhar P2E. */
  async assert(input: Parameters<RiskGuard['check']>[0], now: Date) {
    const v = await this.check(input, now);
    if (!v.ok) {
      throw new AppError(
        'risk_review',
        v.rule === 'manual_block'
          ? 'Esta conta está bloqueada para ganhos. Fale com o suporte.'
          : 'Muitas contas ganhando neste aparelho. A conta foi para revisão; o suporte libera se estiver tudo certo.',
        403,
      );
    }
    return v;
  }
}

/** Balde de fichas por conta, para as rotas de P2E (velocidade). */
export class AccountRateLimit {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly perMinute: number,
    private readonly metrics: RiskMetrics | null = null,
  ) {}

  take(accountId: string, now: number) {
    const b = this.buckets.get(accountId) ?? { tokens: this.perMinute, at: now };
    b.tokens = Math.min(this.perMinute, b.tokens + ((now - b.at) / 60_000) * this.perMinute);
    b.at = now;
    this.buckets.set(accountId, b);
    if (b.tokens < 1) {
      this.metrics?.inc('risk_blocks_total', 'Pedidos de P2E barrados pelo antifraude.', { rule: 'velocity' });
      throw new AppError('too_many_requests', 'Pedidos demais em pouco tempo. Espere um minuto.', 429);
    }
    b.tokens -= 1;
  }
}
