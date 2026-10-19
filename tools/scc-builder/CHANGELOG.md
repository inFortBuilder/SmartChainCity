# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/);
versionamento conforme [SemVer](https://semver.org/lang/pt-BR/).

---

## [0.1.0] — SCC Builder (em desenvolvimento)

Primeira versão do SCC Builder, derivada do Convert3D v2.8.0 para a Smart
Chain City (doc 13 §5), sem vínculo com a aplicação de origem.

### Adicionado

- **JWT do gateway SCC** (`api/lib/Jwt.php`): `Authorization: Bearer <jwt>`,
  só HS256, `exp` obrigatório, `iss`/`aud` conferidos quando configurados,
  `sub` = `account_id`. Claim opcional `builder_company_id`.
- **Escopo por `account_id`**: jobs, modelos, downloads e validações só para
  o dono. API key servidor a servidor continua opcional, com `X-Account-Id`
  para agir em nome de um jogador.
- **Preset `scc`** no CLI (`--preset scc`), na API (`preset=scc`, padrão) e
  no editor: Y-up, metros, Meshopt, LOD0 até 300 mil triângulos (simplifica
  até 240 mil), LOD1 (25%) e LOD2 (5%) e
  `modelo.meta.json` com contorno da base, caixa/colisor, altura e
  triângulos. No editor, aviso acima de 300 mil triângulos.
- **Exportar para o mapa** (botão abaixo de "Baixar arquivo convertido"):
  ajusta o modelo aos limites da plataforma (`src/utils/sccPlatform.js`:
  300 mil triângulos, LODs de 25% e 5%, texturas até 2048 px, Meshopt, até
  40 MB, aviso acima de 8 materiais) e entrega os três LODs ao mapa da cidade
  por `postMessage` (`src/utils/mapLink.js`). O protótipo do mapa recebe,
  entra no modo Construtor e valida no lote.
- **`POST /api/validate-lot.php`** (`api/lib/LotValidator.php`): cabe com
  recuo (polígono reduzido exato, vale para lote não convexo), altura ≤
  gabarito, área construída × coeficiente com outorga onerosa, triângulos ≤
  300 mil, escala plausível, contorno convexo e andares sugeridos — formato
  do doc 13 §5.3.
- **Bucket SCC próprio** (`s3_*` na configuração): layout
  `builder/<account_id>/<model_id>/v<n>/modelo.glb`, com LODs e meta;
  assinatura SigV4 própria, sem SDK externo. `model_id` e versão por job.
- `bin/token-dev.php`: JWT de desenvolvimento. `deploy/`: contêiner próprio.
- `tests/php/`: JWT, autenticação, layout do bucket, versões, validate-lot e
  o endpoint por HTTP (`npm run test:php`). `tests/footprint.test.js`.

### Removido

- Guarda de sessão e SSO da plataforma de origem, o modo
  "subdomínio/mesma origem" do `app.php`, o módulo de integração com o
  framework PHP da origem e o deploy que dependia dela.

---

# Histórico do Convert3D (origem do SCC Builder)

As entradas abaixo são do Convert3D, até a v2.8.0 da qual o SCC Builder
deriva. Ficam como registro do que o núcleo de conversão e o editor já
fazem; nomes de arquivo e marca foram atualizados para os do SCC Builder.

## [Convert3D — não lançado na origem]

### Adicionado

- **Editor em português, espanhol e inglês** (`src/i18n/`). O texto fica em
  português e é a chave: `t('Carregando ^1', arquivo.name)`, com `en.js` e
  `es.js` ao lado. O idioma vem de `?lang=` (é como o jogo o passa),
  da última escolha guardada no navegador ou do idioma do navegador. O
  `index.html` marca os textos fixos com `data-t*`; o worker de parsing
  recebe o idioma pelo nome do worker.
- `tests/traducao.test.js`: reprova texto de tela sem tradução em en ou es,
  tradução com `^1..^4` diferente e entrada que sobrou no dicionário.

### Alterado

- O `index.html` misturava inglês e português; agora está todo em português
  (e traduzido pelo `i18n`). Números seguem o idioma (`toLocaleString`).
- O card do Revit dizia `.FBX · .IFC`: IFC não tem leitor. Passou a
  `.FBX · .DAE`, e o guia de exportação diz para exportar FBX em vez de IFC.
- Nos testes e no CLI (Node) o idioma é sempre português; o Playwright usa
  `locale: 'pt-BR'`.

---

## [2.8.0] — 2026-08-09

Camadas e divisão de malhas.

### Contexto

Um `.dae` do Lumion chega com tudo em poucas malhas gigantes e nomes
inúteis (`Mesh`, `Mesh`, `Mesh`). Não dá para ocultar só as cadeiras nem
texturizar só o piso, porque cadeira e piso são o mesmo objeto para o
viewer. E a estrutura de camadas do CAD se perdeu na exportação.

### Adicionado

- **Divisão por componentes conectados** (`src/utils/meshSplit.js`) — o
  recurso central. Separa ilhas de geometria: cada cadeira, cada mesa, cada
  peça solta vira um objeto próprio.
  - Usa **union-find com compressão de caminho e união por tamanho**,
    praticamente O(1) amortizado — necessário porque uma malha de estande
    tem centenas de milhares de arestas para unir.
  - Solda vértices coincidentes por quantização antes de analisar. Sem
    isso, uma malha não indexada (o padrão em OBJ e DAE) devolveria um
    "componente" por triângulo.
  - **Previsão** antes de executar, para não estilhaçar a árvore em
    milhares de objetos sem aviso.
  - Limite de segurança de 400 mil triângulos, com sugestão de otimizar ou
    fatiar antes.
- **Divisão por grupos de material** — separa multi-material em uma malha
  por material. Barato e exato.
- **Divisão por fatias** em X, Y ou Z, com o triângulo indo inteiro para a
  fatia do seu centroide (nenhum triângulo é cortado ao meio). Último
  recurso para cascas contínuas, como uma fachada em malha única.
- **Detecção de camadas** (`src/utils/layers.js`) em três estratégias:
  - **nome** — prefixo antes do primeiro separador (`Parede_Externa_01` →
    `Parede`), descartando sufixos numéricos;
  - **material** — funciona sempre, e em arquitetura o material quase
    sempre corresponde a um sistema construtivo;
  - **hierarquia** — quando o arquivo já veio agrupado.
- **Sugestão automática de estratégia**: compara as três e recomenda a que
  separa melhor, descartando as que não separam (1 camada) e as que
  estilhaçam (quase uma camada por malha).
- **Organizar em camadas** reescreve a hierarquia de verdade — árvore,
  exportação e editor de blocos passam a enxergar as camadas como
  estrutura, não como rótulo.
- Lista de camadas com contagem de triângulos, ocultar e isolar por camada.
- 23 testes novos. Total: **205**.

### Notas

- Tudo passa pelo histórico: `Ctrl+Z` reverte a divisão e a organização,
  devolvendo as malhas ao pai e ao índice originais.
- As partes herdam material, transformação e flags de sombra da malha de
  origem.

---

## [2.7.0] — 2026-08-09

Texturização de modelos que chegaram sem textura.

### Contexto

Avaliei o [Hi3D](https://www.hi3d.ai) a pedido. O painel "Textura estilizada"
recebe modelo + imagens de referência e usa **difusão em GPU** para gerar
textura multi-vista e projetá-la nas UVs — cobra 15 créditos por geração.
Essa parte **não é replicável** em WAMP local: exige GPU dedicada e minutos
de processamento por modelo. Não faz sentido prometer o contrário.

O que dá para fazer no browser é o outro lado do problema, e é justamente o
que aparece na prática: **aplicar textura em modelos que chegaram sem ela** —
porque o `.dae` veio sem a pasta de imagens, ou porque o exportador não
gravou UVs.

### Adicionado

- **Projeção triplanar** (`src/utils/texturing.js`) — o recurso central.
  Injeta GLSL no `MeshStandardMaterial` via `onBeforeCompile`: a textura é
  amostrada nas três projeções do espaço de mundo (XY, YZ, XZ) e as
  amostras são misturadas por peso na normal. **Dispensa UV por completo**
  e não deixa costura. É o único caminho quando o modelo não tem `uv`,
  situação corriqueira em exportações de Revit e SketchUp — e é a limitação
  que o Hi3D tem, já que ele exige UVs.
- **Geração de UV** em quatro projeções: planar (planta), cúbica,
  cilíndrica e esférica. A escala deriva do tamanho **real de cada malha em
  metros**, não do bounding box normalizado — sem isso uma parede de 10 m e
  um pilar de 0,3 m receberiam a mesma contagem de repetições e o ladrilho
  sairia com escalas diferentes entre as peças.
- **Diagnóstico de UV** no painel: quantas malhas têm mapeamento e qual a
  cobertura, com a recomendação de projeção correspondente.
- **Biblioteca de 12 materiais** de arquitetura com parâmetros PBR
  plausíveis: concreto, concreto aparente, madeira, madeira escura, aço
  escovado, alumínio, vidro, vidro fumê, pintura branca, pintura fosca,
  carpete e tijolo.
- **Texturas procedurais** geradas em canvas (ruído, veio de madeira, metal
  escovado, fiada de tijolo). Procedurais em vez de arquivos de imagem por
  dois motivos: não somam megabytes ao bundle e funcionam offline.
- **Envio de imagem própria** por clique ou arrastar, com controle de
  escala do ladrilho em metros, ajustável ao vivo.
- 25 testes novos. Total: **182**.

### Notas

- A aplicação de material e de textura passa pelo histórico — `Ctrl+Z`
  reverte.
- Aplicar um preset colapsa as malhas do alvo em **um material
  compartilhado**: menos draw calls e um único ponto de ajuste no painel PBR.

---

## [2.6.0] — 2026-08-09

Modal de exportação com nome de arquivo editável.

### Adicionado

- **Diálogo antes de salvar** (`src/ui/exportDialog.js`). Antes o clique em
  "Export GLB" baixava na hora, com o nome derivado do modelo e sem chance
  de conferir nada. Agora abre um modal com:
  - **nome do arquivo editável**, já selecionado para digitar por cima, com
    a extensão fixa ao lado do campo;
  - **seletor de formato** com a descrição de cada um (GLB binário, glTF
    JSON, OBJ sem texturas, STL só malha, PLY com cores por vértice);
  - **resumo do que será salvo** — triângulos e malhas, mais o aviso de
    quantos blocos ocultos serão omitidos e, no preset por engine, qual o
    motor de destino.
- **Validação de nome de arquivo em tempo real**, com o botão Salvar
  desabilitado enquanto houver problema. Cobre os caracteres recusados por
  Windows e Linux (`< > : " / \ | ? *`), caracteres de controle, nomes
  reservados do Windows (`CON`, `NUL`, `LPT1`…) e comprimento máximo.
- `Enter` salva, `Esc` cancela, `Tab` circula dentro do diálogo e o foco
  volta ao botão de origem ao fechar.
- 17 testes novos para `sanitizeFileName` e `validateFileName`, incluindo a
  garantia de que todo nome saneado passa na validação. Total: **157**.

### Modificado

- Os dois caminhos de exportação — o botão principal e o preset por engine —
  passam pelo mesmo diálogo. No preset, o sufixo da engine
  (`_unreal`, `_unity`) entra como sugestão, mas pode ser removido.
- O formato escolhido no modal sincroniza com o seletor da barra lateral.

### Corrigido

- **Latência de um quadro ao voltar para a aba.** O loop de render pula o
  desenho com `document.hidden` para poupar GPU (A16); se o modelo mudasse
  nesse intervalo, o canvas mostrava o quadro antigo até o próximo tick.
  Agora um listener de `visibilitychange` força o redesenho na volta.

---

## [2.5.0] — 2026-08-09

Controles de zoom e barra de ferramentas em ícones.

### Adicionado

- **Grupo de zoom na barra**: lupa − (afastar), lupa + (aproximar),
  **enquadrar todo o ambiente**, **enquadrar a seleção** e **zoom por área**.
- **Zoom por área (janela livre)** — o "zoom janela" do AutoCAD/Revit:
  ative pelo botão ou pela tecla `A` e arraste um retângulo sobre a região
  que quer ampliar. Resolve o caso de inspecionar um detalhe no meio da
  cena, em que enquadrar tudo é grosseiro demais e a lupa aproxima pelo
  centro, não por onde interessa.
  - O novo alvo vem de um **raycast no centro do retângulo**: havendo
    geometria sob a área, a câmera foca nela; sem acerto, cai no plano
    perpendicular que passa pelo alvo atual.
  - A distância é reduzida pela **fração da tela** que o retângulo ocupa —
    um retângulo de metade da largura aproxima 2×.
  - Enquanto o modo está ativo o orbit é desligado, o cursor vira mira e o
    botão fica destacado. `Esc` cancela, e um clique sem arrasto sai do modo
    sem mexer na câmera.
- **Indicador de zoom** na barra de status, em percentual, onde 100%
  significa "o modelo inteiro cabe na tela". Acompanha também o scroll do
  mouse e o arrasto do orbit, com atualização agendada por `requestAnimationFrame`
  para não recalcular várias vezes no mesmo quadro.
- **Duplo clique na viewport** enquadra o objeto sob o cursor, ou a cena
  inteira se nada estiver selecionado.
- Atalhos `+` / `−` (aceitando também `=` e `_`, para o teclado ABNT),
  `F` (enquadrar tudo) e `Shift+F` (enquadrar a seleção).
- **Limites de zoom proporcionais ao modelo**: `minDistance` e `maxDistance`
  do orbit passam a derivar do tamanho da cena. Sem isso, o scroll
  atravessava modelos pequenos e mal se movia em cenas grandes.

### Modificado

- **`ISO`, `TOP`, `FRONT` e `SIDE` viraram ícones.** Cada um mostra qual
  face do cubo está sendo olhada: cubo em perspectiva (isométrica),
  retângulo com borda superior (planta), quadrado cheio (elevação frontal)
  e retângulo com borda lateral. Nome completo e atalho ficam no tooltip e
  no `aria-label`.
- Tooltips da barra traduzidos e com o atalho de teclado junto.
- O enquadramento passou a considerar o **FOV horizontal** além do vertical:
  um estande largo e baixo precisa de mais recuo do que a altura sozinha
  sugere, e antes ficava com as pontas cortadas.

### Corrigido

- O indicador de zoom marcava **155% logo após enquadrar**, porque
  `frameObject` e `zoomPercent` calculavam a distância por fórmulas
  diferentes. Agora ambos usam o mesmo `#fitDistance()` — enquadrar dá
  exatamente 100%.

---

## [2.4.0] — 2026-08-09

Editor de blocos: escolher o que vai para a exportação.

### Adicionado

- **Ocultar blocos pela árvore.** Cada nó ganhou um botão de olho. O que
  está oculto aparece riscado e esmaecido, e **não entra no arquivo
  exportado**.
- **Excluir blocos** (`Delete`), com reposição na posição exata da
  hierarquia ao desfazer — não no fim da lista, como seria com um `add()`
  simples.
- **Isolar** (`I`): mostra apenas a seleção, escondendo o resto. Preserva os
  ancestrais visíveis, senão o próprio alvo desapareceria junto.
- **Mostrar tudo** (`Shift+H`) restaura a visibilidade da cena inteira.
- **Seleção múltipla** na árvore: `Ctrl+clique` acumula, `Shift+clique`
  seleciona o intervalo.
- **Ocultar por material** — o corte mais rápido em arquitetura: esconder
  tudo que usa "Vegetação" de uma vez, em vez de caçar cada arbusto na
  árvore. A lista vem ordenada por peso, com amostra de cor e contagem.
- **Contagem de triângulos por nó** na árvore (`85,4k`), memorizada para não
  recalcular a cada scroll.
- **Resumo de exportação** em tempo real: quantos triângulos serão
  exportados e quantos estão ocultos.
- Atalhos `H` (ocultar), `Shift+H` (mostrar tudo), `I` (isolar) e `Delete`.
- 25 testes novos. Total: **140**.

### Modificado

- **A exportação passou a respeitar a visibilidade em todos os formatos.**
  O `GLTFExporter` tem a opção `onlyVisible`, mas OBJ, STL e PLY não — sem
  a poda de `pruneInvisible()`, ocultar um bloco não teria efeito nesses
  formatos. A poda roda sobre a cópia exportada, nunca sobre o modelo da
  viewport.
- O toast de exportação informa quantos blocos ocultos foram omitidos e
  quantos triângulos isso economizou.

### Corrigido

- Os modelos de exemplo entravam por um caminho próprio que não atualizava
  os painéis dependentes do modelo nem limpava o histórico.

---

## [2.3.1] — 2026-08-09

Correção da exportação com texturas ausentes. Diagnosticado com o arquivo
`BRASMIM.dae` (estande GEOSOL, 85,4 mil triângulos) exportado do Lumion.

### Corrigido

- **Exportação abortava com "No valid image data found. Unable to process
  texture."** Quando o `.dae` é importado sem a pasta de texturas ao lado, o
  ColladaLoader ainda cria os objetos `THREE.Texture` e os materiais mantêm a
  referência — mas `texture.image` fica indefinido. O modelo abre normalmente
  (sem textura), e só na exportação o `GLTFExporter` tenta serializar a imagem
  e falha. Agora `sanitizeForExport()` remove as referências quebradas da
  cópia exportada, clonando os materiais afetados para não alterar o modelo
  que está na viewport.
- **Ícones invisíveis após o deploy.** O mapa de ícones foi gerado com chaves
  em kebab-case (`'arrow-right'`), mas o `createIcons` do Lucide converte o
  atributo para PascalCase e procura `icons.ArrowRight`. Falhava em silêncio —
  só um warning no console e todos os ícones sumiam.
- **`.htaccess` servia o `index.html` de desenvolvimento.** A regra final de
  roteamento tinha a condição `!-d`, mas a raiz do projeto é um diretório, então
  a requisição escapava do rewrite e caía no `DirectoryIndex`. Resultado: o
  Apache entregava o arquivo que referencia `src/main.js` (só funciona sob o
  Vite) e a página abria sem JavaScript. Corrigido com `DirectoryIndex disabled`
  e uma regra explícita para a raiz.

### Adicionado

- Mensagens de erro de exportação acionáveis: textura sem imagem e memória
  insuficiente passam a explicar a causa e sugerir o caminho (reimportar com a
  pasta, exportar em OBJ, otimizar antes, ou usar a API).
- Aviso no toast de exportação quando texturas foram omitidas.
- 13 testes novos para `hasImageData` e `sanitizeForExport`. Total: **115**.

---

## [2.3.0] — 2026-08-09

Correção de importação de arquivos de Lumion, SketchUp e Revit.

### Corrigido

- **DAE abrindo transparente.** SketchUp e Lumion escrevem
  `<transparency>0</transparency>` com `opaque="A_ONE"` querendo dizer
  "sem transparência", mas pela fórmula da spec do COLLADA isso resulta em
  `opacity = alpha × transparency = 0` — o modelo inteiro fica invisível.
  O novo `src/utils/materialRepair.js` detecta opacidade praticamente zero
  sem mapa de alpha e trata como opaco, preservando vidro legítimo
  (opacidade entre 0,02 e 1) e sem tocar em arquivos glTF, onde a semântica
  de alpha é bem definida.
- **Modelo "vazado" por dentro.** Arquitetura é modelada com superfícies de
  espessura zero; com backface culling, olhar a parede por dentro atravessa
  o modelo. `DoubleSide` voltou a ser aplicado em DAE, FBX, OBJ e glTF —
  havia sido perdido na reescrita da v2.0. STL e PLY, que são sólidos
  fechados, seguem com face única.
- **Materiais chapados.** ColladaLoader e OBJLoader produzem
  `MeshPhongMaterial`, que ignora o environment map PBR da cena. Agora são
  convertidos para `MeshStandardMaterial`, mapeando `shininess` para
  `roughness` e preservando texturas e mapas.
- **Texturas lavadas.** Mapas de cor sem `SRGBColorSpace` renderizam claros
  demais sob tone mapping ACES. Corrigido nos slots de cor; normal, rough e
  AO seguem lineares, como devem.
- **Texturas esticadas.** `RepeatWrapping` habilitado para UVs fora de
  [0,1], usadas para ladrilhar pisos e fachadas.

### Adicionado

- **Orientação para formatos proprietários** (`src/utils/formatAdvice.js`).
  `.rvt`, `.rfa`, `.skp`, `.max`, `.ls`, `.pln`, `.dwg`, `.3dm`, `.blend`,
  `.ifc` e `.3mf` não têm leitor público — nenhuma quantidade de código
  resolveria. Em vez de "formato não suportado", cada um mostra um painel
  com o motivo e o passo a passo de exportação do seu software.
- **Diagnóstico pós-importação**: relata quantos materiais foram
  consertados e avisa quando nenhuma malha tem UV ou nenhum material tem
  textura (sinal de que o usuário arrastou só o arquivo, sem a pasta).
- **Botão "Forçar materiais opacos"** como rede de segurança, reversível
  com Ctrl+Z.
- 24 testes novos cobrindo o reparo de materiais. Total: **102**.

### Modificado

- Card do Revit passou a indicar FBX e DAE (antes sugeria `.ifc`, que não é
  suportado).
- Dica do Lumion corrigida: o Lumion **não exporta geometria**, é preciso
  voltar ao software de origem.

---

## [2.2.0] — 2026-08-09

Deploy automatizado e configuração de produção no Apache.

### Adicionado

- **`instalar.bat`** — instalação completa em um comando: dependências,
  chaves, `.env`, storage fora do webroot, banco, build e validação.
- **`bin/instalar.php`** — instalador idempotente que detecta o Node, o
  caminho público e o storage; faz backup antes de reescrever configuração.
- **`bin/validar.php`** — autodiagnóstico com ~45 verificações em 7 blocos.
  Converte um cubo de verdade pelo pipeline, testa a rejeição de arquivos
  maliciosos e checa se o SQLite está exposto por HTTP.
- **`.htaccess` de produção** — roteamento para `dist/`, bloqueio de
  código-fonte e configuração, MIME types 3D (`.glb`, `.wasm`, `.ktx2`),
  compressão, cache imutável para assets com hash e CSP com
  `wasm-unsafe-eval` para os decodificadores.
- **Worker como tarefa agendada** — `bin/windows/worker-instalar.bat`,
  `worker-status.bat` e `worker-remover.bat`.
- **VirtualHost de exemplo** com variante HTTPS, em `docs/apache/`.
- **`docs/DEPLOY.md`** e **`docs/VALIDACAO.md`** com checklist de produção.
- `health.php` passou a reportar os módulos do Apache (`mod_rewrite`,
  `mod_headers`, `mod_deflate`, `mod_expires`) e avisar sobre os ausentes.

---

## [2.1.0] — 2026-08-09

Fases 4 e 5 do plano de estabilização: performance, escala e maturidade de produto.

### Adicionado

- **Parsing em Web Worker** (`src/workers/parser.worker.js`) para OBJ, STL e PLY
  acima de 512 KB. Progresso real e botão Cancelar funcional — antes um arquivo
  de 200 MB congelava a aba sem feedback nem escape.
- **Otimização de malha no browser** (`src/utils/optimizer.js`) com quatro perfis
  (`none`, `balanced`, `aggressive`, `extreme`), previsão antes/depois e
  soldagem que preserva arestas vivas.
- **Geração de LOD** com três níveis (100%, 50%, 12,5%) e distâncias derivadas
  do tamanho do modelo.
- **Presets de exportação por engine** (`src/utils/enginePresets.js`): Unity,
  Unreal, Three.js/WebXR, Godot, Blender e glTF padrão, combinados com a unidade
  e o eixo vertical do arquivo de origem.
- **Undo/redo** com command pattern (`src/utils/history.js`), fusão de comandos
  contíguos e atalhos Ctrl+Z / Ctrl+Y.
- **Colisores convexos** (convex hull) além de box e sphere, com exportação
  em JSON para consumo em Unity/Unreal.
- **KTX2Loader** no viewer, para abrir GLBs com textura comprimida.
- **Atalhos de teclado** completos e listagem com `?`.
- **Testes E2E** com Playwright cobrindo importar → editar → desfazer → exportar.
- Mais 35 testes unitários (histórico e presets de engine). Total: **78**.

### Modificado

- **Árvore de hierarquia virtualizada** (`src/ui/hierarchyTree.js`): apenas a
  janela visível existe no DOM. Uma cena com 30 mil nós mantém ~40 elementos,
  contra 30 mil na v2.0. Inclui papéis ARIA e navegação por teclado.
- **Ícones Lucide** importados do npm com tree-shaking (33 ícones), no lugar da
  CDN `unpkg@latest`. O chunk `vendor` caiu de **695 KB para 93 KB**.
- **Frustum culling e ordenação por material** aplicados a todo modelo carregado.
- **Modais acessíveis**: foco preso, `aria-hidden` sincronizado e devolução do
  foco ao elemento de origem.
- Overlay de progresso substitui o spinner indeterminado.

### Corrigido

- Alterações de material passaram a ser registradas no `change`, não no `input`
  — arrastar um slider deixou de gerar centenas de entradas de histórico.
- `dispose.js` deixou de ser importado dinamicamente e estaticamente ao mesmo
  tempo, eliminando o aviso de chunk do Vite.

---

## [2.0.0] — 2026-08-08

Reescrita a partir da auditoria técnica ([`AUDITORIA.md`](AUDITORIA.md)).

### Adicionado

- **Pipeline de conversão real** (`bin/lib/`) com `gltf-transform`: dedup, weld,
  prune, join, simplify e compressão Draco. A v1 era um stub que imprimia
  `"COMPLETED"` sem gerar arquivo algum.
- **Fila assíncrona** com persistência SQLite e worker (`bin/worker.php`), com
  reserva atômica de jobs.
- **Camada de segurança**: API key com `hash_equals`, CORS por allowlist, rate
  limiting por chave e IP, validação de upload por magic bytes, storage fora do
  webroot, downloads mediados por PHP e escopo por dono.
- **SDK PHP v2** com retry exponencial, polling de jobs, download para disco e
  exceções tipadas com mensagem pronta para o usuário final.
- Módulo de integração com a plataforma de origem do Convert3D (removido no
  SCC Builder 0.1.0).
- Endpoints `health.php`, `jobs.php` e `download.php`.
- Logs estruturados em JSONL com `request_id` correlacionável.
- Git, ESLint, Prettier, Vitest e licença MIT.

### Corrigido

- **Soldagem de vértices**: normais por face impediam o `weld` (medido: 97.200
  cantos viravam 95.714 vértices, ~0% de fusão), o que tornava `simplify` e
  Draco inertes. A correção — mesclar por posição e recalcular normais com
  ângulo de quebra — preserva arestas vivas e habilita a otimização de fato.
  Resultado: OBJ de 1,08 MB → GLB de 39 KB (96,4% menor).
- **Pivot** (`centerAndScaleModel`): a matemática só funcionava com posição zero;
  cliques repetidos faziam o modelo derivar pela cena.
- **Vazamento de VRAM**: geometrias, materiais e texturas nunca eram liberados.
- **Modo raio-X irreversível**: `opacity` e `transparent` eram mutados sem
  guardar o estado anterior.
- **Materiais em array** (multi-material de Revit/3ds Max) lançavam `TypeError`
  e derrubavam o painel PBR.
- **Assets externos**: `.mtl`, `.bin` e texturas passaram a ser resolvidos via
  `LoadingManager`; antes todo OBJ abria cinza.
- **Volume e área**: substituída a estimativa `bbox × 0,75` por soma de
  tetraedros com sinal, com detecção de malha estanque.
- **Slicer**: os planos de corte passaram a ser normalizados pela bounding box.
- **XSS** via nome de arquivo em `innerHTML`.
- URL da API deixou de ser fixa em `/convert3d/`.

### Removido

- **IFC e 3MF** da lista de formatos suportados. Estavam documentados e aceitos
  no upload, mas nenhum loader existia — a conversão falhava silenciosamente.
  Para BIM, exporte do Revit como FBX ou DAE.
- Exclusão de arquivos por nome na API (só por `job_id`, com verificação de dono).

### Segurança

- API totalmente aberta (CORS `*`, sem autenticação) permitia upload de 500 MB
  e exclusão de qualquer arquivo por qualquer origem.
- Diretório de upload criado com permissão `0777` dentro do webroot.
- `@exec` silenciava falhas do conversor sem qualquer log.

---

## [1.0.0] — 2026-08-08

Versão inicial: editor 3D no browser, API REST PHP e SDK.
