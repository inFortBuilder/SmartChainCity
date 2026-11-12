# Spike E0.9 — Cliente web nativo (Three.js)

Verificação da [ADR-0009](../adr/0009-cliente-web-nativo.md). O cliente web foi aceito com a condição de passar nestes critérios; se falhar, volta-se ao Unity com glTFast.

**Situação em 2026-11-12:** três dos quatro critérios passam no desktop. **Falta medir num celular de verdade**, e o critério do notebook foi medido numa máquina acima de "notebook médio".

## Resultado

Medido em Pittsburg (34,6 km de base, 100.152 lotes em 198 bairros), Chrome, desktop com GeForce GTX 1660, tela 1163 × 906.

| Critério da ADR-0009 | Meta | Medido | Situação |
|---|---:|---:|---|
| Download inicial | ≤ 10 MB | **2,8 MB** só com o bairro aberto · **5,7 MB** com os bairros que a câmera inicial enxerga | ✅ (era 19,95 MB) |
| FPS com 1 região e streaming por célula | 60 em notebook médio | 60 (trava na taxa da tela), quadro de 16,6 ms | ✅ no desktop; ⏳ falta um notebook médio |
| 20 prédios GLB de jogadores com LOD | carregar e manter o FPS | 20 de 20 com os 3 LODs, **60 FPS**, 2,78 mi triângulos, 681 chamadas de desenho | ✅ no desktop |
| FPS em celular médio | 30 | não medido: o navegador do PC emula só a tela (375 × 812, DPR 2) e deu 60 FPS com a placa do PC | ⏳ **falta um aparelho real** |

Os 20 prédios do teste são cópias do pior caso permitido: o prédio do estudo de caso do doc 13, com LOD0 de 304 mil triângulos (o limite por prédio é 300 mil). Com 20 cópias do mesmo arquivo, o download conta uma vez só (9,6 MB no total com os três LODs); 20 prédios diferentes somariam até ~4 MB cada, baixados só quando a câmera chega perto.

## O que mudou para passar

| Antes | Agora |
|---|---|
| `lotes.bin` com os 100 mil lotes, 13,6 MB, baixado inteiro | Um bloco por bairro (`tools/scc-builder/bin/city-chunks.js`): mediano de 65 KB, maior de 154 KB. O mapa baixa os abertos primeiro e depois os que estão perto da câmera; o raio cresce quando a câmera se afasta |
| Os três LODs de cada prédio baixados na abertura (3,4 MB só o LOD0 do Centro Administrativo) | LOD progressivo: chega o mais leve (0,2 MB) e os detalhados só a menos de 2,5 km da câmera |
| Linhas dos lotes sem recorte por visão | Cada bairro é uma malha própria com esfera de recorte: o que está fora da tela não é desenhado |

O número de cada lote não mudou: o bloco leva a lista de ids e preenche os mesmos arrays globais, então a ficha, a gestão e o Centro Administrativo funcionam como antes.

## Como medir de novo

Abra o mapa com `?spike` (ou `?spike=20` para escolher quantos prédios). Ao fim, um painel mostra GPU, tela, download, FPS e tempo de quadro, com ✅ ou ❌ em cada meta; os números ficam em `window.__spikeResult`.

```bash
php -S localhost:8081 -t .
```

http://localhost:8081/docs/proposta-cidade-realista/pittsburg.html?spike=20

A cidade precisa estar gerada com os blocos por bairro (`.local/` não é versionado):

```bash
node tools/scc-builder/bin/city-chunks.js .local/cidades/pittsburg
```

### No celular

1. No PC, sirva a pasta para a rede local (o Windows pode pedir para liberar o PHP no firewall):

   ```bash
   php -S 0.0.0.0:8081 -t .
   ```

2. No celular, na mesma rede Wi-Fi, abra `http://<IP-do-PC>:8081/docs/proposta-cidade-realista/pittsburg.html?spike=20`. O IP aparece com `ipconfig`.
3. Anote o painel (ou tire um print) e registre aqui o modelo do aparelho.

Para o "notebook médio", repita no notebook com placa integrada (Intel Iris Xe ou equivalente).

## Achados

- **Chamadas de desenho:** cada cópia do prédio de teste tem ~34 malhas, e as 20 somam 681 chamadas. No celular, isso pesa mais que os triângulos. O SCC Builder deve juntar malhas por material no preset `scc` antes do envio, e o cliente pode usar instâncias para prédios repetidos.
- **Layout no celular:** a barra superior quebra em 4 linhas e, com o painel de camadas, cobre quase metade do mapa. Precisa de um HUD compacto para telas estreitas.
- **A malha da cidade (`cidade.glb`, 1,8 MB) ainda vem inteira.** Cabe na meta e não pesou no FPS; vale dividir por bairro só se uma cidade maior passar do orçamento.
- O PHP embutido não comprime: com gzip ou brotli no servidor de produção, os blocos de lotes devem cair para perto da metade.

## Próximos passos

1. Medir num celular médio e num notebook com placa integrada; registrar aqui.
2. Se o celular ficar abaixo de 30 FPS: limitar o DPR a 1,5, reduzir sombras e juntar as malhas dos prédios.
3. Com os dois aparelhos aprovados, marcar a ADR-0009 como verificada e começar a trilha `client-web` (Vite + Three.js + TypeScript) a partir deste protótipo.
