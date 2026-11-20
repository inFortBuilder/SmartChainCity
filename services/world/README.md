# services/world

Cidade, bairros e lotes: situação, dono, preço e a venda primária (doc 03 §5, doc 13 §3, [ADR-0012](../../docs/adr/0012-cidade-real-construtores.md)). Depois virão imóveis, regras de cerco e as cotações EIP-712 para o `LandNFT`.

- Guia: [trilha-backend.md](../../docs/desenvolvimento/trilha-backend.md)
- Modelo de dados e API: [docs/06](../../docs/06-modelo-dados-api.md)

## O que funciona hoje

| Regra | Como |
|---|---|
| Geometria e situação separadas | Os polígonos ficam nos arquivos estáticos por bairro, que o mapa já baixa ([city-chunks](../../tools/scc-builder/README.md#lotes-por-bairro)). O servidor guarda o que muda e decide a venda: zona, área, bairro, situação e dono |
| Preço em dólar, pago em SCITY | Área × US$/m² da zona (residencial 0,78, uso misto 1,56, comercial 2,85), convertido pela cotação `SCITY_USD`. A cotação é fixa até o câmbio do economy (passo 11 da trilha) |
| Prefeitura | Lotes do Centro Administrativo (`civico.json`) não estão à venda |
| Um bairro por jogador | Todos os lotes de um jogador ficam no mesmo bairro (doc 03 §5), até 30% da área do bairro (doc 13 §3) |
| Liberação por bairro | Um bairro aberto no começo; o próximo abre quando os abertos passam de 70% vendidos (doc 03 §5) |
| Compra sem cobrar sem entregar | Reserva com trava, cobrança no ledger, posse. Detalhes abaixo |
| Observabilidade | Log JSON com `service` e `requestId`, `x-request-id` repassado ao economy na cobrança e `GET /metrics` ([infra/observability](../../infra/observability/README.md)) |

### Compra em três passos

1. **Reserva:** trava o lote e o comprador, confere as regras e fixa o preço; a reserva dura 2 minutos.
2. **Cobrança:** SCITY do jogador para a Prefeitura (`pool/treasury`) no ledger do economy, com a chave `lot-buy:<compra>`. Repetir nunca cobra duas vezes. Sem saldo, a reserva é desfeita (`409 insufficient_scity`).
3. **Posse:** o lote passa ao comprador, e a venda pode abrir o próximo bairro.

Se a reserva venceu e outro comprou antes da posse, o valor volta (`lot-refund:<compra>`). Se a resposta do ledger se perdeu, a compra fica pendente, e o job `purchases.settle` (a cada 60 s) refaz a cobrança e a posse: como a cobrança é idempotente, o resultado é o mesmo. O teste de contrato cobre os três casos (corrida entre dois compradores, falta de saldo e reserva perdida com devolução), em memória e no Postgres.

## Rodar

```bash
pnpm db:up
pnpm db:migrate
cp services/world/.env.example services/world/.env
pnpm --filter @scc/world import:city ../../.local/cidades/pittsburg --code pittsburg --nome "Pittsburg, Califórnia"
pnpm --filter @scc/world dev
```

No `.env`, preencha `JWT_SECRET` (o mesmo do gateway) e `ECONOMY_TOKEN` (o `INTERNAL_TOKEN` do economy). A importação leva ~9 s para os 100.152 lotes de Pittsburg e pode ser repetida: lotes vendidos ou reservados mantêm o dono.

Testes, no banco só de testes (os de compra criam cidades próprias, com código aleatório):

```bash
TEST_DATABASE_URL=postgresql://scc:scc_dev@127.0.0.1:5433/scc_test pnpm --filter @scc/world test
```

## API

| Método | Rota | Quem chama | O que faz |
|---|---|---|---|
| GET | `/v1/world/cities/:code` | público | Cidade, bairros abertos e contagem de vendidos por bairro |
| GET | `/v1/world/cities/:code/districts/:order/lots` | público (com Bearer, marca os seus) | Situação e preço dos lotes do bairro; o dono não é exposto |
| GET | `/v1/world/cities/:code/lots/:id` | público (com Bearer, marca se é seu) | Um lote: zona, área, situação, preço em US$ e em SCITY |
| GET | `/v1/world/me/lots` | jogador (Bearer) | Lotes do jogador |
| POST | `/v1/world/cities/:code/lots/:id/buy` | jogador (Bearer) | Compra pagando SCITY no ledger |
| GET | `/healthz` | — | `{status: "ok"}` |

Erros com código estável: `lot_not_for_sale`, `lot_reserved`, `district_closed`, `other_district`, `area_cap`, `insufficient_scity`, `reservation_lost`, `ledger_unavailable`, `not_found`, `missing_credentials`, `invalid_token`, `token_expired`.

## Banco

Esquema próprio `world`: `city` (zonas, bairros abertos, limiar), `lot` (situação, dono, reserva) e `purchase` (cada compra, com o preço em wei e a situação). Migrações em `drizzle/`, controladas em `drizzle.__world_migrations`.

## Ainda não

- `LandNFT` e cotação assinada (EIP-712) para a posse on-chain (Etapa 2).
- Câmbio THALER ↔ SCITY e cotação do dia (passo 11 da trilha); hoje `SCITY_USD` é fixo.
- Mercado secundário entre jogadores, imóveis e utilidades.
