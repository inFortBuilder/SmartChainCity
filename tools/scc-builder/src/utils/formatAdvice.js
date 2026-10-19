/**
 * Orientação para formatos que NÃO conseguimos abrir.
 *
 * `.rvt`, `.skp`, `.max` e afins são formatos proprietários fechados, sem
 * especificação pública e sem biblioteca capaz de lê-los fora do software
 * de origem. Não é uma limitação que dá para contornar com mais código:
 * ler um `.rvt` exige o próprio Revit, ou o serviço em nuvem da Autodesk.
 *
 * Em vez de responder "formato não suportado" e deixar o usuário sem saída,
 * cada formato tem aqui o passo a passo de exportação do seu software.
 */
import { t } from '../i18n/index.js';

/**
 * @typedef {object} OrientacaoFormato
 * @property {string} software
 * @property {string} motivo
 * @property {string[]} passos
 * @property {string[]} recomendado extensões que devem ser usadas
 * @property {string} [dica]
 */

/** @type {Record<string, OrientacaoFormato>} */
export const FORMATOS_NATIVOS = {
  rvt: {
    software: 'Autodesk Revit',
    motivo: t(
      'O .rvt é o arquivo de projeto do Revit — um banco de dados BIM proprietário, sem formato público. Só o próprio Revit consegue abri-lo.'
    ),
    passos: [
      t('Abra o projeto no Revit'),
      t('Defina uma vista 3D (o export usa a vista ativa)'),
      t('Arquivo → Exportar → CAD Formats → FBX'),
      t('Em Opções, marque "Embed Media" para incluir as texturas no arquivo'),
      t('Importe o .fbx aqui'),
    ],
    recomendado: ['fbx', 'dae'],
    dica: t(
      'Se o FBX sair muito pesado, esconda categorias que não precisa (mobiliário, vegetação, anotações) antes de exportar.'
    ),
  },

  rfa: {
    software: 'Autodesk Revit',
    motivo: t('O .rfa é uma família do Revit, também em formato proprietário.'),
    passos: [
      t('Abra a família no Revit'),
      t('Arquivo → Exportar → CAD Formats → FBX'),
      t('Importe o .fbx aqui'),
    ],
    recomendado: ['fbx', 'dae'],
  },

  skp: {
    software: 'SketchUp',
    motivo: t('O .skp é o formato proprietário do SketchUp, sem leitor público.'),
    passos: [
      t('Abra o modelo no SketchUp'),
      t('Arquivo → Exportar → Modelo 3D'),
      t('Escolha Collada (.dae)'),
      t('Em Opções, marque "Exportar mapas de textura"'),
      t('Importe o .dae junto com a pasta de texturas que o SketchUp criar'),
    ],
    recomendado: ['dae', 'obj'],
    dica: t(
      'O SketchUp gera uma pasta com o mesmo nome do .dae contendo as texturas. Arraste a pasta INTEIRA para cá, não só o arquivo.'
    ),
  },

  max: {
    software: 'Autodesk 3ds Max',
    motivo: t('O .max é o arquivo de cena do 3ds Max, proprietário.'),
    passos: [
      t('Abra a cena no 3ds Max'),
      t('Arquivo → Exportar → Exportar'),
      t('Escolha Autodesk (*.FBX)'),
      t('Marque "Embed Media" e defina Units como Meters'),
      t('Importe o .fbx aqui'),
    ],
    recomendado: ['fbx', 'obj'],
  },

  ls: {
    software: 'Lumion',
    motivo: t(
      'O .ls é a cena do Lumion. O Lumion é um renderizador — ele importa geometria, mas não exporta o modelo de volta.'
    ),
    passos: [
      t('Volte ao software de origem do modelo (Revit, SketchUp, ArchiCAD…)'),
      t('Exporte de lá como FBX ou DAE'),
      t('Importe esse arquivo aqui'),
    ],
    recomendado: ['fbx', 'dae'],
    dica: t(
      'O Lumion não tem exportação de geometria: o caminho é sempre partir do arquivo original que você levou para dentro dele.'
    ),
  },

  pln: {
    software: 'ArchiCAD',
    motivo: t('O .pln é o projeto do ArchiCAD, em formato proprietário.'),
    passos: [
      t('Abra o projeto no ArchiCAD'),
      t('Ative uma vista 3D'),
      t('Arquivo → Salvar como → Collada (.dae) ou Wavefront (.obj)'),
      t('Importe o arquivo aqui'),
    ],
    recomendado: ['dae', 'obj', 'fbx'],
  },

  dwg: {
    software: 'AutoCAD',
    motivo: t(
      'O .dwg é majoritariamente 2D e, quando tem 3D, usa sólidos ACIS que não têm malha triangulada — o que um viewer WebGL precisa.'
    ),
    passos: [
      t('Abra o desenho no AutoCAD'),
      t('Comando EXPORTAR → escolha FBX'),
      t('Ou, para 3D: comando 3DPRINT → salvar como STL'),
      t('Importe o arquivo aqui'),
    ],
    recomendado: ['fbx', 'stl', 'obj'],
  },

  ifc: {
    software: 'BIM (IFC)',
    motivo: t(
      'O IFC é aberto, mas é um formato de dados BIM (com propriedades, relações e geometria paramétrica), não uma malha pronta para renderizar. Suportá-lo exigiria um motor de geometria dedicado — está fora do escopo atual.'
    ),
    passos: [
      t('No Revit: Arquivo → Exportar → CAD Formats → FBX (em vez de IFC)'),
      t('No ArchiCAD: Salvar como → Collada (.dae)'),
      t('Se só tem o IFC, converta antes no BlenderBIM (gratuito) e exporte GLB'),
    ],
    recomendado: ['fbx', 'dae', 'glb'],
    dica: t('O BlenderBIM abre IFC e exporta GLB direto — é o caminho mais curto.'),
  },

  '3dm': {
    software: 'Rhinoceros',
    motivo: t('O .3dm usa NURBS, que precisam ser trianguladas antes de renderizar.'),
    passos: [
      t('Abra no Rhino'),
      t('Arquivo → Exportar Selecionados'),
      t('Escolha OBJ ou FBX e aceite as opções de malha'),
      t('Importe o arquivo aqui'),
    ],
    recomendado: ['obj', 'fbx'],
  },

  blend: {
    software: 'Blender',
    motivo: t('O .blend é o arquivo interno do Blender.'),
    passos: [
      t('Abra no Blender'),
      'File → Export → glTF 2.0 (.glb/.gltf)',
      t('Escolha o formato GLB (binário) — já sai com as texturas embutidas'),
      t('Importe o .glb aqui'),
    ],
    recomendado: ['glb'],
    dica: t('GLB do Blender é o melhor caminho: sai otimizado e com tudo embutido.'),
  },

  '3mf': {
    software: t('Impressão 3D'),
    motivo: t(
      'O .3mf é um container ZIP com XML — suportá-lo exigiria um loader dedicado que ainda não temos.'
    ),
    passos: [t('No seu fatiador ou CAD, exporte como STL ou OBJ'), t('Importe o arquivo aqui')],
    recomendado: ['stl', 'obj'],
  },
};

