# ADR-0006 — Strapi 5 apenas como backoffice de catálogo

- **Status:** Proposto
- **Data:** 2026-10-18
- **Trilhas afetadas:** cms · backend

## Contexto
O Strapi 4.4.3 legado mistura catálogo com saldo e posse e está fora de suporte.

## Opções consideradas
1. Manter Strapi 4 como backend principal.
2. Strapi 5 só para catálogo; regras em serviços próprios.
3. Remover o Strapi.

## Decisão
Opção 2.

## Consequências
Game designers editam o balanceamento sem deploy. O Game Core consome o catálogo por webhook e cache.
