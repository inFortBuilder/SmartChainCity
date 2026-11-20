# services/world

Cidade, bairros e lotes: situação, dono, preço e a venda primária (doc 03 §5, doc 13 §3, [ADR-0012](../../docs/adr/0012-cidade-real-construtores.md)). Também emite a cotação EIP-712 que leva o lote ao `LandNFT`. Também cuida dos imóveis: obra, desgaste e renda. Depois virão as regras de cerco.

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
| Posse on-chain | Lote pago no ledger vira NFT na carteira do jogador, por cotação assinada (abaixo) |

### Compra em três passos

1. **Reserva:** trava o lote e o comprador, confere as regras e fixa o preço; a reserva dura 2 minutos.
2. **Cobrança:** SCITY do jogador para a Prefeitura (`pool/treasury`) no ledger do economy, com a chave `lot-buy:<compra>`. Repetir nunca cobra duas vezes. Sem saldo, a reserva é desfeita (`409 insufficient_scity`).
3. **Posse:** o lote passa ao comprador, e a venda pode abrir o próximo bairro.

Se a reserva venceu e outro comprou antes da posse, o valor volta (`lot-refund:<compra>`). Se a resposta do ledger se perdeu, a compra fica pendente, e o job `purchases.settle` (a cada 60 s) refaz a cobrança e a posse: como a cobrança é idempotente, o resultado é o mesmo. O teste de contrato cobre os três casos (corrida entre dois compradores, falta de saldo e reserva perdida com devolução), em memória e no Postgres.

## Posse on-chain (LandNFT)

O lote é comprado em SCITY no ledger (acima). Depois, se quiser, o dono leva a posse para a blockchain:

