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

Moradia irregular (×0,5) e evento semanal (×1,15) ficam em 1 até existirem imóveis e eventos. O pet entra no teto de 2,5× quando existir.

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

**Despensa.** `POST /v1/avatars/:id/pantry` com `{food}` compra o pacote inteiro do catálogo (maçã vem em 5, ovos em 3) e guarda as unidades no avatar (`pantry`). Compra mesmo satisfeito. Comer da despensa (`POST /v1/avatars/:id/consume`, `{food}`) tem as mesmas regras e efeitos da refeição, inclusive a dor de barriga, e não cobra de novo. O pacote custa o preço do catálogo; sem ele, as unidades pelo preço provisório, sem desconto (**premissa**). Passa pelo mesmo caminho da refeição: lançamento `pack_buy` para `burn/food`, chave `meal:<id>`, `Idempotency-Key`. A despensa não tem limite até existirem casas (E2.5). No mapa, o botão "Pacote" fica ao lado de "Comer" e a despensa aparece com um botão por alimento.

Ainda não: o tempo de compra do mercado (4 min + volume) e a regra da energia que recarrega a cada 8 h.

## Doenças e farmácia (E2.3, passo 12 da trilha)

As doenças leves do GDD §5 ficam no próprio avatar (`conditions`, a `avatar_condition` do doc 06), uma de cada tipo por vez, e passam sozinhas no fim do prazo.

| Doença | Quando aparece | Efeito |
|---|---|---|
| Dor de barriga | 3% das refeições (GDD) | De cama por 1 dia: não trabalha |
| Gripe | 1% dos turnos (GDD; o gatilho no turno é **premissa**) | Isolado por 24 h: não trabalha |
| Dor de cabeça | 5% dos turnos (**premissa**) | Trabalha com −10% de rendimento (GDD) por 12 h (**premissa**) |

A gripe e a dor de cabeça saem da semente do próprio turno (`draw(semente, turno, "gripe")`), a mesma que o jogador recebe quando o turno acaba, e começam no fim do turno. Comer continua permitido doente.

**Farmácia do jogo.** `POST /v1/avatars/:id/medicine` com `{condition}` compra o remédio daquela doença e toma na hora: cura com 70% de chance (GDD); sem cura, o THALER não volta. Custa 10 THALER (**premissa**: o GDD não tem o preço), que vão para a queima (`burn/pharmacy`, lançamento `medicine_buy`). O remédio passa pelo mesmo caminho da refeição: mesma tabela `meal` (código `remedio`), mesma cobrança em duas fases, mesma `Idempotency-Key`. A exigência de enfermeiro como dono vale quando as farmácias forem de jogadores (fase 2).

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

Hoje a saúde não chega a 0 sozinha (nenhum alimento do catálogo tira saúde, e as doenças leves não mexem nela); a energia chega, quando um turno gasta toda a que sobrava. Depois de atualizar o código, rode `pnpm db:migrate`: a tabela `hospital_stay` e a coluna `avatar.hospital_until` são novas.

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
| POST | `/v1/avatars/:id/medicine` | jogador (Bearer) | Compra e toma o remédio `{condition}`. Aceita `Idempotency-Key`. Devolve o remédio, `cured` e o avatar |
| GET | `/v1/catalog/pharmacy` | público | Preço do remédio, chance de cura e a tabela das doenças |
| GET | `/v1/avatars/:id/hospital` | jogador (Bearer) | Últimas 20 internações, com motivo, alta e situação da taxa (`pending`, `paid`, `waived`) |
| POST | `/v1/dev/avatar` | jogador (Bearer) | **Só desenvolvimento** (`DEV_FREE_AVATAR=true`): dá um avatar comum a quem não tem; desligado, 404 |
| POST | `/internal/v1/avatars` | serviços (`X-Service-Token`) | Cria `{account_id, rarity, job_code}`; na Etapa 2, chamado ao ver o mint da Lucky Box |
| GET | `/internal/v1/risk/devices` | revisão (`X-Service-Token`) | Aparelhos com mais contas que o limite (`?days=30`) |
| POST | `/internal/v1/risk/accounts/:accountId` | revisão (`X-Service-Token`) | `{decision: allow | block, note}`: libera ou bloqueia os ganhos da conta |
| POST | `/internal/v1/catalog/refresh` | Strapi (webhook, `X-Service-Token`) | Recarrega o catálogo publicado no Strapi; catálogo quebrado ou sem uma profissão em uso é recusado (`422 catalog_rejected`). Com `model: "food"`, recarrega só os alimentos; outros tipos do catálogo são ignorados |
| GET | `/v1/catalog/foods` | público | Os alimentos do mercado com energia, saúde, o preço de uma unidade e o do pacote (`pack`, `pack_price`), em centavos de THALER |
| GET | `/v1/catalog/professions` | público | As 44 profissões com ganho do dia, duração e tarefas; das tarefas, só a direção (+/−) de energia e felicidade (GDD §2.4) |
| GET | `/healthz` | — | `{status: "ok"}` |

Erros com código estável: `invalid_rarity`, `invalid_job`, `avatar_limit`, `invalid_shift`, `shift_running`, `daily_limit`, `too_tired`, `pool_empty`, `unknown_food`, `not_hungry`, `not_in_pantry`, `in_hospital`, `sick`, `not_sick`, `invalid_condition`, `insufficient_thaler`, `ledger_unavailable`, `not_found`, `forbidden`, `missing_credentials`, `invalid_token`, `token_expired`.

## Banco

Esquema próprio `game`: tabela `avatar` do doc 06, com os instantes de referência da queda, `work_shift`, com a semente e o resultado, `meal`, com o preço, os efeitos e a situação da refeição, e `hospital_stay`, com o motivo, a alta e a taxa. Migrações em `drizzle/`, controladas em `drizzle.__game_core_migrations`.

## Ainda não

- Deslocamento (carro, skate, ônibus, a pé, home office). Efeito real de energia e felicidade por tarefa, que depende do game designer acertar os números do catálogo. Cards de arte das 12 profissões do MVP.
- Bônus de itens, pet, moradia e eventos semanais no ganho.
- Descansar e atividades (sobem os atributos); as doenças do hospital (febre, enxaqueca, virose: −1 de saúde a cada 15 min).
- O tempo de compra do mercado e o limite da despensa pela casa.
- Fila do BullMQ: o job roda no próprio processo até haver Redis no ambiente.
- Calibrar as premissas de felicidade e higiene no simulador.
