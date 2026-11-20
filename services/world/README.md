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

**Na blockchain (`PropertyNFT`).** Com a obra pronta, o dono pede `POST /v1/world/properties/:id/onchain-voucher` com `{wallet}`. O world confere que o imóvel é dele e está pronto, que a cidade está na rede, que a carteira está ligada à conta e que o lote não está inadimplente, e assina com a mesma chave da posse do lote. A carteira chama `PropertyNFT.mint`, e o contrato exige que ela seja dona do lote no `LandNFT`. O id do token é o id do imóvel. Depois de um upgrade, `POST /v1/world/properties/:id/level-voucher` assina o nível atual para `PropertyNFT.upgrade`. Ligue com `PROPERTY_NFT_ADDRESS` no `.env`.

O job `properties.settle` (junto do `purchases.settle`) refaz obras e coletas que ficaram pendentes. As chaves do ledger são as mesmas, então nada é cobrado nem pago duas vezes.

**Premissas, sem fonte no GDD** (a "Figura 16" não veio no texto; doc 11). A API marca cada uma em `provisional`:
- **Casa T1:** 4.000 THALER e 10 THALER/dia, do seed do CMS, que copiou o simulador.
- **Obra:** 24 h, do protótipo de gestão.
- **Acúmulo:** até 7 dias.
- **Desgaste:** 1 ponto por dia.
- **Reparo:** 0,05% do preço por ponto recuperado; na T1, 2 THALER por ponto.
- **Upgrade da T1:** nível 2 custa 2.000 THALER e rende 15/dia; nível 3 custa 4.000 e rende 20/dia.

Com isso, uma T1 coletada toda semana rende 455 THALER até o desgaste chegar a 30, em 70 dias, contra 4.000 de obra. Com reparo a cada 30 dias (60 THALER), sobra ~195 THALER por mês, e a obra se paga em ~620 dias. O [simulador](../../tools/econ-sim/README.md), que conta 10 THALER/dia sem desgaste, precisa passar a contar o desgaste, o reparo e os níveis antes de esses números virarem regra.

## Impostos (E2.6)

O job `tax.charge` (a cada `TAX_EVERY_SECONDS`, 1 h) faz duas coisas: gera as contas vencidas de todos os lotes vendidos e tenta o débito automático, em THALER, do jogador para a queima (`burn/tax`).

| Imposto | Quando |
|---|---|
| PT (Property Tax) | Lote vendido e sem imóvel: a cada 30 dias desde a compra, 10 THALER × o número do mês. Cresce contra a especulação (doc 03 §4). Para quando a obra começa |
| IPTU | Lote com imóvel pronto: 180 THALER a cada 182 dias desde o fim da obra |
| Multa | Sem saldo, a conta ganha 10% de multa, uma vez, e fica pendente. O job tenta de novo a cada rodada, e o jogador pode pagar na hora com `POST /v1/world/me/taxes/pay` |
| Inadimplência | Conta vencida há mais de 90 dias trava o lote: obra, reparo, upgrade e cotação on-chain respondem `409 tax_default` até o pagamento |

Cada lote, tipo e período gera uma conta só, então repetir o job não cria nem cobra em dobro. A chave do ledger leva a conta e o total; a multa só entra depois de uma recusa definitiva do ledger, então o mesmo total nunca é cobrado duas vezes.

**Premissas** (doc 11, lacuna 5: "definir com o simulador"):
- **IPTU:** o `iptuSemiannual` do simulador.
- **PT:** sem fonte, e o simulador ainda não tem PT. Precisa entrar nele antes de virar regra.
- **Multa e bloqueio:** 10%, e bloqueio depois de 90 dias, o "proposto: 3 meses" do doc 03 §4.

O leilão depois de 3 ciclos (doc 03 §4) ainda não existe.

## Prédios de construtores (E2.10)

O construtor converte o modelo no [SCC Builder](../../tools/scc-builder/README.md) e envia o job para o próprio lote com `POST /v1/world/cities/:code/lots/:id/building` e `{job_id, rotation_deg?, units?, position?}`.

**Quem decide é o world.** O world manda ao `validate-lot.php` do Builder o polígono do lote, guardado no próprio banco desde a importação da cidade (`lot.polygon`), e as regras da zona: recuo, gabarito e coeficiente. O jogador não consegue validar contra um lote inventado. O world repassa o token do jogador, e o Builder só valida jobs daquele jogador.

| Etapa | Como |
|---|---|
| Validação | No Builder: cabe no lote com recuo, altura até o gabarito, triângulos e escala. Reprovado: `422 building_invalid`, com as checagens, e nada é gravado |
| Outorga onerosa | Se passar do coeficiente, a outorga que o Builder calculou sai em SCITY do jogador para a Prefeitura (`pool/treasury`), com a chave `building-outorga:<prédio>`. Sem saldo, o prédio não entra |
| Alvará | O prédio fica em `pending_review` até a moderação (`POST /internal/v1/buildings/:id/review` com `{approve, note}`, `x-service-token` = `INTERNAL_TOKEN`). Recusado, o lote fica livre para outro envio |
| Exclusividade | Um prédio vigente por lote. Lote com prédio não aceita imóvel do catálogo, e vice-versa |
| Impostos | O prédio conta como uso: o PT do lote vazio para quando ele é enviado |

