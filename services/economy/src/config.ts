import { z } from 'zod';

const list = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const schema = z.object({
  NODE_ENV: z.string().default('development'),
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
  /**
   * Só desenvolvimento: torneira de SCITY de teste para o jogador logado,
   * enquanto não existe depósito pela blockchain (Etapa 2). Recusada em produção.
   */
  DEV_FAUCET: z.stringbool().default(false),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = schema.parse(env);
  if (config.NODE_ENV === 'production' && config.DEV_FAUCET) {
    throw new Error('DEV_FAUCET é só para desenvolvimento.');
  }
  return config;
}
