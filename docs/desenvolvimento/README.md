# Guia de Desenvolvimento

Como trabalhar neste repositório: ambiente, fluxo de Git, padrões e o **caminho de desenvolvimento de cada trilha**.

## Comece por aqui

1. [Configurar o ambiente](setup-ambiente.md)
2. [Fluxo de Git e GitHub](fluxo-git.md)
3. [Padrões de código](padroes-codigo.md)
4. [Testes e qualidade](testes-qualidade.md)
5. Escolha sua trilha abaixo.

## Trilhas de desenvolvimento

| Trilha | Pasta | Guia | Épicos principais |
|--------|-------|------|-------------------|
| Cliente Unity WebGL | [`client-unity/`](../../client-unity/README.md) | [trilha-client-unity.md](trilha-client-unity.md) | E0.3, E0.6, E1.6, E2.4, E2.7 |
| Backend (serviços) | [`services/`](../../services/README.md) | [trilha-backend.md](trilha-backend.md) | E1.1, E1.3–E1.5, E2.x, E3.x |
| Smart contracts | [`contracts/`](../../contracts/README.md) | [trilha-contratos.md](trilha-contratos.md) | E2.1, E2.5, E3.6–E3.8, E4.1–E4.2 |
| CMS / Backoffice | [`cms-strapi/`](../../cms-strapi/README.md) | [trilha-cms.md](trilha-cms.md) | E1.2, E3.10 |
| Metaverso (Spatial) | [`metaverse-spatial/`](../../metaverse-spatial/README.md) | [trilha-metaverso.md](trilha-metaverso.md) | E4.4, onda 5.5 |
| Ferramentas (economia e cidade real) | [`tools/`](../../tools/README.md) | [trilha-ferramentas.md](trilha-ferramentas.md) | E0.5, E0.7, E2.8 |
| Infraestrutura | [`infra/`](../../infra/README.md) | [trilha-infra.md](trilha-infra.md) | E0.1, E0.2, E1.7, E3.9, E4.1 |
| Arte | [`art/`](../../art/README.md) | — (ver [doc 08](../08-metaverso-webgl.md)) | E0.3, E1.6, E2.2 |

## Como as trilhas se encontram

```
            cms-strapi (catálogo) ──webhook──► services/game-core
                                                    │
client-unity ──REST──► services/gateway ──► game-core · economy · world
     │                                              │
     └──WebSocket──► services/realtime             ▼
     │                                  PostgreSQL · Redis
     └──carteira──► contracts (BSC) ◄──► services/chain-indexer
                                                    ▲
tools/osm-to-grid ──JSON de células──► world + Addressables do client
tools/econ-sim ──parâmetros──► cms-strapi (preços, probabilidades)
```

Contratos entre as trilhas (mudar só via PR revisado pelas duas partes):
- **API REST/WS:** `services/gateway/openapi.yaml` (gerado a partir do [doc 06](../06-modelo-dados-api.md)).
- **ABIs dos contratos:** `contracts/out/abi/*.json`, publicados como pacote interno para backend e cliente.
- **Formato de célula:** esquema JSON em `tools/osm-to-grid/schema/cell.schema.json` ([doc 03 §7.1](../03-cidade-lotes-imoveis.md#71-formato-de-dados-de-célula-saída-do-pipeline)).

## Registro de decisões

Decisões técnicas e de produto ficam em [`docs/adr/`](../adr/README.md) (Architecture Decision Records).
