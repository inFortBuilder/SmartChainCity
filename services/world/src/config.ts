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
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Token do Prometheus para ler /metrics; sem ele, /metrics fica desligado em produção. */
  METRICS_TOKEN: optional(z.string().min(32, 'METRICS_TOKEN precisa de pelo menos 32 caracteres')),
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
  /** Intervalo do job tax.charge (gera contas de IPTU e PT e tenta o débito automático). */
  TAX_EVERY_SECONDS: z.coerce.number().int().positive().default(3600),
  /** SCC Builder (tools/scc-builder): valida os prédios dos construtores. Sem ele, o envio responde 503. */
  BUILDER_URL: optional(z.url()),
  /** Token das ferramentas internas (alvará dos prédios). Sem ele, as rotas /internal respondem 503. */
  INTERNAL_TOKEN: optional(z.string().min(32, 'INTERNAL_TOKEN precisa de pelo menos 32 caracteres')),
  /**
   * Posse on-chain do lote (LandNFT, doc 07 §2.1). Sem GATEWAY_URL, GATEWAY_TOKEN,
   * LAND_NFT_ADDRESS e LAND_SIGNER_KEY, a rota de cotação responde 503. O gateway confere a carteira do jogador.
   */
  GATEWAY_URL: optional(z.url()),
  GATEWAY_TOKEN: optional(z.string().min(32, 'GATEWAY_TOKEN precisa de pelo menos 32 caracteres')),
  CHAIN_ID: z.coerce.number().int().positive().default(31337),
  LAND_NFT_ADDRESS: optional(z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'LAND_NFT_ADDRESS precisa ser um endereço')),
  /** Chave do papel SIGNER do LandNFT. Só no MVP local; na rede pública, KMS. */
  LAND_SIGNER_KEY: optional(z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'LAND_SIGNER_KEY precisa ser uma chave privada hex')),
  /** Id numérico de cada cidade no contrato: "pittsburg=1,outra=2". */
  LAND_CITY_IDS: z
    .string()
    .default('')
    .transform((value) =>
      Object.fromEntries(
        list(value).map((pair) => {
          const [code, id] = pair.split('=').map((s) => s.trim());
          const n = Number(id);
          if (!code || !Number.isInteger(n) || n < 1 || n > 2 ** 32 - 1) throw new Error(`LAND_CITY_IDS inválido: ${pair}`);
          return [code, n];
        }),
      ) as Record<string, number>,
    ),
  /** BuildingNFT: com ele (e o resto da posse on-chain acima), o world emite o voucher do prédio aprovado. */
  BUILDING_NFT_ADDRESS: optional(z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'BUILDING_NFT_ADDRESS precisa ser um endereço')),
  /** PropertyNFT: com ele (e o resto da posse on-chain acima), o world emite o voucher do imóvel pronto. */
  PROPERTY_NFT_ADDRESS: optional(z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'PROPERTY_NFT_ADDRESS precisa ser um endereço')),
  /** Validade da cotação assinada. */
  QUOTE_TTL_SECONDS: z.coerce.number().int().positive().default(600),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}
