# ADR-0005 — Colyseus para presença multiplayer

- **Status:** Proposto
- **Data:** 2026-10-18
- **Trilhas afetadas:** backend · client · infra

## Contexto
O jogo é majoritariamente assíncrono; o multiplayer serve para presença, chat e eventos. WebGL só abre WebSocket/WebRTC.

## Opções consideradas
1. Colyseus (Node, WebSocket).
2. Photon Fusion.
3. Netcode for GameObjects + AWS GameLift.

## Decisão
Colyseus com salas por célula, em contêineres.

## Consequências
Custo baixo e mesma linguagem do backend. GameLift fica reservado para modos de ação em tempo real no futuro.
