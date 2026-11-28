# services/game-core

Regras do jogo: avatares, atributos, turnos de trabalho (jobs agendados com seed commit-reveal), alimentação, saúde, pets, fazenda, veículos e eventos semanais.

- Guia: [trilha-backend.md](../../docs/desenvolvimento/trilha-backend.md)
- Modelo de dados e API: [docs/06](../../docs/06-modelo-dados-api.md)
- Regras: [doc 02 §2](../../docs/02-game-design.md) (avatar, raridades, atributos), [ADR-0013](../../docs/adr/0013-regras-conflitos-fontes.md) (educação 0–100, até 3 avatares por conta)

## O que funciona hoje (E1.3, passo 6 da trilha)

| Regra | Como |
|---|---|
| Avatar com raridade e profissão | 4 raridades e as 44 profissões do GDD, lidas do Strapi (`CMS_URL`) ou, sem ele, de [`cms-strapi/seed/profissoes.json`](../../cms-strapi/README.md); conferidas ao subir e a cada publicação, pelo webhook. A profissão tem de ser da raridade do avatar. `CATALOG_FILE` troca o arquivo |
| Atributos | Energia, saúde, felicidade, alimentação e higiene de 0 a 10; educação de 0 a 100, cumulativa. O banco repete as faixas em `CHECK` |
| Até 3 avatares por conta | Trava por conta no Postgres (`pg_advisory_xact_lock`): 8 pedidos em paralelo criam exatamente 3 |
| Queda com o tempo | Ver a tabela abaixo. A leitura mostra o valor atual; o job grava |
| Job `attributes.decay` | A cada 15 min (`DECAY_EVERY_SECONDS`), em lotes de 500, com `FOR UPDATE SKIP LOCKED`: duas instâncias dividem o trabalho. Rodar duas vezes no mesmo instante não derruba nada a mais |
| Situação do avatar | `earnsReward` (alimentação acima de 0; o GDD diz que 48 h sem comer não gera recompensa), `canWork` (energia ≥ 1) e `canLeisure` (energia ≥ 2) |

| Atributo | Queda | Fonte |
|---|---|---|
| Alimentação | 1 ponto a cada 4,8 h (de 10 a 0 em 48 h) | GDD §2.3 |
| Felicidade | 1 ponto a cada 12 h | **premissa**: o GDD só diz que "decai com o tempo" |
| Higiene | 1 ponto a cada 8 h | **premissa**: o atributo é proposto no GDD, sem taxa |
| Energia, saúde | não cai com o tempo; a energia gasta com o turno (abaixo), a saúde com doenças | GDD §2.3 |
| Educação | nunca cai | GDD §2.3 |

Cada atributo que cai guarda o **instante de referência** (`food_at`, `happiness_at`, `hygiene_at`): o próximo ponto cai em `instante + período`. Por isso a leitura e o job sempre concordam e nenhuma fração de tempo se perde, rode o job a cada 15 min ou uma vez por dia.

## Turno de trabalho (E1.4, passo 7 da trilha)

| Regra | Como |
|---|---|
| Turno de 6 ou 12 h | No máximo 12 h por dia (UTC): um de 12 h ou dois de 6 h (GDD §3.2). A regra da cama para dois turnos entra com os itens |
| Energia | 3 no turno de 6 h e 6 no de 12 h (**premissa**: o GDD dá o custo por tarefa). Precisa de energia e saúde ≥ 1 |
| Roda sem o cliente | O job `shift.complete` (a cada 60 s) conclui os turnos vencidos; listar e coletar também concluem o que já venceu |
| Ganho | A fórmula do simulador (doc 04 §4): base da raridade × saúde × felicidade × experiência (teto 2,5×) × danos. Turno de 12 h = 1 dia de base; de 6 h = meio. 48 h sem comer = 0 |
| Base | O ganho do dia da profissão no GDD (Padeiro 125, Pedreiro 100, Médico 250…), sempre dentro da faixa da raridade que o simulador usa |
| Danos | 5% de chance de perder 30% (premissas do simulador), sorteados com a semente do turno |
| Sorteio auditável | No começo, o servidor publica `seed_commit` = sha256(semente). No fim, revela a semente; o resultado é HMAC(semente, turno), que qualquer um refaz |
| Pagamento | O "Coletar" paga pelo ledger do economy, do pool P2E para o jogador, com a chave `shift:<id>`: repetir nunca paga em dobro. O `x-request-id` da coleta vai junto, para achar o pagamento no log do economy. Pool vazio responde `503 pool_empty` e o turno fica para coletar depois |

O evento semanal, o pet (no teto de 2,5×), os itens da temporada e o Pet Sitter também entram no ganho, cada um na sua seção. A moradia entra pela seção abaixo.

## Moradia: casa própria, aluguel ou hotel

Sem moradia regular, o turno rende **50%**: é o `fator_regularizacao_moradia` do doc 04 §4 e o `work.unregularizedFactor` do simulador. O fator vai na foto do turno (`snapshot.housing`), tirada no começo; turnos de antes não têm o campo e valem 1.

| Moradia | Como |
|---|---|
| Casa própria | Uma casa pronta da conta, regularizada e com água e energia em dia. O game-core pergunta ao world (`GET /internal/v1/accounts/:id/homes`, com `WORLD_URL` e `WORLD_TOKEN`). A regularização se faz no world, pela ficha do lote. Com o world fora do ar, o turno não perde o fator (vale 1) e o aviso fica no log. Sem `WORLD_URL`, a casa própria não conta |
| Aluguel | `POST /v1/avatars/:id/housing` com `{kind: "aluguel", days}`: quarto num residencial da Prefeitura, 15 THALER/dia. 40% viram queima (`burn/rent`) e 60% voltam ao pool P2E, de onde sai a renda dos imóveis, até os prédios de jogadores alugarem unidades (E3.11) |
| Hotel do jogo | `{kind: "hotel", level, days}`: níveis 1, 2 e 3 a 25, 40 e 60 THALER/dia, com 1, 2 e 3 refeições incluídas por dia (`POST /v1/avatars/:id/housing/meal`, +3 de alimentação, sem cobrança). Tudo vira queima (`burn/hotel`) |
| Hotel de jogador | `{kind: "hotel", days, hotel_id}`: o hotel construído por um jogador (world). O nível, a diária e as refeições são os do hotel; 90% da diária vão para o dono e 10% para `burn/hotel`. Cheio (10, 20 ou 40 quartos pelo nível): `409 hotel_full`; quem já está estende. Também `own_hotel`, `hotel_closed` e `hotel_not_found`. `GET /v1/housing/hotels?city=` lista os da cidade com hóspedes, quartos e diária |

- De 1 a 30 dias por vez, até 30 dias pagos adiantado (`409 housing_prepaid`). A mesma estadia estende; outra dá `409 housing_active`.
- `DELETE /v1/avatars/:id/housing` sai agora, sem reembolso, para trocar de moradia.
- A cobrança segue o caminho das refeições (duas fases, `Idempotency-Key`, `rent_fee` e `hotel_fee` no ledger).
- `GET /v1/avatars/:id/housing` mostra o fator do próximo turno, a estadia, as casas próprias e os preços. O avatar traz `housing` (a estadia em curso).
- **Premissas:** os preços, a divisão 40/60 (do simulador: `sinks.rentRenter` e `sinks.rentNpcShare`), as refeições do hotel e o limite de 30 dias.
- Depois de atualizar o código, rode `pnpm db:migrate`: a migração `0020_moradia` cria a coluna `housing` do avatar.

## Descanso, higiene e deslocamento (GDD §2.3, §3.3)

