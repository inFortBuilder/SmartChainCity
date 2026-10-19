/**
 * Dicionário es do editor: texto em português => tradução.
 *
 * A chave é o texto exatamente como está no t('…') ou no data-t* do
 * index.html. Texto novo na tela entra aqui e no outro dicionário; o
 * tests/traducao.test.js reprova chave sem tradução.
 */
export default {
  '"^1" é um nome reservado pelo Windows.': '"^1" es un nombre reservado por Windows.',
  '.^1 é um arquivo do ^2': '.^1 es un archivo de ^2',
  '3ds Max: File → Export → FBX (marque "Embed Media" para incluir texturas)':
    '3ds Max: File → Export → FBX (marque "Embed Media" para incluir las texturas)',
  '<strong>Exportação bloqueada por textura sem imagem</strong><br>Um ou mais materiais apontam para arquivos de textura que não foram carregados.<br><br><strong>Como resolver:</strong><br>1. Reimporte arrastando a <strong>pasta inteira</strong> do modelo, com as imagens;<br>2. ou exporte em <strong>OBJ</strong>, que não embute texturas.':
    '<strong>Exportación bloqueada por una textura sin imagen</strong><br>Uno o más materiales apuntan a archivos de textura que no se cargaron.<br><br><strong>Cómo resolverlo:</strong><br>1. Vuelva a importar arrastrando la <strong>carpeta entera</strong> del modelo, con las imágenes;<br>2. o exporte en <strong>OBJ</strong>, que no incrusta texturas.',
  '<strong>Memória insuficiente para exportar</strong><br>O modelo é grande demais para ser serializado de uma vez.<br><br>Use o painel <strong>Otimização</strong> com o perfil "Agressiva" antes de exportar, ou envie o arquivo pela API (PHP API &amp; SDK), que processa no servidor sem o limite do browser.':
    '<strong>Memoria insuficiente para exportar</strong><br>El modelo es demasiado grande para serializarlo de una vez.<br><br>Use el panel <strong>Optimización</strong> con el perfil "Agresiva" antes de exportar, o envíe el archivo por la API (API PHP y SDK), que lo procesa en el servidor sin el límite del navegador.',
  'A API respondeu com conteúdo não-JSON (HTTP ^1).':
    'La API respondió con contenido que no es JSON (HTTP ^1).',
  'A cena já está organizada em ^1 camada(s). Use Ctrl+Z para desfazer antes de reorganizar.':
    'La escena ya está organizada en ^1 capa(s). Use Ctrl+Z para deshacer antes de reorganizar.',
  'A conversão falhou.': 'La conversión falló.',
  'A malha "^1" não possui atributo de posição.': 'La malla "^1" no tiene atributo de posición.',
  'A malha não tem grupos de material para separar.':
    'La malla no tiene grupos de material para separar.',
  'A malha tem ^1 triângulos — acima do limite de ^2 para divisão por conectividade. Simplifique antes, ou use a divisão por fatias.':
    'La malla tiene ^1 triángulos — por encima del límite de ^2 para la división por conectividad. Simplifíquela antes o use la división por cortes.',
  'A malha é uma peça única — não há ilhas de geometria para separar.':
    'La malla es una sola pieza — no hay islas de geometría para separar.',
  'A previsão está disponível para a divisão por peças soltas.':
    'La vista previa está disponible para la división en piezas sueltas.',
  'A requisição excedeu o tempo limite.': 'La solicitud superó el tiempo límite.',
  'API PHP e SDK': 'API PHP y SDK',
  'API REST em PHP e SDK cliente': 'API REST en PHP y SDK cliente',
  'API respondeu com sucesso!': '¡La API respondió correctamente!',
  'Abra a cena no 3ds Max': 'Abra la escena en 3ds Max',
  'Abra a família no Revit': 'Abra la familia en Revit',
  'Abra no Blender': 'Ábralo en Blender',
  'Abra no Rhino': 'Ábralo en Rhino',
  'Abra o desenho no AutoCAD': 'Abra el dibujo en AutoCAD',
  'Abra o modelo no SketchUp': 'Abra el modelo en SketchUp',
  'Abra o projeto no ArchiCAD': 'Abra el proyecto en ArchiCAD',
  'Abra o projeto no Revit': 'Abra el proyecto en Revit',
  Afastar: 'Alejar',
  'Afastar (tecla −)': 'Alejar (tecla −)',
  'Agressiva — 50% dos triângulos': 'Agresiva — 50% de los triángulos',
  'Agrupar camadas por': 'Agrupar capas por',
  'Alterar material (^1)': 'Cambiar material (^1)',
  'Alternar corte transversal': 'Alternar corte transversal',
  'Alternar wireframe': 'Alternar wireframe',
  Alumínio: 'Aluminio',
  'Alumínio (2,70 g/cm³)': 'Aluminio (2,70 g/cm³)',
  'Ambiente enquadrado.': 'Escena encuadrada.',
  'Analisando a geometria...': 'Analizando la geometría...',
  'Aplicando ^1...': 'Aplicando ^1...',
  Aplicar: 'Aplicar',
  'Aplicar ^1 (^2 malhas)': 'Aplicar ^1 (^2 mallas)',
  'Aplicar ao selecionado': 'Aplicar a la selección',
  Aproximar: 'Acercar',
  'Aproximar (tecla +)': 'Acercar (tecla +)',
  'Aproximar / afastar': 'Acercar / alejar',
  'Arquivo exportado: ^1': 'Archivo exportado: ^1',
  'Arquivo → Exportar Selecionados': 'Archivo → Exportar seleccionados',
  'Arquivo → Exportar → CAD Formats → FBX': 'Archivo → Exportar → CAD Formats → FBX',
  'Arquivo → Exportar → Exportar': 'Archivo → Exportar → Exportar',
  'Arquivo → Exportar → Modelo 3D': 'Archivo → Exportar → Modelo 3D',
  'Arquivo → Salvar como → Collada (.dae) ou Wavefront (.obj)':
    'Archivo → Guardar como → Collada (.dae) o Wavefront (.obj)',
  'Arranha-céu': 'Rascacielos',
  'Arraste o arquivo aqui': 'Arrastre el archivo aquí',
  'Arraste ou clique para enviar': 'Arrastre o haga clic para enviar',
  'Arraste um arquivo DAE ou OBJ exportado do SketchUp':
    'Arrastre un archivo DAE u OBJ exportado de SketchUp',
  'Arraste um arquivo FBX ou DAE exportado do Lumion':
    'Arrastre un archivo FBX o DAE exportado de Lumion',
  'Arraste um arquivo FBX ou DAE exportado do Revit':
    'Arrastre un archivo FBX o DAE exportado de Revit',
  'Arraste um arquivo FBX ou OBJ exportado do 3ds Max':
    'Arrastre un archivo FBX u OBJ exportado de 3ds Max',
  'As malhas não têm coordenadas UV — texturas não podem ser aplicadas. Reexporte marcando a opção de exportar mapeamento de textura.':
    'Las mallas no tienen coordenadas UV — no se pueden aplicar texturas. Vuelva a exportar marcando la opción de exportar el mapeado de textura.',
  Atalhos: 'Atajos',
  'Atalhos (?)': 'Atajos (?)',
  'Atalhos de teclado': 'Atajos de teclado',
  Atenção: 'Atención',
  'Ative uma vista 3D': 'Active una vista 3D',
  'Aço escovado': 'Acero cepillado',
  'Aço estrutural (7,85 g/cm³)': 'Acero estructural (7,85 g/cm³)',
  'Baixar arquivo convertido': 'Descargar archivo convertido',
  'Balanceada — soldar vértices': 'Equilibrada — soldar vértices',
  'Base para todos os demais presets.': 'Base para todos los demás presets.',
  'Bem-vindo ao SCC Builder! Selecione um software de origem ou carregue um modelo de exemplo.':
    '¡Bienvenido a SCC Builder! Elija un software de origen o cargue un modelo de ejemplo.',
  'Biblioteca de materiais': 'Biblioteca de materiales',
  'Blocos da cena': 'Bloques de la escena',
  'Box — mais barato em runtime': 'Box — el más barato en tiempo de ejecución',
  'Camada ^1 isolada.': 'Capa ^1 aislada.',
  'Camadas e blocos': 'Capas y bloques',
  Cancelar: 'Cancelar',
  Carpete: 'Moqueta',
  'Carregamento cancelado pelo usuário.': 'Carga cancelada por el usuario.',
  'Carregamento cancelado.': 'Carga cancelada.',
  'Carregando ^1': 'Cargando ^1',
  'Carregue um modelo para detectar camadas.': 'Cargue un modelo para detectar capas.',
  'Carregue um modelo para ver o estado das UVs.': 'Cargue un modelo para ver el estado de las UV.',
  'Carregue um modelo primeiro.': 'Cargue un modelo primero.',
  'Casa arquitetônica moderna': 'Casa arquitectónica moderna',
  'Cena reorganizada em <strong>^1 camadas</strong>. A árvore e a exportação passam a enxergar essa estrutura.':
    'Escena reorganizada en <strong>^1 capas</strong>. El árbol y la exportación pasan a ver esta estructura.',
  'Centralizar pivot e alinhar ao chão': 'Centrar el pivote y alinear al suelo',
  Centímetros: 'Centímetros',
  'Clique no <span style="color:var(--accent-cyan)">◉</span> para ocultar um bloco. Ctrl+clique seleciona vários.':
    'Haga clic en el <span style="color:var(--accent-cyan)">◉</span> para ocultar un bloque. Ctrl+clic selecciona varios.',
  'Comando EXPORTAR → escolha FBX': 'Comando EXPORTAR → elija FBX',
  'Como exportar do software de arquitetura': 'Cómo exportar desde el software de arquitectura',
  'Como o Unreal é Z-up, a correção de eixo NÃO é aplicada.':
    'Como Unreal es Z-up, la corrección de eje NO se aplica.',
  'Como resolver — exporte como ^1:': 'Cómo resolverlo — exporte como ^1:',
  Concreto: 'Hormigón',
  'Concreto aparente': 'Hormigón visto',
  'SCC Builder — conversor de projetos 3D arquitetônicos e estúdio GLB':
    'SCC Builder — conversor de proyectos 3D arquitectónicos y estudio GLB',
  'Convertendo ^1 arquivo(s)...': 'Convirtiendo ^1 archivo(s)...',
  'Convertendo ^1/^2: ^3': 'Convirtiendo ^1/^2: ^3',
  'Converter Y-up para Z-up': 'Convertir Y-up a Z-up',
  'Converter Z-up para Y-up (CAD / Revit para game)': 'Convertir Z-up a Y-up (CAD / Revit a juego)',
  'Convex Hull — preciso, para corpos dinâmicos': 'Convex Hull — preciso, para cuerpos dinámicos',
  'Copie api/config.local.example.php para api/config.local.php e gere uma chave.':
    'Copie api/config.local.example.php a api/config.local.php y genere una clave.',
  'Cor base (albedo)': 'Color base (albedo)',
  'Corte no eixo X': 'Corte en el eje X',
  'Corte no eixo Y': 'Corte en el eje Y',
  'Corte no eixo Z': 'Corte en el eje Z',
  'Corte transversal': 'Corte transversal',
  'DIMENSÕES:': 'DIMENSIONES:',
  'Da arquitetura ao GLB para games': 'De la arquitectura al GLB para juegos',
  'Abra o editor pelo jogo (link com #token=) ou, em desenvolvimento, defina VITE_SCC_TOKEN ou VITE_API_KEY no .env.':
    'Abra el editor desde el juego (enlace con #token=) o, en desarrollo, defina VITE_SCC_TOKEN o VITE_API_KEY en el .env.',
  'Defina uma vista 3D (o export usa a vista ativa)':
    'Defina una vista 3D (la exportación usa la vista activa)',
  'Densidade do material': 'Densidad del material',
  'Desativar gizmo': 'Desactivar gizmo',
  Desfazer: 'Deshacer',
  'Desfazer (Ctrl+Z)': 'Deshacer (Ctrl+Z)',
  'Desfazer: ^1 (Ctrl+Z)': 'Deshacer: ^1 (Ctrl+Z)',
  'Desfeito: ^1': 'Deshecho: ^1',
  'Destino (engine)': 'Destino (motor)',
  'Destino: ^1': 'Destino: ^1',
  'Dica: ^1': 'Consejo: ^1',
  'Dividindo a malha...': 'Dividiendo la malla...',
  Dividir: 'Dividir',
  'Dividir ^1 em ^2 partes': 'Dividir ^1 en ^2 partes',
  'Dividir bloco selecionado': 'Dividir el bloque seleccionado',
  'Dividir geraria muitos objetos — a árvore ficaria difícil de navegar.':
    'Dividir generaría demasiados objetos — el árbol sería difícil de recorrer.',
  'Editor de material PBR': 'Editor de material PBR',
  'Eixo X': 'Eje X',
  'Eixo Y (altura)': 'Eje Y (altura)',
  'Eixo Z': 'Eje Z',
  'Eixo convertido: ^1': 'Eje convertido: ^1',
  'Eixo vertical da origem': 'Eje vertical de origen',
  'Em Import Settings, desmarque "Convert Scene Unit".':
    'En Import Settings, desmarque "Convert Scene Unit".',
  'Em Opções, marque "Embed Media" para incluir as texturas no arquivo':
    'En Opciones, marque "Embed Media" para incluir las texturas en el archivo',
  'Em Opções, marque "Exportar mapas de textura"':
    'En Opciones, marque "Exportar mapas de textura"',
  'Engrenagem mecânica': 'Engranaje mecánico',
  'Enquadrado: ^1': 'Encuadrado: ^1',
  'Enquadrar a seleção': 'Encuadrar la selección',
  'Enquadrar a seleção (Shift+F)': 'Encuadrar la selección (Shift+F)',
  'Enquadrar o ambiente': 'Encuadrar la escena',
  'Enquadrar o ambiente / a seleção': 'Encuadrar la escena / la selección',
  'Enquadrar todo o ambiente (F)': 'Encuadrar toda la escena (F)',
  Entendi: 'Entendido',
  'Enviando ^1 para ^2 ...': 'Enviando ^1 a ^2 ...',
  'Enviar e converter': 'Enviar y convertir',
  'Erro ao carregar ^1: ^2': 'Error al cargar ^1: ^2',
  'Erro na conversão em lote: ^1': 'Error en la conversión por lotes: ^1',
  'Erro na exportação: ^1': 'Error en la exportación: ^1',
  'Escala da textura:': 'Escala de la textura:',
  Escalar: 'Escalar',
  'Escalar (R)': 'Escalar (R)',
  'Escolha Autodesk (*.FBX)': 'Elija Autodesk (*.FBX)',
  'Escolha Collada (.dae)': 'Elija Collada (.dae)',
  'Escolha OBJ ou FBX e aceite as opções de malha':
    'Elija OBJ o FBX y acepte las opciones de malla',
  'Escolha o formato GLB (binário) — já sai com as texturas embutidas':
    'Elija el formato GLB (binario) — ya sale con las texturas incrustadas',
  'Esta lista': 'Esta lista',
  'Estimativa conservadora — o ganho real costuma ser maior.':
    'Estimación conservadora — la ganancia real suele ser mayor.',
  'Estimativa de massa': 'Estimación de masa',
  'Evite os caracteres < > : " / \\ | ? * e caracteres de controle.':
    'Evite los caracteres < > : " / \\ | ? * y los caracteres de control.',
  'Excluir ^1': 'Eliminar ^1',
  'Excluir os blocos selecionados (tecla Delete) — reversível com Ctrl+Z':
    'Eliminar los bloques seleccionados (tecla Supr) — reversible con Ctrl+Z',
  'Excluir selecionados': 'Eliminar seleccionados',
  'Exemplo de integração com o SDK PHP': 'Ejemplo de integración con el SDK PHP',
  'Exportado para ^1': 'Exportado para ^1',
  'Exportando como .^1...': 'Exportando como .^1...',
  'Exportando para ^1...': 'Exportando para ^1...',
  'Exportar GLB': 'Exportar GLB',
  'Exportar colisores (JSON)': 'Exportar colisionadores (JSON)',
  'Exportar com preset': 'Exportar con preset',
  'Exportar modelo': 'Exportar modelo',
  'Exportar todos em ZIP': 'Exportar todos en ZIP',
  'Exportação rápida': 'Exportación rápida',
  'Exporte de lá como FBX ou DAE': 'Exporte desde allí como FBX o DAE',
  'Exporte do software como <strong>FBX, DAE ou OBJ</strong> antes de importar':
    'Exporte desde el software como <strong>FBX, DAE u OBJ</strong> antes de importar',
  'Exporte o projeto como <strong>FBX (.fbx)</strong> ou <strong>OBJ (.obj)</strong> com "Embed Media" marcado, ou instale o plugin oficial Babylon.js / glTF Exporter para exportar .glb direto.':
    'Exporte el proyecto como <strong>FBX (.fbx)</strong> u <strong>OBJ (.obj)</strong> con "Embed Media" marcado, o instale el plugin oficial Babylon.js / glTF Exporter para exportar .glb directamente.',
  'Extrema — 25% dos triângulos': 'Extrema — 25% de los triángulos',
  'Falha ao aplicar a textura: ^1': 'Error al aplicar la textura: ^1',
  'Falha ao conectar com a API PHP. Verifique o WAMP.':
    'No se pudo conectar con la API PHP. Revise WAMP.',
  'Falha ao dividir: ^1': 'Error al dividir: ^1',
  'Falha ao gerar LOD: ^1': 'Error al generar LOD: ^1',
  'Falha ao gerar colisores: ^1': 'Error al generar colisionadores: ^1',
  'Falha de rede ao enviar o arquivo.': 'Fallo de red al enviar el archivo.',
  'Falha na otimização: ^1': 'Falló la optimización: ^1',
  'Falha no worker de parsing.': 'Falló el worker de análisis.',
  'Fatias por eixo': 'Cortes por eje',
  Fechar: 'Cerrar',
  'Fechar modais / cancelar': 'Cerrar diálogos / cancelar',
  'Ferramentas para game engine': 'Herramientas para motor de juego',
  'Filamento ABS (1,04 g/cm³)': 'Filamento ABS (1,04 g/cm³)',
  'Filamento PLA (1,24 g/cm³)': 'Filamento PLA (1,24 g/cm³)',
  'File → Export → 3D Model → escolha <strong>Collada (.dae)</strong> ou <strong>OBJ (.obj)</strong>. Marque "Export Texture Maps".':
    'File → Export → 3D Model → elija <strong>Collada (.dae)</strong> u <strong>OBJ (.obj)</strong>. Marque "Export Texture Maps".',
  Formato: 'Formato',
  'Formato ".^1" não suportado.': 'Formato ".^1" no compatible.',
  'Formato ".^1" não suportado. Aceitos: ^2.': 'Formato ".^1" no compatible. Aceptados: ^2.',
  'Formato "^1" não suportado.': 'Formato "^1" no compatible.',
  'Formato .^1 não suportado': 'Formato .^1 no compatible',
  'Formato de destino': 'Formato de destino',
  'Formato de exportação "^1" não suportado.': 'Formato de exportación "^1" no compatible.',
  'Formato não suportado': 'Formato no compatible',
  'Formatos aceitos: GLB, GLTF, OBJ, STL, PLY, FBX e DAE.':
    'Formatos aceptados: GLB, GLTF, OBJ, STL, PLY, FBX y DAE.',
  'Forçar materiais opacos': 'Forzar materiales opacos',
  'GLB (glTF binário — recomendado para games)': 'GLB (glTF binario — recomendado para juegos)',
  'GLB do Blender é o melhor caminho: sai otimizado e com tudo embutido.':
    'El GLB de Blender es el mejor camino: sale optimizado y con todo incrustado.',
  'GLB — binário, tudo em um arquivo (recomendado)':
    'GLB — binario, todo en un archivo (recomendado)',
  'Gerando colisores (^1)...': 'Generando colisionadores (^1)...',
  'Gerando níveis de detalhe...': 'Generando niveles de detalle...',
  'Gerar LOD (3 níveis)': 'Generar LOD (3 niveles)',
  'Gerar UV cilíndrica': 'Generar UV cilíndrica',
  'Gerar UV cúbica': 'Generar UV cúbica',
  'Gerar UV esférica': 'Generar UV esférica',
  'Gerar UV planar (planta)': 'Generar UV planar (planta)',
  'Gerar colisores': 'Generar colisionadores',
  'Gere colisores antes de exportar.': 'Genere colisionadores antes de exportar.',
  'Godot importa .glb nativamente; basta arrastar para o FileSystem.':
    'Godot importa .glb de forma nativa; basta arrastrarlo al FileSystem.',
  'Grupos de material': 'Grupos de material',
  'Guia de exportação': 'Guía de exportación',
  'Hierarquia da cena': 'Jerarquía de la escena',
  'Hierarquia do arquivo': 'Jerarquía del archivo',
  'Imagem de textura': 'Imagen de textura',
  'Importar projeto 3D': 'Importar proyecto 3D',
  'Importe com o glTFast ou o UnityGLTF.': 'Importe con glTFast o UnityGLTF.',
  'Importe esse arquivo aqui': 'Importe ese archivo aquí',
  'Importe o .dae junto com a pasta de texturas que o SketchUp criar':
    'Importe el .dae junto con la carpeta de texturas que cree SketchUp',
  'Importe o .fbx aqui': 'Importe el .fbx aquí',
  'Importe o .glb aqui': 'Importe el .glb aquí',
  'Importe o arquivo aqui': 'Importe el archivo aquí',
  'Impressão 3D': 'Impresión 3D',
  'Informe um nome para o arquivo.': 'Indique un nombre para el archivo.',
  'Isolado. Use "Mostrar tudo" ou Ctrl+Z para voltar.':
    'Aislado. Use "Mostrar todo" o Ctrl+Z para volver.',
  Isolar: 'Aislar',
  'Isolar ^1': 'Aislar ^1',
  'Isolar a camada ^1': 'Aislar la capa ^1',
  'Job ^1 enfileirado. Aguardando o worker...': 'Job ^1 en cola. Esperando al worker...',
  'LOD gerado com 3 níveis (100%, 50%, 12,5%). Objetos distantes passam a desenhar muito menos triângulos.':
    'LOD generado con 3 niveles (100%, 50%, 12,5%). Los objetos lejanos pasan a dibujar muchos menos triángulos.',
  'Limpar colisores': 'Limpiar colisionadores',
  'Lumion não exporta geometria. Volte ao Revit/SketchUp/ArchiCAD de origem e exporte de lá como FBX ou DAE (com texturas).':
    'Lumion no exporta geometría. Vuelva al Revit/SketchUp/ArchiCAD de origen y exporte desde allí como FBX o DAE (con texturas).',
  Madeira: 'Madera',
  'Madeira escura': 'Madera oscura',
  Malha: 'Malla',
  'Malha dividida em <strong>^1 peça(s)</strong>. Agora cada uma pode ser ocultada, excluída ou texturizada em separado. Ctrl+Z desfaz.':
    'Malla dividida en <strong>^1 pieza(s)</strong>. Ahora cada una puede ocultarse, eliminarse o texturizarse por separado. Ctrl+Z deshace.',
  'Malha grande demais (^1 triângulos) para a análise por conectividade. Otimize antes ou use fatias.':
    'Malla demasiado grande (^1 triángulos) para el análisis por conectividad. Optimícela antes o use cortes.',
  'Malha não estanque (^1 arestas de borda) — volume não pode ser calculado com precisão.':
    'Malla no estanca (^1 aristas de borde) — el volumen no se puede calcular con precisión.',
  'Manter a orientação original': 'Mantener la orientación original',
  'Marque "Embed Media" e defina Units como Meters':
    'Marque "Embed Media" y defina Units como Meters',
  'Massa estimada:': 'Masa estimada:',
  'Materiais ajustados': 'Materiales ajustados',
  Material: 'Material',
  'Material não encontrado na biblioteca.': 'Material no encontrado en la biblioteca.',
  Metros: 'Metros',
  'Metálico:': 'Metálico:',
  Milímetros: 'Milímetros',
  'Modelo carregado: ^1': 'Modelo cargado: ^1',
  'Modelo de exemplo carregado: ^1': 'Modelo de ejemplo cargado: ^1',
  'Modelos carregados': 'Modelos cargados',
  'Modo Shaded ativado': 'Modo sombreado activado',
  'Modo Wireframe ativado': 'Modo wireframe activado',
  'Modo: ^1': 'Modo: ^1',
  Mostrar: 'Mostrar',
  'Mostrar ^1': 'Mostrar ^1',
  'Mostrar apenas a seleção (tecla I)': 'Mostrar solo la selección (tecla I)',
  'Mostrar camada ^1': 'Mostrar la capa ^1',
  'Mostrar material ^1': 'Mostrar el material ^1',
  'Mostrar os blocos selecionados': 'Mostrar los bloques seleccionados',
  'Mostrar tudo': 'Mostrar todo',
  'Motor de destino': 'Motor de destino',
  Mover: 'Mover',
  'Mover (W)': 'Mover (W)',
  'Mover / Rotacionar / Escalar': 'Mover / Rotar / Escalar',
  'Nada a desfazer': 'Nada que deshacer',
  'Nada a refazer': 'Nada que rehacer',
  'Nada selecionado para receber a textura.': 'Nada seleccionado para recibir la textura.',
  'Nada selecionado para receber o material.': 'Nada seleccionado para recibir el material.',
  'Nenhum arquivo carregado para conversão em lote.':
    'Ningún archivo cargado para la conversión por lotes.',
  'Nenhum bloco selecionado — clique em um objeto na viewport ou na árvore.':
    'Ningún bloque seleccionado — haga clic en un objeto en el visor o en el árbol.',
  'Nenhum colisor gerado — verifique se o modelo tem malhas válidas.':
    'No se generó ningún colisionador — verifique que el modelo tenga mallas válidas.',
  'Nenhum material na cena.': 'No hay materiales en la escena.',
  'Nenhum material tem textura. Se o modelo deveria ter, arraste a pasta inteira (com as imagens) em vez de só o arquivo do modelo.':
    'Ningún material tiene textura. Si el modelo debería tenerla, arrastre la carpeta entera (con las imágenes) en lugar de solo el archivo del modelo.',
  'Nenhum modelo 3D reconhecido nos arquivos selecionados.':
    'No se reconoció ningún modelo 3D en los archivos seleccionados.',
  'Nenhum modelo carregado para exportar.': 'Ningún modelo cargado para exportar.',
  'Nenhum modelo carregado! Importe ou carregue um modelo de exemplo primeiro.':
    '¡Ningún modelo cargado! Importe o cargue un modelo de ejemplo primero.',
  'Nenhum modelo carregado.': 'Ningún modelo cargado.',
  Nenhuma: 'Ninguna',
  'Nenhuma camada detectada.': 'No se detectó ninguna capa.',
  'Nenhuma das ^1 malhas tem UV. Use a projeção triplanar, ou gere UVs pelo seletor abaixo.':
    'Ninguna de las ^1 mallas tiene UV. Use la proyección triplanar o genere UV con el selector de abajo.',
  'Nenhuma malha na cena.': 'No hay mallas en la escena.',
  'No ArchiCAD: Salvar como → Collada (.dae)': 'En ArchiCAD: Guardar como → Collada (.dae)',
  'No Revit: Arquivo → Exportar → CAD Formats → FBX (em vez de IFC)':
    'En Revit: Archivo → Exportar → CAD Formats → FBX (en lugar de IFC)',
  'No inspetor do modelo, mantenha Scale Factor = 1.':
    'En el inspector del modelo, mantenga Scale Factor = 1.',
  'No seu fatiador ou CAD, exporte como STL ou OBJ':
    'En su laminador o CAD, exporte como STL u OBJ',
  'Nome do arquivo': 'Nombre del archivo',
  'Nome do objeto (prefixo)': 'Nombre del objeto (prefijo)',
  'Normais de vértice recalculadas!': '¡Normales de vértice recalculadas!',
  'Não foi possível conectar à API em ^1. Verifique se o servidor PHP está no ar.':
    'No se pudo conectar a la API en ^1. Verifique que el servidor PHP esté en marcha.',
  'Não foi possível dividir esta malha.': 'No se pudo dividir esta malla.',
  'Não foi possível fatiar esta geometria.': 'No se pudo cortar esta geometría.',
  'Não foi possível interpretar o arquivo "^1".': 'No se pudo interpretar el archivo "^1".',
  'Não é possível excluir a raiz do modelo.': 'No se puede eliminar la raíz del modelo.',
  Nível: 'Nivel',
  'Nível "^1" desconhecido.': 'Nivel "^1" desconocido.',
  'Nó toroidal': 'Nudo toroidal',
  'O .3dm usa NURBS, que precisam ser trianguladas antes de renderizar.':
    'El .3dm usa NURBS, que deben triangularse antes de renderizar.',
  'O .3mf é um container ZIP com XML — suportá-lo exigiria um loader dedicado que ainda não temos.':
    'El .3mf es un contenedor ZIP con XML — admitirlo exigiría un cargador dedicado que aún no tenemos.',
  'O .blend é o arquivo interno do Blender.': 'El .blend es el archivo interno de Blender.',
  'O .dwg é majoritariamente 2D e, quando tem 3D, usa sólidos ACIS que não têm malha triangulada — o que um viewer WebGL precisa.':
    'El .dwg es mayormente 2D y, cuando tiene 3D, usa sólidos ACIS sin malla triangulada — que es lo que un visor WebGL necesita.',
  'O .ls é a cena do Lumion. O Lumion é um renderizador — ele importa geometria, mas não exporta o modelo de volta.':
    'El .ls es la escena de Lumion. Lumion es un renderizador — importa geometría, pero no exporta el modelo de vuelta.',
  'O .max é o arquivo de cena do 3ds Max, proprietário.':
    'El .max es el archivo de escena de 3ds Max, propietario.',
  'O .pln é o projeto do ArchiCAD, em formato proprietário.':
    'El .pln es el proyecto de ArchiCAD, en formato propietario.',
  'O .rfa é uma família do Revit, também em formato proprietário.':
    'El .rfa es una familia de Revit, también en formato propietario.',
  'O .rvt é o arquivo de projeto do Revit — um banco de dados BIM proprietário, sem formato público. Só o próprio Revit consegue abri-lo.':
    'El .rvt es el archivo de proyecto de Revit — una base de datos BIM propietaria, sin formato público. Solo el propio Revit puede abrirlo.',
  'O .skp é o formato proprietário do SketchUp, sem leitor público.':
    'El .skp es el formato propietario de SketchUp, sin lector público.',
  'O BlenderBIM abre IFC e exporta GLB direto — é o caminho mais curto.':
    'BlenderBIM abre IFC y exporta GLB directamente — es el camino más corto.',
  'O SCC Builder tem uma API REST em PHP e um SDK orientado a objetos (<code>sdk/SccBuilder.php</code>) para automatizar conversões direto nas suas aplicações PHP.':
    'SCC Builder tiene una API REST en PHP y un SDK orientado a objetos (<code>sdk/SccBuilder.php</code>) para automatizar conversiones directamente en sus aplicaciones PHP.',
  'O IFC é aberto, mas é um formato de dados BIM (com propriedades, relações e geometria paramétrica), não uma malha pronta para renderizar. Suportá-lo exigiria um motor de geometria dedicado — está fora do escopo atual.':
    'El IFC es abierto, pero es un formato de datos BIM (con propiedades, relaciones y geometría paramétrica), no una malla lista para renderizar. Admitirlo exigiría un motor de geometría dedicado — está fuera del alcance actual.',
  'O Lumion não exporta geometria: exporte o modelo de origem como <strong>FBX (.fbx)</strong> ou <strong>DAE (.dae)</strong> antes de importar no SCC Builder.':
    'Lumion no exporta geometría: exporte el modelo de origen como <strong>FBX (.fbx)</strong> o <strong>DAE (.dae)</strong> antes de importarlo en SCC Builder.',
  'O Lumion não tem exportação de geometria: o caminho é sempre partir do arquivo original que você levou para dentro dele.':
    'Lumion no tiene exportación de geometría: el camino es siempre partir del archivo original que usted llevó a él.',
  'O SketchUp gera uma pasta com o mesmo nome do .dae contendo as texturas. Arraste a pasta INTEIRA para cá, não só o arquivo.':
    'SketchUp genera una carpeta con el mismo nombre del .dae con las texturas. Arrastre la carpeta ENTERA aquí, no solo el archivo.',
  'O add-on glTF do Blender aplica a rotação Y-up → Z-up na importação.':
    'El complemento glTF de Blender aplica la rotación Y-up → Z-up al importar.',
  'O arquivo foi lido, mas não contém nenhuma malha com geometria.':
    'El archivo se leyó, pero no contiene ninguna malla con geometría.',
  'O arquivo já veio organizado em grupos.': 'El archivo ya vino organizado en grupos.',
  'O formato ".^1" precisa ser exportado antes de ser importado.':
    'El formato ".^1" debe exportarse antes de importarse.',
  'O material identifica bem os sistemas construtivos.':
    'El material identifica bien los sistemas constructivos.',
  'O nome é longo demais (máximo 120 caracteres).':
    'El nombre es demasiado largo (máximo 120 caracteres).',
  'O objeto selecionado não é uma malha.': 'El objeto seleccionado no es una malla.',
  'O upload excedeu o tempo limite.': 'La subida superó el tiempo límite.',
  'O worker não processa o formato ".^1".': 'El worker no procesa el formato ".^1".',
  'OBJ — geometria simples, sem texturas embutidas':
    'OBJ — geometría simple, sin texturas incrustadas',
  'OCULTO (não será exportado)': 'OCULTO (no se exportará)',
  Ocultar: 'Ocultar',
  'Ocultar (não será exportado)': 'Ocultar (no se exportará)',
  'Ocultar ^1': 'Ocultar ^1',
  'Ocultar camada ^1': 'Ocultar la capa ^1',
  'Ocultar material ^1': 'Ocultar el material ^1',
  'Ocultar os blocos selecionados (tecla H)': 'Ocultar los bloques seleccionados (tecla H)',
  'Ocultar por material': 'Ocultar por material',
  'Ocultar todas as malhas deste material': 'Ocultar todas las mallas de este material',
  'Ocultos: ^1 triângulos em ^2 malha(s)': 'Ocultos: ^1 triángulos en ^2 malla(s)',
  'Opacidade / transparência': 'Opacidad / transparencia',
  'Organizar em ^1 camada(s) por ^2': 'Organizar en ^1 capa(s) por ^2',
  'Organizar em camadas': 'Organizar en capas',
  'Orientação dos eixos': 'Orientación de los ejes',
  'Os materiais selecionados não têm textura.': 'Los materiales seleccionados no tienen textura.',
  'Os nomes das malhas não indicam camadas. Agrupar por material é o caminho mais confiável neste arquivo.':
    'Los nombres de las mallas no indican capas. Agrupar por material es el camino más fiable en este archivo.',
  'Os nomes das malhas seguem uma convenção de camadas.':
    'Los nombres de las mallas siguen una convención de capas.',
  Otimizado: 'Optimizado',
  'Otimizando malha...': 'Optimizando la malla...',
  Otimização: 'Optimización',
  'Ou, para 3D: comando 3DPRINT → salvar como STL':
    'O, para 3D: comando 3DPRINT → guardar como STL',
  'Ouro (19,32 g/cm³)': 'Oro (19,32 g/cm³)',
  'PLY — malha com cores por vértice': 'PLY — malla con colores por vértice',
  'Para WebXR, mantenha a escala em metros: 1 unidade = 1 m no mundo real.':
    'Para WebXR, mantenga la escala en metros: 1 unidad = 1 m en el mundo real.',
  'Peças soltas (componentes conectados)': 'Piezas sueltas (componentes conectados)',
  'Pintura branca': 'Pintura blanca',
  'Pintura fosca (cor)': 'Pintura mate (color)',
  'Pivot centralizado e alinhado ao chão!': '¡Pivote centrado y alineado al suelo!',
  Polegadas: 'Pulgadas',
  Prever: 'Previsualizar',
  'Previsão (^1)': 'Previsión (^1)',
  'Processando...': 'Procesando...',
  'Progresso do carregamento': 'Progreso de la carga',
  Projeção: 'Proyección',
  'Pronto para exportar.': 'Listo para exportar.',
  Pés: 'Pies',
  'Recalcular normais de vértice': 'Recalcular normales de vértice',
  Refazer: 'Rehacer',
  'Refazer (Ctrl+Y)': 'Rehacer (Ctrl+Y)',
  'Refazer: ^1 (Ctrl+Y)': 'Rehacer: ^1 (Ctrl+Y)',
  'Refeito: ^1': 'Rehecho: ^1',
  'Remover textura do selecionado': 'Quitar la textura de la selección',
  'Renomear camada para "^1"': 'Renombrar la capa a "^1"',
  'Resina (1,12 g/cm³)': 'Resina (1,12 g/cm³)',
  'Resposta não-JSON da API.': 'Respuesta de la API que no es JSON.',
  'Restaurar a visibilidade de tudo (Shift+H)': 'Restaurar la visibilidad de todo (Shift+H)',
  'Revit: File → Export → CAD Formats → FBX (ou DAE). O FBX exige o conversor FBX2glTF instalado no servidor.':
    'Revit: File → Export → CAD Formats → FBX (o DAE). El FBX exige el conversor FBX2glTF instalado en el servidor.',
  Rotacionar: 'Rotar',
  'Rotacionar (E)': 'Rotar (E)',
  'Rugosidade:': 'Rugosidad:',
  'STL (binário para impressão 3D)': 'STL (binario para impresión 3D)',
  'STL — só malha, para impressão 3D': 'STL — solo malla, para impresión 3D',
  'Salvar arquivo': 'Guardar archivo',
  'Se o FBX sair muito pesado, esconda categorias que não precisa (mobiliário, vegetação, anotações) antes de exportar.':
    'Si el FBX sale muy pesado, oculte las categorías que no necesite (mobiliario, vegetación, anotaciones) antes de exportar.',
  'Se só tem o IFC, converta antes no BlenderBIM (gratuito) e exporte GLB':
    'Si solo tiene el IFC, conviértalo antes en BlenderBIM (gratuito) y exporte GLB',
  Selecionar: 'Seleccionar',
  'Selecionar (Q)': 'Seleccionar (Q)',
  'Selecione um arquivo 3D para testar o upload na API PHP.':
    'Seleccione un archivo 3D para probar la subida a la API PHP.',
  'Selecione um bloco na árvore ou clique nele na viewport. Use Ctrl+clique para escolher vários.':
    'Seleccione un bloque en el árbol o haga clic en él en el visor. Use Ctrl+clic para elegir varios.',
  'Selecione uma <strong>malha</strong> na árvore ou na viewport. Grupos não podem ser divididos — só as malhas dentro deles.':
    'Seleccione una <strong>malla</strong> en el árbol o en el visor. Los grupos no se pueden dividir — solo las mallas que contienen.',
  'Serão exportados: ^1 triângulos em ^2 malha(s)': 'Se exportarán: ^1 triángulos en ^2 malla(s)',
  'SketchUp: File → Export → 3D Model → Collada .DAE (marque "Export Texture Maps"). Arraste a PASTA inteira, o .dae vem com uma pasta de texturas ao lado.':
    'SketchUp: File → Export → 3D Model → Collada .DAE (marque "Export Texture Maps"). Arrastre la CARPETA entera: el .dae viene con una carpeta de texturas al lado.',
  'Slicer ativado — use os controles no painel direito':
    'Corte activado — use los controles del panel derecho',
  'Slicer desativado': 'Corte desactivado',
  'Solte um arquivo de imagem (JPG, PNG ou WEBP).':
    'Suelte un archivo de imagen (JPG, PNG o WEBP).',
  'Sphere — ideal para objetos redondos': 'Sphere — ideal para objetos redondos',
  'Só uma camada foi detectada — organizar não mudaria nada. Tente outra estratégia de agrupamento.':
    'Solo se detectó una capa — organizar no cambiaría nada. Pruebe otra estrategia de agrupamiento.',
  'TRIÂNGULOS:': 'TRIÁNGULOS:',
  'Também suporta:': 'También admite:',
  'Tempo de espera do job esgotado.': 'Se agotó el tiempo de espera del job.',
  'Testar o envio na API PHP (/api/convert.php)': 'Probar el envío a la API PHP (/api/convert.php)',
  'Textura ^1 aplicada a ^2 material(is) — projeção ^3.':
    'Textura ^1 aplicada a ^2 material(es) — proyección ^3.',
  'Textura removida de ^1 material(is).': 'Textura quitada de ^1 material(es).',
  Texturas: 'Texturas',
  Tijolo: 'Ladrillo',
  'Tipo de colisor': 'Tipo de colisionador',
  'Todas as ^1 malhas têm UV — qualquer projeção funciona.':
    'Las ^1 mallas tienen UV — cualquier proyección funciona.',
  'Transformar ^1': 'Transformar ^1',
  'Triplanar — dispensa UV (recomendado)': 'Triplanar — no necesita UV (recomendado)',
  'Triângulos: ^1 → ^2': 'Triángulos: ^1 → ^2',
  'UV do arquivo — exige mapeamento': 'UV del archivo — exige mapeado',
  'UVs geradas para ^1 malha(s).': 'UV generadas para ^1 malla(s).',
  'Um colisor por malha': 'Un colisionador por malla',
  'Unidade do arquivo de origem': 'Unidad del archivo de origen',
  'Unity usa sistema canhoto; o importador espelha o eixo Z sozinho.':
    'Unity usa un sistema zurdo; el importador refleja el eje Z por sí solo.',
  'Unreal trabalha em centímetros: o preset multiplica a escala por 100.':
    'Unreal trabaja en centímetros: el preset multiplica la escala por 100.',
  'Use GLTFLoader com DRACOLoader para abrir a saída otimizada.':
    'Use GLTFLoader con DRACOLoader para abrir la salida optimizada.',
  'VOLUME:': 'VOLUMEN:',
  'Ver guia de exportação': 'Ver guía de exportación',
  'Verifique se o WAMP está rodando e se a API responde em ^1':
    'Verifique que WAMP esté en marcha y que la API responda en ^1',
  Vidro: 'Vidrio',
  'Vidro fumê': 'Vidrio ahumado',
  'Vista de topo': 'Vista superior',
  'Vista de topo — planta (2)': 'Vista superior — planta (2)',
  'Vista frontal': 'Vista frontal',
  'Vista frontal — elevação (3)': 'Vista frontal — alzado (3)',
  'Vista iso / topo / frente / lateral': 'Vista iso / superior / frontal / lateral',
  'Vista isométrica': 'Vista isométrica',
  'Vista isométrica (1)': 'Vista isométrica (1)',
  'Vista lateral': 'Vista lateral',
  'Vista lateral (4)': 'Vista lateral (4)',
  'Vista: ^1': 'Vista: ^1',
  'Volte ao software de origem do modelo (Revit, SketchUp, ArchiCAD…)':
    'Vuelva al software de origen del modelo (Revit, SketchUp, ArchiCAD…)',
  'Volume real calculado por soma de tetraedros com sinal.':
    'Volumen real calculado como suma de tetraedros con signo.',
  'VÉRTICES:': 'VÉRTICES:',
  'Vá em <em>File → Export → CAD Formats → FBX</em>. O SCC Builder transforma o FBX em um GLB leve, pronto para game. IFC não é lido: exporte FBX em vez dele.':
    'Vaya a <em>File → Export → CAD Formats → FBX</em>. SCC Builder convierte el FBX en un GLB ligero, listo para juegos. El IFC no se lee: exporte FBX en su lugar.',
  'Vértices: ^1 → ^2': 'Vértices: ^1 → ^2',
  'Vértices: ^1 → ~^2': 'Vértices: ^1 → ~^2',
  'Worker falhou: ^1': 'Falló el worker: ^1',
  'Y-up, 1 unidade = 1 metro.': 'Y-up, 1 unidad = 1 metro.',
  'Y-up, metros, Draco recomendado.': 'Y-up, metros, Draco recomendado.',
  'Y-up, metros. Conformidade estrita com a spec glTF 2.0.':
    'Y-up, metros. Conformidad estricta con la especificación glTF 2.0.',
  'Z-up, 1 unidade = 1 centímetro.': 'Z-up, 1 unidad = 1 centímetro.',
  'Z-up, metros — o importador glTF do Blender já converte.':
    'Z-up, metros — el importador glTF de Blender ya lo convierte.',
  'Zoom por área': 'Zoom por área',
  'Zoom por área (arrastar retângulo)': 'Zoom por área (arrastrar un rectángulo)',
  'Zoom por área — arraste um retângulo na cena (tecla A)':
    'Zoom por área — arrastre un rectángulo sobre la escena (tecla A)',
  'Zoom por área: <strong>arraste um retângulo</strong> sobre a região que quer ampliar. Esc cancela.':
    'Zoom por área: <strong>arrastre un rectángulo</strong> sobre la región que quiere ampliar. Esc cancela.',
  '^1 aplicado a ^2 malha(s). Ctrl+Z desfaz.': '^1 aplicado a ^2 malla(s). Ctrl+Z deshace.',
  '^1 arquivo(s) convertidos com sucesso!': '¡^1 archivo(s) convertido(s) correctamente!',
  '^1 asset(s) não encontrado(s): ^2. Arraste a pasta inteira do modelo para incluir texturas e .mtl.':
    '^1 recurso(s) no encontrado(s): ^2. Arrastre la carpeta entera del modelo para incluir texturas y .mtl.',
  '^1 bloco(s) excluído(s). <strong>Ctrl+Z</strong> desfaz.':
    '^1 bloque(s) eliminado(s). <strong>Ctrl+Z</strong> deshace.',
  '^1 bloco(s) ocultado(s) — não entrarão na exportação.':
    '^1 bloque(s) ocultado(s) — no entrarán en la exportación.',
  '^1 bloco(s) oculto(s) omitido(s) — ^2 triângulos a menos.':
    '^1 bloque(s) oculto(s) omitido(s) — ^2 triángulos menos.',
  '^1 bloco(s) oculto(s) serão omitidos (^2 triângulos a menos)':
    '^1 bloque(s) oculto(s) se omitirán (^2 triángulos menos)',
  '^1 bloco(s) selecionado(s)': '^1 bloque(s) seleccionado(s)',
  '^1 blocos': '^1 bloques',
  '^1 camada(s) detectada(s).': '^1 capa(s) detectada(s).',
  '^1 colisor(es) do tipo ^2 gerado(s).': '^1 colisionador(es) de tipo ^2 generado(s).',
  '^1 colisor(es) exportado(s) em JSON.': '^1 colisionador(es) exportado(s) en JSON.',
  '^1 convertido(s), ^2 falharam. Veja _falhas.txt dentro do ZIP.':
    '^1 convertido(s), ^2 fallaron. Vea _falhas.txt dentro del ZIP.',
  '^1 de ^2 malhas têm UV (^3%). A triplanar cobre as demais.':
    '^1 de ^2 mallas tienen UV (^3%). La triplanar cubre las demás.',
  '^1 filho(s)': '^1 hijo(s)',
  '^1 material(is) com opacidade zero — o modelo ficaria invisível.':
    '^1 material(es) con opacidad cero — el modelo quedaría invisible.',
  '^1 material(is) convertidos para PBR.': '^1 material(es) convertido(s) a PBR.',
  '^1 material(is) forçados a opaco. Use Ctrl+Z para reverter.':
    '^1 material(es) forzado(s) a opaco. Use Ctrl+Z para revertir.',
  '^1 material(is) vinham com opacidade zero (bug conhecido de exportação Collada) e foram tornados opacos.':
    '^1 material(es) venían con opacidad cero (error conocido de exportación Collada) y se volvieron opacos.',
  '^1 material(is) vinham invisíveis (opacidade zero) e foram tornados opacos.':
    '^1 material(es) venían invisibles (opacidad cero) y se volvieron opacos.',
  '^1 mi': '^1 M',
  '^1 mil': '^1 mil',
  '^1 textura(s) com cor corrigida.': '^1 textura(s) con color corregido.',
  '^1 textura(s) sem imagem foram omitidas — os arquivos não estavam na pasta importada.':
    '^1 textura(s) sin imagen se omitieron — los archivos no estaban en la carpeta importada.',
  '^1 triângulos': '^1 triángulos',
  '^1 triângulos em <strong>^2</strong> peça(s) solta(s).':
    '^1 triángulos en <strong>^2</strong> pieza(s) suelta(s).',
  '^1 triângulos em ^2 malha(s)': '^1 triángulos en ^2 malla(s)',
  '^1 — ^2 malha(s), ^3 triângulos': '^1 — ^2 malla(s), ^3 triángulos',
  '^1 — ^2 objeto(s), ^3 triângulos': '^1 — ^2 objeto(s), ^3 triángulos',
  '^1% menos': '^1% menos',
  bloco: 'bloque',
  erro: 'error',
  'escala ×^1': 'escala ×^1',
  escalar: 'escalar',
  'extraindo malhas': 'extrayendo mallas',
  frontal: 'frontal',
  'glTF (JSON + assets)': 'glTF (JSON + recursos)',
  'glTF padrão (Khronos)': 'glTF estándar (Khronos)',
  'glTF — JSON legível, assets separados': 'glTF — JSON legible, recursos separados',
  hierarquia: 'jerarquía',
  'interpretando geometria': 'interpretando la geometría',
  isométrica: 'isométrica',
  lateral: 'lateral',
  'lendo arquivo': 'leyendo el archivo',
  'lendo vértices': 'leyendo vértices',
  malha: 'malla',
  'malha aberta': 'malla abierta',
  material: 'material',
  'meshoptimizer não disponível — a malha foi soldada, mas não simplificada. Execute "npm install meshoptimizer".':
    'meshoptimizer no disponible — la malla se soldó, pero no se simplificó. Ejecute "npm install meshoptimizer".',
  'meshoptimizer não disponível — execute "npm install meshoptimizer".':
    'meshoptimizer no disponible — ejecute "npm install meshoptimizer".',
  mover: 'mover',
  'nenhuma transformação necessária': 'ninguna transformación necesaria',
  nome: 'nombre',
  'otimizando ^1/^2': 'optimizando ^1/^2',
  ou: 'o',
  'ou clique para selecionar': 'o haga clic para seleccionar',
  rotacionar: 'rotar',
  topo: 'superior',
  '📦 Carregar modelo de exemplo...': '📦 Cargar modelo de ejemplo...',
  'Y-up, metros, Meshopt e 3 níveis de LOD.': 'Y-up, metros, Meshopt y 3 niveles de LOD.',
  'Preset dos prédios da Smart Chain City: o GLB vai direto para o lote.':
    'Preset de los edificios de Smart Chain City: el GLB va directo al lote.',
  'Até 300 mil triângulos por prédio; acima disso o lote recusa o modelo.':
    'Hasta 300 mil triángulos por edificio; por encima de eso el lote rechaza el modelo.',
  'Meshopt, LOD1/LOD2 e o contorno da base saem na conversão pelo servidor.':
    'Meshopt, LOD1/LOD2 y el contorno de la base salen de la conversión en el servidor.',
  'O modelo tem ^1 triângulos, acima do limite de ^2 do lote. Otimize antes de enviar.':
    'El modelo tiene ^1 triángulos, por encima del límite de ^2 del lote. Optimícelo antes de enviarlo.',
  'Exportar para o mapa': 'Exportar al mapa',
  'Ajusta o modelo aos limites da Smart Chain City (até 300 mil triângulos, 3 LODs, texturas até 2048 px, até 40 MB) e o coloca no seu lote no mapa':
    'Ajusta el modelo a los límites de Smart Chain City (hasta 300 mil triángulos, 3 LOD, texturas de hasta 2048 px, hasta 40 MB) y lo coloca en su lote en el mapa',
  'Mapa não configurado: defina VITE_SCC_MAP_URL no .env.':
    'Mapa no configurado: defina VITE_SCC_MAP_URL en el .env.',
  'O navegador bloqueou a janela do mapa. Permita pop-ups para este site.':
    'El navegador bloqueó la ventana del mapa. Permita las ventanas emergentes para este sitio.',
  'Ajustando o modelo para o mapa...': 'Ajustando el modelo para el mapa...',
  'Ajustando o modelo para o mapa (tentativa ^1 de ^2)...':
    'Ajustando el modelo para el mapa (intento ^1 de ^2)...',
  'Enviando ao mapa...': 'Enviando al mapa...',
  'Triângulos: ^1 → ^2 (LOD1 ^3, LOD2 ^4)': 'Triángulos: ^1 → ^2 (LOD1 ^3, LOD2 ^4)',
  'Tamanho: ^1 → ^2 (limite 40 MB)': 'Tamaño: ^1 → ^2 (límite 40 MB)',
  '^1 textura(s) reduzida(s) para ^2 px': '^1 textura(s) reducida(s) a ^2 px',
  'Atenção: ^1 materiais; o limite por prédio é ^2.':
    'Atención: ^1 materiales; el límite por edificio es ^2.',
  'Modelo enviado ao mapa da Smart Chain City.': 'Modelo enviado al mapa de Smart Chain City.',
  'Mesmo simplificado, o modelo passa dos limites do mapa (300 mil triângulos, 40 MB). Oculte blocos que não fazem parte do prédio (paisagismo, terreno) e tente de novo.':
    'Incluso simplificado, el modelo supera los límites del mapa (300 mil triángulos, 40 MB). Oculte los bloques que no forman parte del edificio (paisajismo, terreno) e inténtelo de nuevo.',
  'A janela do mapa foi fechada antes de receber o modelo.':
    'La ventana del mapa se cerró antes de recibir el modelo.',
  'O mapa não respondeu. Confira se ele está no ar em ^1':
    'El mapa no respondió. Compruebe que esté funcionando en ^1',
  'O mapa recusou o modelo: ^1': 'El mapa rechazó el modelo: ^1',
};
