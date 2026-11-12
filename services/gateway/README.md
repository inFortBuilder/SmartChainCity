# services/gateway

Entrada da API: login por carteira (SIWE, EIP-4361), JWT e rate limit. Contrato em [openapi.yaml](openapi.yaml).

- Guia: [trilha-backend.md](../../docs/desenvolvimento/trilha-backend.md)
- Modelo de dados e API: [docs/06](../../docs/06-modelo-dados-api.md)
- Framework: [ADR-0011](../../docs/adr/0011-framework-backend-fastify.md)

```bash
pnpm install
cp services/gateway/.env.example services/gateway/.env   # preencha JWT_SECRET
pnpm db:up        # em outro terminal, ou o Docker Compose
pnpm db:migrate
pnpm dev
TEST_DATABASE_URL=postgresql://scc:scc_dev@127.0.0.1:5433/scc pnpm --filter @scc/gateway test
pnpm --filter @scc/gateway login:dev   # entra com uma carteira descartável e imprime o JWT
```

## Estado

| Recurso | Estado |
|---|---|
| `POST /v1/auth/siwe/nonce` e `/verify`, conta criada no primeiro login | ✅ |
| `GET /v1/me` (conta e carteiras) | ✅ avatares e saldos entram com game-core e economy |
| JWT HS256 aceito pelo SCC Builder | ✅ testado com a API PHP real |
| Rate limit, CORS por lista, logs sem token nem assinatura | ✅ |
| Armazenamento em Postgres (Drizzle) | ✅ sem `DATABASE_URL` usa memória, e em produção recusa subir |
| Login por e-mail, vínculo de segunda carteira, 2FA | ❌ |
| Carteiras de contrato (ERC-1271) | ❌ só carteiras comuns |
| ESLint, Dockerfile | ❌ `lint` hoje é a checagem de tipos |

## Como o login funciona

1. O cliente pede um nonce, de uso único, válido por 5 minutos.
2. O jogador assina a mensagem SIWE na carteira. Assinar não custa gás nem move fundos.
3. O gateway confere domínio, rede, validade e nonce, e só então a assinatura. A tentativa queima o nonce, mesmo se falhar.
4. Devolve o JWT: `sub` = id da conta, `iss` = `scc-gateway`, `aud` = `scc-api` e `scc-builder`, 1 hora de validade.

## Com o SCC Builder

Use o mesmo segredo nos dois lados: `JWT_SECRET` aqui e `jwt_secret` no Builder. No Builder, defina `jwt_issuer` como `scc-gateway` e `jwt_audience` como `scc-builder`.

O token fica válido até vencer. Banir uma conta bloqueia o gateway na hora, mas o Builder só deixa de aceitar quando o token expira.
