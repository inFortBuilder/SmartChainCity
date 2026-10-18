# Smart Chain City — Documentação da Plataforma

> Plataforma de jogo WebGL e metaverso que replica uma cidade, com lotes e imóveis virtuais tokenizados, avatares-NFT ("smartcityanos") e uma economia Play-to-Earn.

Esta pasta consolida o material legado do projeto (estudos da **FGV Jr.**, backend **Strapi**, build **Unity WebGL v0.0.23**, template **Spatial SDK**) em uma especificação única para construir a plataforma.

## Índice

| # | Documento | Conteúdo |
|---|-----------|----------|
| 01 | [Visão do Produto](01-visao-produto.md) | Proposta, público, pilares, inventário do que já existe |
| 02 | [Game Design (GDD)](02-game-design.md) | Smartcityanos, atributos, profissões, ciclos de trabalho, negócios da cidade |
| 03 | [Cidade, Lotes e Imóveis Virtuais](03-cidade-lotes-imoveis.md) | Grade urbana, coordenadas, zoneamento, regras de posse, imóveis, réplica de cidade real |
| 04 | [Economia e Tokenomics](04-economia-tokenomics.md) | SCITY / THALER, distribuição, liberação, sinks e faucets, fórmula de ganhos |
| 05 | [Arquitetura Técnica](05-arquitetura-tecnica.md) | Cliente Unity WebGL, serviços de backend, multiplayer, blockchain, infraestrutura |
| 06 | [Modelo de Dados e API](06-modelo-dados-api.md) | Entidades, migração do Strapi, contratos REST/WebSocket |
| 07 | [Smart Contracts](07-smart-contracts.md) | Token, NFTs, Lucky Box, marketplace, staking, ponte on/off-chain |
| 08 | [Metaverso e WebGL](08-metaverso-webgl.md) | Orçamento de desempenho, streaming do mapa, Spatial, eventos e marcas |
| 09 | [Roadmap e Entregas](09-roadmap.md) | Fases, MVP, equipe e marcos |
| 10 | [Segurança, Riscos e Compliance](10-seguranca-compliance.md) | Achados no material legado, regulação, antifraude |
| 11 | [Decisões Pendentes](11-decisoes-pendentes.md) | Inconsistências das fontes e o que precisa ser decidido |
| — | [Roadmap detalhado](../ROADMAP.md) | Etapas, épicos, critérios de saída e caminho crítico |
| — | [Guia de Desenvolvimento](desenvolvimento/README.md) | Ambiente, fluxo de Git, padrões, testes e o caminho de cada trilha |
| — | [Decisões registradas (ADR)](adr/README.md) | Decisões de arquitetura e produto |

## Fontes utilizadas

| Fonte | Local original | O que foi aproveitado |
|-------|----------------|-----------------------|
| *Jogo NFT Smart Chain City* (FGV Jr., 118 p.) | `C:\SmartChainCity\Smart Chain City - FGV Jr\Smart Chain City.docx.pdf` | Benchmark de 9 jogos NFT e todo o planejamento do jogo (cap. 3–5) |
| *Tokenomics* (FGV Jr.) | `...\Tokenomics NFT.docx.pdf` | Distribuição dos tokens e cronograma de liberação |
| *Tabelas de Atributos* | `...\Tabelas de Atributos.pdf` | Ganho base por raridade, alimentos, multiplicadores |
| *Economia Smart Chain City* (planilha) | `...\Economia Smart Chain City - FGV Jr..xlsx` | Preço dos combos, circulação, cálculo de payback |
| Arte de profissões | `...\Profissões - Comum`, `Profissões - Épico` | 11 cards comuns + 1 épico (pastas Raro e Lendário estão vazias) |
| Backend Strapi 4.4.3 | `C:\SmartChainCity\Strapi-main` | Modelo de dados existente (avatar, land, property, wallet...) |
| Build Unity WebGL 0.0.23 | `C:\SmartChainCity\scc_web` | Cenas e prefabs já produzidos (CityBuilder, T1, avatar 2D) |
| Template Spatial SDK | `C:\SmartChainCity\spatial-virtualcamp` | Base para espaços no metaverso Spatial (Unity 2021.3.8f1) |
| Guia AWS GameLift | `C:\SmartChainCity\AWSGameTech_Guide to GameLift and Game Server.pdf` | Referência para hospedagem de servidores de jogo |

> Contratos, chaves e documentos pessoais da pasta `C:\SmartChainCity` **não** foram copiados para esta documentação. Ver [10 — Segurança](10-seguranca-compliance.md).

## Glossário rápido

- **Smartcityano** — avatar NFT do jogador; tem raridade, profissão e atributos.
- **Lucky Box** — caixa que gera um smartcityano aleatório; a raridade da caixa altera as probabilidades.
- **SCITY** — token on-chain (BEP-20), oferta fixa de ~1 bilhão.
- **THALER** — moeda interna do jogo (off-chain), usada no dia a dia; conversível em SCITY com taxa.
- **Lote → Slot → Célula → Bairro → Região** — hierarquia espacial da cidade (ver doc 03).
- **A1** — região central, onde fica a Prefeitura na coordenada (0,0).
- **PT (Property Tax)** — imposto que cresce para lotes sem uso, contra especulação.
- **Sink / Faucet** — mecanismos que retiram / emitem moeda na economia.
