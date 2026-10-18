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
| 5 — Live Ops | S27+ | `M5-liveops-*` | Expansões só quando a razão sinks/faucets ficar ≥ 0,9 por 8 semanas |

---

## Etapa 0 — Fundação (S1–S4)

**Objetivo:** tirar o projeto do estado legado e provar que a economia fecha antes de escrever o jogo.

| Épico | Trilha | Entregas | Pronto quando |
|-------|--------|----------|---------------|
| E0.1 Repositório e padrões | infra | Monorepo com as pastas deste repo, CI de lint/teste, proteção da `main`, templates de issue/PR | PR de exemplo passa no CI e é aprovado por revisão |
| E0.2 Segurança do legado | infra · legal | Trocar todas as credenciais de `C:\SmartChainCity\chaves` e afins; cofre de segredos; remoção das cópias locais | Checklist do [doc 10 §1](docs/10-seguranca-compliance.md) concluído |
| E0.3 Recuperar ativos | client · art | Projeto-fonte Unity do build 0.0.23 localizado e importado; arte catalogada em `art/` (via LFS) | Projeto abre no Unity 6 sem erros bloqueantes |
| E0.4 Decisões pendentes | econ · produto | Os 9 conflitos e 8 lacunas do [doc 11](docs/11-decisoes-pendentes.md) resolvidos e registrados em ADRs | Todos os itens com ADR `Aceito` |
| E0.5 Simulador econômico | econ | `tools/econ-sim`: agentes por raridade, faucets/sinks, 365 dias, 3 cenários de preço | Payback entre 40 e 78 dias e sinks/faucets ≥ 0,9 nos 3 cenários |
| E0.6 Protótipo técnico WebGL | client | 1 região com streaming de células via Addressables | Download inicial ≤ 25 MB e 60 FPS em notebook médio |
| E0.7 Pipeline de cidade real (PoC) | tools | `tools/osm-to-grid` gera JSON de células a partir de um recorte do OSM | 1 região gerada e carregada no protótipo |
| E0.8 Parecer jurídico | legal | Parecer sobre token, Lucky Box, contratos de investidores e LGPD | Documento recebido e riscos classificados |

**Dependências:** E0.3 → E0.6 → E0.7 · E0.4 → E0.5.

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

---

## Etapa 2 — Alpha fechado (S9–S14) · testnet

**Objetivo:** loop principal completo na região A1.

| Épico | Trilha | Entregas |
|-------|--------|----------|
| E2.1 Lucky Box (testnet) | contracts · client | `AvatarNFT` + `LuckyBox` com Chainlink VRF; tela de abertura; probabilidades públicas |
| E2.2 Profissões do MVP | backend · cms · art | 12 profissões com minigame (11 comuns + Cozinheiro); cards de arte |
| E2.3 Alimentação e saúde | backend · client | Mercado do jogo, hospital, farmácia, doenças |
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
| E3.1 Pets e Pet Shop | backend · client · art | Gatos e cães, atributos, morte por abandono, serviços |
| E3.2 Educação e troca de profissão | backend | Escola de 4 dias, níveis de educação |
| E3.3 Lazer e negócios de jogador | backend · client | Academia, galeria, parque, campeonato de futebol de botão |
| E3.4 Fazenda (A3) | backend · client · art | Plantio, estações, pecuária, maquinário, riscos |
| E3.5 Veículos e corridas | backend · contracts · client | Carros, autoescola, IPVA, oficina, corridas diárias |
| E3.6 Marketplace | contracts · backend · client | Listagem, leilão, combo lote + imóvel, royalties |
| E3.7 GameVault | contracts · backend | Depósito e saque por voucher EIP-712, limites, circuit breaker |
| E3.8 Auditoria externa | contracts · legal | Auditoria dos contratos e correção dos achados |
| E3.9 Teste de carga | infra | 10 mil simultâneos no Realtime; 1 mil req/s na API |
| E3.10 Eventos semanais + GamePass | backend · cms | Eventos por profissão; temporada 1 |

**Pronto quando:** auditoria sem achados críticos ou altos em aberto; teste de carga aprovado; termos de uso e privacidade publicados.

---

## Etapa 4 — Lançamento (S23–S26) · mainnet

| Épico | Trilha | Entregas |
|-------|--------|----------|
| E4.1 Deploy na mainnet | contracts · infra | Contratos verificados, multisig, timelock, signer no KMS |
| E4.2 TGE do SCITY | contracts · econ | Vesting configurado, LP travado ≥ 12 meses, endereços publicados |
| E4.3 Venda de lotes da A1 | backend · client | Venda primária com fila e limites por carteira |
| E4.4 Espaços Spatial | metaverse | Stand de Vendas, Prefeitura Virtual e Showroom ([doc 08 §5](docs/08-metaverso-webgl.md#5-espaços-spatial-a-partir-de-spatial-virtualcamp)) |
| E4.5 Landing e comunidade | client · art | Site estático, Discord, documentação pública e FAQ |
| E4.6 Plano de incidentes | infra · legal | Runbooks, contatos, comunicação pronta |

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
Recuperar Unity (E0.3) ─► Protótipo WebGL (E0.6) ─► Célula jogável (E1.6) ─► Região A1 (E2.4) ─► Imóveis (E2.5)
Decisões (E0.4) ─► Simulador (E0.5) ─► Ledger (E1.5) ─► GameVault (E3.7) ─► Auditoria (E3.8) ─► TGE (E4.2)
Parecer jurídico (E0.8) ───────────────────────────────────────────────────────────────────────► TGE (E4.2)
```

Atraso em **E0.3** (projeto-fonte Unity) ou **E3.8** (auditoria) desloca o lançamento inteiro; os dois devem começar o quanto antes.

## Riscos do roadmap

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Projeto-fonte Unity não recuperado | Refazer o cliente (+6 a 8 sprints) | Começar E0.3 no dia 1; plano B: refazer a partir do build e da arte |
| Economia não fecha no simulador | Redesenho do GDD | Rodar o simulador antes de qualquer contrato |
| Parecer jurídico desfavorável a token/boxes | Mudança de modelo | Manter o jogo funcional só com THALER; boxes vendidas em moeda fiduciária ou desativadas por região |
| Desempenho do WebGL no celular | Perda de público | Perfil "Low", testes em aparelhos reais desde a Etapa 1 |
| Auditoria atrasa | Lançamento desliza | Reservar o auditor na Etapa 2 |