/**
 * Há orientação cadastrada para esta extensão?
 * @param {string} extensao
 */
export function temOrientacao(extensao) {
  return Object.hasOwn(FORMATOS_NATIVOS, extensao.toLowerCase());
}

/**
 * @param {string} extensao
 * @returns {OrientacaoFormato|null}
 */
export function orientacaoPara(extensao) {
  return FORMATOS_NATIVOS[extensao.toLowerCase()] ?? null;
}

/**
 * Monta a mensagem HTML mostrada quando o usuário tenta abrir um formato
 * nativo. Todo texto interpolado vem deste módulo (não do nome do arquivo),
 * então não há risco de injeção.
 *
 * @param {string} extensao
 * @param {(texto: string) => string} escape função de escape para o nome
 * @param {string} [nomeArquivo]
 */
export function mensagemOrientacao(extensao, escape, nomeArquivo = '') {
  const orientacao = orientacaoPara(extensao);
  const ext = escape(extensao.toUpperCase());

  if (!orientacao) {
    return (
      `<strong>${t('Formato .^1 não suportado', ext)}</strong><br>` +
      t('Formatos aceitos: GLB, GLTF, OBJ, STL, PLY, FBX e DAE.')
    );
  }

  const passos = orientacao.passos
    .map((passo) => `<li style="margin:2px 0">${escape(passo)}</li>`)
    .join('');

  const formatos = orientacao.recomendado.map((f) => `.${f.toUpperCase()}`).join(` ${t('ou')} `);

  const arquivo = nomeArquivo ? ` (${escape(nomeArquivo)})` : '';

  return (
    `<strong>${t('.^1 é um arquivo do ^2', ext, escape(orientacao.software))}</strong>${arquivo}<br>` +
    `<span style="color:#cbd5e1;font-size:0.8rem">${escape(orientacao.motivo)}</span>` +
    `<br><br><strong>${t('Como resolver — exporte como ^1:', escape(formatos))}</strong>` +
    `<ol style="margin:4px 0 0;padding-left:18px;font-size:0.8rem">${passos}</ol>` +
    (orientacao.dica
      ? `<br><span style="color:#fbbf24;font-size:0.78rem">${t('Dica: ^1', escape(orientacao.dica))}</span>`
      : '')
  );
}
