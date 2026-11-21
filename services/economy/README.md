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

## Câmbio THALER ↔ SCITY (passo 11 da trilha)

O "banco central" do doc 04 §5. O jogador troca o SCITY do jogo (que chega pelo depósito do `GameVault`) por THALER e de volta.

| Regra | Como |
|---|---|
| Cotação | THALER por SCITY = 20 × preço do SCITY em dólar: o THALER vale sempre US$ 0,05 e o payback em dólar fica estável. A primeira sai de `SCITY_USD`; as seguintes, de `POST /internal/v1/economy/fx` (quem opera hoje; o job do TWAP 24 h da DEX depois do TGE) |
| Entrada (SCITY → THALER) | Sem taxa e sem teto. O SCITY vai para `system/fx` e o THALER sai de lá (`fx_scity_to_thaler`) |
| Saída (THALER → SCITY) | Spread de 7,5%, queimado (`burn/fx_spread`); mínimo de 500 THALER; teto de 2.000 THALER por conta em 24 h, conferido com a conta travada (`fx_thaler_to_scity`) |
| Freio do pool | Com `P2E_START` (TGE), conta o SCITY já pago em saídas contra o liberado do pool P2E (doc 04 §3). A partir de 70%, o teto cai e o spread sobe, até +10 pontos; no limite, a saída para (`pool_brake`) |
| Período grátis | Com `FREE_PERIOD_UNTIL` (ADR-0014), o THALER ganho no trabalho (`shift_pay`) antes do fim não vira SCITY (`free_period_locked`). O gasto consome primeiro o grátis, o que favorece o jogador |
| Repetição | `Idempotency-Key` obrigatória: a mesma chave devolve a mesma conversão |
| Arredondamento | Sempre a favor do jogo: centavos e wei para baixo, taxa para cima |

**Premissas**, as mesmas do [simulador](../../tools/econ-sim/README.md) (`params/base.json`): 20 THALER/SCITY a US$ 1, spread de 7,5%, mínimo de 500, teto de 2.000/dia, freio a partir de 70% com +10 pontos no máximo. A cotação marcada como `provisional` na API até o TWAP existir.

## Saque pelo GameVault (E3.7)

O jogador pede o saque do SCITY que tem no jogo e recebe um voucher EIP-712 para resgatar na carteira com `GameVault.claim`.