| O quê | Como |
|---|---|
| Dormir | `POST /v1/avatars/:id/rest` com `{hours: 4 \| 8}`. Enquanto dorme, não trabalha nem sai para o lazer (`409 resting`). Ao acordar, ganha +4 ou +8 de energia, até 10. Sem moradia regular, metade. Não dorme com turno rodando nem com a energia cheia (a não ser no descanso obrigatório) |
| Descanso obrigatório | Com 16 h acordado (desde o fim do último descanso; o avatar novo conta da criação), não começa turno nem lazer (`409 must_rest`) até dormir. O turno que já começou termina. O avatar traz `must_rest_at`, e o `status` traz `mustRest`. Qualquer descanso, até o de 4 h, zera a conta |
| Higiene em casa | `POST /v1/avatars/:id/chores` com `{code}`: banho (+3 higiene, +1 saúde), ducha (+3 higiene, +1 felicidade), dentes (+1 higiene, +1 saúde) e mãos (+1 higiene). De graça, cada uma a cada 4 h, só com moradia regular (`409 no_home`) |
| Ir ao trabalho | `POST /v1/avatars/:id/work` aceita `commute`: `a_pe` (15 min, o padrão), `skate` (10 min; precisa do skate da loja), `onibus` (6 min, 3 THALER), `carro` (4 min, 2 THALER de combustível; precisa de habilitação e de um carro em dia) e `home_office` (0 min, 2 THALER de internet, −1 de felicidade e de saúde). O atraso tira a fração do turno e a tarifa sai do pagamento. Vai na foto do turno (`commute`, `commuteMode`, `commuteCostCents`) |

- `GET /v1/catalog/routine` lista os descansos, as atividades de casa e os modos. O avatar traz `rest` (acorda em, energia) e `chores` (quando cada uma libera).
- **Premissas:** a energia do descanso, o corte sem moradia, os efeitos da higiene (o seed só dá a direção), os atrasos de ônibus e a pé (o GDD propõe), as tarifas, o efeito do home office e liberar o home office para todas as profissões até o catálogo marcar quais podem.
- Depois de atualizar o código, rode `pnpm db:migrate`: a migração `0021_rotina` cria as colunas `rest` e `chores` do avatar, e a `0023_descanso_16h` cria a `awake_since` (os avatares que já existem contam a partir da migração).

## Loja do jogo: roupas, ferramenta, cama, móveis e eletrodomésticos (GDD §6 "Lojas", §3.2)

`POST /v1/avatars/:id/shop` com `{item, level?}`, pelo caminho das refeições (`shop_buy`, `burn/shop`):

| Item | Efeito | Preço (premissa) |
|---|---|---|
| Roupa nível 1, 2 ou 3 | +10%, +15% ou +20% no ganho, para sempre; vale a melhor (`409 already_owned` para igual ou pior) | 300, 800 e 1.500 THALER |
| Ferramenta de trabalho | +30% por 3 dias, só na profissão da compra (o GDD dá o estetoscópio do médico); comprar de novo estende, até 6 dias | 50 THALER |
| Cama | Libera o segundo turno de 6 h no dia (`409 bed_required` sem ela) | 250 THALER |
| Skate ou bicicleta: `skate` | Libera o modo `skate` de ir ao trabalho (10 min). Gasta uma viagem por turno; sem viagens, quebra (`409 no_skate`) e é preciso comprar outro | 120 THALER, 60 viagens |
| Móveis: `sofa`, `mesa`, `guarda_roupa` | Com a cama, a **casa completa**: ao acordar de um descanso numa moradia regular, +1 de felicidade | 200, 150 e 180 THALER |
| Eletrodomésticos: `fogao`, `micro_ondas`, `geladeira` | Cozinhar a despensa em casa (`POST /v1/avatars/:id/cook`, `{food}`): +5 de alimentação no fogão, +4 no micro-ondas (comer cru dá +3), sem dor de barriga; a geladeira soma +1 de saúde. Precisa de moradia regular (`409 no_home`) e de fogão ou micro-ondas (`409 no_stove`) | 300, 150 e 400 THALER |

- O bônus da loja (roupa × ferramenta) multiplica o dos itens sazonais do GamePass em `snapshot.items` (o `M_itens` do doc 04 §4).
- O avatar traz `gear` (roupa, ferramenta, cama, `home` com os móveis e eletrodomésticos, `complete_home`, `cooks_with` e o fator do próximo turno). `GET /v1/catalog/shop` lista os preços, a casa completa e o rendimento da cozinha.
- **Premissas:** os preços, a ferramenta genérica por profissão, o limite de 6 dias, a felicidade da casa completa só ao acordar (uma vez por descanso) e o rendimento da cozinha.
- **Ficam para depois:** calçados e as roupas sazonais.
- Depois de atualizar o código, rode `pnpm db:migrate`: a migração `0022_loja` cria a coluna `gear` do avatar.

## Minigame do turno (E2.2)

O turno percorre as tarefas da profissão, no servidor e sem o jogo aberto (doc 02 §3.2). Cada tarefa ocupa uma parte do turno proporcional à duração dela no GDD. No Pedreiro, por exemplo, "Construir a casa" leva 160 de 265 min, então 60% do turno. Cada turno em `GET /v1/avatars/:id/shifts` e `POST /work` traz `minigame`:
- `tasks`: nome, início, fim, situação (`done`, `current`, `next`) e a direção da energia e da felicidade (`+`/`-`);
- `current` e `progress`;
- `damage`: depois do fim, a tarefa e o motivo do dano (ferramenta quebrada, roubo no trajeto…), tirados da mesma semente do sorteio. Durante o turno fica `null`, para não revelar nada antes da hora (commit-reveal).

**O minigame não muda a economia.** O ganho e a energia seguem a fórmula do simulador (ADR-0010). O GDD dá custos de energia por tarefa (5 a 20 no turno) que não cabem no atributo de 0 a 10, e por isso as tarefas mostram só a direção dos efeitos até o game designer acertar o catálogo.

**Profissões do MVP:** as 12 do ROADMAP, as 11 comuns e o Cozinheiro, vêm com `mvp: true` em `GET /v1/catalog/professions`. No mapa de Pittsburg, o painel mostra a lista de tarefas do turno, com a atual em destaque, e o motivo do dano no último turno.

## Alimentação (E2.3, passo 12 da trilha)

O avatar come no **mercado do jogo**: compra uma unidade do alimento e come na hora.

| Regra | Como |
|---|---|
| Alimentos | Os 17 da Tabela de Atributos (doc 02 §7), lidos do Strapi (`/api/foods`) ou, sem ele, de [`cms-strapi/seed/alimentos.json`](../../cms-strapi/README.md). Publicar um alimento no Strapi recarrega o mercado pelo mesmo webhook das profissões. `FOODS_FILE` troca o arquivo |
| Efeito | +3 de alimentação (**premissa**: o GDD pede 3 refeições por dia e a alimentação cai 5 pontos por dia), mais a energia e a saúde do alimento, que podem ser negativas. Tudo fica entre 0 e 10 |
| Satisfeito | Com alimentação 10 não come (`409 not_hungry`), e nada é cobrado |
| Preço | O do catálogo (THALER por pacote) dividido pelas unidades do pacote. Sem preço no catálogo, que é o caso hoje, 4 THALER por unidade (**premissa**: o simulador conta 12 THALER por dia de comida, em 3 refeições). A API marca `provisional_price` |
| Para onde vai o THALER | Para a queima (`burn/food`): comida é sink (doc 04 §7). Lançamento `meal_buy` com a chave `meal:<id>` |
| Sem saldo | `409 insufficient_thaler`: a refeição fica `failed` e o avatar não muda |
| Ledger fora | A refeição fica `pending` e a próxima chamada do jogador (comer ou listar) termina: cobra com a mesma chave, que o ledger nunca lança duas vezes, e aplica |
| Clique repetido | Com `Idempotency-Key`, o mesmo pedido devolve a mesma refeição e cobra uma vez |

No mapa de Pittsburg, o painel mostra a lista de alimentos e o botão "Comer" quando a alimentação está abaixo de 10.

Depois de atualizar o código, rode `pnpm db:migrate`: a tabela `meal` é nova.

