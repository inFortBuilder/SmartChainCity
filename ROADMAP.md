# Roadmap de Desenvolvimento — Smart Chain City

Plano de execução da plataforma (jogo WebGL + metaverso + imóveis virtuais), organizado em **etapas**, **épicos** e **entregas verificáveis**.
A especificação de cada item está em [`docs/`](docs/README.md); o roteiro por área técnica está em [`docs/desenvolvimento/`](docs/desenvolvimento/README.md).

- **Cadência:** sprints de 2 semanas. Prazos em sprints a partir do kick-off (S1 = semanas 1–2).
- **Rastreamento no GitHub:** cada etapa vira um *Milestone*; cada épico, uma *issue* com o rótulo `epic`; cada tarefa, uma *issue* ligada ao épico (ver [modelo de épico](.github/ISSUE_TEMPLATE/epic.yml)).
- **Trilhas (rótulo `track:*`):** `client` · `backend` · `contracts` · `cms` · `metaverse` · `econ` · `infra` · `art` · `legal`.

---

## Mapa das etapas

```
Etapa 0          Etapa 1            Etapa 2             Etapa 3              Etapa 4           Etapa 5
Fundação   ──►   Vertical Slice ──► Alpha fechado  ──►  Beta + Mainnet  ──►  Lançamento   ──►  Live Ops
S1–S4            S5–S8              S9–S14              S15–S22              S23–S26           S27+
(repos,          (1 célula,          (A1 completa,       (fazenda, carros,    (TGE, venda       (A2, indústrias,
 economia,        1 avatar,           loop completo,      marketplace,         de lotes,         mineração,
 segurança)       1 turno)            testnet)            auditoria)           Spatial)          marcas)
```

| Etapa | Sprints | Milestone GitHub | Critério de saída (resumo) |
|-------|---------|------------------|----------------------------|
| 0 — Fundação | S1–S4 | `M0-fundacao` | Monorepo pronto, credenciais legadas trocadas, economia aprovada no simulador |
| 1 — Vertical Slice | S5–S8 | `M1-vertical-slice` | Jogador loga, vê uma célula em 3D, trabalha um turno e coleta THALER pelo servidor |
| 2 — Alpha fechado | S9–S14 | `M2-alpha` | Região A1 jogável na testnet com 200–500 jogadores, 7 dias sem perder saldo |
| 3 — Beta + Mainnet | S15–S22 | `M3-beta` | Auditoria sem achados críticos, sistemas da fase 2 do MVP e marketplace |
| 4 — Lançamento | S23–S26 | `M4-lancamento` | TGE do SCITY, venda de lotes da A1, evento no Spatial |
| 5 — Live Ops | S27+ | `M5-liveops-*` | Expansões só quando a cobertura em dólar ficar ≥ 1 por 8 semanas |

> **Aprovada em 2026-11-12 — Cidade realista e construtores** ([doc 13](docs/13-cidade-realista-construtores.md), [ADR-0012](docs/adr/0012-cidade-real-construtores.md)): cidade em formato real, prédios de jogadores enviados pelo SCC Builder (Convert3D sem vínculo com o EventosWeb) e unidades vendáveis, com cliente web nativo ([ADR-0009](docs/adr/0009-cliente-web-nativo.md)). Entram os épicos E0.9 (spike do cliente web nativo), E0.10 (fork SCC Builder), E1.8 (lote poligonal), E2.10–E2.11 (validação e prédios na testnet) e E3.11–E3.12 (unidades, UnitMarket e moderação).

## Situação e sequência (2026-11-20)

O MVP roda inteiro na máquina local, sem serviços pagos. Por isso, publicar o ambiente `dev` e ligar o Sentry ficam fora do MVP.

