# ADR-0002 — Servidor autoritativo para saldo, atributos e sorteios

- **Status:** Proposto
- **Data:** 2026-10-18
- **Trilhas afetadas:** backend · client

## Contexto
O Strapi legado permite que o cliente altere saldo por cabeçalho HTTP. Um cliente WebGL é inspecionável e não pode ser confiável (docs/10 §1).

## Opções consideradas
1. Regras no cliente com validação parcial.
2. Servidor calcula tudo; cliente só pede ações.

## Decisão
Opção 2. O cliente nunca calcula saldo, ganho, dano ou sorteio.

## Consequências
Mais carga no servidor, mas sem fraude trivial. Os turnos de trabalho rodam como jobs agendados.
