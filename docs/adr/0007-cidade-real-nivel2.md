# ADR-0007 — Réplica de cidade real pelo traçado do OpenStreetMap

- **Status:** Proposto
- **Data:** 2026-10-18
- **Trilhas afetadas:** tools · client · backend

## Contexto
O produto quer replicar uma cidade. O fotorrealismo (3D Tiles) tem dúvidas de suporte em WebGL e de licença (docs/03 §7).

## Opções consideradas
1. Cidade estilizada.
2. Traçado OSM projetado na grade de lotes.
3. Gêmeo digital fotorrealista.

## Decisão
Nível 2 com uma cidade-referência; o nível 3 vira um tour separado no futuro.

## Consequências
Precisa do pipeline tools/osm-to-grid e de atribuição ODbL. A grade continua sendo a fonte da verdade de posse.
