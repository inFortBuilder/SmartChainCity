# ADR-0004 — SCITY on-chain e THALER off-chain

- **Status:** Proposto
- **Data:** 2026-10-18
- **Trilhas afetadas:** econ · backend · contracts

## Contexto
A planilha mostra que o P2E em SCITY esgotaria o pool rapidamente (docs/04 §6). Os jogos analisados que sobreviveram separam moeda de valor e moeda de uso.

## Opções consideradas
1. Só SCITY.
2. SCITY (fixo, on-chain) + THALER (ilimitado, off-chain) com câmbio e limites.

## Decisão
Opção 2, com câmbio por TWAP de 24 h, spread de saída e limites diários.

## Consequências
O ledger off-chain precisa de auditoria e invariantes fortes. A economia pode ser ajustada sem mexer em contratos.
