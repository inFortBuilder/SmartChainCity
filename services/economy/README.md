# services/economy

Ledger de dupla entrada do THALER e do SCITY dentro do jogo (épico **E1.5**, passo 5 da [trilha do backend](../../docs/desenvolvimento/trilha-backend.md)). Depois virão impostos, câmbio e vouchers de saque.

- Guia: [trilha-backend.md](../../docs/desenvolvimento/trilha-backend.md)
- Modelo de dados e API: [docs/06](../../docs/06-modelo-dados-api.md)
- Decisões: [ADR-0002](../../docs/adr/0002-servidor-autoritativo.md) (o servidor decide o saldo), [ADR-0004](../../docs/adr/0004-duas-moedas.md) (SCITY on-chain, THALER off-chain), [ADR-0011](../../docs/adr/0011-framework-backend-fastify.md) (Fastify e Drizzle)

## O que funciona hoje

| Regra | Como |
|---|---|
| Valor nunca é `float` | `bigint` em unidade mínima (THALER com 2 casas, SCITY com 18); `NUMERIC(38,0)` no banco; texto na API |
| Toda transação fecha | Os lançamentos de cada transação somam zero **por moeda**; pelo menos 2 e no máximo 20 |
| Só a emissora fica negativa | Contas `player`, `pool`, `burn` e `escrow` nunca ficam abaixo de zero; `system` (emissora) pode, e o negativo dela é o que já foi posto em circulação. O banco repete a regra numa `CHECK` |
| Queima só recebe | A conta `burn` não pode ser debitada |
| Idempotência | `Idempotency-Key` obrigatória. Mesma chave e mesmo pedido devolvem a mesma transação (200); mesma chave com outro pedido é `409 idempotency_conflict` |
| Concorrência | As contas são travadas em ordem de id (`SELECT … FOR UPDATE`); a chave é conferida de novo depois da trava |
| Jogador não lança | Só serviços internos, com `X-Service-Token`, lançam no ledger. O jogador só lê o próprio saldo e extrato |

**Teste de propriedade** (critério do E1.5 no [ROADMAP](../../ROADMAP.md)): 10 mil transações aleatórias de 8 tipos (emissão, pagamento pelo pool, transferência, gasto, escrow, taxa de três pernas), com 5% de pedidos repetidos. No fim, a soma de todas as entradas é zero por moeda, o saldo de cada conta é igual à soma das suas entradas e nenhuma conta fica negativa. Roda em memória e no Postgres (cerca de 70 s).

## Rodar

```bash
pnpm db:up
pnpm db:migrate
cp services/economy/.env.example services/economy/.env
pnpm --filter @scc/economy dev
```

Sem `DATABASE_URL`, o ledger roda em memória (só para desenvolvimento). O `JWT_SECRET` e o `JWT_ISSUER` são os mesmos do gateway: o economy só valida o token, com a mesma regra (`verifyAccessToken`, em `@scc/shared`).

Testes, com o Postgres do `pnpm db:up` no ar:

```bash
TEST_DATABASE_URL=postgresql://scc:scc_dev@127.0.0.1:5433/scc pnpm --filter @scc/economy test
```

## API

| Método | Rota | Quem chama | O que faz |
|---|---|---|---|
| GET | `/v1/economy/balances` | jogador (Bearer) | Saldos: `{balances: [{currency, amount, decimals}]}` |
| GET | `/v1/economy/ledger?currency=&cursor=&limit=` | jogador (Bearer) | Extrato do mais recente para o mais antigo; `next_cursor` para a próxima página |
| POST | `/internal/v1/ledger/transactions` | serviços (`X-Service-Token` + `Idempotency-Key`) | Lança `{kind, ref_type, ref_id, legs: [{owner_type, owner_id, currency, amount}]}`: 201 novo, 200 repetido |
| GET | `/healthz` | — | `{status: "ok"}` |

Exemplo: pagar um turno de 11,85 THALER a partir do pool P2E.

```json
{
  "kind": "shift_pay",
  "ref_type": "shift",
  "ref_id": "…",
  "legs": [
    { "owner_type": "pool", "owner_id": "p2e", "currency": "THALER", "amount": "-1185" },
    { "owner_type": "player", "owner_id": "<account.id>", "currency": "THALER", "amount": "1185" }
  ]
}
```

Erros com código estável: `invalid_posting`, `insufficient_funds`, `idempotency_conflict`, `missing_idempotency_key`, `forbidden`, `missing_credentials`, `invalid_token`, `token_expired`.

## Banco

Esquema próprio `economy` (o serviço não toca as tabelas do gateway): `ledger_account` (com o saldo guardado), `ledger_tx` (com `seq`, cursor do extrato, e a impressão digital do pedido) e `ledger_entry`. Migrações em `drizzle/`, controladas na tabela `drizzle.__economy_migrations`.

## Ainda não

- Impostos, câmbio THALER ↔ SCITY e vouchers de saque (passos 11 e 16 da trilha).
- `openapi.yaml` deste serviço.
- Quem chama o lançamento interno: o game-core (turno de trabalho, passo 7) e o world (compra de lote) ainda não existem.
