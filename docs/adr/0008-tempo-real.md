# ADR-0008 — Um dia de jogo = 24 horas reais

- **Status:** Proposto
- **Data:** 2026-10-18
- **Trilhas afetadas:** backend · client · econ

## Contexto
Turnos de 6/12 h, refeições a cada 8 h e estações de 7 dias estão descritos em horas reais no GDD.

## Opções consideradas
1. Tempo real.
2. Tempo acelerado.

## Decisão
Tempo real, com o relógio do servidor em UTC.

## Consequências
O jogo funciona em sessões curtas. O ciclo dia/noite visual acompanha o horário do jogador.