**Despensa.** `POST /v1/avatars/:id/pantry` com `{food}` compra o pacote inteiro do catálogo (maçã vem em 5, ovos em 3) e guarda as unidades no avatar (`pantry`). Compra mesmo satisfeito. Comer da despensa (`POST /v1/avatars/:id/consume`, `{food}`) tem as mesmas regras e efeitos da refeição, inclusive a dor de barriga, e não cobra de novo. O pacote custa o preço do catálogo; sem ele, as unidades pelo preço provisório, sem desconto (**premissa**). Passa pelo mesmo caminho da refeição: lançamento `pack_buy` para `burn/food`, chave `meal:<id>`, `Idempotency-Key`. A despensa tem limite pela casa: 10 unidades sem moradia regular, 30 com moradia e 60 com geladeira. O pacote que passa do limite dá `409 pantry_full`; o que vem da fazenda não passa pelo limite (**premissa**). No mapa, o botão "Pacote" fica ao lado de "Comer" e a despensa aparece com um botão por alimento.

**Tempo de compra** (GDD §6 "Mercado": "4 min + volume"): depois de comprar a refeição ou o pacote, o avatar fica no mercado por 4 min mais 30 s por unidade (**premissa**). Enquanto isso, não começa turno nem sai para o lazer (`409 at_market`). Pode comprar de novo (o carrinho do mercado no mapa): cada compra soma o tempo dela ao que falta; o avatar traz `market_until` e `status.atMarket`. Comer da despensa e cozinhar são em casa e não contam. `GET /v1/catalog/foods` traz `market` e `pantry_limits`. A migração `0024_mercado_despensa` cria a coluna `market_until`.

Ainda não: a regra da energia que recarrega a cada 8 h.

## Doenças e farmácia (E2.3, passo 12 da trilha)

As doenças leves do GDD §5 ficam no próprio avatar (`conditions`, a `avatar_condition` do doc 06), uma de cada tipo por vez, e passam sozinhas no fim do prazo.

| Doença | Quando aparece | Efeito |
|---|---|---|
| Dor de barriga | 3% das refeições (GDD) | De cama por 1 dia: não trabalha |
| Gripe | 1% dos turnos (GDD; o gatilho no turno é **premissa**) | Isolado por 24 h: não trabalha |
| Dor de cabeça | 5% dos turnos (**premissa**) | Trabalha com −10% de rendimento (GDD) por 12 h (**premissa**) |

A gripe e a dor de cabeça saem da semente do próprio turno (`draw(semente, turno, "gripe")`), a mesma que o jogador recebe quando o turno acaba, e começam no fim do turno. Comer continua permitido doente.

**Farmácia do jogo.** `POST /v1/avatars/:id/medicine` com `{condition}` compra o remédio daquela doença e toma na hora: cura com 70% de chance (GDD); sem cura, o THALER não volta. Custa 10 THALER (**premissa**: o GDD não tem o preço), que vão para a queima (`burn/pharmacy`, lançamento `medicine_buy`). O remédio passa pelo mesmo caminho da refeição: mesma tabela `meal` (código `remedio`), mesma cobrança em duas fases, mesma `Idempotency-Key`. A exigência de enfermeiro como dono vale quando as farmácias forem de jogadores (fase 2).

**Passagem de ônibus na rua** (fase 3 do mundo aberto). `POST /v1/avatars/:id/bus-ride` paga a passagem quando o avatar embarca no ônibus do street view. Custa o mesmo que o deslocamento de ônibus do turno (`COMMUTES.onibus`, 3 THALER), que vai para a queima (`burn/transit`, lançamento `bus_fare`), pelo mesmo caminho da refeição (código `onibus`, cobrança em duas fases, `Idempotency-Key`). Não muda nada no avatar; a viagem é da cena. Não embarca internado, dormindo nem de cama. O catálogo da rotina mostra o preço em `bus_fare`.

**Dirigir o próprio carro na rua** (fase 4 do mundo aberto). `POST /v1/avatars/:id/drive` com `{vehicle}` confere a habilitação do avatar (`no_license`, `in_driving_school`) e o carro em dia (`vehicle_unavailable`) e cobra o combustível da saída: o mesmo do deslocamento de carro do turno (`COMMUTES.carro`, 2 THALER), para a queima (`burn/fuel`, lançamento `drive_fuel`), pelo caminho do IPVA (`chargeVehicle`, chave `drive-fuel:<carro>:<Idempotency-Key>`). A cobrança é na entrada: o navegador não informa distância. O catálogo da rotina mostra `drive_fuel`.

No mapa de Pittsburg, o painel mostra "🤒 Doente" com cada doença, o tempo até passar e o botão do remédio.

Depois de atualizar o código, rode `pnpm db:migrate`: a coluna `avatar.conditions` é nova.

## Hospital (E2.3, passo 12 da trilha)

Com **saúde 0 ou energia 0**, o avatar é internado na hora (GDD §2.3 e §5). Ninguém escolhe ir.

| Regra | Como |
|---|---|
| Quando | Na próxima chamada do jogador (ver o avatar, trabalhar, comer) ou na passada do job `hospital.admit` (`HOSPITAL_CHECK_SECONDS`, 60 s), o que vier antes. Com um turno rodando, espera o horário de fim do turno |
| Quanto tempo | 1 dia (`hospital_until` no avatar). Até lá, trabalhar e comer respondem `409 in_hospital` |
| Alta | Energia e saúde voltam a 10 (**premissa**: o castigo é o dia parado e a taxa). A alimentação continua caindo |
| Taxa | 30 THALER, do jogador para a queima (`burn/hospital`): hospital é sink (doc 04 §7). Lançamento `hospital_fee` com a chave `hospital:<id>` |
| Sem saldo | A internação vale do mesmo jeito e a taxa fica `waived` (**premissa**: o jogador não pode ficar preso sem trabalhar para pagar; a inadimplência entra com os impostos, E2.6) |
| Ledger fora | A internação vale e a taxa fica `pending`; o job cobra depois, com a mesma chave |

No mapa de Pittsburg, o painel mostra "🏥 Internado" com o tempo até a alta e esconde o mercado e os turnos.

A saúde chega a 0 pelas doenças graves (abaixo); a energia, quando um turno gasta toda a que sobrava. Depois de atualizar o código, rode `pnpm db:migrate`: a tabela `hospital_stay` e a coluna `avatar.hospital_until` são novas.

### Doenças graves e tratamento

As doenças do hospital do GDD §5 tiram **1 de saúde a cada 15 min** enquanto duram. A farmácia não cura (`409 hospital_only`): só o hospital.

| Doença | Quando aparece (**premissa**) | Efeito além da saúde |
|---|---|---|
| Febre | 1% dos turnos | Não trabalha |
| Enxaqueca | 1% dos turnos | Trabalha com −20% de rendimento (**premissa**) |
| Virose | 0,5% dos turnos | Não trabalha |

Saem da semente do turno, como a gripe, e duram até 72 h (**premissa**). Sem tratamento, a saúde chega a 0 em 2 h 30 e o avatar é internado por 1 dia; a internação compulsória também cura a doença grave.

A queda é calculada pelo tempo, como a alimentação: cada doença guarda quanto já tirou (`drained`), então ver o avatar, a passada do job de decaimento e a internação dão o mesmo número, sem contar duas vezes.

**Tratamento voluntário.** `POST /v1/avatars/:id/hospital/treat` interna por **4 h** (**premissa**), com a mesma taxa de 30 THALER para a queima e as mesmas regras de cobrança da compulsória (`reason: treatment`). Na alta, a doença grave sumiu e a saúde está cheia. Recusa com `nothing_to_treat` sem doença grave, `in_hospital` já internado e `shift_running` com turno rodando. O catálogo da farmácia e o avatar marcam essas doenças com `hospital_only: true`.

No mapa de Pittsburg, a doença grave mostra a queda de saúde e o botão "Hospital · 30" no lugar do remédio.

Depois de atualizar o código, rode `pnpm db:migrate`: a migração `0007_tratamento` aceita o motivo `treatment`.

## Lazer (E3.3)

Atividades de lazer ([leisure.ts](src/domain/leisure.ts), GDD §2.3 e §6). Precisam de 2 de energia (`too_tired`), fora do hospital, e cada uma vale uma vez a cada 4 h (`leisure_cooldown`, guardado na coluna `leisure` do avatar).

