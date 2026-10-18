# ADR-0009 — Cliente web nativo (Three.js) para a cidade e os prédios de jogadores

- **Status:** Proposto
- **Data:** 2026-10-18
- **Trilhas afetadas:** client · backend · tools · infra

## Contexto
A nova direção ([doc 13](../13-cidade-realista-construtores.md)) pede uma cidade em formato real, com edifícios enviados por jogadores-construtores em GLB pelo SCC Builder (fork do Convert3D, que usa Three.js). O cliente previsto era Unity 6 WebGL ([doc 05 §3](../05-arquitetura-tecnica.md#3-cliente--unity-webgl)). O build legado tem cerca de 133 MB e o projeto-fonte não foi localizado (E0.3).

## Opções consideradas
1. **Unity 6 WebGL + glTFast** — ferramentas maduras; carregar GLB de jogadores em tempo real exige integração e reescrita da validação em C#; download grande; memória limitada no mobile.
2. **Web nativo (Three.js)** — mesmo motor e código do SCC Builder (validação, LOD, otimização); download inicial pequeno; GLB nativo; menos ferramentas prontas (física com Rapier, editor de cena próprio).
3. **Web nativo (Babylon.js)** — parecido com a opção 2, com mais recursos de engine integrados; não compartilha código com o Convert3D.

## Decisão
Proposta: **opção 2**, condicionada a um *spike* de 2 sprints (épico E0.9). O protótipo em `docs/proposta-cidade-realista/` é o ponto de partida. Critérios de aceite do spike: 60 FPS em notebook médio com 1 região e streaming por célula; 30 FPS em celular médio; download inicial ≤ 10 MB; carregar 20 prédios GLB de jogadores com LOD.

## Consequências
- A trilha `client-unity` vira `client-web` (Vite + Three.js + TypeScript); o Unity fica opcional para minijogos.
- Validação de lote, LOD e presets são compartilhados entre o SCC Builder e o cliente.
- Física, animação de avatar e editor de cena precisam ser montados (Rapier, three-mesh-bvh, animações glTF).
- Se o spike falhar nos critérios, volta-se à opção 1 com glTFast.
