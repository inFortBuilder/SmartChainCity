import { z } from 'zod';

/** No .env, valor em branco quer dizer “não definido”. */
const optional = <T extends z.ZodType>(type: T) => z.preprocess((v) => (v === '' ? undefined : v), type.optional());

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(8020),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().optional(),
  /** O mesmo segredo do gateway: o game-core só valida o token, não emite. */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa de pelo menos 32 caracteres'),
  JWT_ISSUER: z.string().default('scc-gateway'),
  /** Chave dos outros serviços para as rotas internas (criar avatar no mint). */
  INTERNAL_TOKEN: z.string().min(32, 'INTERNAL_TOKEN precisa de pelo menos 32 caracteres'),
  /** Intervalo do job de queda dos atributos (trilha do backend: 15 min). */
  DECAY_EVERY_SECONDS: z.coerce.number().int().positive().default(900),
  /** Intervalo do job que conclui os turnos vencidos (shift.complete). */
  SHIFT_CHECK_SECONDS: z.coerce.number().int().positive().default(60),
  /** Ledger que paga os turnos. Sem os dois, a coleta responde 503. */
  ECONOMY_URL: optional(z.url()),
  ECONOMY_TOKEN: optional(z.string().min(32, 'ECONOMY_TOKEN precisa de pelo menos 32 caracteres')),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}
