# tools/scc-optimize

Preset **SCC** de otimização de edifícios GLB. É o protótipo do passo de conversão do SCC Builder ([doc 13 §5](../../docs/13-cidade-realista-construtores.md#5-scc-builder--versão-smart-do-convert3d-sem-vínculo-com-o-eventosweb)) e usa as mesmas bibliotecas do Convert3D (gltf-transform + meshoptimizer).

```bash
npm install
node --max-old-space-size=12000 scc-optimize.mjs <entrada.glb> <pasta-saida> [--scale 0.01] [--drop "regex de materiais"]
```

| Etapa | O que faz |
|-------|-----------|
| Remover paisagismo | Apaga primitivas cujo material casa com `--drop` (padrão: vegetação, água, mobiliário e o plano do terreno, que o jogo já tem) |
| Escala e origem | Converte unidades (`--scale 0.01` = cm → m), centraliza em X/Z e apoia a base em y = 0 |
| Instâncias | `dedup` + `instance`: cópias idênticas viram EXT_mesh_gpu_instancing |
| União | `flatten` + `join` + `weld` por material |
| LOD0 | Até 240 mil triângulos (orçamento de 300 mil; 450 mil para torre-marco); remove UVs quando não há textura |
| LOD1 / LOD2 | 20% e 4%, sem normais e UVs, para a simplificação atravessar as costuras (o three.js usa sombreamento plano) |
| Compressão | `quantize` + meshopt (o cliente precisa do `MeshoptDecoder`) |
| Metadados | `<nome>.meta.json` com tamanho, triângulos e bytes de cada LOD |

Resultado medido com `edificio.glb` (cena arquitetônica de 413 MB): ver [doc 13 §13](../../docs/13-cidade-realista-construtores.md#13-estudo-de-caso-edifício-grande-edificioglb).

> Não versione modelos de terceiros neste repositório: modelos comprados em bibliotecas (Evermotion, TurboSquid…) costumam proibir redistribuição em jogos e NFTs.
