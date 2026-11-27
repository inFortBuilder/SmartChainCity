# services/world

Cidade, bairros e lotes: situação, dono, preço e a venda primária (doc 03 §5, doc 13 §3, [ADR-0012](../../docs/adr/0012-cidade-real-construtores.md)). Também emite a cotação EIP-712 que leva o lote ao `LandNFT`. Também cuida dos imóveis: obra, desgaste e renda. Depois virão as regras de cerco.

- Guia: [trilha-backend.md](../../docs/desenvolvimento/trilha-backend.md)
- Modelo de dados e API: [docs/06](../../docs/06-modelo-dados-api.md)

## O que funciona hoje

| Regra | Como |
|---|---|
| Geometria e situação separadas | Os polígonos ficam nos arquivos estáticos por bairro, que o mapa já baixa ([city-chunks](../../tools/scc-builder/README.md#lotes-por-bairro)). O servidor guarda o que muda e decide a venda: zona, área, bairro, situação e dono |
| Preço em dólar, pago em SCITY | Área × US$/m² da zona (residencial 0,78, uso misto 1,56, comercial 2,85), convertido pela cotação do câmbio do economy (`GET /v1/economy/fx`, renovada a cada minuto). Sem o economy, vale a última cotação lida ou o `SCITY_USD` do `.env`. A reserva fixa o preço em SCITY |
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

### Venda de lançamento: fila e limite por carteira (E4.3)

Na abertura de uma cidade ou região, a operação agenda um **lançamento**. Até o fim dele, a compra passa por uma sala de espera:

- **Fila:**
  - A fila abre `pre_queue_seconds` antes da venda (padrão: 30 min).
  - Quem entra antes da abertura tem a posição **sorteada** (aleatório do sistema), para não premiar o bot que chega primeiro.
  - Quem entra depois vai por ordem de chegada, atrás dos sorteados.
- **Vez:**
  - A cada `batch_seconds` entram mais `batch_size` posições (padrão: 200 por minuto).
  - A vez é calculada da posição, sem job: `max(entrada, abertura + ⌊(posição − 1) / batch_size⌋ · batch_seconds)`.
  - Na vez, o jogador tem `window_seconds` para comprar (padrão: 10 min).
  - Se a vez passar, entra de novo, no fim da fila.
- **Limite por carteira:**
  - Durante o lançamento, cada conta compra até `max_lots` lotes (padrão: 3). Contam as compras pagas e as em andamento desde a abertura, e a recusada por saldo não conta.
  - A contagem roda dentro da trava do comprador na reserva, então compras em paralelo não passam do limite.
  - Com `require_wallet` (padrão), só entra na fila quem tem carteira ligada. Como uma carteira só se liga a uma conta (gateway), o limite vale por carteira.
  - Sem o gateway configurado (dev), essa exigência não é conferida.
- **Depois de `ends_at`:** a venda volta ao normal, sem fila e sem limite extra, só com as regras de sempre (um bairro por jogador, teto de 30% da área).

```bash
# Agendar (ferramenta da operação; o token é o INTERNAL_TOKEN do world)
curl -X PUT $WORLD/internal/v1/cities/pittsburg/sale -H "x-service-token: $INTERNAL_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"opens_at":"2026-12-01T15:00:00Z","ends_at":"2026-12-04T15:00:00Z","batch_size":200,"max_lots":3}'
```

No mapa, a ficha do lote à venda mostra o bloco **Venda de lançamento**:
- a fase;
- o botão **Entrar na fila**;
- a posição (provisória até o sorteio) e quanto falta para a vez;
- o tempo para comprar e o limite.

O **Comprar** só vale na vez, e a ficha se atualiza sozinha quando a vez chega.

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

### Venda na blockchain muda o dono no jogo

O `LandNFT` e o `PropertyNFT` circulam livres (ADR-0014). O job `chain.sync` (`CHAIN_SYNC_SECONDS`, 30 s) lê o feed de eventos confirmados do chain-indexer e, a cada `Transfer` entre duas carteiras:

| Caso | O que acontece |
|---|---|
| Carteira com conta (gateway) | O lote ou o imóvel passa para essa conta. Os impostos seguintes vão para ela |
| Carteira sem conta | A transferência fica pendente, e o jogo mantém o dono antigo até a carteira ser ligada |
| O mesmo token vendido de novo | Vale a última transferência; as pendentes dele saem |
| Mint (de `0x0`) | Nada: é o jogo levando para a carteira o que já era do jogador |

**Renda:** o imóvel só rende para quem também é dono do lote (doc 07 §2.2), e só pelo tempo em que os dois donos coincidiram. Antes de o lote ou o imóvel mudar de dono, na blockchain (`chain.sync`) ou no leilão, a renda acumulada é fechada:

- se os donos eram os mesmos, ela vira uma coleta do dono do imóvel, paga pelo job `properties.settle`. Quem vende o lote não perde o que já rendeu;
- se eram diferentes, o período fica fechado sem renda. Juntar o lote e o imóvel de novo não paga o tempo em que estiveram separados.

Com os donos separados, a coleta responde `409 lot_not_owned`, e um reparo ou upgrade fecha o período sem pagar.

Ligue com `CHAIN_INDEXER_URL`, `CHAIN_INDEXER_TOKEN` (o `INTERNAL_TOKEN` do indexer), `GATEWAY_URL` e `GATEWAY_TOKEN`. Testado no anvil em 2026-11-21: o lote vendido de uma carteira para outra passou para a conta do comprador.

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
- **Regularização e serviços:** taxa de 2% do preço; água 2 e energia 3 THALER/dia no centro (somam os 5/dia do plano de energia do simulador), até o dobro na borda; 60 dias adiantados no máximo.

### Catálogo do Strapi e troca de tipo (doc 03 §6)

**Catálogo.** Com `CMS_URL`, o world lê os tipos publicados no Strapi (`/api/property-types`, com os níveis) na partida e a cada `CATALOG_REFRESH_SECONDS` (padrão 300). Junta com o catálogo do código, que é o mesmo do seed:
- o que o CMS traz vale; o que falta (preço, renda, custo de nível) vem do tipo de mesmo código no código;
- o negócio de lazer (entrada da academia e da galeria), o uso na Prefeitura e as premissas ficam do código;
- sem preço ou sem a renda do nível 1, o tipo aparece em `/v1/world/property-types` com `available: false` e o motivo, mas não constrói (`409 type_unavailable`); um nível sem renda ou sem custo para subir encerra a lista de níveis;
- tipos raros (só em eventos) e de lote duplo também não constroem ainda;
- com o Strapi fora do ar, segue o catálogo que já estava. Sem `CMS_URL`, vale o do código.

**Troca de tipo (T1 → T2 → T3).** `POST /v1/world/properties/:id/retype`, uma obra como as outras:
- pede a casa no último nível do tipo (`409 max_level_first`);
- cobra a diferença de preço entre os tipos (`burn/construction`, `property_retype`);
- fecha a renda até ali e começa no nível 1 do tipo novo.

T2 e T3 não se constroem direto (`409 type_by_upgrade`). O imóvel traz `next_type` (tipo, custo, renda e `ready`).

**No `PropertyNFT`.** O contrato guarda o `typeCode` do mint e só aceita nível maior. Por isso a família da casa vai como a T1, com o nível corrido: T1 1 a 3, T2 4 a 6, T3 7 a 9 (`chain` no imóvel). Assim a troca de tipo é um "nível" a mais no token, sem mudar o contrato auditado.

**Premissas** (a "Figura 16" do GDD não veio no texto):
- **T2:** 7.000 THALER; renda de 24, 30 e 36/dia; níveis a 3.000 e 5.000.
- **T3:** 12.000 THALER; renda de 42, 50 e 58/dia; níveis a 5.000 e 8.000.
- A troca da T1 no nível 3 custa 3.000; a da T2, 5.000.

### Regularização, água e energia (doc 03 §3)

O imóvel pronto rende **50%** até estar regular: regularizado na Prefeitura e com água e energia em dia. É o `fator_regularizacao_moradia` do doc 04 §4 e o `work.unregularizedFactor` do simulador. Cada passo é uma obra, como o reparo: cobra antes, fecha a renda até ali com o estado antigo e só então muda o imóvel.

| Passo | Rota | Custo (premissa) | Sink |
|---|---|---|---|
| Regularizar (uma vez; residencial ou comercial, pelo tipo) | `POST /v1/world/properties/:id/regularize` | 2% do preço: 80 THALER na T1 | `burn/prefeitura` |
| Água por 30 dias | `POST /v1/world/properties/:id/water` | 2 THALER/dia no centro | `burn/utilities` |
| Energia por 30 dias | `POST /v1/world/properties/:id/power` | 3 THALER/dia no centro | `burn/utilities` |

- O custo dos serviços sobe em linha reta com o bairro, até o dobro no último (o lote vem sem água e energia, e o custo cresce com a distância ao centro, doc 03 §4).
- Em dia, a contratação estende 30 dias; vencida, recomeça na hora.
- No máximo 60 dias pagos adiantado (`409 utility_prepaid`). Regularizar duas vezes dá `409 already_regularized`.
- A renda é a integral do desgaste vezes 0,5 no período todo, mais 0,5 dentro da janela em que as três valem. Por isso a janela pode abrir ou fechar no meio do acúmulo.
- `GET /v1/world/me/properties` mostra `regular`, `income_factor`, `regularization_cost_cents`, `utility_cost_cents` (água e energia no lote), `water_until` e `power_until`. A ficha do lote no mapa tem os botões.
- **Moradia própria.** `GET /internal/v1/accounts/:accountId/homes`, com o `INTERNAL_TOKEN`, lista as casas prontas da conta e até quando cada uma fica regular (`regular_until`). A casa só conta se o dono do imóvel também for o dono do lote. O game-core usa isso no turno.

Com isso, uma T1 coletada toda semana rende 455 THALER até o desgaste chegar a 30, em 70 dias, contra 4.000 de obra. Com reparo a cada 30 dias (60 THALER), sobra ~195 THALER por mês, e a obra se paga em ~620 dias. O [simulador](../../tools/econ-sim/README.md), que conta 10 THALER/dia sem desgaste, precisa passar a contar o desgaste, o reparo e os níveis antes de esses números virarem regra.

## Negócios de lazer (E3.3)

Academia e galeria de arte são tipos de imóvel de jogador (GDD §6 "Lazer": "negócios de jogador com custo de entrada baixo"). São construídas pela mesma rota da Casa T1, em zona comercial ou mista.

- **Renda:** não vem do pool P2E. Quem usa paga a entrada no game-core, e ela vai para o dono.
- **Aberta:** com a obra pronta e o desgaste acima de 30, o mesmo mínimo da renda. Abaixo disso, fecha para reforma.
- `GET /v1/world/cities/:code/venues` lista as abertas e as em obra da cidade, sem expor o dono (só `mine`).
- `GET /internal/v1/venues/:id` (`X-Service-Token`) dá ao game-core o dono, a atividade, a entrada e se está aberta.

**Premissas:** academia por 6.000 THALER com entrada de 5; galeria por 5.000 com entrada de 4; obra de 24 h.

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

### Leilão do lote inadimplente

O job `auctions.tick` (a cada `AUCTION_EVERY_SECONDS`, 60 s) abre o leilão do lote com conta vencida há mais de 120 dias e fecha os que terminaram. O lote vai com o imóvel.

| Regra | Como |
|---|---|
| Lance mínimo | A dívida na abertura (impostos e multas). Depois, 5% acima do maior lance |
| Quem dá lance | Qualquer jogador, menos o dono, com as regras da compra: um bairro por jogador e o teto de 30% da área (`other_district`, `area_cap`). Sem reserva de saldo |
| Duração | 72 h. Lance nos últimos 10 min empurra o fim para 10 min depois dele |
| Fim | Cobra o maior lance numa transação só do ledger (`lot_auction`): sai do vencedor, a dívida ainda pendente vai para `burn/tax` e o resto para o antigo dono. Sem saldo, passa para o próximo jogador |
| Passagem | Depois da cobrança, o lote e o imóvel saem de quem os tiver no jogo naquela hora e vão para o vencedor, e as contas do leilão ficam pagas. A dívida acompanha o lote: vender na blockchain durante o leilão não o salva. Se a passagem parar no meio, o leilão fica `charged` e o job termina na rodada seguinte |
| Dono pagou | Se as contas não estão mais pendentes no fim, o leilão é cancelado e ninguém é cobrado |
| Ninguém pagou | Fica `unsold`, o lote continua com o dono e, se ainda estiver inadimplente, o job abre outro leilão |

O PT continua contando os meses desde a primeira compra: o novo dono herda a escada, como pede o doc 03 §4 contra a especulação. A renda acumulada até a passagem fica com o antigo dono, se ele tinha o lote e o imóvel; o vencedor recebe a partir dali.

**Premissas** (sem fonte no GDD): abre 120 dias depois do vencimento (30 depois do bloqueio de 90), dura 72 h, passo de 5% e extensão de 10 min. Lote com prédio de construtor não vai a leilão, porque o prédio tem regras e NFT próprios.

**Apreensão do NFT ([ADR-0016](../../docs/adr/0016-apreensao-nft-leilao.md)):** se o lote ou o imóvel pode estar numa carteira, o leilão abre a apreensão para o vencedor.

1. `GET /v1/world/me/seizures` lista as apreensões abertas do jogador.
2. `POST /v1/world/seizures/:id/voucher` com `{wallet}` (carteira ligada à conta) devolve o voucher EIP-712, válido por 24 h, para `LandNFT.seize` ou `PropertyNFT.seize`. O contrato leva o token de quem o tiver até essa carteira.
3. Token que nunca foi para a blockchain (o chain-indexer responde 404) cancela a apreensão com `409 not_onchain`: o vencedor leva o lote para a carteira pelo caminho normal.
4. Enquanto a apreensão está aberta, o `chain.sync` ignora as transferências do token. O dono antigo não tira o lote do vencedor vendendo na blockchain. A apreensão fecha (`done`) quando o token chega a uma carteira do vencedor.

Testado no anvil em 2026-11-21: o antigo dono passou o lote para outra carteira, o jogo manteve o lote com o vencedor, o `seize` levou o NFT ao vencedor e a apreensão fechou. Erros: `seizure_closed`, `not_onchain`, `wallet_not_linked`, `seizures_disabled`.

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

### Unidades: venda, revenda e aluguel (E3.11, doc 13 §4)

Fora da blockchain por enquanto: o `UnitNFT` e o `UnitMarket` são contratos novos e pedem auditoria. Preços em THALER (centavos), pelo ledger:

| Passo | Rota | Dinheiro |
|---|---|---|
| Gerar (construtor, prédio com alvará, uma vez) | `POST /v1/world/buildings/:id/units` com `{units_per_floor, ground_commercial, price_cents_per_m2}` | Andares × unidades por andar, com a mesma área (área construída ÷ unidades); térreo comercial opcional |
| Preço de venda e de aluguel | `PUT /v1/world/units/:id/offer` com `{price_cents?, rent_cents_per_day?}` (null tira) | Do dono, ou do construtor antes da 1ª venda; aluguel só na residencial |
| Comprar | `POST /v1/world/units/:id/buy` | 1ª venda: 95% ao construtor, 5% de taxa (`burn/platform`). Revenda: 2% de royalty ao construtor, o resto ao vendedor |
| Alugar para morar | `POST /v1/world/units/:id/lease` com `{avatar_id, days}` (1 a 30) | 90% ao dono, 10% de taxa da Prefeitura (`burn/rent`). Um inquilino por vez; o mesmo avatar estende |

- `GET /v1/world/buildings/:id/units` lista as unidades, e `GET /v1/world/cities/:code/units/for-rent` as livres para alugar. `GET /v1/world/me/units` mostra as da conta (`owned`) e as alugadas (`rented`).
- **Moradia:** a unidade alugada entra em `/internal/v1/accounts/:id/homes` com o `avatar_id` do inquilino. Para o game-core, é moradia regular só desse avatar até o fim do aluguel. A revenda não corta o aluguel pago.
- Venda e aluguel cobram em duas fases: a unidade (ou a vaga) fica segura, o ledger cobra pela chave da venda ou do aluguel, e só então muda. Com o ledger fora, o job `units.settle` termina.
- **Premissas:** as taxas (5%, 2% e 10%); até 20 unidades por andar e 1.000 por prédio; e a unidade conta como moradia sem a Prefeitura, porque o prédio já tem alvará.
- **Ainda não:** `UnitNFT`/`UnitMarket`, IPTU por unidade, condomínio, unidade sem dono que volta ao construtor, e a taxa de alvará e o prazo de obra pela área.

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
| POST | `/v1/world/cities/:code/lots/:id/buy` | jogador (Bearer) | Compra pagando SCITY no ledger. No lançamento, só na vez da fila e até o limite por carteira |
| GET | `/v1/world/cities/:code/sale` | público (com Bearer, a sua ficha) | Lançamento agendado: fase (`soon`, `queue`, `launch`, `ended`), horários, lote de entrada e limite. Com Bearer, `me.ticket` (`waiting`, `admitted`, `expired`, posição, `provisional`, vez e prazo) e `me.bought` |
| POST | `/v1/world/cities/:code/sale/queue` | jogador (Bearer) | Entra na fila (ou devolve a ficha que ainda vale) |
| PUT | `/internal/v1/cities/:code/sale` | operação (`x-service-token`) | Agenda ou muda o lançamento: `opens_at`, `ends_at`, `pre_queue_seconds`, `batch_size`, `batch_seconds`, `window_seconds`, `max_lots`, `require_wallet` |
| DELETE | `/internal/v1/cities/:code/sale` | operação (`x-service-token`) | Cancela o lançamento: a venda fica livre |
| POST | `/v1/world/cities/:code/lots/:id/onchain-quote` | dono do lote (Bearer) | Cotação assinada para o `LandNFT` (corpo: `{wallet}`) |
| GET | `/v1/world/property-types` | público | Tipos de imóvel, preço, obra, renda por nível e regras de desgaste e acúmulo; nos negócios de lazer, `venue` com a atividade e a entrada |
| GET | `/v1/world/cities/:code/venues` | público (com Bearer, marca `mine`) | Academias e galerias da cidade: tipo, lote, entrada, `open` e fase |
| GET | `/internal/v1/venues/:id` | serviços (`X-Service-Token`) | O negócio para o game-core cobrar a entrada: dono, atividade, entrada e se está aberto |
| POST | `/v1/world/cities/:code/lots/:id/property` | dono do lote (Bearer) | Constrói (corpo: `{type}`) pagando THALER |
| GET | `/v1/world/me/properties` | jogador (Bearer) | Imóveis do jogador: fase (`pending_payment`, `building`, `ready`), progresso da obra, desgaste, renda por dia e acumulada |
| POST | `/v1/world/properties/:id/claim` | dono (Bearer) | Coleta a renda acumulada |
| POST | `/v1/world/properties/:id/repair` | dono (Bearer) | Reparo: desgaste volta a 100 |
| POST | `/v1/world/properties/:id/upgrade` | dono (Bearer) | Sobe um nível |
| POST | `/v1/world/properties/:id/regularize` | dono (Bearer) | Regulariza na Prefeitura (uma vez) |
| POST | `/v1/world/properties/:id/retype` | dono (Bearer) | Troca de tipo: T1 → T2 → T3, no último nível |
| POST | `/v1/world/buildings/:id/units` | construtor (Bearer) | Gera as unidades do prédio aprovado |
| GET | `/v1/world/buildings/:id/units` | público | Unidades do prédio |
| PUT | `/v1/world/units/:id/offer` | dono (Bearer) | Preço de venda e de aluguel |
| POST | `/v1/world/units/:id/buy` | jogador (Bearer) | Compra a unidade |
| POST | `/v1/world/units/:id/lease` | jogador (Bearer) | Aluga para um avatar morar |
| GET | `/v1/world/me/units` | jogador (Bearer) | Unidades da conta e as alugadas |
| GET | `/v1/world/cities/:code/units/for-rent` | público | Unidades livres para alugar |
| POST | `/v1/world/properties/:id/water` | dono (Bearer) | Água por 30 dias |
| POST | `/v1/world/properties/:id/power` | dono (Bearer) | Energia por 30 dias |
| GET | `/internal/v1/accounts/:accountId/homes` | `x-service-token` | Casas prontas da conta e até quando são moradia regular |
| POST | `/v1/world/properties/:id/onchain-voucher` | dono (Bearer) | Voucher EIP-712 do `PropertyNFT` para o imóvel pronto (corpo: `{wallet}`) |
| POST | `/v1/world/properties/:id/level-voucher` | dono (Bearer) | Voucher do nível atual para `PropertyNFT.upgrade` |
| GET | `/v1/world/me/taxes` | jogador (Bearer) | Contas de imposto: valor, multa, vencimento, situação e dias de atraso; total devido |
| GET | `/v1/world/auctions` | público (com Bearer, diz se você lidera) | Leilões abertos: dívida, maior lance, lance mínimo e fim |
| GET | `/v1/world/auctions/:id` | público | Um leilão, aberto ou fechado |
| POST | `/v1/world/auctions/:id/bids` | jogador (Bearer) | Lance (corpo: `{amount_cents}`) |
| POST | `/v1/world/me/taxes/pay` | jogador (Bearer) | Paga agora as contas pendentes |
| POST | `/v1/world/cities/:code/lots/:id/building` | dono do lote (Bearer) | Envia o job do SCC Builder; o world valida contra o próprio lote |
| GET | `/v1/world/me/buildings` | jogador (Bearer) | Prédios do jogador e a situação de cada um |
| GET | `/v1/world/cities/:code/lots/:id/building` | público | Prédio aprovado do lote, com os artefatos |
| POST | `/internal/v1/buildings/:id/review` | ferramenta interna (`x-service-token`) | Alvará: aprova ou recusa |
| POST | `/v1/world/buildings/:id/onchain-voucher` | dono (Bearer) | Voucher EIP-712 do `BuildingNFT` para o prédio aprovado (corpo: `{wallet}`) |
| GET | `/v1/world/cities/:code/lots/:id/visit` | jogador (Bearer) | Posso entrar no imóvel do lote? `{place: {kind, id, interior, label}, role}` para o dono ou um convidado |
| GET | `/v1/world/places/:kind/:id/guests` | dono (Bearer) | Convidados do imóvel (`property`) ou do prédio (`building`) |
| POST | `/v1/world/places/:kind/:id/guests` | dono (Bearer) | Convida pela conta ou pela carteira ligada a ela (corpo: `{account_id}` ou `{wallet}`) |
| DELETE | `/v1/world/places/:kind/:id/guests/:account` | dono (Bearer) | Tira o convite |
| GET | `/v1/world/me/invitations` | jogador (Bearer) | Imóveis onde fui convidado e o convite ainda vale |
| GET | `/healthz` | — | `{status: "ok"}` |

Erros com código estável: `sale_not_open`, `queue_required`, `queue_waiting`, `queue_expired`, `queue_not_open`, `sale_ended`, `sale_limit`, `no_sale`, `wallet_required`, `lot_not_for_sale`, `lot_reserved`, `district_closed`, `other_district`, `area_cap`, `insufficient_scity`, `reservation_lost`, `ledger_unavailable`, `not_found`, `not_lot_owner`, `wallet_not_linked`, `unknown_property_type`, `zone_not_allowed`, `lot_has_property`, `insufficient_thaler`, `property_not_ready`, `nothing_to_claim`, `claim_in_progress`, `nothing_to_repair`, `max_level`, `already_regularized`, `utility_prepaid`, `type_unavailable`, `units_disabled`, `units_exist`, `invalid_units`, `unit_not_for_sale`, `unit_not_for_rent`, `own_unit`, `sale_in_progress`, `unit_rented`, `invalid_lease`, `lease_prepaid`, `not_residential`, `type_by_upgrade`, `no_next_type`, `max_level_first`, `work_in_progress`, `lot_not_owned`, `nothing_to_upgrade`, `tax_default`, `taxes_disabled`, `auctions_disabled`, `own_auction`, `auction_closed`, `bid_too_low`, `other_district`, `area_cap`, `building_invalid`, `lot_has_building`, `lot_without_polygon`, `building_not_in_review`, `builder_unavailable`, `model_not_found`, `building_not_approved`, `model_hash_missing`, `pool_empty`, `properties_disabled`, `city_not_onchain`, `onchain_disabled`, `gateway_unavailable`, `missing_credentials`, `invalid_token`, `token_expired`.

## Visitas: entrar nos imóveis pelo street view

No street view do mapa ([street view](../../docs/desenvolvimento/street-view.md)), o jogador clica no imóvel de um lote perto do avatar e entra no interior.

| Regra | Como |
|---|---|
| O que se visita | O prédio de construtor aprovado no lote é um **escritório**. A Casa T1 pronta é uma **residência**. Um imóvel em obra responde `409 under_construction`, e um lote sem nenhum dos dois responde `404 nothing_to_visit` |
| Quem entra | O dono e quem ele convidou. Os outros recebem `403 not_invited` |
| Convite | O dono convida pela conta ou pela carteira ligada a ela (o gateway diz de quem é a carteira), com até 20 convidados por imóvel (**premissa**). Erros: `wallet_unknown`, `self_invite`, `guest_limit` |
| Venda | O convite só vale enquanto quem convidou ainda é o dono. Se o imóvel ou o prédio muda de dono, na blockchain ou no leilão, os convites antigos param de valer sozinhos |

Tabela `place_guest`, migração `0010_visitas`.

## Banco

Esquema próprio `world`: `city` (zonas, bairros abertos, limiar), `lot` (situação, dono, reserva) e `purchase` (cada compra, com o preço em wei e a situação), `property` (imóvel, obra, desgaste, última coleta, regularização e janelas de água e energia; um por lote) e `property_claim` (cada coleta e se já foi paga) `property_work` (reparos, upgrades, regularização, água e energia; uma pendente por imóvel), `tax_bill` (uma conta por lote, tipo e período), `auction` e `auction_bid` (leilão do lote inadimplente; um ativo por lote) e `building` (prédio validado, outorga, alvará; um vigente por lote), `chain_cursor` e `chain_transfer_pending` (posse on-chain → jogo), `sale` (lançamento agendado por cidade) e `sale_ticket` (fichas da fila; a posição é calculada pelo sorteio e pela ordem de chegada). O `lot` ganhou `polygon`. Migrações em `drizzle/`, controladas em `drizzle.__world_migrations`.

## Ainda não

- Imóveis: os valores definitivos dos tipos (Figura 16 do GDD), seguro, aluguel de unidades entre jogadores (com os prédios, E3.11), lote duplo (Residencial 2 e 3); os outros tipos do doc 03 §6.
- Prédios: o chain-indexer ler o `BuildingNFT`, `UnitNFT` e `UnitMarket` (as unidades já se vendem e se alugam no jogo), taxa de alvará, prazo de obra proporcional à área, IPTU por unidade e condomínio.
- Impostos: IPTU por unidade dos prédios de construtores (doc 13). A apreensão do NFT no leilão já existe ([ADR-0016](../../docs/adr/0016-apreensao-nft-leilao.md)).
- Mercado de utilidades entre jogadores (o mercado on-chain de lotes, imóveis e avatares já existe: [contratos](../../contracts/README.md#marketplace-e36)).
