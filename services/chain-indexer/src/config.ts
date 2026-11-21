import { readFileSync } from 'node:fs';

import { z } from 'zod';

const list = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

/** No .env, valor em branco quer dizer “não definido”. */
const optional = <T extends z.ZodType>(type: T) => z.preprocess((v) => (v === '' ? undefined : v), type.optional());
const address = optional(z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'endereço inválido'));

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  METRICS_TOKEN: optional(z.string().min(32, 'METRICS_TOKEN precisa de pelo menos 32 caracteres')),
  PORT: z.coerce.number().int().positive().default(8040),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().optional(),
  CORS_ORIGINS: z.string().default('').transform(list),
  /** Token dos outros serviços para o feed de eventos (/internal). Sem ele, o feed responde 503. */
  INTERNAL_TOKEN: optional(z.string().min(32, 'INTERNAL_TOKEN precisa de pelo menos 32 caracteres')),
  /** RPC da rede: anvil (http://127.0.0.1:8545), BSC Testnet ou BSC. Sem ele, o indexer só serve a API. */
  RPC_URL: optional(z.url()),
  CHAIN_ID: z.coerce.number().int().positive().default(31337),
  /** Blocos em cima antes de ler (doc 05: 15 na BSC). No anvil, 0 ou 1. */
  CONFIRMATIONS: z.coerce.number().int().nonnegative().default(15),
  /** Primeiro bloco a ler: o do deploy dos contratos. */
  START_BLOCK: z.coerce.bigint().nonnegative().default(0n),
  BATCH_BLOCKS: z.coerce.number().int().positive().default(2000),
  /** Quanto voltar quando o bloco do cursor muda de hash. */
  REORG_DEPTH: z.coerce.number().int().positive().default(64),
  POLL_SECONDS: z.coerce.number().positive().default(3),
  /**
   * Endereços dos contratos. Com DEPLOYMENTS_FILE (ex.: ../../contracts/deployments/anvil.json),
   * os que faltarem saem do arquivo.
   */
  DEPLOYMENTS_FILE: optional(z.string()),
  LAND_NFT_ADDRESS: address,
  AVATAR_NFT_ADDRESS: address,
  LUCKY_BOX_ADDRESS: address,
  PROPERTY_NFT_ADDRESS: address,
  GAME_VAULT_ADDRESS: address,
  /** Crédito dos depósitos: o gateway diz de quem é a carteira e o economy lança o SCITY. Sem os quatro, o crédito fica desligado. */
  GATEWAY_URL: optional(z.url()),
  GATEWAY_TOKEN: optional(z.string().min(32)),
  ECONOMY_URL: optional(z.url()),
  ECONOMY_TOKEN: optional(z.string().min(32)),
});

export type Config = z.infer<typeof schema> & {
  contracts: { LandNFT?: `0x${string}`; AvatarNFT?: `0x${string}`; LuckyBox?: `0x${string}`; PropertyNFT?: `0x${string}`; GameVault?: `0x${string}` };
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const c = schema.parse(env);
  let file: Record<string, string> = {};
  if (c.DEPLOYMENTS_FILE) file = JSON.parse(readFileSync(c.DEPLOYMENTS_FILE, 'utf8')) as Record<string, string>;
  const pick = (own: string | undefined, key: string) => (own ?? file[key]) as `0x${string}` | undefined;
  return {
    ...c,
    contracts: {
      LandNFT: pick(c.LAND_NFT_ADDRESS, 'LandNFT'),
      AvatarNFT: pick(c.AVATAR_NFT_ADDRESS, 'AvatarNFT'),
      LuckyBox: pick(c.LUCKY_BOX_ADDRESS, 'LuckyBox'),
      PropertyNFT: pick(c.PROPERTY_NFT_ADDRESS, 'PropertyNFT'),
      GameVault: pick(c.GAME_VAULT_ADDRESS, 'GameVault'),
    },
  };
}
