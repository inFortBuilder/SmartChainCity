# Spike do escritório (ADR-0015)

- **Data:** 2026-11-21
- **Página:** [escritorio.html](../proposta-cidade-realista/escritorio.html). Para abrir, rode o `scc-telas` e acesse `http://localhost:8081/docs/proposta-cidade-realista/escritorio.html`.
- **Pergunta:** o padrão do SCC Kit ([ADR-0015](../adr/0015-render-realista-e-biblioteca-3d.md)) dá um interior realista e caminhável no Three.js, com a luz assada e o avatar entrando, dentro do orçamento de desempenho?

## O que foi montado

| Parte | Como |
|---|---|
| Escritório 12 × 9 m, pé-direito 2,8 m | Geometria própria, feita em código (nenhum modelo de terceiros): 2 ilhas com 12 estações, sala de reunião, estar, recepção, 3 estantes com livros, plantas e 7 pendentes. Texturas procedurais (madeira, carpete, reboco, concreto) |
| Porta 1,0 × 2,1 m e janela | Vão na fachada e no casco; faixa de janela no fundo com caixilhos |
| Luz assada | `ProgressiveLightMap` do three.js no navegador, com 240 amostras e luzes sorteadas a cada amostra (sombra suave). Entram 7 spots nas pendentes, o sol pela janela e o céu. A luz vai para o casco (piso, forro e paredes); os móveis projetam sombra no bake por cópias que só escrevem na sombra |
| Ambiente e pós | `RoomEnvironment` (IBL), tone mapping AgX e AO em tela (`GTAOPass`), que pode ser desligado |
| Avatar | RobotExpressive (Quaternius, CC0), escalado para 1,75 m, com as animações de parado, andar e correr. Teclado (WASD e Shift) ou toque no chão |
| Colisão | Caixas no plano XZ contra um círculo de 0,3 m: fachada, vão da porta livre, ilhas, sofá, estantes e plantas |
| Streaming | O interior é montado a menos de 9 m da porta e descartado a mais de 22 m (histerese), liberando geometria e lightmap |

## Resultados

Medidos no navegador interno do app, numa GeForce GTX 1660, com a janela em 1163 × 905 e DPR 1. O custo de quadro é a média de 100 quadros forçados em sequência, sem o limite de 60 Hz da tela.

| Cenário | ms por quadro | Chamadas de desenho | Triângulos no quadro |
|---|---|---|---|
| Dentro, com AO | 3,8 | 115 a 203 | 24 a 31 mil |
| Dentro, sem AO | 2,9 | | |
| Rua, interior carregado, com AO | 3,2 | 207 | |
| Rua, interior carregado, sem AO | 1,7 | | |
| Rua, interior descarregado, com AO | 2,4 | | |
| Tela de celular emulada (375 × 812, DPR 2), dentro, com AO | 4,3 | 199 | 31 mil |

- **FPS na tela:** 60 o tempo todo, inclusive durante o bake.
- **Montar o interior:** 5 a 13 ms. **Bake:** 4,3 s, com a página jogável enquanto assa.
- **Orçamento:** 31 mil triângulos no quadro, contra 150 mil por ambiente no ADR-0015, e 32 objetos com uma InstancedMesh por peça.
- **Caminhar:** o avatar entra pela porta andando, para nas estantes (x = 5,32 m, o raio de 0,3 m antes da caixa) e para na ilha de mesas. Ao se afastar, o interior é descarregado.
- **Celular:** a disposição da tela foi conferida em 375 px, sem rolagem horizontal. O custo em celular real **não foi medido**.

## Achados (o que muda no padrão)

1. **Toda luz de fora precisa projetar sombra.** O sol e a luz hemisférica da rua, sem sombra, atravessavam a laje e iluminavam o piso por igual, apagando a luz assada. Agora o sol projeta sombra (1 mapa de 2048), móveis e avatar recebem essa sombra, e o ambiente (IBL) faz o papel da luz hemisférica.
2. **`envMapIntensity` não vale com `scene.environment`** (three r170): é o `scene.environmentIntensity` que manda. Para o casco usar pouco ambiente, o material precisa do próprio `envMap`.
3. **O blur de borda do `ProgressiveLightMap`, aplicado a cada amostra, borra as sombras inteiras.** Fica desligado.
4. **O `ProgressiveLightMap` dá a mesma área do atlas a cada objeto,** seja o piso ou a verga da porta, e só funciona com UV sem sobreposição. Para produção, o lightmap sai do Blender, com UV2 dimensionado pela área.
5. **Câmera em terceira pessoa atravessa a parede.** Dentro da sala, a câmera fica presa às paredes. No jogo, é preciso uma colisão de câmera de verdade (raio contra o casco).
6. **Clique para andar segue em linha reta** e encalha atrás do móvel. Para NPCs e para o clique, é preciso navmesh (Recast), como o ADR-0015 já prevê.
7. **Memória do bake no navegador:** dois alvos 2048² em float, cerca de 128 MB de GPU no desktop (meia precisão no celular, cerca de 64 MB). É pesado demais para assar no aparelho do jogador.

## Conclusão

O Three.js atende à pergunta: luz assada, sombra de contato, AO e o avatar entrando pela porta custam menos de 4 ms por quadro numa GPU de mesa, e o interior inteiro fica em cerca de 30 mil triângulos.

**Decisão para o pipeline:** o bake sai do navegador. Cada interior do SCC Kit traz o próprio lightmap feito no Blender (UV2, KTX2 ou PNG de cerca de 1 a 2 MB). O jogo só carrega a textura, sem custo de bake nem os 64 a 128 MB de GPU. O bake no navegador fica só como prévia no SCC Builder.

**Falta (fora deste spike):**

- Medir no notebook de referência (GeForce 940MX) e num celular médio pelo `scc-telas-rede` (porta 8082, na rede local). A meta é 60 e 30 FPS.
- O avatar humano do jogo, com o esqueleto padrão.
- Navmesh.
- Colisão de câmera.
- O lightmap do Blender no preset `scc` do SCC Builder.
