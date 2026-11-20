import { z } from 'zod';

const list = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

/** No .env, valor em branco quer dizer “não definido”. */
const optional = <T extends z.ZodType>(type: T) => z.preprocess((v) => (v === '' ? undefined : v), type.optional());

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(8030),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().optional(),
  /** O mesmo segredo do gateway: o world só valida o token. */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa de pelo menos 32 caracteres'),
  JWT_ISSUER: z.string().default('scc-gateway'),
  CORS_ORIGINS: z.string().default('').transform(list),
  /** Ledger que cobra os lotes. Sem os dois, a compra responde 503. */
  ECONOMY_URL: optional(z.url()),
  ECONOMY_TOKEN: optional(z.string().min(32, 'ECONOMY_TOKEN precisa de pelo menos 32 caracteres')),
  /**
   * Cotação em US$ por SCITY. O preço do lote é em dólar (doc 13 §3) e pago
   * em SCITY pela cotação do dia; fica fixa aqui até o câmbio do economy
   * (passo 11 da trilha).
   */
  SCITY_USD: z.coerce.number().positive().default(1),
  /** Intervalo do job que resolve compras pendentes. */
  SETTLE_EVERY_SECONDS: z.coerce.number().int().positive().default(60),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}