| Atividade | Onde | Efeito (premissa) |
|---|---|---|
| Skate | Parque, de graça | −1 de energia, +2 de felicidade (GDD) |
| Basquete | Parque, de graça | −1 de energia, +2 de felicidade (GDD), +1 de saúde |
| Academia | Negócio de jogador no world | −2 de energia, +2 de saúde, +1 de felicidade |
| Galeria | Negócio de jogador no world | −1 de energia, +2 de felicidade, +1 de educação |

**Na academia e na galeria:**
- O game-core pergunta ao world (`WORLD_URL`, `WORLD_TOKEN`) o dono, a entrada e se está aberta. Sem os dois, só o parque funciona (`503 venues_unavailable`).
- A entrada é cobrada pelo ledger antes do efeito, pelo mesmo caminho das refeições (`leisure_fee`): 90% vão para o dono e 10% para a queima (`burn/leisure`, taxa da Prefeitura, **premissa**). No negócio próprio, não paga.
- Recusa com `venue_required`, `venue_not_found` e `venue_closed`.

Depois de atualizar o código, rode `pnpm db:migrate`: a migração `0012_lazer` cria a coluna `leisure`.

## Veículos (E3.5)

Autoescola, agência e IPVA ([vehicle.ts](src/domain/vehicle.ts), GDD §6 "Carros" e "Agência de carros e barcos"). O carro existe só no jogo (tabela `vehicle`), porque o `VehicleNFT` do doc 07 é opcional na fase 2. As corridas e a oficina vêm no próximo passo.

| Regra | Como |
|---|---|
| Autoescola | `POST /v1/avatars/:id/license`: 3 h sem trabalhar nem lazer (GDD), depois habilitado. Paga pelo caminho das refeições (`license_buy`, `burn/license`). O avatar traz `license` |
| Agência | `POST /v1/vehicles` com `{model}` compra e `{model, rent: true}` aluga por 3 dias a 5% do valor (GDD). O carro nasce `pending` e vira `active` com a cobrança (`vehicle_buy`/`vehicle_rent`, `burn/vehicles`); sem THALER, some. Pendente com o ledger fora: o job cobra de novo com a mesma chave |
| Vida útil | Atributos (velocidade e força) no máximo até 90 dias e caindo em linha reta até 50% aos 180 (GDD: vida média de 6 meses). Depois disso o carro está gasto e só vende |
| IPVA | 2% do preço a cada 182 dias; o primeiro vence 182 dias depois da compra. `POST /v1/vehicles/:id/ipva` paga (até 30 dias antes), com uma chave por semestre. Atrasado, o carro fica `suspended` (GDD: "inadimplência suspende o uso") e não vende |
| Recompra | `POST /v1/vehicles/:id/sell`: a agência paga 80% do valor depreciado (preço × (1 − idade/180 dias)), saindo da conta de sistema `system/vehicle_agency` (`vehicle_buyback`) |

**Premissas:** Hatch 3.000, Sedã esportivo 8.000 e Superesportivo 20.000 THALER; a curva de queda; IPVA de 2%; recompra de 80%; autoescola de 50 THALER. Depois de atualizar o código, rode `pnpm db:migrate`: a migração `0014_veiculos` cria `vehicle` e a coluna `license` do avatar.

## Fazenda: agricultura (E3.4)

Plantio, estações, níveis e riscos ([farm.ts](src/domain/farm.ts), GDD §6). A pecuária vem no próximo passo. A região A3 (zona rural) ainda não existe no mapa. Por isso a fazenda é um slot da conta comprado da Prefeitura, com 4 canteiros (um por lote do slot), na tabela `farm` com trava otimista (`version`).

| Regra | Como |
|---|---|
| Estações | Mudam a cada 7 dias (verão, outono, inverno, primavera) e multiplicam a colheita por 1; 0,7; 0,5; 0,85 (GDD: verão > primavera > outono > inverno) |
| Arar | Precisa da enxada (GDD). Com o próprio agricultor (agricultor, fazendeiro ou agrônomo, `avatar_id`), custa 1 de energia; contratado, 10 THALER. Repete depois de cada colheita |
| Plantar | Culturas pelo nível (GDD): no 1, uva, morango, tomate e cenoura; o 2 soma laranja, beterraba e milho; o 3 soma maçã, trigo e batata. Sementes de 5 THALER. Crescimento de 1, 2 ou 3 dias pelo nível da cultura (o irrigador corta 25%) |
| Riscos | Sorteados no plantio, com a semente guardada no canteiro e mostrada na colheita: apodrecer 5% (perde tudo); pássaros nas frutas 5% (agrotóxico −20% da chance; leva 50%); corvos nos grãos 5% (espantalho −50%; leva 50%); coelhos 3% (leva 30%, 15% com o cão). Sem colher, perde 5% por dia depois do 1º dia (o drone corta pela metade) |
| Colher | 10 unidades por canteiro no verão (+20% com o separador de sementes), para a despensa do avatar escolhido, como o alimento do catálogo |
| Nível | 3 colheitas no nível + 5.000 (nível 2) ou 10.000 THALER (nível 3) (GDD: "≥ 3 colheitas + pagamento") |

**Dinheiro:** slot, máquinas, sementes, aragem contratada e níveis vão para a queima (`burn/farm`). Cada cobrança tem a chave da operação (o slot da conta, a máquina, o ciclo do canteiro, o nível), então tentar de novo depois de um conflito não cobra outra vez.

**Premissas:** os preços (slot 10.000, máquinas de 50 a 500), o crescimento, as unidades, as chances que o GDD não dá e o tamanho dos danos. Depois de atualizar o código, rode `pnpm db:migrate`: a migração `0017_fazenda` cria `farm`.

## Fazenda: pecuária (E3.4)

Galinhas, porcos e gado ([livestock.ts](src/domain/livestock.ts), GDD §6 "Pecuária"), guardados no estado da própria fazenda (mesma trava otimista).

| Regra | Como |
|---|---|
| Estruturas | Galinheiro (para galinhas e galo), chiqueiro (80 THALER, do GDD), pasto com curral e comedouro (o gado precisa dos dois), chocadeira |
| Lotação | Galinheiro até 12 galinhas, com 1 galo para 12 (GDD); chiqueiro até 6 porcos; pasto até 15 cabeças (GDD) |
| Alimentar | 1 milho ou trigo da despensa do avatar, uma vez por dia. Adulto depois de 3 refeições (GDD); nível 2 com 10 e nível 3 com 20, com +10% e +20% de itens (GDD) |
| Produção | Galinha adulta alimentada, com o galinheiro limpo, põe 1 ovo por dia; vaca de leite dá 1 leite a cada 3 dias. Fica guardado (até 3) até `POST /v1/farm/collect`, que põe na despensa |
| Abate | Só o adulto dá carne crua (GDD): galinha 1, porco 3, boi ou vaca 6 |
| Reprodução | Casal adulto da espécie (galo com galinha), 1 trigo ou milho (GDD); o casal espera 3 dias |
| Chocadeira | 1 ovo da despensa vira pinto, com 3% de galinha dos ovos de ouro, que põe em dobro (GDD) |
| Mortes | Porco com 3 dias sem comida (GDD); boi e vaca aos 45 dias (GDD) |
| Riscos | Sorteados uma vez por dia com a semente da fazenda (GDD): febre aftosa (3%, mata 25% do gado), raposas (3% com mais de 4 galinhas, mata 50%, e o cão de pastoreio protege), gripe aviária (3%, −25% dos ovos) |
| Limpeza | O galinheiro limpo vale 5 dias por 30 THALER (GDD); sujo, as galinhas não põem |

**Premissas:** preços das estruturas e dos animais, o limite de porcos, o ritmo de ovos e leite, quanto fica guardado, a carne por animal, quem nasce na reprodução e os níveis por refeição. Sem migração nova: a pecuária mora no `state` da fazenda.

## Eventos semanais e GamePass (E3.10)

