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
  PORT: z.coerce.number().int().positive().default(8000),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().optional(),
  /** Serviços que publicam os números da cidade para o site (`GET /v1/public/stats`, E4.5). */
  GAME_CORE_URL: z.url().optional(),
  WORLD_URL: z.url().optional(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa de pelo menos 32 caracteres'),
  JWT_ISSUER: z.string().default('scc-gateway'),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  SIWE_DOMAINS: z.string().min(1).transform(list),
  SIWE_CHAIN_IDS: z
    .string()
    .default('97')
    .transform((value) => list(value).map(Number)),
  SIWE_NONCE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  CORS_ORIGINS: z.string().default('').transform(list),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),
  TRUST_PROXY: z.stringbool().default(false),
  /**
   * Como o código de login por e-mail chega: 'log' escreve no log do gateway
   * (MVP local, sem provedor pago; recusado em produção). 'off' desliga a rota.
   */
  EMAIL_LOGIN: z.enum(['log', 'off']).default('log'),
  EMAIL_CODE_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  EMAIL_CODE_RESEND_SECONDS: z.coerce.number().int().nonnegative().default(60),
  EMAIL_CODE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  /**
   * Captcha de prova de trabalho no login (SIWE) e no pedido do código por
   * e-mail, que é onde a conta nasce. 'off' é recusado em produção; em teste,
   * fica desligado salvo CAPTCHA=pow.
   */
  CAPTCHA: z.enum(['pow', 'off']).optional(),
  /** Maior número sorteado: em média o navegador testa metade (50 mil ≈ 0,1 a 0,5 s). */
  CAPTCHA_MAX_NUMBER: z.coerce.number().int().min(1000).max(10_000_000).default(50_000),
  CAPTCHA_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  /**
   * Token dos outros serviços para as rotas /internal (ex.: o world confere a
   * carteira de quem pede a cotação do lote). Sem ele, as rotas respondem 503.
   */
  INTERNAL_TOKEN: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(32, 'INTERNAL_TOKEN precisa de pelo menos 32 caracteres').optional(),
  ),
});

export type Config = Omit<z.infer<typeof schema>, 'CAPTCHA'> & { CAPTCHA: 'pow' | 'off' };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.parse(env);
  const config = { ...parsed, CAPTCHA: parsed.CAPTCHA ?? (parsed.NODE_ENV === 'test' ? 'off' : 'pow') };
  if (config.NODE_ENV === 'production' && config.CAPTCHA === 'off') {
    throw new Error('CAPTCHA=off não é aceito em produção: o cadastro precisa do captcha (doc 10).');
  }
  return config;
}