Só o prédio aprovado aparece para os outros jogadores (`GET /v1/world/cities/:code/lots/:id/building`), com os artefatos (GLB e LODs) que o mapa desenha.

**Testado com o Builder real em 2026-11-20** (`php -S`, jobs semeados como em `tests/php/test-endpoint.php`):
- uma caixa de 9 m num lote de 10 m com recuo de 3 m foi recusada (`fits_setback`, 44 de 44 pontos fora);
- uma de 3 m foi aceita e foi para o alvará com 2 andares, com o GLB no caminho do jogador.

Para o envio funcionar, a cidade precisa ter sido importada de novo, porque é a importação que grava o polígono de cada lote.

**Na blockchain (E2.11):** com o alvará, o construtor pede o voucher com `POST /v1/world/buildings/:id/onchain-voucher` e `{wallet}`. O world confere que o prédio é dele e foi aprovado, que tem o hash do GLB (`model_sha256`, devolvido pelo Builder na validação) e que a carteira está ligada à conta; e assina com a mesma chave da posse on-chain do lote. Com o voucher, a carteira chama `BuildingNFT.mint`, e o contrato exige que ela seja dona do lote no `LandNFT`. Ligue com `BUILDING_NFT_ADDRESS` no `.env`.

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
| POST | `/v1/world/properties/:id/onchain-voucher` | dono (Bearer) | Voucher EIP-712 do `PropertyNFT` para o imóvel pronto (corpo: `{wallet}`) |
| POST | `/v1/world/properties/:id/level-voucher` | dono (Bearer) | Voucher do nível atual para `PropertyNFT.upgrade` |
| GET | `/v1/world/me/taxes` | jogador (Bearer) | Contas de imposto: valor, multa, vencimento, situação e dias de atraso; total devido |
| POST | `/v1/world/me/taxes/pay` | jogador (Bearer) | Paga agora as contas pendentes |
| POST | `/v1/world/cities/:code/lots/:id/building` | dono do lote (Bearer) | Envia o job do SCC Builder; o world valida contra o próprio lote |
| GET | `/v1/world/me/buildings` | jogador (Bearer) | Prédios do jogador e a situação de cada um |
| GET | `/v1/world/cities/:code/lots/:id/building` | público | Prédio aprovado do lote, com os artefatos |
| POST | `/internal/v1/buildings/:id/review` | ferramenta interna (`x-service-token`) | Alvará: aprova ou recusa |
| POST | `/v1/world/buildings/:id/onchain-voucher` | dono (Bearer) | Voucher EIP-712 do `BuildingNFT` para o prédio aprovado (corpo: `{wallet}`) |
| GET | `/healthz` | — | `{status: "ok"}` |

Erros com código estável: `lot_not_for_sale`, `lot_reserved`, `district_closed`, `other_district`, `area_cap`, `insufficient_scity`, `reservation_lost`, `ledger_unavailable`, `not_found`, `not_lot_owner`, `wallet_not_linked`, `unknown_property_type`, `zone_not_allowed`, `lot_has_property`, `insufficient_thaler`, `property_not_ready`, `nothing_to_claim`, `claim_in_progress`, `nothing_to_repair`, `max_level`, `work_in_progress`, `nothing_to_upgrade`, `tax_default`, `taxes_disabled`, `building_invalid`, `lot_has_building`, `lot_without_polygon`, `building_not_in_review`, `builder_unavailable`, `model_not_found`, `building_not_approved`, `model_hash_missing`, `pool_empty`, `properties_disabled`, `city_not_onchain`, `onchain_disabled`, `gateway_unavailable`, `missing_credentials`, `invalid_token`, `token_expired`.

## Banco

Esquema próprio `world`: `city` (zonas, bairros abertos, limiar), `lot` (situação, dono, reserva) e `purchase` (cada compra, com o preço em wei e a situação), `property` (imóvel, obra, desgaste e última coleta; um por lote) e `property_claim` (cada coleta e se já foi paga) `property_work` (reparos e upgrades; uma pendente por imóvel), `tax_bill` (uma conta por lote, tipo e período) e `building` (prédio validado, outorga, alvará; um vigente por lote). O `lot` ganhou `polygon`. Migrações em `drizzle/`, controladas em `drizzle.__world_migrations`.

## Ainda não

- Ler a blockchain: transferências do `LandNFT` atualizarem o dono no jogo (chain-indexer).
- Imóveis: troca de tipo (T1 → T2 → T3), seguro, aluguel e hotel, lote duplo (Residencial 2 e 3), regularização e água/energia; os outros tipos do doc 03 §6; o catálogo vindo do Strapi (hoje fica no código, igual ao seed); a renda conferir o dono on-chain do imóvel e do lote (doc 07 §2.2), que pede o feed do chain-indexer.
- Prédios: o chain-indexer ler o `BuildingNFT`, unidades e venda (E3.11), taxa de alvará, prazo de obra proporcional à área, IPTU por unidade.
- Impostos: leilão do lote inadimplente; IPTU por unidade dos prédios de construtores (doc 13).
- Câmbio THALER ↔ SCITY e cotação do dia (passo 11 da trilha); hoje `SCITY_USD` é fixo.
- Mercado secundário entre jogadores, imóveis e utilidades.