**Na `main`:**
- **Etapa 1 concluída no ambiente local.**
  - Login por carteira (SIWE) e por e-mail, com vínculo entre os dois.
  - Avatar, atributos e turno de trabalho.
  - Ledger do THALER.
  - Catálogo no Strapi 5, com webhook para o game-core.
  - Observabilidade local.
  - Lotes no serviço world, com venda primária paga pelo ledger.
- **Primeira parte da E2.3:** comer, despensa, hospital compulsório, farmácia e doenças leves.
- **Fila de PRs zerada.** Os 13 PRs que esperavam merge entraram em 20/11, depois de testados juntos: 243 testes e o CI verde.

**O que falta:**

| Área | Situação |
|------|----------|
| `contracts/` | Desde 2026-11-20: `LandNFT`, `AvatarNFT`, `LuckyBox`, `SCityToken`, `BuildingNFT`, `PropertyNFT` e `GameVault` no anvil. O `Marketplace` também (2026-11-21): listagem com preço fixo, combo, taxa e royalties. O TGE também (2026-11-22): vesting, P2E por parcelas e LP travado ([E4.2](contracts/README.md#tge-vesting-e-lp-travado-e42)). Falta a auditoria (E3.8) |
| `services/world` | Faltam imóveis, impostos, regras de cerco e a cotação EIP-712 |
| `services/chain-indexer` | Começou em 2026-11-20; credita os depósitos do `GameVault` no ledger. O `services/realtime` também começou nesse dia |
| Etapa 0 sem código | E0.2 (trocar as credenciais legadas), E0.8 (parecer jurídico), o tomate duplicado e a calibração da elasticidade e do dinheiro novo no simulador |
| `client-unity/` | Plano B ([ADR-0009](docs/adr/0009-cliente-web-nativo.md)): E0.3 e E0.6 saíram do caminho crítico |

**Sequência:**
1. ✅ **Contratos de lote e avatar** (2026-11-20). `LandNFT`, `AvatarNFT`, `LuckyBox` e `SCityToken` estão em Foundry, com 42 testes e deploy no anvil ([contracts](contracts/README.md)). Faltam:
   - o world assinar a cotação, que entra no passo 2;
   - a assinatura do VRF da Chainlink na testnet.
2. **Concluir o `world`.**
   - ✅ Cotação EIP-712 aceita pelo `LandNFT` no anvil (E2.4, 2026-11-20). O lote pago no ledger vira NFT na carteira do jogador.
   - 🟡 Imóveis com obra, desgaste e renda (E2.5, 2026-11-20). A Casa T1 está pronta, com reparo e upgrade de nível e valores provisórios. O `PropertyNFT` também: o imóvel pronto vira NFT na carteira do dono do lote, o nível sobe com voucher do world e o chain-indexer espelha tudo, testado no anvil. A venda do lote ou do imóvel na blockchain muda o dono no jogo, e o imóvel só rende para quem também é dono do lote, pelo tempo em que os dois donos coincidiram (2026-11-21). Faltam aluguel e os outros tipos.
   - 🟡 Impostos (E2.6, 2026-11-20). IPTU e PT com débito automático, multa, bloqueio e leilão do lote inadimplente (o lote vai com o imóvel), com valores provisórios. Desde 2026-11-21, o leilão também toma o NFT do lote e do imóvel na blockchain pela apreensão assinada pelo world, testada no anvil ([ADR-0016](docs/adr/0016-apreensao-nft-leilao.md)).
3. **Blockchain e prédios no servidor.**
   - 🟡 `chain-indexer` (2026-11-20): lê os eventos com confirmações e trata reorganização. Espelha lotes, avatares, imóveis e caixas, e foi testado no anvil. O avatar revelado pela Lucky Box entra no game-core, e a venda dele na blockchain muda a conta dona (2026-11-21). O `GameVault` (E3.7, adiantado) já funciona nos dois sentidos: o depósito vira SCITY na conta uma única vez, e o saque sai por voucher do economy, com teto de 24 h, carência e devolução do voucher vencido. O câmbio THALER ↔ SCITY também está no economy (spread queimado, teto, freio do pool e período grátis, com valores do simulador). O TWAP 24 h da DEX também (2026-11-21): o job `fx.twap` lê o pool da PancakeSwap V3, guarda amostras próprias quando o pool não cobre 24 h e tem um disjuntor de salto. Falta o pool SCITY/USDT, que nasce no TGE. O saque já pede KYC acima do limite (revisão manual até haver provedor).
   - 🟡 Validação dos prédios no servidor (E2.10, 2026-11-20). O world manda o polígono e as regras do próprio banco para o SCC Builder, cobra a outorga e guarda o prédio para o alvará; testado com o Builder real. O `BuildingNFT` (E2.11) também está pronto: o prédio aprovado vira NFT na carteira do construtor, testado no anvil.
4. **Fechar a Etapa 2.**
   - 🟡 Multiplayer no `realtime` (E2.7, 2026-11-20). Salas por bairro, presença, chat moderado e eventos, com 100 clientes numa sala, p95 de 72 ms e nenhuma queda. O mapa de Pittsburg mostra os outros jogadores do bairro e o chat. O [street view](docs/desenvolvimento/street-view.md) também está no mapa (2026-11-21): o jogador arrasta o boneco até uma rua e caminha só pelas ruas, com as animações da Universal Animation Library (Quaternius, CC0). Desde 2026-11-21, o jogador também entra nos imóveis pelo clique: a residência (Casa T1) e o escritório (prédio aprovado), seus ou de quem o convidou. Quem está na rua também vê o avatar dos outros jogadores do bairro, com a animação pela velocidade.
   - 🟡 Profissões com minigame (E2.2, 2026-11-20). O turno percorre as tarefas da profissão e o mapa mostra a tarefa atual e o motivo do dano; as 12 do MVP estão marcadas no catálogo. Faltam o efeito real de energia por tarefa, que depende do game designer, e os cards de arte.
   - 🟡 Antifraude (E2.9, 2026-11-20). Até 3 contas ganhando P2E por aparelho, alerta por rede, limite de velocidade, revisão manual e métricas; os números são premissas. O captcha no cadastro está no gateway (prova de trabalho, sem terceiros, 2026-11-21). O KYC progressivo no saque também (sem verificação, até 300 SCITY em 30 dias; revisão manual até haver provedor, 2026-11-21).
   - 🟡 Painel econômico (E2.8, 2026-11-20). Emissão × dreno por tipo em 24 h e 7 dias, razão contra a meta de 55%, THALER por jogador, duração do pool P2E, alertas e painel "Economia" no Grafana. Os limites dos alertas são de partida.
   - 🟡 Doenças do hospital (E2.3, 2026-11-20). Febre, enxaqueca e virose tiram 1 de saúde a cada 15 min; a farmácia não cura e o hospital trata em 4 h pela taxa de 30 THALER. Faltam os preços e as chances definitivos, que são premissas, e calibrar no simulador.
5. **Em paralelo, desde já:** reservar o auditor, obter o parecer jurídico (E0.8) e calibrar a economia. São o caminho crítico até o TGE e não dependem de código.

**Regra para não acumular PRs:**
- No máximo 3 PRs empilhados por cadeia.
- O merge acontece em até 2 dias depois de o CI ficar verde.
- Antes de abrir uma nova cadeia, a anterior precisa ter entrado na `main`.

---

## Etapa 0 — Fundação (S1–S4)

**Objetivo:** tirar o projeto do estado legado e provar que a economia fecha antes de escrever o jogo.

| Épico | Trilha | Entregas | Pronto quando |
|-------|--------|----------|---------------|
| E0.1 Repositório e padrões | infra | Monorepo com as pastas deste repo, CI de lint/teste, proteção da `main`, templates de issue/PR | PR de exemplo passa no CI e é aprovado por revisão |
| E0.2 Segurança do legado | infra · legal | Trocar todas as credenciais de `C:\SmartChainCity\chaves` e afins; cofre de segredos; remoção das cópias locais | Checklist do [doc 10 §1](docs/10-seguranca-compliance.md) concluído |
| E0.3 Recuperar ativos | client · art | Projeto-fonte Unity do build 0.0.23 localizado e importado; arte catalogada em `art/` (via LFS) | Projeto abre no Unity 6 sem erros bloqueantes |
| E0.4 Decisões pendentes | econ · produto | Os 9 conflitos e 8 lacunas do [doc 11](docs/11-decisoes-pendentes.md) resolvidos e registrados em ADRs | Todos os itens com ADR `Aceito` |
| E0.5 Simulador econômico | econ | `tools/econ-sim`: agentes por raridade, faucets/sinks, 365 dias, 3 cenários de preço | Payback entre 40 e 78 dias, cobertura em dólar ≥ 1 e pool P2E sem esgotar nos cenários ([ADR-0010](docs/adr/0010-criterio-economia-cobertura.md)) |
| E0.6 Protótipo técnico WebGL | client | 1 região com streaming de células via Addressables | Download inicial ≤ 25 MB e 60 FPS em notebook médio |
| E0.7 Pipeline de cidade real (PoC) | tools | `tools/osm-to-grid` gera JSON de células a partir de um recorte do OSM | 1 região gerada e carregada no protótipo |
| E0.8 Parecer jurídico | legal | Parecer sobre token, Lucky Box, contratos de investidores e LGPD | Documento recebido e riscos classificados |

**Dependências:** E0.3 → E0.6 → E0.7 · E0.4 → E0.5.

> **Situação em 2026-11-20:**
> - ✅ **Prontos:**
>   - E0.1;
>   - E0.4, exceto o tomate duplicado;
>   - E0.5, aprovado em 9 de 9 cenários, mas com premissas ainda sem dados;
>   - E0.9, o spike do cliente web;
>   - E0.10, o SCC Builder. O Convert3D é código próprio da equipe, feito para o EventosWeb já pensando na Smart Chain City, e a titularidade foi confirmada em 2026-11-20.
> - ↪ **Substituídos:**
>   - E0.3 e E0.6, pelo cliente web nativo ([ADR-0009](docs/adr/0009-cliente-web-nativo.md));
>   - E0.7, pela importação da cidade inteira no [SCC Builder](tools/scc-builder/README.md#cidade-inteira-em-obj).
> - ⏳ **Abertos:** E0.2 e E0.8.

---

## Etapa 1 — Vertical Slice (S5–S8)

**Objetivo:** um fio completo cliente → servidor → banco, com qualidade de produção.

| Épico | Trilha | Entregas | Pronto quando |
|-------|--------|----------|---------------|
| E1.1 Contas e login | backend · client | Login por e-mail + SIWE; JWT; `GET /v1/me` | Login funcionando na cena `Login` do WebGL |
| E1.2 Catálogo no Strapi 5 | cms | `cms-strapi` migrado; tipos `rarity`, `job`, `job_task`, `food`, `activity`, `property_type`, `property_level`; webhook de publicação | Game Core lê o catálogo publicado pelo cache |
| E1.3 Avatar e atributos | backend · client | Entidade `avatar`, decaimento de atributos, HUD | Atributos mudam no servidor e aparecem no HUD |
| E1.4 Turno de trabalho | backend | `POST /work` e `POST /claim`, job agendado, sorteio com seed (commit-reveal) | Turno de 6 h executa sem o cliente aberto |
| E1.5 Ledger THALER | backend | Contabilidade em dupla entrada, extrato, idempotência | Teste de propriedade: soma das entradas = 0 em 10 mil transações aleatórias |
| E1.6 Célula jogável | client · art | 1 célula com lotes, 1 casa T1, câmera isométrica | Célula carrega por Addressables com dados de `/world/cells` |
| E1.7 Observabilidade | infra | Logs estruturados, métricas, Sentry, ambiente `dev` | Painel mostra requisições e erros por serviço |

> **Situação em 2026-11-12:** o critério de saída foi demonstrado localmente. No mapa de Pittsburg (cliente web, [ADR-0009](docs/adr/0009-cliente-web-nativo.md)), o jogador entra com a carteira, trabalha um turno e coleta THALER no ledger, tudo pelo servidor. Prontos: E1.1 (login SIWE e, desde 2026-11-13, por código no e-mail, que no MVP local sai no log do gateway; a conta pode ligar carteira e e-mail e entrar por qualquer um), E1.3, E1.4, E1.5 e E1.6, com os lotes no serviço world e a compra paga em SCITY pelo ledger (a geometria segue em arquivos estáticos por bairro). E1.2 pronto no catálogo: Strapi 5 com profissões, atividades, alimentos, raridades, multiplicadores e tipos de imóvel publicados; o game-core lê as profissões e os alimentos sem deploy. Os números que o GDD não tem (efeito exato das atividades, preço dos alimentos, renda dos imóveis) esperam o game designer.
>
> **E1.7 em 2026-11-13:** logs JSON com o serviço e o id da requisição, métricas em `/metrics` e painel local (Prometheus + Grafana) com requisições, erros e latência por serviço ([infra/observability](infra/observability/README.md)).
>
> **Etapa 1 concluída em 2026-11-20, no ambiente local:** tudo acima está na `main`. O Sentry e o ambiente `dev` publicado ficam fora do MVP, que roda sem serviços pagos.

---

## Etapa 2 — Alpha fechado (S9–S14) · testnet

**Objetivo:** loop principal completo na região A1.

| Épico | Trilha | Entregas |
|-------|--------|----------|
| E2.1 Lucky Box (testnet) | contracts · client | `AvatarNFT` + `LuckyBox` com Chainlink VRF; tela de abertura; probabilidades públicas |
| E2.2 Profissões do MVP | backend · cms · art | 12 profissões com minigame (11 comuns + Cozinheiro); cards de arte |
| E2.3 Alimentação e saúde | backend · client | Mercado do jogo (🟡 comer e despensa pagos pelo ledger, preço provisório), hospital (🟡 compulsório com taxa), farmácia e doenças (🟡 dor de barriga, gripe e dor de cabeça na farmácia; febre, enxaqueca e virose tiram saúde e só o hospital trata) |
| E2.4 Região A1 | backend · client · tools | Grade completa, compra primária com cotação assinada, regularização, água/energia |
| E2.5 Imóveis | backend · contracts · client | `LandNFT`, `PropertyNFT`; T1–T3 e Residencial 3; obra, desgaste, renda; aluguel e hotel |
| E2.6 Impostos | backend | IPTU, PT de lote vazio, inadimplência |
| E2.7 Presença multiplayer | backend · client | Colyseus com salas por célula, chat moderado |
| E2.8 Painel econômico | econ · infra | Faucets × sinks em tempo real, alertas |
| E2.9 Antifraude v1 | backend | Limite de 3 avatares, fingerprint, rate limit |

**Pronto quando:** 200–500 jogadores convidados por 2 semanas; 7 dias sem perda de saldo; retenção D7 ≥ 20%; FPS e download dentro do [orçamento](docs/08-metaverso-webgl.md#2-orçamento-de-desempenho-webgl).

---

## Etapa 3 — Beta público + preparação da Mainnet (S15–S22)

| Épico | Trilha | Entregas |
|-------|--------|----------|
| E3.1 Pets e Pet Shop | backend · client · art | Gatos e cães, atributos, morte por abandono, serviços. 🟡 Desde 2026-11-21: no game-core e no mapa. Adoção, alimentação, água e felicidade de 0 a 5, morte por fome, passeio, ração, banho, tosa e hotel pagos pelo ledger, e o nível do pet no turno (até 1,25×, teto conjunto de 2,5×). O Pet Sitter como serviço de jogador também (2026-11-22): diária com 90% para o sitter, até 3 pets por vez e +20% no turno de quem cuida. Falta a arte |
| E3.2 Educação e troca de profissão | backend | Escola de 4 dias, níveis de educação. ✅ Desde 2026-11-21, no game-core e no mapa: aula do dia (+educação, graus nos marcos 33/66/100) e troca de profissão na mesma raridade, com 4 dias de escola sem trabalhar e +felicidade nos 2 primeiros, pagas pelo ledger (premissas de preço e ganho a calibrar no simulador) |
| E3.3 Lazer e negócios de jogador | backend · client | Academia, galeria, parque, campeonato de futebol de botão. ✅ Desde 2026-11-21: parque (skate, basquete) e academia e galeria como negócios de jogador. O dono constrói pela ficha do lote, e a entrada vai 90% para ele. O campeonato mensal de futebol de botão também: times de 6, inscrição no escrow, sorteio auditável e 75% para os 3 primeiros (50/35/15), com 25% queimados |
| E3.4 Fazenda (A3) | backend · client · art | Plantio, estações, pecuária, maquinário, riscos. ✅ Desde 2026-11-21, no game-core e no mapa: slot da Prefeitura com 4 canteiros, estações de 7 dias, aragem com enxada, plantio por nível, riscos e proteções do GDD, colheita para a despensa e níveis 1–3. A pecuária também: galinheiro, chiqueiro e pasto, alimentação com o grão da despensa, ovos e leite, abate, reprodução, chocadeira e os riscos diários do GDD. Falta o lugar no mapa quando a região A3 abrir |
| E3.5 Veículos e corridas | backend · contracts · client | Carros, autoescola, IPVA, oficina, corridas diárias. ✅ Desde 2026-11-21, no game-core e no mapa: autoescola (3 h parado), agência (compra, aluguel de 3 dias a 5% e recompra pela depreciação), vida útil de 6 meses e IPVA semestral, que suspende o carro quando atrasa. As corridas diárias também (até 3 por piloto, prêmio do pool P2E, semente no resultado), com pane, oficina do jogo (1/3/7 dias) e revisão. Ficam para depois a oficina como negócio de jogador, o seguro e o motorista particular; o VehicleNFT fica para a fase 2 (doc 07) |
| E3.6 Marketplace | contracts · backend · client | Listagem, leilão, combo lote + imóvel, royalties. 🟡 Desde 2026-11-21: contrato com listagem, combo, taxa e royalties, e listagens no chain-indexer. A tela no mapa também: painel Mercado, compra, venda pela ficha do lote (com o imóvel em combo) e cancelamento. O leilão com prazo também, no contrato, no indexer e no mapa. No site também (2026-11-22): `/marketplace` mostra os anúncios on-chain do indexer, compra, vende (preço fixo ou leilão), dá lance e encerra leilão pela carteira |
| E3.7 GameVault | contracts · backend | Depósito e saque por voucher EIP-712, limites, circuit breaker. ✅ No anvil desde 2026-11-21: depósito com permit, saque por voucher com teto de 24 h, KYC e carência, teto diário do contrato conferido antes de assinar, desistência do voucher e a tela no mapa (depositar, resgatar e desistir pela carteira). Fora do MVP: proxy UUPS atrás de timelock e signer no KMS, antes da mainnet |
| E3.8 Auditoria externa | contracts · legal | Auditoria dos contratos e correção dos achados. 🟡 Preparação desde 2026-11-22: `GameVault` e `Marketplace` com proxy UUPS atrás do `TimelockController` (doc 07 §5). Os testes de invariantes, o Slither e a cobertura no CI (100% das linhas nos contratos principais) e o [pacote do auditor](docs/auditoria/README.md) também. O script de deploy da BSC também (`DeployMainnet.s.sol`, papéis finais conferidos na cadeia). Falta a auditoria em si, que é de terceiros |
| E3.9 Teste de carga | infra | 10 mil simultâneos no Realtime; 1 mil req/s na API. 🟡 Desde 2026-11-22, local ([teste de carga](docs/desenvolvimento/teste-de-carga.md)). A API passou a 1 mil e 1,5 mil req/s (p95 de 15 a 20 ms, 0 erro). O Realtime recebeu as 10 mil conexões em 3 processos divididos por bairro (0 queda), e o movimento chegou em p95 de 130 ms com 5 mil. A divisão por bairro também (2026-11-22): o cliente escolhe o processo e cada um sobe com SHARD=i/n. Falta a rodada com o gerador em outra máquina |
| E3.10 Eventos semanais + GamePass | backend · cms | Eventos por profissão; temporada 1. 🟡 Desde 2026-11-21, no game-core e no mapa: evento semanal por grupo de profissões (×1,2 no turno, com o calendário) e GamePass da temporada 1 (níveis 1–5 em SCITY, menos dano no turno e distintivos). Desde 2026-11-22, eventos e temporadas no Strapi (tipos `event-group` e `season`, com seed e webhook) e itens sazonais com efeito: ganho a mais no turno ou menos dano, só durante a temporada, com tetos ([game-core](services/game-core/README.md#eventos-semanais-e-gamepass-e310)). Faltam os eventos de data marcada (Natal, Carnaval) e a loja de itens |

**Pronto quando:** auditoria sem achados críticos ou altos em aberto; teste de carga aprovado; termos de uso e privacidade publicados.

---

## Etapa 4 — Lançamento (S23–S26) · mainnet

| Épico | Trilha | Entregas |
|-------|--------|----------|
| E4.1 Deploy na mainnet | contracts · infra | Contratos verificados, multisig, timelock, signer no KMS. 🟡 O script está pronto (2026-11-22, [contracts](contracts/README.md#deploy-na-bsc-mainnet-e-testnet)). Faltam os Safes, a chave no KMS, a assinatura do VRF e a auditoria |
| E4.2 TGE do SCITY | contracts · econ | Vesting configurado, LP travado ≥ 12 meses, endereços publicados. 🟡 Contratos e script prontos (2026-11-22, [contracts](contracts/README.md#tge-vesting-e-lp-travado-e42)). O `TgeDistributor` faz o TGE numa transação: `VestingWallet` por alocação do doc 04, P2E no `RewardsPool` e `TokenLock` do LP com mínimo de 365 dias. Faltam os Safes de cada alocação, a auditoria, o par na DEX e publicar os endereços (E4.5) |
| E4.3 Venda de lotes da A1 | backend · client | Venda primária com fila e limites por carteira. ✅ Desde 2026-11-22, no world e no mapa ([world](services/world/README.md#venda-de-lançamento-fila-e-limite-por-carteira-e43)). A operação agenda o lançamento. A fila abre antes, com posição sorteada para quem chega cedo, e as entradas vão em lotes por minuto. Na vez, há 10 min para comprar, até N lotes por carteira (carteira ligada obrigatória). Depois do lançamento, a venda fica livre |
| E4.4 Espaços Spatial | metaverse | Stand de Vendas, Prefeitura Virtual e Showroom ([doc 08 §5](docs/08-metaverso-webgl.md#5-espaços-spatial-a-partir-de-spatial-virtualcamp)) |
| E4.5 Landing e comunidade | site · art | Site em PHP/JS já criado em [`website/`](website/README.md) (ver [trilha-site](docs/desenvolvimento/trilha-site.md)); publicar com dados reais, Discord, documentação pública e FAQ. 🟡 Desde 2026-11-22: números reais na home (`GET /v1/public/stats` no gateway, juntando game-core e world), [FAQ](website/public/faq.php), página de contratos oficiais lida dos arquivos de deploy (endereços publicados do E4.2) e aviso de incidente no topo do site ([website](website/README.md)). Faltam os links reais (Discord e redes), o trailer, termos e privacidade (dependem do parecer, E0.8), o domínio e a publicação |
| E4.6 Plano de incidentes | infra · legal | Runbooks, contatos, comunicação pronta. 🟡 Desde 2026-11-22: [plano](docs/incidentes/README.md) com severidade, papéis, primeiros 15 minutos, ressarcimento pelo ledger e treino. Runbooks de 8 casos, modelos de aviso e pós-incidente. Travas do economy (saque e câmbio sem deploy, com aviso no mapa e alerta) e lotes do Safe para pausar tudo e trocar o signer pelo timelock, ensaiados num anvil com chain id 97. Faltam os contatos reais no cofre da equipe, os Safes da mainnet e o primeiro treino na testnet |

---

## Etapa 5 — Live Ops (S27+)

Liberada em ondas; cada onda só abre quando o painel econômico estiver saudável.

| Onda | Conteúdo |
|------|----------|
| 5.1 | Abertura do anel A2; franquias e lojas para jogadores; food trucks |
| 5.2 | Mineração, postos, cadeia de combustível, caminhões e trens |
| 5.3 | Energia por fonte (solar, eólica, hidráulica, atômica); usinas de jogadores |
| 5.4 | Staking; transporte aéreo; concessão do transporte público |
| 5.5 | Marcas reais, Arena de Eventos no Spatial, avatar 3D completo |
| 5.6 | Mobile otimizado, inglês e espanhol, governança da Prefeitura |

---

## Caminho crítico

```
Cliente web (E0.9 ✅) ─► Célula jogável (E1.6 ✅) ─► LandNFT + cotação (E2.4) ─► Imóveis (E2.5) ─► Prédios de construtores (E2.10–E2.11)
Simulador (E0.5 ✅) ─► Ledger (E1.5 ✅) ─► Contratos (E2.1, E2.5) ─► GameVault (E3.7) ─► Auditoria (E3.8) ─► TGE (E4.2)
Parecer jurídico (E0.8) ──────────────────────────────────────────────────────────────────────────────────► TGE (E4.2)
```

Desde 2026-11-22, os contratos, o TGE, os serviços, o mapa e o site estão prontos no repositório. O que falta depende de pessoas de fora (auditoria, parecer jurídico, Safes, KMS, VRF, domínio e arte), na ordem do [checklist de lançamento](docs/lancamento.md). Antes, em 2026-11-20, os gargalos eram os **contratos** (pasta vazia), a **auditoria** (E3.8) e o **parecer jurídico** (E0.8). O projeto Unity (E0.3) saiu do caminho crítico pela [ADR-0009](docs/adr/0009-cliente-web-nativo.md).

## Riscos do roadmap

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| ~~Projeto-fonte Unity não recuperado~~ | Resolvido pela [ADR-0009](docs/adr/0009-cliente-web-nativo.md): o cliente web nativo é o principal | Unity fica como plano B |
| PRs acumulados sem merge | Revisão difícil, conflitos entre trilhas (em 2026-11-20 eram 13 abertos em 3 cadeias) | Máximo de 3 PRs empilhados por cadeia; merge em até 2 dias com o CI verde |
| Contratos atrasados | Etapa 2 e auditoria deslizam | Começar `LandNFT`/`AvatarNFT` já, na rede local (Anvil) |
| Economia não fecha no simulador | Redesenho do GDD | Rodar o simulador antes de qualquer contrato |
| Parecer jurídico desfavorável a token/boxes | Mudança de modelo | Manter o jogo funcional só com THALER; boxes vendidas em moeda fiduciária ou desativadas por região |
| Desempenho do WebGL no celular | Perda de público | Perfil "Low", testes em aparelhos reais desde a Etapa 1 |
| Auditoria atrasa | Lançamento desliza | Reservar o auditor na Etapa 2 |
