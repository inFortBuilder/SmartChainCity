# 11 — Decisões Pendentes

Inconsistências ou lacunas encontradas nas fontes. Cada item tem uma **recomendação** para destravar o desenvolvimento.

## 1. Conflitos nas fontes

| # | Tema | Fonte A | Fonte B | Recomendação |
|---|------|---------|---------|--------------|
| 1 | Faixa de **Educação** | GDD §3.1: níveis 1–10 | GDD §3.10: 1–100 · §3.24: 1–3 · Tabela de Atributos: 0/50/100 · Strapi: máx. 10 | **0–100 cumulativo** (casa com a tabela de multiplicadores 1×/2×/3×); a escola dá "graus" 1–3 como marcos (33/66/100) |
| 2 | % de **Play-to-Earn** | Tokenomics: 41% | Planilha: 42% | **41%** (a soma do tokenomics fecha 100%) |
| 3 | Educação como multiplicador | Tabela: até 3× | Planilha: (Exp. + Pet) anulados pelos sinks | Manter os multiplicadores, mas com teto conjunto (proposto: Exp. × Pet ≤ 2,5×) validado no simulador |
| 4 | **Tomate** duplicado | Tabela: +1 energia/+2 saúde | Tabela: +1 energia/+3 saúde | Um deles é provavelmente outro alimento (ex.: alface) — confirmar |
| 5 | Limite de avatares | GDD §3.24: "pelo menos 3 avatares no mesmo IP" | — | **Máximo de 3 por conta verificada** |
| 6 | Avatar por usuário | Strapi: 1:1 | GDD: até 3 | Relação 1:N |
| 7 | Raridade de **lote** | Strapi: `land.id_rarity` com `landPrice` | GDD: preço por região/distância ao centro | Preço por região; raridade de lote só para lotes especiais (orla, esquina, mineração) |
| 8 | Fast food recarrega... | §3.11: "alimentação, felicidade e energia" | Níveis citam só energia/saúde | Níveis aplicam +energia/−saúde; +1 felicidade fixo |
| 9 | Fazenda em "A3" | §3.14: "81 células sempre no A3" | Sistema de coordenadas não define A3 | Adotar anéis (doc 03 §2): A3 = anel 2 |

## 2. Lacunas (dados ausentes)

| # | O que falta | Onde deveria estar | Como resolver |
|---|-------------|--------------------|---------------|
| 1 | Probabilidades de raridade por **tipo de Lucky Box** | "Figura 14 — Whitepaper" | Recuperar o whitepaper ou definir no simulador |
| 2 | Distribuição de profissões por raridade (oficial) | "Figura 15 — Whitepaper" | Usar a lista do cap. 4 (doc 02 §3) até confirmar |
| 3 | Capacidade de moradores e custos por tipo de imóvel | "Figura 16" | Recuperar a figura; enquanto isso, propor no simulador |
| 4 | Preços de lote por região | — | Definir com o simulador (curva por anel) |
| 5 | Valores de impostos (IPTU, PT, IPVA), seguros e energia | Texto só descreve mecânicas | Definir com o simulador |
| 6 | Arte das profissões **Raras e Lendárias** e de 13 épicas | Pastas vazias | Produção de arte na fase 1 |
| 7 | **Projeto-fonte Unity** | Só o build 0.0.23 está na pasta | Localizar repositório (arquivo `Smart-Repositorios.txt`) |
| 8 | Planilha online citada no tokenomics (Google Sheets) | Link no rodapé do estudo | Pedir acesso e arquivar uma cópia |

## 3. Decisões de produto / técnica

| # | Decisão | Opções | Recomendação |
|---|---------|--------|--------------|
| 1 | Cidade real a replicar | Nível 1 (estilizada) · 2 (OSM na grade) · 3 (fotorrealista) | Começar no **Nível 2** com uma cidade-referência e uma região |
| 2 | Regra de bairro no mercado secundário | (a) restrição no contrato · (b) só no jogo | **(b)** no MVP — mais simples e compatível com marketplaces externos |
| 3 | Rede blockchain | BNB Smart Chain · Polygon · Base | **BNB Smart Chain** (identidade da marca e comunidade P2E) |
| 4 | Multiplayer | Colyseus · Photon Fusion · Netcode + GameLift | **Colyseus** (WebSocket nativo, salas por célula, custo baixo) |
| 5 | Moeda da Lucky Box | SCITY · BNB · stablecoin | Stablecoin ou BNB no lançamento (preço estável); SCITY depois do TGE |
| 6 | Escala de tempo | 1 dia de jogo = 24 h reais · acelerado | **24 h reais** (os turnos e a fome do GDD são em horas reais) |
| 7 | Avatar 3D no jogo principal | Só 2D (atual) · 3D modular | 2D no MVP de gestão; 3D para o modo passeio na fase 2 |
| 8 | Strapi | Manter v4 · migrar v5 · substituir | **Migrar para v5** como backoffice apenas |
| 9 | Período grátis (scholarship) | Sim · Não | **Sim**, com ganhos não conversíveis |
