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
| `GET /internal/v1/wallets/:address/account`: conta ligada a uma carteira, com `x-service-token` | ✅ o chain-indexer usa para creditar o depósito do `GameVault`. 404 se ninguém ligou a carteira |
| `GET /internal/v1/accounts/:id/wallets`: carteiras da conta (e `account_created_at`) para outros serviços, com `x-service-token` igual ao `INTERNAL_TOKEN` | ✅ o world usa para a cotação on-chain do lote. Sem `INTERNAL_TOKEN`, responde 503 |
| JWT HS256 aceito pelo SCC Builder | ✅ testado com a API PHP real |
| Rate limit, CORS por lista, logs sem token nem assinatura | ✅ |
| Captcha de prova de trabalho no login SIWE e no pedido do código por e-mail (`GET /v1/auth/captcha`) | ✅ sem serviço de terceiros; veja [Captcha no cadastro](#captcha-no-cadastro) |
| KYC progressivo para o saque (`/v1/me/kyc` e a revisão em `/internal/v1/kyc`) | 🟡 situação e revisão manual prontas; falta o provedor de KYC. Veja [KYC no saque](#kyc-no-saque) |
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

## Captcha no cadastro

A conta nasce no primeiro login, então o captcha fica nas duas portas de entrada: `POST /v1/auth/siwe/verify` e `POST /v1/auth/email/start`. As duas pedem o campo `captcha`. É uma prova de trabalho no formato do [ALTCHA](https://altcha.org) (MIT), sem serviço de terceiros nem custo:

1. `GET /v1/auth/captcha` devolve `{enabled, algorithm, challenge, maxnumber, salt, signature}`. O gateway sorteia um número até `maxnumber` e publica o `sha256(salt + número)`, assinado com HMAC.
2. O navegador testa 0, 1, 2… até achar o número. Com `CAPTCHA_MAX_NUMBER=50000`, leva frações de segundo para uma pessoa, mas custa caro para quem cria milhares de contas.
3. O cliente manda a solução em base64 no campo `captcha`. O gateway confere o hash, a assinatura e a validade (`?expires=` no salt, 5 min), e gasta o desafio na tabela de uso único do nonce. A mesma solução não abre duas contas.

| Erro | Quando |
|---|---|
| `400 captcha_required` | Sem o campo `captcha` |
| `403 captcha_invalid` | Número errado, assinatura forjada, salt trocado, desafio vencido ou já usado |

`CAPTCHA=off` desliga o captcha (a rota responde `{enabled: false}`), e o gateway recusa subir assim em produção. Em teste, o padrão é desligado. O resolvedor do mapa é SHA-256 em JavaScript puro, porque o `crypto.subtle` não existe em HTTP pela rede local. O `login:dev` resolve sozinho. O gateway não guarda IP nem dado da pessoa.

## KYC no saque

O doc 10 pede "KYC progressivo para saques acima de um limite". O economy deixa a conta sem KYC sacar até 300 SCITY em 30 dias (premissa). Acima disso, a conta precisa do nível 1, que mora aqui (`account.kyc_level`).

| Rota | Quem chama | O que faz |
|---|---|---|
| `GET /v1/me/kyc` | jogador (Bearer) | `{level, request}`: o nível da conta e o último pedido |
| `POST /v1/me/kyc` | jogador (Bearer) | Abre o pedido de verificação (`202`). Se já há um pendente, devolve ele. Conta verificada: `409 already_verified` |
| `GET /internal/v1/kyc?status=pending` | revisão (`X-Service-Token`) | Fila de pedidos, do mais antigo para o mais novo |
| `POST /internal/v1/kyc/:id` | revisão ou webhook do provedor (`X-Service-Token`) | `{decision: approve \| reject, note}`. Aprovado, a conta sobe para o nível 1 (nunca desce). Pedido já decidido: `409 not_pending` |

- **Sem dado pessoal aqui (LGPD):** a tabela `kyc_request` guarda só a situação, o nível, quem verificou (`provider`) e a nota da revisão. Documento e foto ficam com o provedor de KYC.
- **No MVP local** não há provedor (sem custo). O pedido fica pendente e a revisão decide pela rota interna. A mesma rota recebe depois o webhook do provedor (Sumsub, Persona ou outro, a escolher com o parecer jurídico, E0.8).
- **Recusado:** o nível fica em 0 e o jogador pode pedir de novo.
- **Economy:** `/internal/v1/accounts/:id/wallets` passa `kyc_level` junto com as carteiras e a data da conta.

O mapa mostra a situação na seção de saque, com o botão **Verificar identidade**. Depois de atualizar, rode `pnpm db:migrate`: a tabela `kyc_request` é nova.

## Vincular carteira e e-mail

Uma conta pode ter as duas formas de entrar. Os vínculos pedem o JWT da conta.

- **Carteira na conta de e-mail:** `POST /v1/me/wallets` com `{ message, signature }`, a mesma mensagem SIWE do login (nonce em `/v1/auth/siwe/nonce`). Responde `201` com a conta, ou `200` se a carteira já era dela. Uma carteira pertence a uma conta só: se for de outra, é `409 wallet_in_use`. A conta pode ter mais de uma carteira.
- **E-mail na conta de carteira:** `POST /v1/me/email/start` com `{ email }` manda o código, como no login. `POST /v1/me/email/verify` com `{ email, code }` grava o e-mail. Conta que já tem e-mail recebe `409 email_already_set`, e o e-mail não troca por aqui. Só depois do código certo o jogador fica sabendo se outra conta já usa o e-mail (`409 email_in_use`).

Depois do vínculo, entrar por qualquer um dos dois cai na mesma conta. No mapa de Pittsburg, o painel "Jogo no servidor" mostra os botões "Ligar carteira" e o campo de e-mail quando falta um deles. Não há migração nova.

## Com o SCC Builder

Use o mesmo segredo nos dois lados: `JWT_SECRET` aqui e `jwt_secret` no Builder. No Builder, defina `jwt_issuer` como `scc-gateway` e `jwt_audience` como `scc-builder`.

O token fica válido até vencer. Banir uma conta bloqueia o gateway na hora, mas o Builder só deixa de aceitar quando o token expira.