Eventos por profissão e o GamePass da temporada ([events.ts](src/domain/events.ts), GDD §8, doc 04 §4 e §8). Os grupos de evento e as temporadas, com os itens, vêm do **Strapi** (tipos `event-group` e `season`). O seed fica em [`cms-strapi/seed/eventos.json`](../../cms-strapi/seed/eventos.json) e [`temporadas.json`](../../cms-strapi/seed/temporadas.json) e vale até o Strapi responder, e se ele cair.

| Regra | Como |
|---|---|
| Evento da semana | Toda semana ISO (segunda a domingo, UTC) um grupo de profissões ganha ×1,2 no turno (`fator_evento_semanal` do doc 04 §4). Os grupos se revezam: Comida, Saúde, Lazer (do GDD §8) e Cidade (as 18 profissões que o GDD não pôs em nenhum grupo, **premissa**). O nome gira na lista do grupo. O fator vale para o turno que começa na semana e fica no retrato do turno (`snapshot.event`). `GET /v1/events` dá o evento de agora e os 3 próximos |
| GamePass | Temporada 1: 12 semanas a partir de 16/11/2026. Níveis 1 a 5 pagos em SCITY (sink `burn/gamepass`, doc 04 §8). Subir paga só a diferença, com uma chave por nível. Cada nível corta 10% da chance de dano no turno (`snapshot.damageCut`) e libera um item da temporada |
| Itens sazonais | Cada item tem um efeito que vale **só durante a temporada**. `earn` soma ao ganho do turno (`snapshot.items`, multiplicador): na temporada 1, boné +2%, camiseta +3% e placa +5%. `damage` corta mais a chance de dano: o troféu corta 5%. `cosmetic` só aparece (o adesivo). Tetos: +15% de ganho e 60% de corte de dano. No nível 5 da temporada 1: −55% de dano e +10% de ganho. `GET /v1/gamepass` traz `earn_bonus`, `damage_cut` e os itens com `effect`, `value` e `unlocked` |
| Strapi | Publicar um `event-group` ou uma `season` dispara o webhook, e o game-core recarrega sem deploy (`/internal/v1/catalog/refresh`, modelos `event-group` e `season`). Dado quebrado não entra, e o jogo segue com o anterior. Os casos: profissão desconhecida ou em dois grupos, ordem repetida, fator fora de 1 a 2, temporadas sobrepostas, item fora dos níveis, efeitos acima dos tetos, ou a temporada aberta sumir ou mudar de datas (quem pagou perderia o nível). Preço e itens da temporada aberta podem mudar. `origin` (`seed` ou `cms`) aparece em `/v1/events` e `/v1/gamepass` |

**Premissas (no seed, editáveis no Strapi):** o grupo Cidade, o fator de 1,2, a ordem dos grupos, 5 SCITY por nível, o corte de 10% por nível, os efeitos dos itens e a duração da temporada. Os eventos de data marcada (Natal, Carnaval) e a loja de itens ficam para depois. Depois de atualizar o código, rode `pnpm db:migrate`: a migração `0016_gamepass` cria `game_pass`, e a `0019_gamepass_nivel_10` sobe o teto do nível no banco para 10 (`PASS_LEVEL_CAP`), o mesmo que uma temporada do Strapi pode ter.

## Corridas e oficina (E3.5)

Corridas diárias e oficina do jogo ([race.ts](src/domain/race.ts), GDD §6 "Carros" e "Oficina").

| Regra | Como |
|---|---|
| Corrida | `POST /v1/vehicles/:id/races` `{avatar_id}`: o piloto é um avatar habilitado da conta, com 2 de energia. Corre contra 7 rivais do jogo. Nota: 30% velocidade, 25% força, 20% experiência (educação) e 25% sorte (GDD: "velocidade, força, experiência + sorte"). A semente fica no resultado: quem tem a semente refaz a corrida |
| Limite | Até 3 corridas por piloto por dia UTC (GDD: "Limite diário de corridas (emissões)"), conferido com o piloto travado. Passa pelo antifraude do P2E (`action: race`) |
| Dinheiro | Gasolina de 3 THALER antes (`race_fuel`, `burn/fuel`); prêmio de 20/10/5 THALER para os 3 primeiros, do pool P2E (`race_prize`). A corrida vai `pending` → `charged` (gasolina paga, −1 de energia e +1 de felicidade no piloto, pane no carro, uma vez só) → `done` (prêmio pago). Sem THALER, `failed`; pool vazio, fica `charged` e o job paga depois |
| Pane | 5% das corridas (2% com a revisão em dia): leve, moderada ou grave (60/30/10%). Com pane, o carro não corre |
| Oficina | `POST /v1/vehicles/:id/repair`: 2%, 5% ou 10% do preço; o carro fica 1, 3 ou 7 dias na oficina (GDD). A chave da cobrança é a pane: tentar de novo não cobra outra vez |
| Revisão | `POST /v1/vehicles/:id/revision`: 1% do preço, vale 30 dias e reduz as panes (GDD: "Seguro e revisão reduzem panes") |

**Premissas:** os pesos da nota, os rivais entre 0,30 e 0,75, os prêmios, a gasolina, o limite de 3, as chances de pane e os custos de reparo e revisão. A oficina como negócio de jogador, o seguro e o motorista particular ficam para depois. Depois de atualizar o código, rode `pnpm db:migrate`: a migração `0015_corridas` cria `vehicle_race` e as colunas de pane, oficina e revisão do carro.

## Campeonato de futebol de botão (E3.3)

Um campeonato por mês, UTC ([championship.ts](src/domain/championship.ts), GDD §6 "Lazer": "times de 6; 75% das inscrições → 50/35/15% para os 3 primeiros; 25% queimados").

| Passo | Como |
|---|---|
| Inscrição | `POST /v1/championships/current/teams` `{name, avatar_id}` cria o time com o jogador como capitão; `POST /v1/championships/current/teams/:teamId/members` `{avatar_id}` entra. Uma conta joga num time só, e o time vai até 6 (`team_full`, `already_registered`, `team_name_taken`). A inscrição vai do jogador para o escrow do mês (`escrow/championship_AAAA_MM`), gravada `pending` antes e `paid` depois. Sem THALER, a inscrição é desfeita |
| Sorteio | A semente é sorteada na criação e só o hash (`seed_commit`) aparece. Depois da disputa, a semente é revelada e qualquer um refaz a classificação |
| Disputa | Na virada do mês (job `championship.settle` a cada minuto, ou a primeira leitura depois disso). A nota é 60% força (média de energia, saúde e felicidade dos 6) e 40% sorte da semente |
| Prêmios | 75% do bolo dos times completos para os 3 primeiros (50/35/15), divididos igualmente pelos 6. O resto vai para a queima (`burn/championship`). O time incompleto recebe a inscrição de volta; com menos de 3 times completos, todos recebem e nada é queimado. Tudo numa transação do ledger, idempotente pelo mês |

**Premissas:** inscrição de 10 THALER; 60% força e 40% sorte. Depois de atualizar o código, rode `pnpm db:migrate`: a migração `0013_campeonato` cria `championship`, `championship_team` e `championship_member`.

## Escola (E3.2)

Aula e troca de profissão ([school.ts](src/domain/school.ts), GDD §3.2 e ADR-0013). A escola mora no próprio avatar (coluna `school`, jsonb) e anda na leitura, como a queda dos atributos.

