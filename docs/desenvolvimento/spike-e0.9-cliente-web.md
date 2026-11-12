# Spike E0.9 — Cliente web nativo (Three.js)

Verificação da [ADR-0009](../adr/0009-cliente-web-nativo.md). O cliente web foi aceito com a condição de passar nestes critérios; se falhar, volta-se ao Unity com glTFast.

**Situação em 2026-11-12:** download, 20 prédios e celular passam. Num **Galaxy S9** (2018, Adreno 630), os 20 prédios rodam a **43 FPS** em resolução 2×, acima da meta de 30; no iPhone 17 Pro Max, a 30 FPS travados pelo aparelho. Num notebook com placa integrada fraca (Intel HD 620, de 2016, abaixo do "notebook médio"), o FPS subiu de 19 para 50 com os ajustes, ainda abaixo de 60. **Falta só medir num notebook com placa integrada atual** (Iris Xe ou equivalente).

## Resultado

Medido em Pittsburg (34,6 km de base, 100.152 lotes em 198 bairros), Chrome, desktop com GeForce GTX 1660, tela 1163 × 906.

| Critério da ADR-0009 | Meta | Medido | Situação |
|---|---:|---:|---|
| Download inicial | ≤ 10 MB | **2,8 MB** só com o bairro aberto · **5,7 MB** com os bairros que a câmera inicial enxerga | ✅ (era 19,95 MB) |
| FPS com 1 região e streaming por célula | 60 em notebook médio | Desktop: 59 FPS. Notebook com HD 620: **48 FPS** (era 35) | ✅ no desktop; ⚠️ HD 620 abaixo; ⏳ falta um notebook médio |
| 20 prédios GLB de jogadores com LOD | carregar e manter o FPS | 20 de 20 com os 3 LODs, 2,78 mi triângulos. Desktop: **58 FPS**. Notebook com HD 620: **50 FPS** (era 19), p95 de 33,5 ms, resolução adaptada a 0,65× | ✅ no desktop; ⚠️ HD 620 abaixo de 60 |
| FPS em celular médio | 30 | Galaxy S9 (2018): **43 FPS** com os 20 prédios, 52 FPS na cidade, resolução 2×. iPhone 17 Pro Max: 30 FPS, travado em 30 pelo aparelho | ✅ |

Os 20 prédios do teste são cópias do pior caso permitido: o prédio do estudo de caso do doc 13, com LOD0 de 304 mil triângulos (o limite por prédio é 300 mil). Com 20 cópias do mesmo arquivo, o download conta uma vez só (9,6 MB no total com os três LODs); 20 prédios diferentes somariam até ~4 MB cada, baixados só quando a câmera chega perto.

### Medições

| Aparelho | Perfil | Cidade | 20 prédios | Chamadas |
|---|---|---:|---:|---:|
| Desktop, GTX 1660, 1163 × 906 | depth logarítmico, resolução 1× | 59 FPS | 60 FPS | 681 |
| Notebook, Intel HD 620, 1536 × 695, DPR 1,25 | depth logarítmico, resolução 1,25× fixa | 35 FPS (28,6 ms) | 19 FPS (51,9 ms, p95 66,9) | 687 |
| Desktop, GTX 1660 | depth comum, resolução adaptativa, malhas juntadas | 59 FPS | 58 FPS | 612 |
| Notebook, Intel HD 620 | depth comum, resolução adaptativa (caiu a 0,65×), malhas juntadas | **48 FPS** (21 ms) | **50 FPS** (20 ms, p95 33,5) | 624 |
| iPhone 17 Pro Max, Safari, 440 × 793, DPR 3 | depth comum, resolução adaptativa (caiu ao mínimo de 0,6×, sem reconhecer o limite) | 27 FPS | 30 FPS (33,3 ms, p95 34) | 471 |
| iPhone 17 Pro Max, Safari | depth comum, resolução adaptativa que reconhece o limite do aparelho (ficou em 2×) | 30 FPS | **30 FPS** (33,3 ms, p95 34) | 477 |
| Galaxy S9 (SM-G9600, Adreno 630, Android 10), Chrome, 360 × 612, DPR 3 | depth comum, resolução adaptativa (ficou em 2×), malhas juntadas | **52 FPS** (19,3 ms) | **43 FPS** (23,3 ms, p95 33,4) | 483 |

No iPhone, o quadro ficou cravado em 33,3 ms mesmo com a resolução no mínimo: é o limite de 30 FPS do aparelho (o iOS faz isso no Modo de Pouca Energia), não sobrecarga. A primeira versão da resolução adaptativa confundia esse limite com falta de desempenho e borrava a imagem à toa; agora, quadro estável (variação menor que 2,5 ms) não derruba a resolução, e o painel avisa "FPS travado pelo aparelho". Em tela 3×, a resolução mínima passou a ser 1,5×.