| Passo | Como |
|---|---|
| Pedido | `POST /v1/economy/withdrawals` com `{wallet, amount_wei}`. O gateway confere que a carteira é da conta e a idade da conta |
| Regras | Mínimo de 1 SCITY; teto de 1.000 SCITY por conta em 24 h, conferido com a conta travada (dois pedidos juntos não passam do teto); carência de 7 dias para conta nova (doc 04 §5). **Sem KYC, até 300 SCITY em 30 dias** (premissa), conferido na mesma trava; acima disso, `403 kyc_required` até a conta ter o nível 1 no gateway ([KYC](../gateway/README.md#kyc-no-saque)) |
| Débito | O SCITY sai do jogador para `escrow/withdrawals` (`scity_withdrawal`, chave `withdrawal:<id>`). Sem saldo, `409 insufficient_scity` |
| Voucher | `{to, amount, nonce, deadline}`, nonce = os 128 bits do id, prazo de 48 h. A resposta traz o contrato, a rede, o voucher e a assinatura |
| Resgate | O job `withdrawals.settle` (`WITHDRAW_EVERY_SECONDS`, 60 s) lê `nonceUsed` no cofre. Resgatado: o escrow vai para `system/vault` e o saque fica `claimed` |
| Prazo vencido | Sem resgate, o escrow volta ao jogador (`scity_withdrawal_refund`) e o saque fica `refunded`. O contrato já recusa o voucher vencido, então não há saque em dobro |
| Queda no meio | Saque `created` parado há mais de 1 min é retomado pelo job, com as mesmas chaves |

Ligue com `GATEWAY_URL`, `GATEWAY_TOKEN`, `RPC_URL`, `GAME_VAULT_ADDRESS` e `VAULT_SIGNER_KEY`; sem os cinco, as rotas de saque respondem 503. A chave no `.env` é só para o MVP local e é recusada em produção (KMS, doc 07 §3).

**Premissas** (doc 04 §5, a calibrar no simulador): mínimo, teto de 24 h, carência e prazo do voucher. Sem spread, porque SCITY sai como SCITY; o spread do doc 04 vale na troca THALER → SCITY, que ainda não existe. O saldo grátis do período inicial (ADR-0014) ainda não é marcado como não sacável.

Testado no anvil em 2026-11-20: 20 SCITY pedidos no economy chegaram à carteira pelo `claim`, o job marcou como resgatado, e um segundo voucher, não resgatado, voltou para o jogador depois do prazo.

## Painel econômico (E2.8)

Cada transação do ledger vira um fluxo, olhando a parte dos jogadores (doc 04 §7):
- **emissão** (faucet): os jogadores recebem de um pool ou do sistema, como turno, renda de imóvel ou crédito da ponte;
- **dreno** (sink): os jogadores pagam para a queima ou para um pool, como comida, imposto, obra ou lote;
- **circulação**: entre jogadores, soma zero.

O SQL agrupa por tipo e pela conta do outro lado (`pool/p2e`, `burn/food`…), em 24 h e em 7 dias.

| Indicador | Para quê |
|---|---|
| Dreno ÷ emissão (7 dias) | O doc 04 §6 pede um dreno-alvo de 55% da renda. Abaixo disso, o THALER se acumula e pressiona o saque |
| THALER por jogador | Saldo médio de quem tem saldo |
| Pool P2E: saldo e duração | Quantos dias o pool aguenta no ritmo de emissão da última semana |
| Por tipo | De onde vem e para onde vai o dinheiro |

- **Rota:** `GET /internal/v1/economy/panel?currency=THALER` (`x-service-token`) devolve tudo, com os `alerts`.
- **Job `economy.panel`:** roda a cada `PANEL_EVERY_SECONDS` (60) e põe os indicadores no `/metrics` como `economy_*`. É o que o painel "Economia" do Grafana e os alertas do Prometheus leem ([infra/observability](../../infra/observability/README.md)).

**Alertas, com limites de partida:**
- `sink_ratio_low`: dreno abaixo de 55% em 7 dias, com pelo menos 1.000 THALER emitidos;
- `p2e_runway_short`: pool P2E acabando em menos de 30 dias; crítico abaixo de 7.

## Rodar

```bash
pnpm db:up
pnpm db:migrate
cp services/economy/.env.example services/economy/.env
pnpm --filter @scc/economy dev
```

No `.env`, preencha `JWT_SECRET` (o mesmo do gateway) e `INTERNAL_TOKEN` (uma chave de 32 caracteres ou mais, que os outros serviços enviam no `X-Service-Token`). Sem `DATABASE_URL`, o ledger roda em memória (só para desenvolvimento). O `JWT_SECRET` e o `JWT_ISSUER` são os mesmos do gateway: o economy só valida o token, com a mesma regra (`verifyAccessToken`, em `@scc/shared`).

Testes, com o Postgres do `pnpm db:up` no ar:

```bash
TEST_DATABASE_URL=postgresql://scc:scc_dev@127.0.0.1:5433/scc_test pnpm --filter @scc/economy test
```

## API

| Método | Rota | Quem chama | O que faz |
|---|---|---|---|
| GET | `/v1/economy/balances` | jogador (Bearer) | Saldos: `{balances: [{currency, amount, decimals}]}` |
| GET | `/v1/economy/ledger?currency=&cursor=&limit=` | jogador (Bearer) | Extrato do mais recente para o mais antigo; `next_cursor` para a próxima página |
| POST | `/internal/v1/ledger/transactions` | serviços (`X-Service-Token` + `Idempotency-Key`) | Lança `{kind, ref_type, ref_id, legs: [{owner_type, owner_id, currency, amount}]}`: 201 novo, 200 repetido |
| GET | `/internal/v1/economy/panel` | serviços (`X-Service-Token`) | Painel econômico (`?currency=THALER` ou `SCITY`): emissão, dreno, razão, por tipo, pools, duração do P2E e alertas |
| GET | `/v1/economy/fx` | público | Cotação, spread de saída, freio, mínimo e teto de agora |
| POST | `/v1/economy/exchange` | jogador (Bearer + `Idempotency-Key`) | Converte `{direction: scity_to_thaler \| thaler_to_scity, amount}` (wei ou centavos) |
| GET | `/v1/economy/exchange` | jogador (Bearer) | Últimas 50 conversões |
| POST | `/internal/v1/economy/fx` | serviços (`X-Service-Token`) | Cotação nova `{scity_usd, source}`, valendo a partir de agora |
| POST | `/v1/economy/withdrawals` | jogador (Bearer) | Pede o saque `{wallet, amount_wei}` e recebe o voucher do `GameVault` |
| GET | `/v1/economy/withdrawals` | jogador (Bearer) | Últimos 50 saques, com o voucher dos pendentes |
| POST | `/v1/dev/faucet` | jogador (Bearer) | **Só desenvolvimento** (`DEV_FAUCET=true`, recusado em produção): +1.000 SCITY de teste, como um depósito simulado da ponte |
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

Erros com código estável: `invalid_posting`, `insufficient_funds`, `idempotency_conflict`, `missing_idempotency_key`, `fx_disabled`, `fx_unavailable`, `amount_too_small`, `pool_brake`, `free_period_locked`, `insufficient_thaler`, `conversion_failed`, `withdrawals_disabled`, `wallet_not_linked`, `account_too_new`, `below_minimum`, `daily_limit`, `kyc_required`, `insufficient_scity`, `gateway_unavailable`, `forbidden`, `missing_credentials`, `invalid_token`, `token_expired`.

## Banco

Esquema próprio `economy` (o serviço não toca as tabelas do gateway): `ledger_account` (com o saldo guardado), `ledger_tx` (com `seq`, cursor do extrato, e a impressão digital do pedido), `ledger_entry`, `withdrawal` (saques e vouchers), `fx_rate` (cotações) e `fx_conversion` (cada troca). Migrações em `drizzle/`, controladas na tabela `drizzle.__economy_migrations`.

## Ainda não

- TWAP 24 h da DEX para a cotação (depois do TGE, E4.2).
- KYC para saque acima de um limite (doc 10).
- `openapi.yaml` deste serviço.
- Quem chama o lançamento interno: o game-core (turno de trabalho, passo 7) e o world (compra de lote) ainda não existem.