| Regra | Como |
|---|---|
| Educação | De 0 a 100, cumulativa: nunca se perde, nem ao trocar de profissão. Multiplica o turno de 1× a 3×. Graus 1 a 3 nos marcos 33, 66 e 100 (ADR-0013) |
| Aula | `POST /v1/avatars/:id/school/class`: +2 de educação, −2 de energia, uma por dia (UTC). Recusa com `class_taken`, `max_education`, `too_tired`, `in_hospital` e `in_school` |
| Troca de profissão | `POST /v1/avatars/:id/school/change` com `{job}`: só para outra profissão da mesma raridade (a raridade é do NFT). São 4 dias de escola: o turno recusa com `in_school`. Dá +2 de felicidade na matrícula e +2 depois de 24 h (GDD: "+felicidade nos 2 primeiros dias"). A nova profissão vale no fim dos 4 dias. Recusa com turno rodando (`shift_running`) |
| Cobrança | Pelo ledger, como as refeições (`school_buy`, para a queima `burn/school`), com `Idempotency-Key` |
| Pet Sitter (serviço de jogador) | O avatar com a profissão Pet Sitter abre a oferta e escolhe a diária. O dono deixa o pet com ele por 24 h, com o mesmo cuidado do hotel. A vaga é reservada antes da cobrança (até 3 pets por sitter, conferido com o sitter travado) e volta se o pagamento falhar. A diária vai pelo ledger: 90% para o sitter e 10% para a queima (`petsitter_fee`, `burn/petsitter`). Enquanto cuida de algum pet, o turno do sitter rende +20% (`snapshot.sitter`, GDD: "Pet sitter recebe produtividade + 20%"). O sitter não atende a própria conta ([sitter.ts](src/domain/sitter.ts)) |

**Premissas** (a calibrar no simulador):
- Aula de 15 THALER, com +2 de educação. Chegar a 100 leva 50 dias de aula.
- Troca de profissão por 100 THALER.
- "+felicidade" vira +2 por dia nos 2 primeiros dias.

Depois de atualizar o código, rode `pnpm db:migrate`: a migração `0011_escola` cria a coluna `school`.

## Pets e Pet Shop (E3.1)

Cada avatar pode ter um gato ou um cachorro ([pet.ts](src/domain/pet.ts), GDD §3 e §2.4). O pet mora no próprio avatar (coluna `pet`, jsonb) e cai junto com ele na leitura.

| Regra | Como |
|---|---|
| Atributos | Alimentação, água e felicidade de 0 a 5. A água só cai no passeio (−1) e o pet só bebe em casa ("Água", de graça) |
| Morte | Alimentação em 0: o pet morre no instante em que zerou. Morto, fica até o jogador enterrar (`enterrar`) ou adotar outro |
| Pet triste | Felicidade do pet em 0: no turno, o avatar conta metade da felicidade (GDD: "perde 50%") |
| Nível | De 3 a 15, sobe 1 a cada 5 de experiência (1 por passeio ou serviço do Pet Shop). Multiplicador de 1,00× a 1,25× (GDD §2.4), com teto conjunto Experiência × Pet de 2,5× (ADR-0013) |
| Passeio | −5 de energia, +3 de felicidade e +3 de saúde no avatar; +2 de felicidade e −1 de água no pet. Precisa de energia para lazer e de 2 de água no pet |
| Pet Shop | Adoção, ração (+3 de alimentação), banho e tosa (+2 de felicidade) e hotel de 24 h (alimentação e água cheias, +2 de felicidade, sem queda enquanto está lá). Pago pelo ledger como as refeições (`petshop_buy`, para a queima `burn/petshop`), com `Idempotency-Key` |

**Premissas** (a calibrar no simulador):
- A alimentação do pet cai 1 a cada 6 h e a felicidade 1 a cada 12 h. O GDD diz −1/h de alimentação, o que mataria o pet 5 h depois da última ração, antes de um turno de 6 h acabar.
- "+30%" vira +2 no pet (de 5) e +3 no avatar (de 10).
- Um pet por avatar.
- Preços, em THALER: gato 50, cachorro 80, ração 3, banho 8, tosa 12, hotel 20.
- Pet Sitter: diária de 10 a 40 THALER, até 3 pets por vez, e o +20% vale para o turno que começa com algum pet sob cuidado.

Depois de atualizar o código, rode `pnpm db:migrate`: a migração `0010_pets` cria a coluna `pet`, e a `0018_pet_sitter` cria `pet_sitter_offer` e `pet_sitting`.

## Antifraude (E2.9, passo 15 da trilha)

O limite de 3 avatares por conta (ADR-0013) já vale na criação. O resto do doc 10 ("multi-contas / bots farmando P2E") roda nas duas rotas que emitem P2E, começar turno (`/work`) e coletar (`/claim`):

| Regra | Como |
|---|---|
| Aparelho (bloqueia) | O cliente manda `x-device-id`: um id aleatório que o mapa guarda no navegador. No máximo 3 contas ganham P2E no mesmo aparelho em 30 dias. As 3 primeiras seguem; da 4ª em diante, `403 risk_review` até a revisão. É o "3 por IP" do GDD, adaptado como pede o doc 02 |
| Rede (só alerta) | IPv4 /24 ou IPv6 /64. Mais de 10 contas na mesma rede em 24 h viram métrica e log, sem bloquear: lan house, escola e NAT de operadora juntam muita gente |
| Velocidade | Até `RISK_RATE_PER_MINUTE` (20) pedidos de P2E por conta por minuto; acima disso, `429 too_many_requests` |
| Revisão | `GET /internal/v1/risk/devices` lista os aparelhos acima do limite. `POST /internal/v1/risk/accounts/:id` com `{decision: allow | block, note}` libera ou bloqueia a conta, acima das regras |
| Métricas | `risk_signals_total`, `risk_flags_total{rule}`, `risk_blocks_total{rule}` (device, manual, velocity) e `risk_decisions_total`, no `/metrics` |

**Privacidade (LGPD):** o banco guarda só HMAC do aparelho e da rede, com o segredo `RISK_PEPPER` (sem ele, o `JWT_SECRET`). IP e id puros nunca são gravados, e não dá para refazer a tabela a partir de IPs conhecidos sem o segredo. Atrás de proxy, ligue `TRUST_PROXY=true` para o IP vir do `X-Forwarded-For`.

**Premissas, sem dados ainda:** 3 contas por aparelho, 30 dias, 10 contas por rede em 24 h e 20 pedidos por minuto. Calibrar com as métricas do alpha.

Cliente sem `x-device-id` não é bloqueado, só aparece em `risk_signals_total{device="nao"}`. Os clientes oficiais mandam o cabeçalho.

## Avatar na blockchain (AvatarNFT)

O job `chain.sync` (`CHAIN_SYNC_SECONDS`, 30 s) lê o feed de eventos confirmados do chain-indexer:

| Evento | O que acontece |
|---|---|
| `AvatarMinted` (Lucky Box revelou) | O avatar nasce no jogo para a conta dona da carteira, com a raridade e a profissão gravadas no token. Uma vez por token |
| `Transfer` entre carteiras (venda fora do jogo) | O avatar passa para a conta da carteira que recebeu, com os atributos, a despensa e as doenças de agora |
| Carteira sem conta | Fica pendente, uma por token, e sai quando a carteira for ligada. Se o token muda de mão antes, vale a última carteira, inclusive para um mint ainda pendente |
| Profissão fora do catálogo | O mint fica pendente até o catálogo ter a profissão |

**Limite de 3 por conta:** o avatar que chega da blockchain entra mesmo com a conta no limite, porque o NFT é do jogador. Para o antifraude continuar valendo, só os 3 que estão na conta há mais tempo trabalham; o turno dos outros responde `409 avatar_limit`. O turno começado antes da venda é pago a quem o começou.

Ligue com `CHAIN_INDEXER_URL`, `CHAIN_INDEXER_TOKEN` (o `INTERNAL_TOKEN` do indexer), `GATEWAY_URL` e `GATEWAY_TOKEN`. Testado no anvil em 2026-11-21: o avatar mintado (épico, arquiteto) entrou no jogo e passou para a conta do comprador.

## Rodar

```bash
pnpm db:up
pnpm db:migrate
cp services/game-core/.env.example services/game-core/.env
pnpm --filter @scc/game-core dev
```