1. Pede a cotação com `POST /v1/world/cities/:code/lots/:id/onchain-quote` e `{"wallet": "0x…"}`.
2. O world confere três coisas: que a conta é dona do lote, que a carteira está ligada à conta (pela rota interna do gateway, `GET /internal/v1/accounts/:id/wallets`) e que a cidade tem id no contrato (`LAND_CITY_IDS`).
3. O world assina a cotação ([`contracts` §Cotação de lote](../../contracts/README.md#cotação-de-lote-para-o-serviço-world)) com preço 0, porque o lote já foi pago. O nonce é o próprio `tokenId`, então cada lote vira NFT uma vez só. A cotação vale `QUOTE_TTL_SECONDS` (10 min).
4. A carteira do jogador chama `LandNFT.buyPrimary(quote, signature)`. A resposta da rota traz `contract`, `chain_id`, `token_id`, `quote` e `signature`.

O teste confere o hash da cotação com o `quoteDigest` do contrato no anvil. Testado de ponta a ponta no anvil em 2026-11-20: o lote foi para a carteira, e a mesma cotação foi recusada na segunda vez (`NonceAlreadyUsed`).

Para ligar no ambiente local:
- gere uma chave com `cast wallet new`;
- faça o deploy dos contratos com `WORLD_SIGNER` igual ao endereço dela;
- no `.env`, preencha `LAND_SIGNER_KEY` com a chave e `GATEWAY_TOKEN` com o `INTERNAL_TOKEN` do gateway.

Em produção a chave fica num KMS, e o world não sobe com `LAND_SIGNER_KEY`.

Ainda não: o world não lê a blockchain. Quando o lote for transferido on-chain, quem atualiza o dono no jogo é o chain-indexer (passo 13 da trilha).

## Imóveis (E2.5)

O dono do lote constrói, espera a obra e coleta a renda (doc 03 §6.3). O dinheiro é THALER em centavos, no ledger do economy:

| Etapa | Como |
|---|---|
| Obra | `POST /v1/world/cities/:code/lots/:id/property` com `{type}`. O world confere que a conta é dona do lote, que a zona aceita o tipo e que o lote não tem outro imóvel. Cobra o preço do jogador para a queima (`burn/construction`), com a chave `property-build:<imóvel>`. Sem THALER, a obra não existe (`409 insufficient_thaler`) |
| Desgaste | Começa em 100 quando a obra termina e cai 1 ponto por dia |
| Renda | Renda do nível × desgaste/100. Abaixo de 30 de desgaste, o imóvel para de render. Acumula até 7 dias sem coletar |
| Coleta | `POST /v1/world/properties/:id/claim` fecha o período e paga do pool P2E para o jogador, com a chave da coleta. Duas coletas ao mesmo tempo: só uma fecha o período. Com o pool vazio, a coleta fica guardada (`503 pool_empty`), e o job paga depois |
| Reparo | `POST /v1/world/properties/:id/repair` cobra pelo desgaste perdido (burn/repair) e volta o desgaste a 100 |
| Upgrade | `POST /v1/world/properties/:id/upgrade` cobra o custo do próximo nível (burn/construction) e sobe o nível; a renda passa a ser a do nível novo, e o desgaste segue de onde estava |

Reparo e upgrade cobram antes e só depois mudam o imóvel. Na mudança, que roda numa transação com o imóvel travado, a renda acumulada até ali é fechada numa coleta e paga, com o desgaste e o nível antigos. Assim a obra nunca recalcula para trás um período que já rendeu. Cada imóvel tem no máximo uma obra pendente (`409 work_in_progress`). Sem THALER, a obra não acontece; com o ledger fora, ela fica pendente e o job a termina depois.

O job `properties.settle` (junto do `purchases.settle`) refaz obras e coletas que ficaram pendentes. As chaves do ledger são as mesmas, então nada é cobrado nem pago duas vezes.

**Premissas, sem fonte no GDD** (a "Figura 16" não veio no texto; doc 11). A API marca cada uma em `provisional`:
- **Casa T1:** 4.000 THALER e 10 THALER/dia, do seed do CMS, que copiou o simulador.
- **Obra:** 24 h, do protótipo de gestão.
- **Acúmulo:** até 7 dias.
- **Desgaste:** 1 ponto por dia.
- **Reparo:** 0,05% do preço por ponto recuperado; na T1, 2 THALER por ponto.
- **Upgrade da T1:** nível 2 custa 2.000 THALER e rende 15/dia; nível 3 custa 4.000 e rende 20/dia.

Com isso, uma T1 coletada toda semana rende 455 THALER até o desgaste chegar a 30, em 70 dias, contra 4.000 de obra. Com reparo a cada 30 dias (60 THALER), sobra ~195 THALER por mês, e a obra se paga em ~620 dias. O [simulador](../../tools/econ-sim/README.md), que conta 10 THALER/dia sem desgaste, precisa passar a contar o desgaste, o reparo e os níveis antes de esses números virarem regra.

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
| POST | `/v1/world/cities/:code/lots/:id/onchain-quote` | dono do lote (Bearer) | Cotação assinada para o `LandNFT` (corpo: `{wallet}`) |
| GET | `/v1/world/property-types` | público | Tipos de imóvel, preço, obra, renda por nível e regras de desgaste e acúmulo |
| POST | `/v1/world/cities/:code/lots/:id/property` | dono do lote (Bearer) | Constrói (corpo: `{type}`) pagando THALER |
| GET | `/v1/world/me/properties` | jogador (Bearer) | Imóveis do jogador: fase (`pending_payment`, `building`, `ready`), progresso da obra, desgaste, renda por dia e acumulada |
| POST | `/v1/world/properties/:id/claim` | dono (Bearer) | Coleta a renda acumulada |
| POST | `/v1/world/properties/:id/repair` | dono (Bearer) | Reparo: desgaste volta a 100 |
| POST | `/v1/world/properties/:id/upgrade` | dono (Bearer) | Sobe um nível |
| GET | `/healthz` | — | `{status: "ok"}` |

Erros com código estável: `lot_not_for_sale`, `lot_reserved`, `district_closed`, `other_district`, `area_cap`, `insufficient_scity`, `reservation_lost`, `ledger_unavailable`, `not_found`, `not_lot_owner`, `wallet_not_linked`, `unknown_property_type`, `zone_not_allowed`, `lot_has_property`, `insufficient_thaler`, `property_not_ready`, `nothing_to_claim`, `claim_in_progress`, `nothing_to_repair`, `max_level`, `work_in_progress`, `pool_empty`, `properties_disabled`, `city_not_onchain`, `onchain_disabled`, `gateway_unavailable`, `missing_credentials`, `invalid_token`, `token_expired`.

## Banco

Esquema próprio `world`: `city` (zonas, bairros abertos, limiar), `lot` (situação, dono, reserva) e `purchase` (cada compra, com o preço em wei e a situação), `property` (imóvel, obra, desgaste e última coleta; um por lote) e `property_claim` (cada coleta e se já foi paga) e `property_work` (reparos e upgrades; uma pendente por imóvel). Migrações em `drizzle/`, controladas em `drizzle.__world_migrations`.

## Ainda não

- Ler a blockchain: transferências do `LandNFT` atualizarem o dono no jogo (chain-indexer).
- Imóveis: troca de tipo (T1 → T2 → T3), seguro, aluguel e hotel, lote duplo (Residencial 2 e 3), regularização e água/energia; os outros tipos do doc 03 §6; o catálogo vindo do Strapi (hoje fica no código, igual ao seed); o `PropertyNFT`.
- Câmbio THALER ↔ SCITY e cotação do dia (passo 11 da trilha); hoje `SCITY_USD` é fixo.
- Mercado secundário entre jogadores, imóveis e utilidades.
