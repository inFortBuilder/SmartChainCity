/**
 * Dicionário en do editor: texto em português => tradução.
 *
 * A chave é o texto exatamente como está no t('…') ou no data-t* do
 * index.html. Texto novo na tela entra aqui e no outro dicionário; o
 * tests/traducao.test.js reprova chave sem tradução.
 */
export default {
  '"^1" é um nome reservado pelo Windows.': '"^1" is a name reserved by Windows.',
  '.^1 é um arquivo do ^2': '.^1 is a ^2 file',
  '3ds Max: File → Export → FBX (marque "Embed Media" para incluir texturas)':
    '3ds Max: File → Export → FBX (check "Embed Media" to include textures)',
  '<strong>Exportação bloqueada por textura sem imagem</strong><br>Um ou mais materiais apontam para arquivos de textura que não foram carregados.<br><br><strong>Como resolver:</strong><br>1. Reimporte arrastando a <strong>pasta inteira</strong> do modelo, com as imagens;<br>2. ou exporte em <strong>OBJ</strong>, que não embute texturas.':
    "<strong>Export blocked by a texture without an image</strong><br>One or more materials point to texture files that were not loaded.<br><br><strong>How to fix:</strong><br>1. Re-import by dragging the model's <strong>whole folder</strong>, images included;<br>2. or export as <strong>OBJ</strong>, which does not embed textures.",
  '<strong>Memória insuficiente para exportar</strong><br>O modelo é grande demais para ser serializado de uma vez.<br><br>Use o painel <strong>Otimização</strong> com o perfil "Agressiva" antes de exportar, ou envie o arquivo pela API (PHP API &amp; SDK), que processa no servidor sem o limite do browser.':
    '<strong>Not enough memory to export</strong><br>The model is too large to be serialized at once.<br><br>Use the <strong>Optimization</strong> panel with the "Aggressive" profile before exporting, or send the file through the API (PHP API &amp; SDK), which processes it on the server without the browser limit.',
  'A API respondeu com conteúdo não-JSON (HTTP ^1).':
    'The API responded with non-JSON content (HTTP ^1).',
  'A cena já está organizada em ^1 camada(s). Use Ctrl+Z para desfazer antes de reorganizar.':
    'The scene is already organized in ^1 layer(s). Use Ctrl+Z to undo before reorganizing.',
  'A conversão falhou.': 'The conversion failed.',
  'A malha "^1" não possui atributo de posição.': 'Mesh "^1" has no position attribute.',
  'A malha não tem grupos de material para separar.':
    'The mesh has no material groups to separate.',
  'A malha tem ^1 triângulos — acima do limite de ^2 para divisão por conectividade. Simplifique antes, ou use a divisão por fatias.':
    'The mesh has ^1 triangles — above the ^2 limit for splitting by connectivity. Simplify it first, or split by slices.',
  'A malha é uma peça única — não há ilhas de geometria para separar.':
    'The mesh is a single piece — there are no geometry islands to separate.',
  'A previsão está disponível para a divisão por peças soltas.':
    'The preview is available for splitting into loose parts.',
  'A requisição excedeu o tempo limite.': 'The request timed out.',
  'API PHP e SDK': 'PHP API & SDK',
  'API REST em PHP e SDK cliente': 'PHP REST API & client SDK',
  'API respondeu com sucesso!': 'The API responded successfully!',
  'Abra a cena no 3ds Max': 'Open the scene in 3ds Max',
  'Abra a família no Revit': 'Open the family in Revit',
  'Abra no Blender': 'Open it in Blender',
  'Abra no Rhino': 'Open it in Rhino',
  'Abra o desenho no AutoCAD': 'Open the drawing in AutoCAD',
  'Abra o modelo no SketchUp': 'Open the model in SketchUp',
  'Abra o projeto no ArchiCAD': 'Open the project in ArchiCAD',
  'Abra o projeto no Revit': 'Open the project in Revit',
  Afastar: 'Zoom out',
  'Afastar (tecla −)': 'Zoom out (− key)',
  'Agressiva — 50% dos triângulos': 'Aggressive — 50% of the triangles',
  'Agrupar camadas por': 'Group layers by',
  'Alterar material (^1)': 'Change material (^1)',
  'Alternar corte transversal': 'Toggle cross-section',
  'Alternar wireframe': 'Toggle wireframe',
  Alumínio: 'Aluminum',
  'Alumínio (2,70 g/cm³)': 'Aluminum (2.70 g/cm³)',
  'Ambiente enquadrado.': 'Scene framed.',
  'Analisando a geometria...': 'Analyzing the geometry...',
  'Aplicando ^1...': 'Applying ^1...',
  Aplicar: 'Apply',
  'Aplicar ^1 (^2 malhas)': 'Apply ^1 (^2 meshes)',
  'Aplicar ao selecionado': 'Apply to selection',
  Aproximar: 'Zoom in',
  'Aproximar (tecla +)': 'Zoom in (+ key)',
  'Aproximar / afastar': 'Zoom in / out',
  'Arquivo exportado: ^1': 'File exported: ^1',
  'Arquivo → Exportar Selecionados': 'File → Export Selected',
  'Arquivo → Exportar → CAD Formats → FBX': 'File → Export → CAD Formats → FBX',
  'Arquivo → Exportar → Exportar': 'File → Export → Export',
  'Arquivo → Exportar → Modelo 3D': 'File → Export → 3D Model',
  'Arquivo → Salvar como → Collada (.dae) ou Wavefront (.obj)':
    'File → Save As → Collada (.dae) or Wavefront (.obj)',
  'Arranha-céu': 'Skyscraper',
  'Arraste o arquivo aqui': 'Drag the file here',
  'Arraste ou clique para enviar': 'Drag or click to upload',
  'Arraste um arquivo DAE ou OBJ exportado do SketchUp':
    'Drag a DAE or OBJ file exported from SketchUp',
  'Arraste um arquivo FBX ou DAE exportado do Lumion':
    'Drag an FBX or DAE file exported from Lumion',
  'Arraste um arquivo FBX ou DAE exportado do Revit': 'Drag an FBX or DAE file exported from Revit',
  'Arraste um arquivo FBX ou OBJ exportado do 3ds Max':
    'Drag an FBX or OBJ file exported from 3ds Max',
  'As malhas não têm coordenadas UV — texturas não podem ser aplicadas. Reexporte marcando a opção de exportar mapeamento de textura.':
    'The meshes have no UV coordinates — textures cannot be applied. Re-export with the texture mapping option checked.',
  Atalhos: 'Shortcuts',
  'Atalhos (?)': 'Shortcuts (?)',
  'Atalhos de teclado': 'Keyboard shortcuts',
  Atenção: 'Warning',
  'Ative uma vista 3D': 'Activate a 3D view',
  'Aço escovado': 'Brushed steel',
  'Aço estrutural (7,85 g/cm³)': 'Structural steel (7.85 g/cm³)',
  'Baixar arquivo convertido': 'Download converted file',
  'Balanceada — soldar vértices': 'Balanced — weld vertices',
  'Base para todos os demais presets.': 'Base for all the other presets.',
  'Bem-vindo ao SCC Builder! Selecione um software de origem ou carregue um modelo de exemplo.':
    'Welcome to SCC Builder! Pick a source software or load a sample model.',
  'Biblioteca de materiais': 'Material library',
  'Blocos da cena': 'Scene blocks',
  'Box — mais barato em runtime': 'Box — cheapest at runtime',
  'Camada ^1 isolada.': 'Layer ^1 isolated.',
  'Camadas e blocos': 'Layers and blocks',
  Cancelar: 'Cancel',
  Carpete: 'Carpet',
  'Carregamento cancelado pelo usuário.': 'Loading cancelled by the user.',
  'Carregamento cancelado.': 'Loading cancelled.',
  'Carregando ^1': 'Loading ^1',
  'Carregue um modelo para detectar camadas.': 'Load a model to detect layers.',
  'Carregue um modelo para ver o estado das UVs.': 'Load a model to see the state of its UVs.',
  'Carregue um modelo primeiro.': 'Load a model first.',
  'Casa arquitetônica moderna': 'Modern architectural house',
  'Cena reorganizada em <strong>^1 camadas</strong>. A árvore e a exportação passam a enxergar essa estrutura.':
    'Scene reorganized into <strong>^1 layers</strong>. The tree and the export now see this structure.',
  'Centralizar pivot e alinhar ao chão': 'Center pivot and align to ground',
  Centímetros: 'Centimeters',
  'Clique no <span style="color:var(--accent-cyan)">◉</span> para ocultar um bloco. Ctrl+clique seleciona vários.':
    'Click the <span style="color:var(--accent-cyan)">◉</span> to hide a block. Ctrl+click selects several.',
  'Comando EXPORTAR → escolha FBX': 'EXPORT command → choose FBX',
  'Como exportar do software de arquitetura': 'How to export from architecture software',
  'Como o Unreal é Z-up, a correção de eixo NÃO é aplicada.':
    'Since Unreal is Z-up, the axis correction is NOT applied.',
  'Como resolver — exporte como ^1:': 'How to fix — export as ^1:',
  Concreto: 'Concrete',
  'Concreto aparente': 'Exposed concrete',
  'SCC Builder — conversor de projetos 3D arquitetônicos e estúdio GLB':
    'SCC Builder — architectural 3D project converter and GLB studio',
  'Convertendo ^1 arquivo(s)...': 'Converting ^1 file(s)...',
  'Convertendo ^1/^2: ^3': 'Converting ^1/^2: ^3',
  'Converter Y-up para Z-up': 'Convert Y-up to Z-up',
  'Converter Z-up para Y-up (CAD / Revit para game)': 'Convert Z-up to Y-up (CAD / Revit to game)',
  'Convex Hull — preciso, para corpos dinâmicos': 'Convex Hull — precise, for dynamic bodies',
  'Copie api/config.local.example.php para api/config.local.php e gere uma chave.':
    'Copy api/config.local.example.php to api/config.local.php and generate a key.',
  'Cor base (albedo)': 'Base color (albedo)',
  'Corte no eixo X': 'X-axis cut',
  'Corte no eixo Y': 'Y-axis cut',
  'Corte no eixo Z': 'Z-axis cut',
  'Corte transversal': 'Cross-section',
  'DIMENSÕES:': 'BOUNDS:',
  'Da arquitetura ao GLB para games': 'From architecture to game-ready GLB',
  'Abra o editor pelo jogo (link com #token=) ou, em desenvolvimento, defina VITE_SCC_TOKEN ou VITE_API_KEY no .env.':
    'Open the editor from the game (link with #token=) or, in development, set VITE_SCC_TOKEN or VITE_API_KEY in .env.',
  'Defina uma vista 3D (o export usa a vista ativa)':
    'Set up a 3D view (the export uses the active view)',
  'Densidade do material': 'Material density',
  'Desativar gizmo': 'Turn off gizmo',
  Desfazer: 'Undo',
  'Desfazer (Ctrl+Z)': 'Undo (Ctrl+Z)',
  'Desfazer: ^1 (Ctrl+Z)': 'Undo: ^1 (Ctrl+Z)',
  'Desfeito: ^1': 'Undone: ^1',
  'Destino (engine)': 'Target (engine)',
  'Destino: ^1': 'Target: ^1',
  'Dica: ^1': 'Tip: ^1',
  'Dividindo a malha...': 'Splitting the mesh...',
  Dividir: 'Split',
  'Dividir ^1 em ^2 partes': 'Split ^1 into ^2 parts',
  'Dividir bloco selecionado': 'Split selected block',
  'Dividir geraria muitos objetos — a árvore ficaria difícil de navegar.':
    'Splitting would create too many objects — the tree would be hard to navigate.',
  'Editor de material PBR': 'PBR material editor',
  'Eixo X': 'X axis',
  'Eixo Y (altura)': 'Y axis (height)',
  'Eixo Z': 'Z axis',
  'Eixo convertido: ^1': 'Axis converted: ^1',
  'Eixo vertical da origem': 'Source up axis',
  'Em Import Settings, desmarque "Convert Scene Unit".':
    'In Import Settings, uncheck "Convert Scene Unit".',
  'Em Opções, marque "Embed Media" para incluir as texturas no arquivo':
    'In Options, check "Embed Media" to include the textures in the file',
  'Em Opções, marque "Exportar mapas de textura"': 'In Options, check "Export Texture Maps"',
  'Engrenagem mecânica': 'Mechanical gear',
  'Enquadrado: ^1': 'Framed: ^1',
  'Enquadrar a seleção': 'Frame selection',
  'Enquadrar a seleção (Shift+F)': 'Frame selection (Shift+F)',
  'Enquadrar o ambiente': 'Frame the scene',
  'Enquadrar o ambiente / a seleção': 'Frame the scene / the selection',
  'Enquadrar todo o ambiente (F)': 'Frame the whole scene (F)',
  Entendi: 'Got it',
  'Enviando ^1 para ^2 ...': 'Sending ^1 to ^2 ...',
  'Enviar e converter': 'Upload and convert',
  'Erro ao carregar ^1: ^2': 'Error loading ^1: ^2',
  'Erro na conversão em lote: ^1': 'Batch conversion error: ^1',
  'Erro na exportação: ^1': 'Export error: ^1',
  'Escala da textura:': 'Texture scale:',
  Escalar: 'Scale',
  'Escalar (R)': 'Scale (R)',
  'Escolha Autodesk (*.FBX)': 'Choose Autodesk (*.FBX)',
  'Escolha Collada (.dae)': 'Choose Collada (.dae)',
  'Escolha OBJ ou FBX e aceite as opções de malha': 'Choose OBJ or FBX and accept the mesh options',
  'Escolha o formato GLB (binário) — já sai com as texturas embutidas':
    'Choose the GLB (binary) format — textures come embedded',
  'Esta lista': 'This list',
  'Estimativa conservadora — o ganho real costuma ser maior.':
    'Conservative estimate — the real gain is usually larger.',
  'Estimativa de massa': 'Mass estimate',
  'Evite os caracteres < > : " / \\ | ? * e caracteres de controle.':
    'Avoid the characters < > : " / \\ | ? * and control characters.',
  'Excluir ^1': 'Delete ^1',
  'Excluir os blocos selecionados (tecla Delete) — reversível com Ctrl+Z':
    'Delete the selected blocks (Delete key) — reversible with Ctrl+Z',
  'Excluir selecionados': 'Delete selected',
  'Exemplo de integração com o SDK PHP': 'PHP SDK integration example',
  'Exportado para ^1': 'Exported for ^1',
  'Exportando como .^1...': 'Exporting as .^1...',
  'Exportando para ^1...': 'Exporting for ^1...',
  'Exportar GLB': 'Export GLB',
  'Exportar colisores (JSON)': 'Export colliders (JSON)',
  'Exportar com preset': 'Export with preset',
  'Exportar modelo': 'Export model',
  'Exportar todos em ZIP': 'Export all to ZIP',
  'Exportação rápida': 'Quick export',
  'Exporte de lá como FBX ou DAE': 'Export from there as FBX or DAE',
  'Exporte do software como <strong>FBX, DAE ou OBJ</strong> antes de importar':
    'Export from your software as <strong>FBX, DAE or OBJ</strong> before importing',
  'Exporte o projeto como <strong>FBX (.fbx)</strong> ou <strong>OBJ (.obj)</strong> com "Embed Media" marcado, ou instale o plugin oficial Babylon.js / glTF Exporter para exportar .glb direto.':
    'Export the project as <strong>FBX (.fbx)</strong> or <strong>OBJ (.obj)</strong> with "Embed Media" checked, or install the official Babylon.js / glTF Exporter plugin to export .glb directly.',
  'Extrema — 25% dos triângulos': 'Extreme — 25% of the triangles',
  'Falha ao aplicar a textura: ^1': 'Failed to apply the texture: ^1',
  'Falha ao conectar com a API PHP. Verifique o WAMP.':
    'Failed to connect to the PHP API. Check WAMP.',
  'Falha ao dividir: ^1': 'Failed to split: ^1',
  'Falha ao gerar LOD: ^1': 'Failed to generate LOD: ^1',
  'Falha ao gerar colisores: ^1': 'Failed to generate colliders: ^1',
  'Falha de rede ao enviar o arquivo.': 'Network failure while sending the file.',
  'Falha na otimização: ^1': 'Optimization failed: ^1',
  'Falha no worker de parsing.': 'The parsing worker failed.',
  'Fatias por eixo': 'Slices along an axis',
  Fechar: 'Close',
  'Fechar modais / cancelar': 'Close dialogs / cancel',
  'Ferramentas para game engine': 'Game engine tools',
  'Filamento ABS (1,04 g/cm³)': 'ABS filament (1.04 g/cm³)',
  'Filamento PLA (1,24 g/cm³)': 'PLA filament (1.24 g/cm³)',
  'File → Export → 3D Model → escolha <strong>Collada (.dae)</strong> ou <strong>OBJ (.obj)</strong>. Marque "Export Texture Maps".':
    'File → Export → 3D Model → choose <strong>Collada (.dae)</strong> or <strong>OBJ (.obj)</strong>. Check "Export Texture Maps".',
  Formato: 'Format',
  'Formato ".^1" não suportado.': 'Format ".^1" is not supported.',
  'Formato ".^1" não suportado. Aceitos: ^2.': 'Format ".^1" is not supported. Accepted: ^2.',
  'Formato "^1" não suportado.': 'Format "^1" is not supported.',
  'Formato .^1 não suportado': 'Format .^1 is not supported',
  'Formato de destino': 'Target format',
  'Formato de exportação "^1" não suportado.': 'Export format "^1" is not supported.',
  'Formato não suportado': 'Unsupported format',
  'Formatos aceitos: GLB, GLTF, OBJ, STL, PLY, FBX e DAE.':
    'Accepted formats: GLB, GLTF, OBJ, STL, PLY, FBX and DAE.',
  'Forçar materiais opacos': 'Force opaque materials',
  'GLB (glTF binário — recomendado para games)': 'GLB (binary glTF — recommended for games)',
  'GLB do Blender é o melhor caminho: sai otimizado e com tudo embutido.':
    'GLB from Blender is the best route: it comes out optimized with everything embedded.',
  'GLB — binário, tudo em um arquivo (recomendado)':
    'GLB — binary, everything in one file (recommended)',
  'Gerando colisores (^1)...': 'Generating colliders (^1)...',
  'Gerando níveis de detalhe...': 'Generating levels of detail...',
  'Gerar LOD (3 níveis)': 'Generate LOD (3 levels)',
  'Gerar UV cilíndrica': 'Generate cylindrical UV',
  'Gerar UV cúbica': 'Generate box UV',
  'Gerar UV esférica': 'Generate spherical UV',
  'Gerar UV planar (planta)': 'Generate planar UV (plan)',
  'Gerar colisores': 'Generate colliders',
  'Gere colisores antes de exportar.': 'Generate colliders before exporting.',
  'Godot importa .glb nativamente; basta arrastar para o FileSystem.':
    'Godot imports .glb natively; just drag it into the FileSystem.',
  'Grupos de material': 'Material groups',
  'Guia de exportação': 'Export guide',
  'Hierarquia da cena': 'Scene hierarchy',
  'Hierarquia do arquivo': 'File hierarchy',
  'Imagem de textura': 'Texture image',
  'Importar projeto 3D': 'Import 3D project',
  'Importe com o glTFast ou o UnityGLTF.': 'Import with glTFast or UnityGLTF.',
  'Importe esse arquivo aqui': 'Import that file here',
  'Importe o .dae junto com a pasta de texturas que o SketchUp criar':
    'Import the .dae together with the texture folder SketchUp creates',
  'Importe o .fbx aqui': 'Import the .fbx here',
  'Importe o .glb aqui': 'Import the .glb here',
  'Importe o arquivo aqui': 'Import the file here',
  'Impressão 3D': '3D printing',
  'Informe um nome para o arquivo.': 'Enter a name for the file.',
  'Isolado. Use "Mostrar tudo" ou Ctrl+Z para voltar.':
    'Isolated. Use "Show all" or Ctrl+Z to go back.',
  Isolar: 'Isolate',
  'Isolar ^1': 'Isolate ^1',
  'Isolar a camada ^1': 'Isolate layer ^1',
  'Job ^1 enfileirado. Aguardando o worker...': 'Job ^1 queued. Waiting for the worker...',
  'LOD gerado com 3 níveis (100%, 50%, 12,5%). Objetos distantes passam a desenhar muito menos triângulos.':
    'LOD generated with 3 levels (100%, 50%, 12.5%). Distant objects now draw far fewer triangles.',
  'Limpar colisores': 'Clear colliders',
  'Lumion não exporta geometria. Volte ao Revit/SketchUp/ArchiCAD de origem e exporte de lá como FBX ou DAE (com texturas).':
    'Lumion does not export geometry. Go back to the source Revit/SketchUp/ArchiCAD and export from there as FBX or DAE (with textures).',
  Madeira: 'Wood',
  'Madeira escura': 'Dark wood',
  Malha: 'Mesh',
  'Malha dividida em <strong>^1 peça(s)</strong>. Agora cada uma pode ser ocultada, excluída ou texturizada em separado. Ctrl+Z desfaz.':
    'Mesh split into <strong>^1 part(s)</strong>. Each one can now be hidden, deleted or textured separately. Ctrl+Z undoes it.',
  'Malha grande demais (^1 triângulos) para a análise por conectividade. Otimize antes ou use fatias.':
    'Mesh too large (^1 triangles) for the connectivity analysis. Optimize it first or use slices.',
  'Malha não estanque (^1 arestas de borda) — volume não pode ser calculado com precisão.':
    'Mesh is not watertight (^1 border edges) — the volume cannot be calculated precisely.',
  'Manter a orientação original': 'Keep the original orientation',
  'Marque "Embed Media" e defina Units como Meters': 'Check "Embed Media" and set Units to Meters',
  'Massa estimada:': 'Estimated mass:',
  'Materiais ajustados': 'Materials adjusted',
  Material: 'Material',
  'Material não encontrado na biblioteca.': 'Material not found in the library.',
  Metros: 'Meters',
  'Metálico:': 'Metallic:',
  Milímetros: 'Millimeters',
  'Modelo carregado: ^1': 'Model loaded: ^1',
  'Modelo de exemplo carregado: ^1': 'Sample model loaded: ^1',
  'Modelos carregados': 'Loaded models',
  'Modo Shaded ativado': 'Shaded mode on',
  'Modo Wireframe ativado': 'Wireframe mode on',
  'Modo: ^1': 'Mode: ^1',
  Mostrar: 'Show',
  'Mostrar ^1': 'Show ^1',
  'Mostrar apenas a seleção (tecla I)': 'Show only the selection (I key)',
  'Mostrar camada ^1': 'Show layer ^1',
  'Mostrar material ^1': 'Show material ^1',
  'Mostrar os blocos selecionados': 'Show the selected blocks',
  'Mostrar tudo': 'Show all',
  'Motor de destino': 'Target engine',
  Mover: 'Move',
  'Mover (W)': 'Move (W)',
  'Mover / Rotacionar / Escalar': 'Move / Rotate / Scale',
  'Nada a desfazer': 'Nothing to undo',
  'Nada a refazer': 'Nothing to redo',
  'Nada selecionado para receber a textura.': 'Nothing selected to receive the texture.',
  'Nada selecionado para receber o material.': 'Nothing selected to receive the material.',
  'Nenhum arquivo carregado para conversão em lote.': 'No file loaded for batch conversion.',
  'Nenhum bloco selecionado — clique em um objeto na viewport ou na árvore.':
    'No block selected — click an object in the viewport or in the tree.',
  'Nenhum colisor gerado — verifique se o modelo tem malhas válidas.':
    'No collider generated — check that the model has valid meshes.',
  'Nenhum material na cena.': 'No materials in the scene.',
  'Nenhum material tem textura. Se o modelo deveria ter, arraste a pasta inteira (com as imagens) em vez de só o arquivo do modelo.':
    'No material has a texture. If the model should have them, drag the whole folder (with the images) instead of just the model file.',
  'Nenhum modelo 3D reconhecido nos arquivos selecionados.':
    'No 3D model recognized in the selected files.',
  'Nenhum modelo carregado para exportar.': 'No model loaded to export.',
  'Nenhum modelo carregado! Importe ou carregue um modelo de exemplo primeiro.':
    'No model loaded! Import or load a sample model first.',
  'Nenhum modelo carregado.': 'No model loaded.',
  Nenhuma: 'None',
  'Nenhuma camada detectada.': 'No layers detected.',
  'Nenhuma das ^1 malhas tem UV. Use a projeção triplanar, ou gere UVs pelo seletor abaixo.':
    'None of the ^1 meshes has UVs. Use the triplanar projection, or generate UVs with the selector below.',
  'Nenhuma malha na cena.': 'No meshes in the scene.',
  'No ArchiCAD: Salvar como → Collada (.dae)': 'In ArchiCAD: Save As → Collada (.dae)',
  'No Revit: Arquivo → Exportar → CAD Formats → FBX (em vez de IFC)':
    'In Revit: File → Export → CAD Formats → FBX (instead of IFC)',
  'No inspetor do modelo, mantenha Scale Factor = 1.':
    'In the model inspector, keep Scale Factor = 1.',
  'No seu fatiador ou CAD, exporte como STL ou OBJ': 'In your slicer or CAD, export as STL or OBJ',
  'Nome do arquivo': 'File name',
  'Nome do objeto (prefixo)': 'Object name (prefix)',
  'Normais de vértice recalculadas!': 'Vertex normals recalculated!',
  'Não foi possível conectar à API em ^1. Verifique se o servidor PHP está no ar.':
    'Could not connect to the API at ^1. Check that the PHP server is up.',
  'Não foi possível dividir esta malha.': 'This mesh could not be split.',
  'Não foi possível fatiar esta geometria.': 'This geometry could not be sliced.',
  'Não foi possível interpretar o arquivo "^1".': 'Could not parse the file "^1".',
  'Não é possível excluir a raiz do modelo.': 'The model root cannot be deleted.',
  Nível: 'Level',
  'Nível "^1" desconhecido.': 'Unknown level "^1".',
  'Nó toroidal': 'Torus knot',
  'O .3dm usa NURBS, que precisam ser trianguladas antes de renderizar.':
    '.3dm uses NURBS, which must be triangulated before rendering.',
  'O .3mf é um container ZIP com XML — suportá-lo exigiria um loader dedicado que ainda não temos.':
    '.3mf is a ZIP container with XML — supporting it would require a dedicated loader we do not have yet.',
  'O .blend é o arquivo interno do Blender.': ".blend is Blender's internal file.",
  'O .dwg é majoritariamente 2D e, quando tem 3D, usa sólidos ACIS que não têm malha triangulada — o que um viewer WebGL precisa.':
    '.dwg is mostly 2D and, when it has 3D, uses ACIS solids without a triangulated mesh — which a WebGL viewer needs.',
  'O .ls é a cena do Lumion. O Lumion é um renderizador — ele importa geometria, mas não exporta o modelo de volta.':
    '.ls is a Lumion scene. Lumion is a renderer — it imports geometry but does not export the model back.',
  'O .max é o arquivo de cena do 3ds Max, proprietário.':
    '.max is the proprietary 3ds Max scene file.',
  'O .pln é o projeto do ArchiCAD, em formato proprietário.':
    '.pln is an ArchiCAD project, in a proprietary format.',
  'O .rfa é uma família do Revit, também em formato proprietário.':
    '.rfa is a Revit family, also in a proprietary format.',
  'O .rvt é o arquivo de projeto do Revit — um banco de dados BIM proprietário, sem formato público. Só o próprio Revit consegue abri-lo.':
    '.rvt is the Revit project file — a proprietary BIM database with no public format. Only Revit itself can open it.',
  'O .skp é o formato proprietário do SketchUp, sem leitor público.':
    ".skp is SketchUp's proprietary format, with no public reader.",
  'O BlenderBIM abre IFC e exporta GLB direto — é o caminho mais curto.':
    'BlenderBIM opens IFC and exports GLB directly — it is the shortest route.',
  'O SCC Builder tem uma API REST em PHP e um SDK orientado a objetos (<code>sdk/SccBuilder.php</code>) para automatizar conversões direto nas suas aplicações PHP.':
    'SCC Builder has a PHP REST API and an object-oriented SDK (<code>sdk/SccBuilder.php</code>) to automate conversions straight from your PHP applications.',
  'O IFC é aberto, mas é um formato de dados BIM (com propriedades, relações e geometria paramétrica), não uma malha pronta para renderizar. Suportá-lo exigiria um motor de geometria dedicado — está fora do escopo atual.':
    'IFC is open, but it is a BIM data format (with properties, relations and parametric geometry), not a render-ready mesh. Supporting it would require a dedicated geometry engine — it is out of the current scope.',
  'O Lumion não exporta geometria: exporte o modelo de origem como <strong>FBX (.fbx)</strong> ou <strong>DAE (.dae)</strong> antes de importar no SCC Builder.':
    'Lumion does not export geometry: export the source model as <strong>FBX (.fbx)</strong> or <strong>DAE (.dae)</strong> before importing it into SCC Builder.',
  'O Lumion não tem exportação de geometria: o caminho é sempre partir do arquivo original que você levou para dentro dele.':
    'Lumion has no geometry export: the way is always to start from the original file you brought into it.',
  'O SketchUp gera uma pasta com o mesmo nome do .dae contendo as texturas. Arraste a pasta INTEIRA para cá, não só o arquivo.':
    'SketchUp creates a folder with the same name as the .dae containing the textures. Drag the WHOLE folder here, not just the file.',
  'O add-on glTF do Blender aplica a rotação Y-up → Z-up na importação.':
    "Blender's glTF add-on applies the Y-up → Z-up rotation on import.",
  'O arquivo foi lido, mas não contém nenhuma malha com geometria.':
    'The file was read, but it contains no mesh with geometry.',
  'O arquivo já veio organizado em grupos.': 'The file already came organized in groups.',
  'O formato ".^1" precisa ser exportado antes de ser importado.':
    'The ".^1" format must be exported before it can be imported.',
  'O material identifica bem os sistemas construtivos.':
    'The material identifies the building systems well.',
  'O nome é longo demais (máximo 120 caracteres).': 'The name is too long (120 characters max).',
  'O objeto selecionado não é uma malha.': 'The selected object is not a mesh.',
  'O upload excedeu o tempo limite.': 'The upload timed out.',
  'O worker não processa o formato ".^1".': 'The worker does not process the ".^1" format.',
  'OBJ — geometria simples, sem texturas embutidas': 'OBJ — plain geometry, no embedded textures',
  'OCULTO (não será exportado)': 'HIDDEN (will not be exported)',
  Ocultar: 'Hide',
  'Ocultar (não será exportado)': 'Hide (will not be exported)',
  'Ocultar ^1': 'Hide ^1',
  'Ocultar camada ^1': 'Hide layer ^1',
  'Ocultar material ^1': 'Hide material ^1',
  'Ocultar os blocos selecionados (tecla H)': 'Hide the selected blocks (H key)',
  'Ocultar por material': 'Hide by material',
  'Ocultar todas as malhas deste material': 'Hide every mesh with this material',
  'Ocultos: ^1 triângulos em ^2 malha(s)': 'Hidden: ^1 triangles in ^2 mesh(es)',
  'Opacidade / transparência': 'Opacity / transparency',
  'Organizar em ^1 camada(s) por ^2': 'Organize into ^1 layer(s) by ^2',
  'Organizar em camadas': 'Organize into layers',
  'Orientação dos eixos': 'Axis orientation',
  'Os materiais selecionados não têm textura.': 'The selected materials have no texture.',
  'Os nomes das malhas não indicam camadas. Agrupar por material é o caminho mais confiável neste arquivo.':
    'The mesh names do not indicate layers. Grouping by material is the most reliable route for this file.',
  'Os nomes das malhas seguem uma convenção de camadas.':
    'The mesh names follow a layer convention.',
  Otimizado: 'Optimized',
  'Otimizando malha...': 'Optimizing mesh...',
  Otimização: 'Optimization',
  'Ou, para 3D: comando 3DPRINT → salvar como STL': 'Or, for 3D: 3DPRINT command → save as STL',
  'Ouro (19,32 g/cm³)': 'Gold (19.32 g/cm³)',
  'PLY — malha com cores por vértice': 'PLY — mesh with per-vertex colors',
  'Para WebXR, mantenha a escala em metros: 1 unidade = 1 m no mundo real.':
    'For WebXR, keep the scale in meters: 1 unit = 1 m in the real world.',
  'Peças soltas (componentes conectados)': 'Loose parts (connected components)',
  'Pintura branca': 'White paint',
  'Pintura fosca (cor)': 'Matte paint (color)',
  'Pivot centralizado e alinhado ao chão!': 'Pivot centered and aligned to the ground!',
  Polegadas: 'Inches',
  Prever: 'Preview',
  'Previsão (^1)': 'Preview (^1)',
  'Processando...': 'Processing...',
  'Progresso do carregamento': 'Loading progress',
  Projeção: 'Projection',
  'Pronto para exportar.': 'Ready to export.',
  Pés: 'Feet',
  'Recalcular normais de vértice': 'Recalculate vertex normals',
  Refazer: 'Redo',
  'Refazer (Ctrl+Y)': 'Redo (Ctrl+Y)',
  'Refazer: ^1 (Ctrl+Y)': 'Redo: ^1 (Ctrl+Y)',
  'Refeito: ^1': 'Redone: ^1',
  'Remover textura do selecionado': 'Remove texture from selection',
  'Renomear camada para "^1"': 'Rename layer to "^1"',
  'Resina (1,12 g/cm³)': 'Resin (1.12 g/cm³)',
  'Resposta não-JSON da API.': 'Non-JSON response from the API.',
  'Restaurar a visibilidade de tudo (Shift+H)': 'Restore visibility of everything (Shift+H)',
  'Revit: File → Export → CAD Formats → FBX (ou DAE). O FBX exige o conversor FBX2glTF instalado no servidor.':
    'Revit: File → Export → CAD Formats → FBX (or DAE). FBX requires the FBX2glTF converter installed on the server.',
  Rotacionar: 'Rotate',
  'Rotacionar (E)': 'Rotate (E)',
  'Rugosidade:': 'Roughness:',
  'STL (binário para impressão 3D)': 'STL (binary for 3D printing)',
  'STL — só malha, para impressão 3D': 'STL — mesh only, for 3D printing',
  'Salvar arquivo': 'Save file',
  'Se o FBX sair muito pesado, esconda categorias que não precisa (mobiliário, vegetação, anotações) antes de exportar.':
    'If the FBX comes out too heavy, hide categories you do not need (furniture, vegetation, annotations) before exporting.',
  'Se só tem o IFC, converta antes no BlenderBIM (gratuito) e exporte GLB':
    'If you only have the IFC, convert it first in BlenderBIM (free) and export GLB',
  Selecionar: 'Select',
  'Selecionar (Q)': 'Select (Q)',
  'Selecione um arquivo 3D para testar o upload na API PHP.':
    'Select a 3D file to test the upload to the PHP API.',
  'Selecione um bloco na árvore ou clique nele na viewport. Use Ctrl+clique para escolher vários.':
    'Select a block in the tree or click it in the viewport. Use Ctrl+click to pick several.',
  'Selecione uma <strong>malha</strong> na árvore ou na viewport. Grupos não podem ser divididos — só as malhas dentro deles.':
    'Select a <strong>mesh</strong> in the tree or in the viewport. Groups cannot be split — only the meshes inside them.',
  'Serão exportados: ^1 triângulos em ^2 malha(s)': 'To be exported: ^1 triangles in ^2 mesh(es)',
  'SketchUp: File → Export → 3D Model → Collada .DAE (marque "Export Texture Maps"). Arraste a PASTA inteira, o .dae vem com uma pasta de texturas ao lado.':
    'SketchUp: File → Export → 3D Model → Collada .DAE (check "Export Texture Maps"). Drag the WHOLE folder: the .dae comes with a texture folder next to it.',
  'Slicer ativado — use os controles no painel direito':
    'Slicer on — use the controls in the right panel',
  'Slicer desativado': 'Slicer off',
  'Solte um arquivo de imagem (JPG, PNG ou WEBP).': 'Drop an image file (JPG, PNG or WEBP).',
  'Sphere — ideal para objetos redondos': 'Sphere — ideal for round objects',
  'Só uma camada foi detectada — organizar não mudaria nada. Tente outra estratégia de agrupamento.':
    'Only one layer was detected — organizing would change nothing. Try another grouping strategy.',
  'TRIÂNGULOS:': 'TRIS:',
  'Também suporta:': 'Also supports:',
  'Tempo de espera do job esgotado.': 'Timed out waiting for the job.',
  'Testar o envio na API PHP (/api/convert.php)':
    'Test the upload to the PHP API (/api/convert.php)',
  'Textura ^1 aplicada a ^2 material(is) — projeção ^3.':
    'Texture ^1 applied to ^2 material(s) — ^3 projection.',
  'Textura removida de ^1 material(is).': 'Texture removed from ^1 material(s).',
  Texturas: 'Textures',
  Tijolo: 'Brick',
  'Tipo de colisor': 'Collider type',
  'Todas as ^1 malhas têm UV — qualquer projeção funciona.':
    'All ^1 meshes have UVs — any projection works.',
  'Transformar ^1': 'Transform ^1',
  'Triplanar — dispensa UV (recomendado)': 'Triplanar — no UV needed (recommended)',
  'Triângulos: ^1 → ^2': 'Triangles: ^1 → ^2',
  'UV do arquivo — exige mapeamento': 'File UVs — requires mapping',
  'UVs geradas para ^1 malha(s).': 'UVs generated for ^1 mesh(es).',
  'Um colisor por malha': 'One collider per mesh',
  'Unidade do arquivo de origem': 'Source file unit',
  'Unity usa sistema canhoto; o importador espelha o eixo Z sozinho.':
    'Unity uses a left-handed system; the importer mirrors the Z axis by itself.',
  'Unreal trabalha em centímetros: o preset multiplica a escala por 100.':
    'Unreal works in centimeters: the preset multiplies the scale by 100.',
  'Use GLTFLoader com DRACOLoader para abrir a saída otimizada.':
    'Use GLTFLoader with DRACOLoader to open the optimized output.',
  'VOLUME:': 'VOL:',
  'Ver guia de exportação': 'See export guide',
  'Verifique se o WAMP está rodando e se a API responde em ^1':
    'Check that WAMP is running and the API responds at ^1',
  Vidro: 'Glass',
  'Vidro fumê': 'Smoked glass',
  'Vista de topo': 'Top view',
  'Vista de topo — planta (2)': 'Top view — plan (2)',
  'Vista frontal': 'Front view',
  'Vista frontal — elevação (3)': 'Front view — elevation (3)',
  'Vista iso / topo / frente / lateral': 'Iso / top / front / side view',
  'Vista isométrica': 'Isometric view',
  'Vista isométrica (1)': 'Isometric view (1)',
  'Vista lateral': 'Side view',
  'Vista lateral (4)': 'Side view (4)',
  'Vista: ^1': 'View: ^1',
  'Volte ao software de origem do modelo (Revit, SketchUp, ArchiCAD…)':
    "Go back to the model's source software (Revit, SketchUp, ArchiCAD…)",
  'Volume real calculado por soma de tetraedros com sinal.':
    'Real volume calculated as a sum of signed tetrahedra.',
  'VÉRTICES:': 'VERTS:',
  'Vá em <em>File → Export → CAD Formats → FBX</em>. O SCC Builder transforma o FBX em um GLB leve, pronto para game. IFC não é lido: exporte FBX em vez dele.':
    'Go to <em>File → Export → CAD Formats → FBX</em>. SCC Builder turns the FBX into a light, game-ready GLB. IFC is not read: export FBX instead.',
  'Vértices: ^1 → ^2': 'Vertices: ^1 → ^2',
  'Vértices: ^1 → ~^2': 'Vertices: ^1 → ~^2',
  'Worker falhou: ^1': 'Worker failed: ^1',
  'Y-up, 1 unidade = 1 metro.': 'Y-up, 1 unit = 1 meter.',
  'Y-up, metros, Draco recomendado.': 'Y-up, meters, Draco recommended.',
  'Y-up, metros. Conformidade estrita com a spec glTF 2.0.':
    'Y-up, meters. Strict compliance with the glTF 2.0 spec.',
  'Z-up, 1 unidade = 1 centímetro.': 'Z-up, 1 unit = 1 centimeter.',
  'Z-up, metros — o importador glTF do Blender já converte.':
    "Z-up, meters — Blender's glTF importer already converts it.",
  'Zoom por área': 'Area zoom',
  'Zoom por área (arrastar retângulo)': 'Area zoom (drag a rectangle)',
  'Zoom por área — arraste um retângulo na cena (tecla A)':
    'Area zoom — drag a rectangle over the scene (A key)',
  'Zoom por área: <strong>arraste um retângulo</strong> sobre a região que quer ampliar. Esc cancela.':
    'Area zoom: <strong>drag a rectangle</strong> over the region you want to enlarge. Esc cancels.',
  '^1 aplicado a ^2 malha(s). Ctrl+Z desfaz.': '^1 applied to ^2 mesh(es). Ctrl+Z undoes it.',
  '^1 arquivo(s) convertidos com sucesso!': '^1 file(s) converted successfully!',
  '^1 asset(s) não encontrado(s): ^2. Arraste a pasta inteira do modelo para incluir texturas e .mtl.':
    "^1 asset(s) not found: ^2. Drag the model's whole folder to include textures and .mtl.",
  '^1 bloco(s) excluído(s). <strong>Ctrl+Z</strong> desfaz.':
    '^1 block(s) deleted. <strong>Ctrl+Z</strong> undoes it.',
  '^1 bloco(s) ocultado(s) — não entrarão na exportação.':
    '^1 block(s) hidden — they will not be exported.',
  '^1 bloco(s) oculto(s) omitido(s) — ^2 triângulos a menos.':
    '^1 hidden block(s) left out — ^2 fewer triangles.',
  '^1 bloco(s) oculto(s) serão omitidos (^2 triângulos a menos)':
    '^1 hidden block(s) will be left out (^2 fewer triangles)',
  '^1 bloco(s) selecionado(s)': '^1 block(s) selected',
  '^1 blocos': '^1 blocks',
  '^1 camada(s) detectada(s).': '^1 layer(s) detected.',
  '^1 colisor(es) do tipo ^2 gerado(s).': '^1 collider(s) of type ^2 generated.',
  '^1 colisor(es) exportado(s) em JSON.': '^1 collider(s) exported as JSON.',
  '^1 convertido(s), ^2 falharam. Veja _falhas.txt dentro do ZIP.':
    '^1 converted, ^2 failed. See _falhas.txt inside the ZIP.',
  '^1 de ^2 malhas têm UV (^3%). A triplanar cobre as demais.':
    '^1 of ^2 meshes have UVs (^3%). Triplanar covers the rest.',
  '^1 filho(s)': '^1 child(ren)',
  '^1 material(is) com opacidade zero — o modelo ficaria invisível.':
    '^1 material(s) with zero opacity — the model would be invisible.',
  '^1 material(is) convertidos para PBR.': '^1 material(s) converted to PBR.',
  '^1 material(is) forçados a opaco. Use Ctrl+Z para reverter.':
    '^1 material(s) forced to opaque. Use Ctrl+Z to revert.',
  '^1 material(is) vinham com opacidade zero (bug conhecido de exportação Collada) e foram tornados opacos.':
    '^1 material(s) came with zero opacity (a known Collada export bug) and were made opaque.',
  '^1 material(is) vinham invisíveis (opacidade zero) e foram tornados opacos.':
    '^1 material(s) came invisible (zero opacity) and were made opaque.',
  '^1 mi': '^1M',
  '^1 mil': '^1K',
  '^1 textura(s) com cor corrigida.': '^1 texture(s) with corrected color.',
  '^1 textura(s) sem imagem foram omitidas — os arquivos não estavam na pasta importada.':
    '^1 texture(s) without an image were left out — the files were not in the imported folder.',
  '^1 triângulos': '^1 triangles',
  '^1 triângulos em <strong>^2</strong> peça(s) solta(s).':
    '^1 triangles in <strong>^2</strong> loose part(s).',
  '^1 triângulos em ^2 malha(s)': '^1 triangles in ^2 mesh(es)',
  '^1 — ^2 malha(s), ^3 triângulos': '^1 — ^2 mesh(es), ^3 triangles',
  '^1 — ^2 objeto(s), ^3 triângulos': '^1 — ^2 object(s), ^3 triangles',
  '^1% menos': '^1% fewer',
  bloco: 'block',
  erro: 'error',
  'escala ×^1': 'scale ×^1',
  escalar: 'scale',
  'extraindo malhas': 'extracting meshes',
  frontal: 'front',
  'glTF (JSON + assets)': 'glTF (JSON + assets)',
  'glTF padrão (Khronos)': 'Standard glTF (Khronos)',
  'glTF — JSON legível, assets separados': 'glTF — readable JSON, separate assets',
  hierarquia: 'hierarchy',
  'interpretando geometria': 'parsing geometry',
  isométrica: 'isometric',
  lateral: 'side',
  'lendo arquivo': 'reading file',
  'lendo vértices': 'reading vertices',
  malha: 'mesh',
  'malha aberta': 'open mesh',
  material: 'material',
  'meshoptimizer não disponível — a malha foi soldada, mas não simplificada. Execute "npm install meshoptimizer".':
    'meshoptimizer unavailable — the mesh was welded but not simplified. Run "npm install meshoptimizer".',
  'meshoptimizer não disponível — execute "npm install meshoptimizer".':
    'meshoptimizer unavailable — run "npm install meshoptimizer".',
  mover: 'move',
  'nenhuma transformação necessária': 'no transformation needed',
  nome: 'name',
  'otimizando ^1/^2': 'optimizing ^1/^2',
  ou: 'or',
  'ou clique para selecionar': 'or click to select',
  rotacionar: 'rotate',
  topo: 'top',
  '📦 Carregar modelo de exemplo...': '📦 Load sample model...',
  'Y-up, metros, Meshopt e 3 níveis de LOD.': 'Y-up, meters, Meshopt and 3 LOD levels.',
  'Preset dos prédios da Smart Chain City: o GLB vai direto para o lote.':
    'Preset for Smart Chain City buildings: the GLB goes straight to the lot.',
  'Até 300 mil triângulos por prédio; acima disso o lote recusa o modelo.':
    'Up to 300 thousand triangles per building; above that the lot rejects the model.',
  'Meshopt, LOD1/LOD2 e o contorno da base saem na conversão pelo servidor.':
    'Meshopt, LOD1/LOD2 and the base outline come out of the server-side conversion.',
  'O modelo tem ^1 triângulos, acima do limite de ^2 do lote. Otimize antes de enviar.':
    'The model has ^1 triangles, above the lot limit of ^2. Optimize it before uploading.',
  'Exportar para o mapa': 'Export to the map',
  'Ajusta o modelo aos limites da Smart Chain City (até 300 mil triângulos, 3 LODs, texturas até 2048 px, até 40 MB) e o coloca no seu lote no mapa':
    'Fits the model to Smart Chain City limits (up to 300 thousand triangles, 3 LODs, textures up to 2048 px, up to 40 MB) and places it on your lot on the map',
  'Mapa não configurado: defina VITE_SCC_MAP_URL no .env.':
    'Map not configured: set VITE_SCC_MAP_URL in .env.',
  'O navegador bloqueou a janela do mapa. Permita pop-ups para este site.':
    'The browser blocked the map window. Allow pop-ups for this site.',
  'Ajustando o modelo para o mapa...': 'Fitting the model for the map...',
  'Ajustando o modelo para o mapa (tentativa ^1 de ^2)...':
    'Fitting the model for the map (attempt ^1 of ^2)...',
  'Enviando ao mapa...': 'Sending to the map...',
  'Triângulos: ^1 → ^2 (LOD1 ^3, LOD2 ^4)': 'Triangles: ^1 → ^2 (LOD1 ^3, LOD2 ^4)',
  'Tamanho: ^1 → ^2 (limite 40 MB)': 'Size: ^1 → ^2 (limit 40 MB)',
  '^1 textura(s) reduzida(s) para ^2 px': '^1 texture(s) reduced to ^2 px',
  'Atenção: ^1 materiais; o limite por prédio é ^2.':
    'Warning: ^1 materials; the limit per building is ^2.',
  'Modelo enviado ao mapa da Smart Chain City.': 'Model sent to the Smart Chain City map.',
  'Mesmo simplificado, o modelo passa dos limites do mapa (300 mil triângulos, 40 MB). Oculte blocos que não fazem parte do prédio (paisagismo, terreno) e tente de novo.':
    'Even simplified, the model exceeds the map limits (300 thousand triangles, 40 MB). Hide blocks that are not part of the building (landscaping, terrain) and try again.',
  'A janela do mapa foi fechada antes de receber o modelo.':
    'The map window was closed before receiving the model.',
  'O mapa não respondeu. Confira se ele está no ar em ^1':
    'The map did not respond. Check that it is running at ^1',
  'O mapa recusou o modelo: ^1': 'The map rejected the model: ^1',
};
