# 11 — Decisões Pendentes

Inconsistências ou lacunas encontradas nas fontes. Cada item tem uma **recomendação** para destravar o desenvolvimento.

> **Situação em 2026-11-12:** conflitos e decisões resolvidos por ADR (✅), exceto o tomate duplicado (⏳). As lacunas do §2 dependem de dados que faltam (figuras do whitepaper, projeto Unity, planilha) e continuam abertas; a 4 (preço por região) já foi calibrada no [simulador](../tools/econ-sim/README.md).

## 1. Conflitos nas fontes

| # | Tema | Fonte A | Fonte B | Recomendação |
|---|------|---------|---------|--------------|
| 1 | Faixa de **Educação** | GDD §3.1: níveis 1–10 | GDD §3.10: 1–100 · §3.24: 1–3 · Tabela de Atributos: 0/50/100 · Strapi: máx. 10 | ✅ [ADR-0013](adr/0013-regras-conflitos-fontes.md): **0–100 cumulativo** (casa com a tabela de multiplicadores 1×/2×/3×); a escola dá "graus" 1–3 como marcos (33/66/100) |
| 2 | % de **Play-to-Earn** | Tokenomics: 41% | Planilha: 42% | ✅ [ADR-0013](adr/0013-regras-conflitos-fontes.md): **41%** (a soma do tokenomics fecha 100%) |
| 3 | Educação como multiplicador | Tabela: até 3× | Planilha: (Exp. + Pet) anulados pelos sinks | ✅ [ADR-0013](adr/0013-regras-conflitos-fontes.md): manter os multiplicadores, mas com teto conjunto (proposto: Exp. × Pet ≤ 2,5×) validado no simulador |
| 4 | **Tomate** duplicado | Tabela: +1 energia/+2 saúde | Tabela: +1 energia/+3 saúde | ⏳ Pendente: um deles é provavelmente outro alimento (ex.: alface) — confirmar |
| 5 | Limite de avatares | GDD §3.24: "pelo menos 3 avatares no mesmo IP" | — | ✅ [ADR-0013](adr/0013-regras-conflitos-fontes.md): **máximo de 3 por conta verificada** |
| 6 | Avatar por usuário | Strapi: 1:1 | GDD: até 3 | ✅ [ADR-0013](adr/0013-regras-conflitos-fontes.md): relação 1:N |
| 7 | Raridade de **lote** | Strapi: `land.id_rarity` com `landPrice` | GDD: preço por região/distância ao centro | ✅ [ADR-0013](adr/0013-regras-conflitos-fontes.md): preço por região; raridade de lote só para lotes especiais (orla, esquina, mineração) |
| 8 | Fast food recarrega... | §3.11: "alimentação, felicidade e energia" | Níveis citam só energia/saúde | ✅ [ADR-0013](adr/0013-regras-conflitos-fontes.md): níveis aplicam +energia/−saúde; +1 felicidade fixo |
| 9 | Fazenda em "A3" | §3.14: "81 células sempre no A3" | Sistema de coordenadas não define A3 | ✅ [ADR-0013](adr/0013-regras-conflitos-fontes.md): anéis (doc 03 §2), A3 = anel 2 |

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
| 1 | Cidade real a replicar | Nível 1 (estilizada) · 2 (OSM na grade) · 3 (fotorrealista) | ✅ [ADR-0012](adr/0012-cidade-real-construtores.md): cidade real com lotes poligonais (substitui o Nível 2 da ADR-0007) |
| 2 | Regra de bairro no mercado secundário | (a) restrição no contrato · (b) só no jogo | ✅ [ADR-0014](adr/0014-decisoes-produto-mvp.md): **(b)**, só no jogo |
| 3 | Rede blockchain | BNB Smart Chain · Polygon · Base | ✅ [ADR-0003](adr/0003-blockchain-bsc.md): **BNB Smart Chain** |
| 4 | Multiplayer | Colyseus · Photon Fusion · Netcode + GameLift | ✅ [ADR-0005](adr/0005-multiplayer-colyseus.md): **Colyseus** |
| 5 | Moeda da Lucky Box | SCITY · BNB · stablecoin | ✅ [ADR-0014](adr/0014-decisoes-produto-mvp.md): stablecoin ou BNB no lançamento; SCITY depois do TGE (depende do parecer jurídico) |
| 6 | Escala de tempo | 1 dia de jogo = 24 h reais · acelerado | ✅ [ADR-0008](adr/0008-tempo-real.md): **24 h reais** |
| 7 | Avatar 3D no jogo principal | Só 2D (atual) · 3D modular | ✅ [ADR-0014](adr/0014-decisoes-produto-mvp.md): 2D no MVP de gestão; 3D no modo passeio depois |
| 8 | Strapi | Manter v4 · migrar v5 · substituir | ✅ [ADR-0006](adr/0006-strapi-backoffice.md): **Strapi 5** só como backoffice |
| 9 | Período grátis (scholarship) | Sim · Não | ✅ [ADR-0014](adr/0014-decisoes-produto-mvp.md): **sim**, com ganhos não conversíveis |
