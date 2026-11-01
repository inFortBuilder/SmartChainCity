import { z } from 'zod';

const list = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(8000),
  HOST: z.string().default('127.0.0.1'),
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
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}
