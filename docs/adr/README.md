# Registro de Decisões (ADR)

Cada decisão técnica ou de produto relevante é registrada como um arquivo `NNNN-titulo.md` a partir do [modelo](0000-template.md). Uma decisão só muda por um novo ADR que **substitui** o anterior.

| ADR | Decisão | Status |
|-----|---------|--------|
| [0001](0001-monorepo.md) | Monorepo único para todas as trilhas | Aceito |
| [0002](0002-servidor-autoritativo.md) | Servidor autoritativo para saldo, atributos e sorteios | Aceito |
| [0003](0003-blockchain-bsc.md) | BNB Smart Chain como rede | Aceito |
| [0004](0004-duas-moedas.md) | SCITY on-chain e THALER off-chain | Aceito |
| [0005](0005-multiplayer-colyseus.md) | Colyseus para presença multiplayer | Aceito |
| [0006](0006-strapi-backoffice.md) | Strapi 5 apenas como backoffice | Aceito |
| [0007](0007-cidade-real-nivel2.md) | Réplica de cidade pelo traçado do OpenStreetMap | Substituído por 0012 |
| [0008](0008-tempo-real.md) | Um dia de jogo = 24 horas reais | Aceito |
| [0009](0009-cliente-web-nativo.md) | Cliente web nativo (Three.js) para a cidade e os prédios de jogadores | Aceito e verificado (spike E0.9) |
| [0010](0010-criterio-economia-cobertura.md) | Economia aprovada por payback e cobertura em dólar | Aceito |
| [0011](0011-framework-backend-fastify.md) | Fastify e Drizzle no backend | Aceito |
| [0012](0012-cidade-real-construtores.md) | Cidade real com lotes poligonais e prédios de construtores | Aceito |
| [0013](0013-regras-conflitos-fontes.md) | Regras de jogo para os conflitos entre as fontes | Aceito |
| [0014](0014-decisoes-produto-mvp.md) | Decisões de produto do MVP | Aceito |

Pendentes de ADR (ver [doc 11](../11-decisoes-pendentes.md)): IaC (Terraform ou CDK); o tomate duplicado na tabela de alimentos; e, do [doc 13 §11](../13-cidade-realista-construtores.md#11-decisões-pendentes), cidade de referência definitiva, padrão das unidades, royalty/alvará/outorga, quem pode ser construtor e titularidade do Convert3D.
