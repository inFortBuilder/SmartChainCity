import { z } from 'zod';

const list = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Token do Prometheus para ler /metrics; sem ele, /metrics fica desligado em produção. */
  METRICS_TOKEN: z.string().min(32, 'METRICS_TOKEN precisa de pelo menos 32 caracteres').optional(),
  PORT: z.coerce.number().int().positive().default(8010),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().optional(),
  /** O mesmo segredo do gateway: o economy só valida o token, não emite. */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa de pelo menos 32 caracteres'),
  JWT_ISSUER: z.string().default('scc-gateway'),
  /** Origens do navegador que podem chamar a API (o cliente web), separadas por vírgula. */
  CORS_ORIGINS: z.string().default('').transform(list),
  /** Chave dos outros serviços (game-core, world) para lançar no ledger. */
  INTERNAL_TOKEN: z.string().min(32, 'INTERNAL_TOKEN precisa de pelo menos 32 caracteres'),
  /** Intervalo do job economy.panel (indicadores no /metrics). 0 desliga (testes). */
  PANEL_EVERY_SECONDS: z.coerce.number().int().nonnegative().default(60),
  /**
   * Só desenvolvimento: torneira de SCITY de teste para o jogador logado,
   * enquanto não existe depósito pela blockchain (Etapa 2). Recusada em produção.
   */
  DEV_FAUCET: z.stringbool().default(false),
  /**
   * Saque pelo GameVault (E3.7). Precisa dos cinco: o gateway confere a
   * carteira, a chave assina o voucher e a RPC diz se ele foi resgatado.
   */
  GATEWAY_URL: z.preprocess((v) => (v === '' ? undefined : v), z.url().optional()),
  GATEWAY_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(32).optional()),
  RPC_URL: z.preprocess((v) => (v === '' ? undefined : v), z.url().optional()),
  CHAIN_ID: z.coerce.number().int().positive().default(31337),
  GAME_VAULT_ADDRESS: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional()),
  /** Só no MVP local: em produção a chave fica num KMS. */
  VAULT_SIGNER_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional()),
  WITHDRAW_EVERY_SECONDS: z.coerce.number().int().nonnegative().default(60),
  /** Câmbio: preço do SCITY em dólar para a primeira cotação, se o banco ainda não tiver uma (PREMISSA: US$ 1). */
  SCITY_USD: z.coerce.number().positive().default(1),
  /** Início da liberação do pool P2E (TGE). Sem ele, o freio do pool fica desligado. */
  P2E_START: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.date().optional()),
  /** Fim do período grátis (ADR-0014): o THALER ganho antes não vira SCITY. Sem ele, não há período grátis. */
  FREE_PERIOD_UNTIL: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.date().optional()),
  /**
   * Cotação pelo TWAP da DEX (job fx.twap). Precisa do RPC_URL, do pool SCITY/USDT
   * (PancakeSwap V3) e do endereço do SCITY. Sem eles, a cotação vem só da rota interna.
   */
  DEX_POOL_ADDRESS: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional()),
  SCITY_TOKEN_ADDRESS: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional()),
  /** Janela da média, em segundos (doc 04 §5: 24 h). O pool precisa guardar observações para ela. */
  FX_TWAP_SECONDS: z.coerce.number().int().min(600).max(7 * 86_400).default(86_400),
  /** Uma cotação nova a cada tantas horas (doc 04 §5: diária). */
  FX_PERIOD_HOURS: z.coerce.number().positive().default(24),
  /** Disjuntor: salto maior que isso sobre a cotação em vigor não é aplicado (PREMISSA: 50%). */
  FX_MAX_JUMP_BPS: z.coerce.number().int().positive().max(100_000).default(5000),
  /** De quanto em quanto tempo o job confere se a cotação venceu. 0 desliga. */
  FX_CHECK_SECONDS: z.coerce.number().int().nonnegative().default(600),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = schema.parse(env);
  if (config.NODE_ENV === 'production' && config.DEV_FAUCET) {
    throw new Error('DEV_FAUCET é só para desenvolvimento.');
  }
  if (config.NODE_ENV === 'production' && config.VAULT_SIGNER_KEY) {
    throw new Error('VAULT_SIGNER_KEY no .env é só para o MVP local: em produção a chave fica num KMS.');
  }
  return config;
}