No `.env`, preencha `JWT_SECRET` (o mesmo do gateway) e `INTERNAL_TOKEN` (32 caracteres ou mais). `CORS_ORIGINS` lista as origens do navegador (o mapa em `http://localhost:8081`). Para testar, `DEV_FREE_AVATAR=true` e `DEV_SHIFT_MINUTES=1` (turno de 1 minuto que paga como 6 h); os dois são recusados em produção. Para pagar turnos, `ECONOMY_URL` e `ECONOMY_TOKEN` (o `INTERNAL_TOKEN` do economy); o pool P2E precisa ter saldo, emitido pelo `system/mint` (veja o [README do economy](../economy/README.md)). Testes, com o Postgres do `pnpm db:up` no ar e **no banco `scc_test`**, nunca no do jogo local: os jobs de teste varrem a tabela inteira (queda de atributos, conclusão de turnos) e mexeriam nos seus avatares. Migre antes com `DATABASE_URL=…/scc_test pnpm db:migrate`.

```bash
TEST_DATABASE_URL=postgresql://scc:scc_dev@127.0.0.1:5433/scc_test pnpm --filter @scc/game-core test
```

## API

| Método | Rota | Quem chama | O que faz |
|---|---|---|---|
| GET | `/v1/avatars` | jogador (Bearer) | Avatares da conta, com atributos atuais e situação |
| GET | `/v1/avatars/:id` | jogador (Bearer) | Um avatar; de outra conta responde 404 |
| POST | `/v1/avatars/:id/work` | jogador (Bearer) | Começa o turno `{shift}`, de 6 ou 12 h; devolve o `seed_commit` |
| GET | `/v1/avatars/:id/shifts` | jogador (Bearer) | Últimos 20 turnos, com resultado e semente dos concluídos |
| POST | `/v1/avatars/:id/claim` | jogador (Bearer) | Paga no ledger os turnos concluídos e ainda não coletados |
| POST | `/v1/avatars/:id/meals` | jogador (Bearer) | Come `{food}`: cobra no ledger e aplica os efeitos. Aceita `Idempotency-Key`. Devolve a refeição e o avatar |
| GET | `/v1/avatars/:id/meals` | jogador (Bearer) | Últimas 20 compras do mercado e da farmácia (`pending`, `eaten`, `failed`) |
| POST | `/v1/avatars/:id/pantry` | jogador (Bearer) | Compra o pacote `{food}` para a despensa. Aceita `Idempotency-Key`. Devolve a compra e o avatar |
| POST | `/v1/avatars/:id/consume` | jogador (Bearer) | Come uma unidade `{food}` da despensa, sem cobrar. Devolve o avatar |
| POST | `/v1/avatars/:id/cook` | jogador (Bearer) | Cozinha em casa uma unidade `{food}` da despensa (fogão ou micro-ondas, moradia regular) |
| POST | `/v1/avatars/:id/medicine` | jogador (Bearer) | Compra e toma o remédio `{condition}`. Aceita `Idempotency-Key`. Devolve o remédio, `cured` e o avatar |
| POST | `/v1/avatars/:id/drive` | jogador (Bearer) | Dirige o próprio carro na rua `{vehicle}`: confere a habilitação e o carro em dia e cobra o combustível da saída (2 THALER, para `burn/fuel`). Aceita `Idempotency-Key`. Devolve `fuel_cents`, o carro e o avatar |
| POST | `/v1/avatars/:id/bus-ride` | jogador (Bearer) | Paga a passagem do ônibus na rua (3 THALER, para `burn/transit`). Aceita `Idempotency-Key`. Devolve a passagem (`ride`) e o avatar |
| GET | `/v1/catalog/pharmacy` | público | Preço do remédio, chance de cura e a tabela das doenças |
| GET | `/v1/catalog/vehicles` | público | Modelos da agência (preço, aluguel, velocidade, força) e as regras de vida útil, IPVA, aluguel, recompra e autoescola |
| POST | `/v1/avatars/:id/license` | jogador (Bearer) | Autoescola: paga e fica 3 h parado. Aceita `Idempotency-Key` |
| GET | `/v1/avatars/:id/housing` | jogador (Bearer) | Moradia: fator do próximo turno, estadia, casas próprias e preços |
| POST | `/v1/avatars/:id/housing` | jogador (Bearer) | Aluguel ou hotel `{kind, level?, days}`. Aceita `Idempotency-Key` |
| DELETE | `/v1/avatars/:id/housing` | jogador (Bearer) | Sai do aluguel ou do hotel, sem reembolso |
| POST | `/v1/avatars/:id/housing/meal` | jogador (Bearer) | Refeição incluída no hotel |
| GET | `/v1/housing/prices` | público | Preços do aluguel e do hotel |
| GET | `/v1/housing/hotels` | público (com Bearer, marca os seus) | Hotéis de jogador da cidade (`?city=`): nível, quartos, hóspedes, diária e refeições |
| POST | `/v1/avatars/:id/rest` | jogador (Bearer) | Dorme 4 ou 8 h `{hours}` |
| POST | `/v1/avatars/:id/chores` | jogador (Bearer) | Higiene em casa `{code}` |
| GET | `/v1/catalog/routine` | público | Descanso, higiene e modos de ir ao trabalho |
| POST | `/v1/avatars/:id/shop` | jogador (Bearer) | Loja: roupa, ferramenta, cama, móveis e eletrodomésticos. Aceita `Idempotency-Key` |
| GET | `/v1/catalog/shop` | público | Preços e bônus da loja |
| GET | `/v1/vehicles` | jogador (Bearer) | Carros da conta com a situação (`ok`, `suspended`, `worn_out`, `expired`), atributos de agora, valor, recompra e IPVA |
| POST | `/v1/vehicles` | jogador (Bearer) | Compra `{model}` ou aluga `{model, rent: true}` na agência |
| POST | `/v1/vehicles/:id/ipva` | jogador (Bearer) | Paga o IPVA do semestre |
| GET | `/v1/farm` | jogador (Bearer) | O catálogo da fazenda (slot, sementes, aragem, níveis, estações, culturas, máquinas) e a fazenda da conta (ou null) |
| POST | `/v1/farm` | jogador (Bearer) | Compra o slot da Prefeitura |
| POST | `/v1/farm/machines` | jogador (Bearer) | Compra a máquina `{machine}` |
| POST | `/v1/farm/plots/:i/plow` | jogador (Bearer) | Ara o canteiro 1–4: com o agricultor `{avatar_id}` ou contratado `{}` |
| POST | `/v1/farm/plots/:i/plant` | jogador (Bearer) | Planta `{crop}` no canteiro arado |
| POST | `/v1/farm/plots/:i/harvest` | jogador (Bearer) | Colhe para a despensa do avatar `{avatar_id}`; devolve unidades, dano e a semente |
| POST | `/v1/farm/structures` | jogador (Bearer) | Constrói `{structure}`: galinheiro, chiqueiro, pasto, comedouro ou chocadeira |
| POST | `/v1/farm/animals` | jogador (Bearer) | Compra `{breed}`: galinha, galo, porco, boi ou vaca |
| POST | `/v1/farm/animals/:id/feed` | jogador (Bearer) | Alimenta com `{avatar_id, food}` (milho ou trigo da despensa) |
| POST | `/v1/farm/animals/:id/slaughter` | jogador (Bearer) | Abate: carne crua para a despensa de `{avatar_id}` |
| POST | `/v1/farm/collect` | jogador (Bearer) | Coleta ovos e leite para a despensa de `{avatar_id}` |
| POST | `/v1/farm/breed` | jogador (Bearer) | Reprodução `{ids: [a, b], avatar_id, food}` |
| POST | `/v1/farm/hatch` | jogador (Bearer) | Chocadeira: 1 ovo da despensa de `{avatar_id}` vira pinto |
| POST | `/v1/farm/coop/clean` | jogador (Bearer) | Limpa o galinheiro (5 dias) |
| POST | `/v1/farm/level` | jogador (Bearer) | Sobe a fazenda de nível |
| GET | `/v1/events` | público | O evento semanal de agora (grupo, nome, profissões, fator, início e fim) e os 3 próximos |
| GET | `/v1/gamepass` | público (com Bearer, o seu nível) | A temporada, o preço por nível, o seu nível, o corte de dano e os distintivos |
| POST | `/v1/gamepass` | jogador (Bearer) | Sobe para `{level}`, pagando a diferença em SCITY |
| POST | `/v1/vehicles/:id/races` | jogador (Bearer) | Corrida do dia com o piloto `{avatar_id}`: gasolina, resultado com a semente e o prêmio |
| GET | `/v1/races` | jogador (Bearer) | Últimas 20 corridas da conta |
| POST | `/v1/vehicles/:id/repair` | jogador (Bearer) | Leva o carro com pane à oficina (1, 3 ou 7 dias) |
| POST | `/v1/vehicles/:id/revision` | jogador (Bearer) | Revisão de 30 dias, com menos panes |
| POST | `/v1/vehicles/:id/sell` | jogador (Bearer) | Vende para a agência pela depreciação |
| GET | `/v1/championships/current` | público (com Bearer, marca o seu time) | O campeonato do mês (times, jogadores por time, bolo, prazo, `seed_commit`), as regras e o resultado do mês anterior (`last`) |
| GET | `/v1/championships/:month` | público | Um campeonato (`AAAA-MM`); disputado, com a semente e o resultado |
| POST | `/v1/championships/current/teams` | jogador (Bearer) | Cria o time `{name, avatar_id}` e paga a inscrição |
| POST | `/v1/championships/current/teams/:teamId/members` | jogador (Bearer) | Entra no time `{avatar_id}` e paga a inscrição |
| GET | `/v1/catalog/leisure` | público | As atividades, onde acontecem, a direção (+/−) dos efeitos, o intervalo e a parte do dono |
| POST | `/v1/avatars/:id/leisure` | jogador (Bearer) | Atividade `{activity, venue_id?}`. No parque é de graça; na academia ou na galeria, cobra a entrada (aceita `Idempotency-Key`). Devolve a compra (ou null) e o avatar (com `leisure`) |
| GET | `/v1/catalog/school` | público | Preço e efeito da aula, preço e dias da troca de profissão, e os marcos dos graus |
| POST | `/v1/avatars/:id/school/class` | jogador (Bearer) | Aula do dia, paga pelo ledger. Aceita `Idempotency-Key`. Devolve a compra e o avatar (com `school`) |
| POST | `/v1/avatars/:id/school/change` | jogador (Bearer) | Troca de profissão `{job}`, na mesma raridade, paga pelo ledger: 4 dias de escola |
| GET | `/v1/catalog/petshop` | público | Espécies e serviços do Pet Shop com o preço, o passeio, a queda e a tabela de nível → multiplicador |
| POST | `/v1/avatars/:id/pet` | jogador (Bearer) | Adota `{species: cat \| dog, name}`, pago pelo ledger. Aceita `Idempotency-Key`. Devolve a compra e o avatar (com `pet`) |
| POST | `/v1/avatars/:id/pet/services` | jogador (Bearer) | Serviço do Pet Shop `{service: racao \| banho \| tosa \| hotel}`, pago pelo ledger. Aceita `Idempotency-Key` |
| GET | `/v1/pet-sitters` | público (com Bearer e `?avatar_id=`, a estadia do pet) | Pet Sitters atendendo, com a diária e as vagas (sem os da própria conta), a faixa de preço, a capacidade e as horas da estadia |
| PUT | `/v1/avatars/:id/pet-sitter` | avatar Pet Sitter (Bearer) | Abre ou fecha a oferta: `{open, price}` (centavos de THALER, de 1000 a 4000) |
| GET | `/v1/avatars/:id/pet-sitter` | avatar Pet Sitter (Bearer) | Painel do sitter: a oferta, os pets sob cuidado e o bônus do turno (`shift_bonus`) |
| POST | `/v1/avatars/:id/pet/sitter` | dono (Bearer) | Deixa o pet com o Pet Sitter por 24 h: `{sitter_avatar_id}`. Erros: `sitter_closed`, `sitter_full`, `own_sitter`, `pet_in_hotel`, `insufficient_thaler`. Aceita `Idempotency-Key` |
| POST | `/v1/avatars/:id/pet/actions` | jogador (Bearer) | De graça: `{action: agua \| passeio \| enterrar}` |
| GET | `/v1/avatars/:id/hospital` | jogador (Bearer) | Últimas 20 internações, com motivo, alta e situação da taxa (`pending`, `paid`, `waived`) |
| POST | `/v1/avatars/:id/hospital/treat` | jogador (Bearer) | Tratamento das doenças graves: 4 h internado, taxa de 30 THALER, sai curado |
| POST | `/v1/dev/avatar` | jogador (Bearer) | **Só desenvolvimento** (`DEV_FREE_AVATAR=true`): dá um avatar comum a quem não tem; desligado, 404 |
| POST | `/internal/v1/avatars` | serviços (`X-Service-Token`) | Cria `{account_id, rarity, job_code}` só no jogo, dentro do limite. O avatar da Lucky Box entra pelo `chain.sync` |
| GET | `/internal/v1/risk/devices` | revisão (`X-Service-Token`) | Aparelhos com mais contas que o limite (`?days=30`) |
| POST | `/internal/v1/risk/accounts/:accountId` | revisão (`X-Service-Token`) | `{decision: allow | block, note}`: libera ou bloqueia os ganhos da conta |
| POST | `/internal/v1/catalog/refresh` | Strapi (webhook, `X-Service-Token`) | Recarrega o catálogo publicado no Strapi; catálogo quebrado ou sem uma profissão em uso é recusado (`422 catalog_rejected`). Com `model: "food"`, recarrega só os alimentos; outros tipos do catálogo são ignorados |
| GET | `/v1/catalog/foods` | público | Os alimentos do mercado com energia, saúde, o preço de uma unidade e o do pacote (`pack`, `pack_price`), em centavos de THALER |
| GET | `/v1/catalog/professions` | público | As 44 profissões com ganho do dia, duração e tarefas; das tarefas, só a direção (+/−) de energia e felicidade (GDD §2.4) |
| GET | `/healthz` | — | `{status: "ok"}` |