O que pesava na placa integrada era o preenchimento de pixels: o depth logarítmico escreve a profundidade de cada pixel e desliga o descarte antecipado dos pixels escondidos, e o antialiasing a 1,25× multiplica o trabalho. Juntar as malhas por material ajudou pouco (681 → 612 chamadas): o prédio de teste já vem com instâncias e quase um material por peça.

## O que mudou para passar

| Antes | Agora |
|---|---|
| `lotes.bin` com os 100 mil lotes, 13,6 MB, baixado inteiro | Um bloco por bairro (`tools/scc-builder/bin/city-chunks.js`): mediano de 65 KB, maior de 154 KB. O mapa baixa os abertos primeiro e depois os que estão perto da câmera; o raio cresce quando a câmera se afasta |
| Os três LODs de cada prédio baixados na abertura (3,4 MB só o LOD0 do Centro Administrativo) | LOD progressivo: chega o mais leve (0,2 MB) e os detalhados só a menos de 2,5 km da câmera |
| Linhas dos lotes sem recorte por visão | Cada bairro é uma malha própria com esfera de recorte: o que está fora da tela não é desenhado |
| Depth logarítmico | Depth comum com o plano próximo acompanhando a distância da câmera (5%, entre 2 e 400 m): as camadas planas não piscam e o descarte antecipado volta. `?profundidade=log` volta ao antigo; o depth reverso do three r170 (`?profundidade=reversa`) ainda não desenha a cena |
| Resolução fixa | Resolução adaptativa: cai até 0,6× quando o quadro passa de 22 ms e sobe quando sobra folga (`?resolucao=fixa` desliga) |
| Uma chamada de desenho por malha | Malhas de cada prédio juntadas por material ao carregar (`?juntar=nao` desliga) |

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

### No celular Android pelo cabo USB

Com a depuração USB ligada no celular e o [Android Platform-Tools](https://developer.android.com/tools/releases/platform-tools) instalado, não precisa de Wi-Fi: o `adb reverse` liga a porta do celular à do PC, e o `am start` abre o Chrome no teste.

```bash
adb reverse tcp:8081 tcp:8081
adb shell am start -a android.intent.action.VIEW -d "http://localhost:8081/docs/proposta-cidade-realista/pittsburg.html?spike=20" -n com.android.chrome/com.google.android.apps.chrome.Main
```

O resultado chega em `.local/spike/resultados.jsonl`. No fim, `adb reverse --remove tcp:8081`.

### No celular pela rede

1. No PC, sirva a pasta para a rede local (o Windows pode pedir para liberar o PHP no firewall):

   ```bash
   php -S 0.0.0.0:8081 -t .
   ```

2. No celular, na mesma rede Wi-Fi, abra `http://<IP-do-PC>:8081/docs/proposta-cidade-realista/pittsburg.html?spike=20`. O IP aparece com `ipconfig`.
3. Espere o painel mostrar "✅ Resultado enviado para o PC": o resultado (com GPU, tela, CPUs e o navegador do aparelho) é gravado no PC em `.local/spike/resultados.jsonl` por [`spike-resultado.php`](../proposta-cidade-realista/spike-resultado.php). Registre aqui o modelo do aparelho.

Para o "notebook médio", repita no notebook com placa integrada (Intel Iris Xe ou equivalente).

## Achados

- **Chamadas de desenho:** cada cópia do prédio de teste tem ~34 malhas, e as 20 somam 681 chamadas. No celular, isso pesa mais que os triângulos. O SCC Builder deve juntar malhas por material no preset `scc` antes do envio, e o cliente pode usar instâncias para prédios repetidos.
- **Layout no celular:** a barra superior quebra em 4 linhas e, com o painel de camadas, cobre quase metade do mapa. Precisa de um HUD compacto para telas estreitas.
- **A malha da cidade (`cidade.glb`, 1,8 MB) ainda vem inteira.** Cabe na meta e não pesou no FPS; vale dividir por bairro só se uma cidade maior passar do orçamento.
- O PHP embutido não comprime: com gzip ou brotli no servidor de produção, os blocos de lotes devem cair para perto da metade.

## Próximos passos

1. Medir num notebook com placa integrada atual (Iris Xe ou equivalente); registrar aqui. No iPhone, repetir sem o Modo de Pouca Energia para ver a folga acima de 30 FPS.
2. Se o celular ficar abaixo de 30 FPS: limitar o DPR a 1,5, reduzir sombras e juntar as malhas dos prédios.
3. Com os dois aparelhos aprovados, marcar a ADR-0009 como verificada e começar a trilha `client-web` (Vite + Three.js + TypeScript) a partir deste protótipo.
