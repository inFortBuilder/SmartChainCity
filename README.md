# Smart Chain City

Cidade virtual persistente jogável no navegador (**Unity WebGL**) e em espaços de **metaverso**, com **lotes e imóveis virtuais** tokenizados, avatares-NFT (*smartcityanos*) e uma economia Play-to-Earn de duas moedas (SCITY on-chain e THALER no jogo).

## Navegação

| Quero… | Vá para |
|--------|---------|
| Entender o produto e o jogo | [docs/](docs/README.md) — visão, GDD, cidade e imóveis, economia, arquitetura |
| Ver o plano e as etapas | [ROADMAP.md](ROADMAP.md) |
| Começar a desenvolver | [docs/desenvolvimento/](docs/desenvolvimento/README.md) — ambiente, Git, padrões, trilhas |
| Ver as decisões tomadas | [docs/adr/](docs/adr/README.md) |
| Contribuir | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Reportar uma vulnerabilidade | [SECURITY.md](SECURITY.md) |

## Estrutura do repositório

```
.
├─ ROADMAP.md              ← etapas, épicos e marcos
├─ docs/                   ← especificação (01–11), guias de desenvolvimento e ADRs
├─ client-unity/           ← cliente Unity 6 → WebGL
├─ metaverse-spatial/      ← espaços no Spatial
├─ services/               ← backend TypeScript (gateway, game-core, economy, world, realtime, chain-indexer)
├─ cms-strapi/             ← backoffice de catálogo (Strapi 5)
├─ contracts/              ← smart contracts (Foundry, BNB Smart Chain)
├─ tools/                  ← simulador econômico e pipeline de cidade real (OSM)
├─ infra/                  ← IaC, Docker Compose, runbooks
├─ art/                    ← arte-fonte (Git LFS)
└─ .github/                ← CI, modelos de issue e PR
```

## Estado atual

**Etapa 0 — Fundação.** O repositório contém a documentação e a estrutura de pastas; o código de cada trilha entra a partir dos épicos E0.x do [roadmap](ROADMAP.md#etapa-0--fundação-s1s4).