Erros com código estável: `invalid_rarity`, `invalid_job`, `avatar_limit`, `invalid_shift`, `shift_running`, `daily_limit`, `too_tired`, `pool_empty`, `unknown_food`, `not_hungry`, `not_in_pantry`, `invalid_stay`, `housing_active`, `housing_prepaid`, `not_staying`, `not_in_hotel`, `hotel_meals_used`, `resting`, `invalid_rest`, `not_tired`, `unknown_chore`, `no_home`, `chore_cooldown`, `invalid_commute`, `no_car`, `invalid_item`, `already_owned`, `bed_required`, `in_hospital`, `sick`, `not_sick`, `invalid_condition`, `hospital_only`, `nothing_to_treat`, `insufficient_thaler`, `ledger_unavailable`, `not_found`, `forbidden`, `missing_credentials`, `invalid_token`, `token_expired`.

## Banco

Esquema próprio `game`: tabela `avatar` do doc 06, com os instantes de referência da queda, `work_shift`, com a semente e o resultado, `chain_cursor` e `chain_avatar_pending` (AvatarNFT → jogo), `meal`, com o preço, os efeitos e a situação da refeição, e `hospital_stay`, com o motivo, a alta e a taxa. Migrações em `drizzle/`, controladas em `drizzle.__game_core_migrations`.

## Ainda não

- Efeito real de energia e felicidade por tarefa, que depende do game designer acertar os números do catálogo. Cards de arte das 12 profissões do MVP.
- Móveis, eletrodomésticos (cozinhar), calçados e roupas sazonais na loja; lojas de jogadores (fase 2).
- Aluguel de unidades de prédios de jogadores (com o E3.11); bônus por ocupação do hotel de jogador.
- As outras atividades extras do seed (parque, ginásio e lojas já têm o lazer; as de transporte, pets e escola são parte de outros sistemas); as doenças do hospital (febre, enxaqueca, virose: −1 de saúde a cada 15 min).
- O tempo de compra do mercado e o limite da despensa pela casa.
- Calibrar as premissas de felicidade e higiene no simulador.
