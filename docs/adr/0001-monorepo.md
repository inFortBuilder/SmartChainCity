# ADR-0001 — Monorepo único para todas as trilhas

- **Status:** Proposto
- **Data:** 2026-10-18
- **Trilhas afetadas:** todas

## Contexto
O material legado está espalhado (build Unity sem fonte, Strapi isolado, template Spatial, site WordPress). As trilhas compartilham contratos de API, ABIs e o formato de célula.

## Opções consideradas
1. Monorepo com workspaces pnpm e pastas por trilha.
2. Um repositório por componente.

## Decisão
Monorepo (este repositório), com Git LFS para arte e Unity.

## Consequências
Mudanças que atravessam trilhas viram um único PR. O CI precisa filtrar por pasta alterada para não rodar tudo sempre.
