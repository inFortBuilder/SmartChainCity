# Trilha — Metaverso (Spatial)

Pasta: [`metaverse-spatial/`](../../metaverse-spatial/README.md) · Origem: `C:\SmartChainCity\spatial-virtualcamp` (Unity 2021.3.8f1, URP 12) · Especificação: [doc 08 §5](../08-metaverso-webgl.md#5-espaços-spatial-a-partir-de-spatial-virtualcamp)

## Caminho de desenvolvimento

| Passo | Etapa | O que fazer | Pronto quando |
|------:|-------|-------------|---------------|
| 1 | 0 | Copiar o template para `metaverse-spatial/` (sem `Library/`, `Logs/`, `UserSettings/`); conferir a versão de Unity exigida hoje pelo Spatial SDK | Projeto abre e publica um espaço de teste |
| 2 | 2 | Pipeline de **exportação de modelos** do cliente principal (prefabs sem scripts proprietários, materiais compatíveis) | 1 imóvel T1 exibido no Spatial |
| 3 | 3 | **Stand de Vendas**: maquete da região A1, preços, link profundo para o lote no jogo | Visitável, dentro dos limites de tamanho do Spatial |
| 4 | 3 | **Prefeitura Virtual**: auditório para anúncios e AMAs | Evento de teste com 30+ pessoas |
| 5 | 4 | **Showroom de Imóveis** em escala 1:1 (T1–T3, Residenciais) | Publicado no lançamento |
| 6 | 5 | **Arena de Eventos** e **Lojas de Marca** | Onda 5.5 |

## Regras
- O espaço Spatial é **vitrine**: não exibe saldo nem executa compra; leva ao jogo por link profundo (`/city?x=..&y=..`).
- Identidade visual igual ao jogo (paleta, logo, sinalização).
- Cada espaço tem um README com objetivo, limites de tamanho e checklist de publicação.
