# services/gateway

Entrada da API: login por carteira (SIWE, EIP-4361) ou por código no e-mail, JWT e rate limit. Contrato em [openapi.yaml](openapi.yaml).

- Guia: [trilha-backend.md](../../docs/desenvolvimento/trilha-backend.md)
- Modelo de dados e API: [docs/06](../../docs/06-modelo-dados-api.md)
- Framework: [ADR-0011](../../docs/adr/0011-framework-backend-fastify.md)

```bash
pnpm install
cp services/gateway/.env.example services/gateway/.env   # preencha JWT_SECRET
pnpm db:up        # em outro terminal, ou o Docker Compose
pnpm db:migrate
pnpm dev
TEST_DATABASE_URL=postgresql://scc:scc_dev@127.0.0.1:5433/scc_test pnpm --filter @scc/gateway test
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
| `POST /v1/auth/email/start` e `/verify`: login por código de 6 dígitos no e-mail | ✅ no MVP local o código sai no log do gateway (`EMAIL_LOGIN=log`), sem provedor de e-mail |
| Carteira embutida para quem entra por e-mail, vínculo de carteira à conta, 2FA | ❌ a conta de e-mail entra sem carteira; joga, mas ainda não assina na rede |
| Carteiras de contrato (ERC-1271) | ❌ só carteiras comuns |
| ESLint, Dockerfile | ❌ `lint` hoje é a checagem de tipos |

## Como o login funciona

1. O cliente pede um nonce, de uso único, válido por 5 minutos.
2. O jogador assina a mensagem SIWE na carteira. Assinar não custa gás nem move fundos.
3. O gateway confere domínio, rede, validade e nonce, e só então a assinatura. A tentativa queima o nonce, mesmo se falhar.
4. Devolve o JWT: `sub` = id da conta, `iss` = `scc-gateway`, `aud` = `scc-api` e `scc-builder`, 1 hora de validade.

## Login por e-mail

1. `POST /v1/auth/email/start` com `{ email }`: o gateway gera um código de 6 dígitos, que vale 10 minutos. A resposta é sempre `202`, exista a conta ou não, para não revelar quem joga.
2. No MVP local não há provedor de e-mail (sem custo): o código aparece no **log do gateway**, numa linha `warn` com `código de login para …`. Em produção, `EMAIL_LOGIN=log` impede a subida.
3. `POST /v1/auth/email/verify` com `{ email, code }` devolve o mesmo JWT do SIWE. A conta nasce no primeiro login, com o e-mail em minúsculas.

Regras:

- O código vale uma vez.
- 5 erros queimam o código.
- Pedir de novo antes de 60 s não gera outro código.
- O banco guarda só o HMAC do código (`email_code`), nunca o código.
- Os limites ficam no `.env`: `EMAIL_CODE_TTL_SECONDS`, `EMAIL_CODE_RESEND_SECONDS` e `EMAIL_CODE_MAX_ATTEMPTS`.

O mapa de Pittsburg tem o formulário no painel "Jogo no servidor".

Depois de atualizar o código, rode `pnpm db:migrate`: a tabela `email_code` é nova.

## Vincular carteira e e-mail

Uma conta pode ter as duas formas de entrar. Os vínculos pedem o JWT da conta.

- **Carteira na conta de e-mail:** `POST /v1/me/wallets` com `{ message, signature }`, a mesma mensagem SIWE do login (nonce em `/v1/auth/siwe/nonce`). Responde `201` com a conta, ou `200` se a carteira já era dela. Uma carteira pertence a uma conta só: se for de outra, é `409 wallet_in_use`. A conta pode ter mais de uma carteira.
- **E-mail na conta de carteira:** `POST /v1/me/email/start` com `{ email }` manda o código, como no login. `POST /v1/me/email/verify` com `{ email, code }` grava o e-mail. Conta que já tem e-mail recebe `409 email_already_set`, e o e-mail não troca por aqui. Só depois do código certo o jogador fica sabendo se outra conta já usa o e-mail (`409 email_in_use`).

Depois do vínculo, entrar por qualquer um dos dois cai na mesma conta. No mapa de Pittsburg, o painel "Jogo no servidor" mostra os botões "Ligar carteira" e o campo de e-mail quando falta um deles. Não há migração nova.

## Com o SCC Builder

Use o mesmo segredo nos dois lados: `JWT_SECRET` aqui e `jwt_secret` no Builder. No Builder, defina `jwt_issuer` como `scc-gateway` e `jwt_audience` como `scc-builder`.

O token fica válido até vencer. Banir uma conta bloqueia o gateway na hora, mas o Builder só deixa de aceitar quando o token expira.
