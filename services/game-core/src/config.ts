import { z } from 'zod';

/** No .env, valor em branco quer dizer “não definido”. */
const optional = <T extends z.ZodType>(type: T) => z.preprocess((v) => (v === '' ? undefined : v), type.optional());

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
  PORT: z.coerce.number().int().positive().default(8020),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().optional(),
  /** O mesmo segredo do gateway: o game-core só valida o token, não emite. */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa de pelo menos 32 caracteres'),
  JWT_ISSUER: z.string().default('scc-gateway'),
  /** Origens do navegador que podem chamar a API (o cliente web), separadas por vírgula. */
  CORS_ORIGINS: z.string().default('').transform(list),
  /** Chave dos outros serviços para as rotas internas (criar avatar no mint). */
  INTERNAL_TOKEN: z.string().min(32, 'INTERNAL_TOKEN precisa de pelo menos 32 caracteres'),
  /** Intervalo do job de queda dos atributos (trilha do backend: 15 min). */
  DECAY_EVERY_SECONDS: z.coerce.number().int().positive().default(900),
  /** Intervalo do job que conclui os turnos vencidos (shift.complete). */
  SHIFT_CHECK_SECONDS: z.coerce.number().int().positive().default(60),
  /** Ledger que paga os turnos. Sem os dois, a coleta responde 503. */
  ECONOMY_URL: optional(z.url()),
  ECONOMY_TOKEN: optional(z.string().min(32, 'ECONOMY_TOKEN precisa de pelo menos 32 caracteres')),
  /**
   * Só desenvolvimento: dá um avatar de teste a quem não tem (ainda não existe
   * Lucky Box) e encurta a duração do turno, sem mudar o pagamento.
   */
  DEV_FREE_AVATAR: z.stringbool().default(false),
  DEV_SHIFT_MINUTES: optional(z.coerce.number().positive()),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = schema.parse(env);
  if (config.NODE_ENV === 'production' && (config.DEV_FREE_AVATAR || config.DEV_SHIFT_MINUTES)) {
    throw new Error('DEV_FREE_AVATAR e DEV_SHIFT_MINUTES são só para desenvolvimento.');
  }
  return config;
}
