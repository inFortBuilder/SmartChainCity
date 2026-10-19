import './style.css';
import { aplicarNoDom, locale, t } from './i18n/index.js';
import { StudioViewer } from './viewer.js';
import { ACCEPT_ATTRIBUTE, EXPORT_FORMATS, ModelConverter } from './converter.js';
import { apiClient } from './api/client.js';
import { filesFromDrop, pickMainModel } from './utils/assets.js';
import { estimateMass, formatCount } from './utils/geometry.js';
import { HierarchyTree } from './ui/hierarchyTree.js';
import { renderIcons } from './ui/icons.js';
import { openExportDialog, sanitizeFileName } from './ui/exportDialog.js';
import {
  OrganizeInLayersCommand,
  SplitMeshCommand,
  detectLayers,
  existingLayers,
  isOrganized,
  suggestLayerMode,
} from './utils/layers.js';
import { previewSplit, splitMesh } from './utils/meshSplit.js';
import {
  analyzeUVs,
  applyTriplanar,
  generateUVsForObject,
  materialFromPreset,
  presetList,
  removeTriplanar,
  setTriplanarScale,
  textureFromFile,
} from './utils/texturing.js';
import {
  CallbackCommand,
  History,
  MaterialCommand,
  TransformCommand,
  captureMaterial,
} from './utils/history.js';
import { CLIENT_PROFILES, buildLOD, optimize, preview } from './utils/optimizer.js';
import { ENGINE_PRESETS, SOURCE_UNITS, applyPreset, presetNotes } from './utils/enginePresets.js';
import { buildModelMessage, deliverToMap, originOf, resolveMapUrl } from './utils/mapLink.js';
import { preparePackageForMap } from './utils/mapExport.js';
import { materialsOf } from './utils/materials.js';
import { ParseCancelled } from './utils/parseClient.js';
import { diagnose } from './utils/materialRepair.js';
import { mensagemOrientacao, temOrientacao } from './utils/formatAdvice.js';
import {
  DeleteCommand,
  IsolateCommand,
  ShowAllCommand,
  VisibilityCommand,
  countTriangles,
  exportPreview,
  groupByMaterial,
} from './utils/sceneEditor.js';
import {
  createModernVillaSample,
  createSkyscraperSample,
  createGearMechanicalSample,
  createTorusKnotSample,
} from './sampleModels.js';

// ============================================================
// 1. INICIALIZAR MOTOR 3D
// ============================================================
const canvasContainer = document.getElementById('canvas-container');
const converter = new ModelConverter();

const history = new History({
  limit: 60,
  onChange: (state) => updateHistoryButtons(state),
});

const viewer = new StudioViewer(canvasContainer, {
  // F10 — clicar na viewport seleciona a malha e sincroniza a árvore.
  onSelect: (object) => {
    tree?.revealAndSelect(object);
    syncMaterialPanel(object);
  },
  // Item 37 — um arrasto de gizmo inteiro vira um único comando de undo.
  onTransform: (object, before, after) => {
    history.push(new TransformCommand(object, before, after), { skipExecute: true });
    refreshStats();
  },
});

// KTX2 precisa do renderer para detectar o formato suportado pela GPU.
converter.setRenderer(viewer.renderer);

/** @type {HierarchyTree|null} */
let tree = null;

/** Controlador de cancelamento do carregamento em curso. */
let loadAbort = null;

const loadedFiles = [];
let currentModel = null;
let currentBundle = null;
let activeSoftware = null;
let wireframeOn = false;
let slicerOn = false;

/** Escapa texto vindo do usuário antes de qualquer innerHTML (F13 — XSS). */
function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
  );
}

/** Libera o modelo e os object URLs anteriores (F4). */
function releaseCurrent() {
  currentBundle?.revoke();
  currentBundle = null;
}

window.addEventListener('beforeunload', () => {
  releaseCurrent();
  viewer.dispose();
});

// ============================================================
// 2. REFERÊNCIAS DOM — obtidas após DOM carregado
// ============================================================
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const modelList = document.getElementById('model-list');
const hierarchyTree = document.getElementById('hierarchy-tree');
const sampleSelect = document.getElementById('sample-model-select');
const exportFormatSel = document.getElementById('export-format-select');
const axisFlipSel = document.getElementById('axis-flip-select');
const slicerPanel = document.getElementById('slicer-panel');
const sliceX = document.getElementById('slice-x');
const sliceY = document.getElementById('slice-y');
const sliceZ = document.getElementById('slice-z');
const statVerts = document.getElementById('stat-verts');
const statTris = document.getElementById('stat-tris');
const statBounds = document.getElementById('stat-bounds');
const statVol = document.getElementById('stat-vol');
const matColorPicker = document.getElementById('mat-color-picker');
const matRoughness = document.getElementById('mat-roughness');
const matMetallic = document.getElementById('mat-metallic');
const matOpacity = document.getElementById('mat-opacity');
const densityPreset = document.getElementById('density-preset');
const estWeight = document.getElementById('est-weight');
const swHintBar = document.getElementById('sw-hint-bar');
const swHintText = document.getElementById('sw-hint-text');

// ============================================================
// 3. TOAST & SPINNER
// ============================================================
function showToast(message, type = 'info', duration = 3500) {
  const old = document.getElementById('c3d-toast');
  if (old) old.remove();

  const colors = { info: '#00f0ff', success: '#10b981', error: '#f43f5e', warn: '#f59e0b' };
  const icons = { info: 'ℹ', success: '✔', error: '✖', warn: '⚠' };
  const color = colors[type] || colors.info;

  const el = document.createElement('div');
  el.id = 'c3d-toast';
  el.style.cssText = `
    position:fixed; bottom:24px; right:24px; z-index:99999;
    padding:12px 18px; border-radius:10px;
    background:rgba(10,14,22,0.97); border:1px solid ${color};
    color:#fff; font-size:0.85rem; font-family:var(--font-body);
    box-shadow:0 8px 32px rgba(0,0,0,0.6); max-width:360px;
    animation:slideInRight 0.3s ease; backdrop-filter:blur(12px);
    display:flex; align-items:flex-start; gap:10px;
  `;
  el.innerHTML = `
    <style>@keyframes slideInRight{from{opacity:0;transform:translateX(60px)}to{opacity:1;transform:translateX(0)}}</style>
    <span style="color:${color};font-size:1rem;font-weight:700;flex-shrink:0">${icons[type] || 'ℹ'}</span>
    <span>${message}</span>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

function showSpinner(visible, msg = t('Processando...')) {
  let el = document.getElementById('c3d-spinner');
  if (!visible) {
    el?.remove();
    return;
  }
  if (el) {
    el.querySelector('p').textContent = msg;
    return;
  }
  el = document.createElement('div');
  el.id = 'c3d-spinner';
  el.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(8px);
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    z-index:9999;gap:16px;
  `;
  el.innerHTML = `
    <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    <div style="width:52px;height:52px;border:4px solid rgba(0,240,255,0.15);
      border-top:4px solid #00f0ff;border-radius:50%;animation:spin 0.8s linear infinite"></div>
    <p style="color:#fff;font-family:var(--font-heading);font-size:1rem;margin:0">${msg}</p>
  `;
  document.body.appendChild(el);
}

/**
 * Overlay de progresso com barra e botão Cancelar.
 *
 * Substitui o spinner indeterminado da v1: agora o worker reporta o
 * percentual real e o usuário pode interromper um arquivo de 300 MB.
 *
 * @param {boolean} visible
 * @param {string} [message]
 * @param {number|null} [percent] null = indeterminado
 * @param {(() => void)|null} [onCancel]
 */
function showProgress(visible, message = t('Processando...'), percent = null, onCancel = null) {
  let el = document.getElementById('c3d-progress');

  if (!visible) {
    el?.remove();

    return;
  }

  if (!el) {
    el = document.createElement('div');
    el.id = 'c3d-progress';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-label', t('Progresso do carregamento'));
    el.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.72);backdrop-filter:blur(8px);
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      z-index:9999;gap:14px;
    `;
    el.innerHTML = `
      <p data-role="msg" style="color:#fff;font-size:1rem;margin:0;max-width:70vw;text-align:center"></p>
      <div style="width:min(420px,70vw);height:6px;background:rgba(255,255,255,0.12);border-radius:3px;overflow:hidden">
        <div data-role="bar" style="height:100%;width:0%;background:#00f0ff;transition:width 0.2s ease"></div>
      </div>
      <p data-role="pct" style="color:#9ca3af;font-size:0.8rem;margin:0"></p>
      <button data-role="cancel" type="button"
        style="margin-top:6px;padding:6px 16px;border-radius:6px;cursor:pointer;
               background:transparent;border:1px solid rgba(255,255,255,0.25);color:#e5e7eb;
               font-size:0.8rem">${t('Cancelar')}</button>
    `;
    document.body.appendChild(el);
  }

  el.querySelector('[data-role="msg"]').textContent = message;

  const bar = el.querySelector('[data-role="bar"]');
  const pct = el.querySelector('[data-role="pct"]');

  if (percent === null) {
    bar.style.width = '100%';
    bar.style.opacity = '0.4';
    pct.textContent = '';
  } else {
    bar.style.opacity = '1';
    bar.style.width = `${Math.max(2, Math.min(100, percent))}%`;
    pct.textContent = `${Math.round(percent)}%`;
  }

  const cancel = el.querySelector('[data-role="cancel"]');
  cancel.style.display = onCancel ? '' : 'none';
  if (onCancel) {
    cancel.onclick = () => {
      onCancel();
      showProgress(false);
    };
  }
}

// ============================================================
// 4. MODAIS
// ============================================================
/**
 * Modais acessíveis (item 40): foco preso dentro do diálogo, `aria-hidden`
 * sincronizado e devolução do foco ao elemento que abriu.
 */
let lastFocused = null;

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;

  lastFocused = document.activeElement;

  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');

  // Foca o primeiro controle utilizável do diálogo.
  const focusable = modal.querySelector(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  focusable?.focus();

  modal.addEventListener('keydown', trapFocus);
}

function closeAllModals() {
  for (const modal of document.querySelectorAll('.modal-overlay')) {
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    modal.removeEventListener('keydown', trapFocus);
  }

  lastFocused?.focus?.();
  lastFocused = null;
}

/** Mantém o Tab circulando dentro do modal aberto. */
function trapFocus(event) {
  if (event.key !== 'Tab') return;

  const focusable = [
    ...event.currentTarget.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    ),
  ].filter((el) => !el.disabled && el.offsetParent !== null);

  if (focusable.length === 0) return;

  const first = focusable[0];
  const last = focusable.at(-1);

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

document.getElementById('btn-api-modal')?.addEventListener('click', () => openModal('modal-api'));
document.getElementById('btn-docs-modal')?.addEventListener('click', () => openModal('modal-docs'));
document.querySelectorAll('.modal-overlay').forEach((o) =>
  o.addEventListener('click', (e) => {
    if (e.target === o) closeAllModals();
  })
);
document
  .querySelectorAll('.modal-close')
  .forEach((b) => b.addEventListener('click', closeAllModals));

// ============================================================
// 5. ESTATÍSTICAS HUD
// ============================================================
function refreshStats() {
  const s = viewer.getStats();

  if (statVerts) statVerts.textContent = formatCount(s.vertices);
  if (statTris) statTris.textContent = formatCount(s.triangles);
  if (statBounds) {
    statBounds.textContent = `${s.size.x.toFixed(2)} × ${s.size.y.toFixed(2)} × ${s.size.z.toFixed(2)}`;
  }

  // F8 — volume só é exibido quando a malha é fechada. Antes mostrávamos
  // bbox × 0,75, que errava por ordens de magnitude.
  if (statVol) {
    statVol.textContent =
      s.volumeCm3 === null
        ? t('malha aberta')
        : `${s.volumeCm3.toLocaleString(locale, { maximumFractionDigits: 2 })} cm³`;
    statVol.title =
      s.volumeCm3 === null
        ? t(
            'Malha não estanque (^1 arestas de borda) — volume não pode ser calculado com precisão.',
            s.boundaryEdges
          )
        : t('Volume real calculado por soma de tetraedros com sinal.');
  }

  const density = Number.parseFloat(densityPreset?.value ?? '1.24');
  if (estWeight) {
    estWeight.textContent =
      s.volumeCm3 === null
        ? '—'
        : `${estimateMass(s.volumeCm3, density).toLocaleString(locale, { maximumFractionDigits: 2 })} g`;
  }
}

densityPreset?.addEventListener('change', refreshStats);

// ============================================================
// 6. ÁRVORE DE HIERARQUIA DA CENA
// ============================================================
/**
 * F11 — árvore virtualizada e acessível (src/ui/hierarchyTree.js).
 *
 * A v1 criava um elemento por nó da cena, recursivamente: um modelo de
 * Revit com 30 mil nós congelava a aba. Agora só a janela visível existe
 * no DOM (~40 elementos), com navegação por teclado e papéis ARIA.
 */
function buildHierarchyTree(root) {
  if (!hierarchyTree) return;

  if (!tree) {
    tree = new HierarchyTree(hierarchyTree, {
      onSelect: (object) => {
        viewer.select(object);
        syncMaterialPanel(object);
      },
      // Clique no olho: registra no histórico, então Ctrl+Z reverte.
      onToggleVisibility: (object) => {
        history.push(new VisibilityCommand([object], !object.visible));
        tree.refresh();
        atualizarPainelBlocos();
      },
      onSelectionChange: () => atualizarPainelBlocos(),
    });
  }

  tree.setRoot(root);
}

/** Reflete o material do objeto selecionado nos controles PBR. */
function syncMaterialPanel(object) {
  if (!object?.isMesh) return;

  const material = Array.isArray(object.material) ? object.material[0] : object.material;
  if (!material) return;

  if (matColorPicker && material.color) {
    matColorPicker.value = `#${material.color.getHexString()}`;
  }
  if (matRoughness && typeof material.roughness === 'number') {
    matRoughness.value = String(material.roughness);
    const el = document.getElementById('val-roughness');
    if (el) el.textContent = material.roughness.toFixed(2);
  }
  if (matMetallic && typeof material.metalness === 'number') {
    matMetallic.value = String(material.metalness);
    const el = document.getElementById('val-metallic');
    if (el) el.textContent = material.metalness.toFixed(2);
  }
  if (matOpacity) matOpacity.value = String(material.opacity ?? 1);
}

// ============================================================
// 7. CARREGAR E EXIBIR MODELO
// ============================================================
/**
 * @param {File} file modelo principal
 * @param {File[]} [companions] .mtl, .bin e texturas que vieram junto (F5)
 */
async function loadAndDisplayModel(file, companions = []) {
  // F12 — o parsing pesado roda em Web Worker, então o progresso é real e
  // o botão Cancelar de fato interrompe.
  loadAbort?.abort();
  loadAbort = new AbortController();

  showProgress(true, t('Carregando ^1', file.name), 0, () => loadAbort?.abort());

  try {
    const { object, bundle, missing, reparo } = await converter.loadModel(file, {
      companions,
      signal: loadAbort.signal,
      onProgress: (percent, stage) => showProgress(true, `${file.name} — ${stage}`, percent),
    });

    releaseCurrent();
    currentBundle = bundle;
    currentModel = object;

    viewer.setModel(object);
    buildHierarchyTree(object);
    refreshStats();
    atualizarPainelBlocos();
    atualizarListaMateriais();
    atualizarIndicadorZoom();
    atualizarStatusUV();
    atualizarSugestaoLayers();
    history.clear();

    showToast(t('Modelo carregado: ^1', `<strong>${escapeHtml(file.name)}</strong>`), 'success');

    // Relata o que precisou ser consertado no material e o que ainda está
    // errado. Modelos de Lumion/SketchUp quase sempre caem aqui.
    relatarReparo(reparo, object);

    if (missing.length > 0) {
      const list = missing.slice(0, 3).map(escapeHtml).join(', ');
      showToast(
        t(
          '^1 asset(s) não encontrado(s): ^2. Arraste a pasta inteira do modelo para incluir texturas e .mtl.',
          missing.length,
          list
        ),
        'warn',
        7000
      );
    }

    if (!loadedFiles.some((item) => item.name === file.name)) {
      loadedFiles.push(file);
      updateModelListUI();
    }
  } catch (error) {
    if (error instanceof ParseCancelled || error.name === 'AbortError') {
      showToast(t('Carregamento cancelado.'), 'info', 2000);
    } else if (error.code === 'formato_nativo' || temOrientacao(error.extension ?? '')) {
      // .rvt, .skp, .max… não têm leitor público. Em vez de "não suportado",
      // mostramos o passo a passo de exportação do software de origem.
      mostrarOrientacaoFormato(error.extension ?? '', file.name);
    } else {
      showToast(
        t('Erro ao carregar ^1: ^2', escapeHtml(file.name), escapeHtml(error.message)),
        'error',
        6000
      );
      console.error('[SCC Builder] Falha ao carregar:', error);
    }
  } finally {
    loadAbort = null;
    showProgress(false);
    showSpinner(false);
  }
}

function updateModelListUI() {
  if (!modelList) return;
  if (loadedFiles.length === 0) {
    modelList.innerHTML = `<div style="font-size:0.8rem;color:var(--text-dim);text-align:center;padding:10px">${t('Nenhum modelo carregado.')}</div>`;
    return;
  }
  modelList.innerHTML = '';
  loadedFiles.forEach((file) => {
    const ext = file.name.split('.').pop().toUpperCase();
    const item = document.createElement('div');
    item.style.cssText = `
      display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;
      background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);
      cursor:pointer;font-size:0.78rem;transition:background 0.15s;
    `;
    item.innerHTML = `
      <span style="background:rgba(0,240,255,0.15);color:#00f0ff;padding:2px 6px;border-radius:3px;font-weight:700;font-size:0.65rem;flex-shrink:0">${escapeHtml(ext)}</span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${escapeHtml(file.name)}</span>
    `;
    item.addEventListener('mouseenter', () => (item.style.background = 'rgba(255,255,255,0.07)'));
    item.addEventListener('mouseleave', () => (item.style.background = 'rgba(255,255,255,0.04)'));
    item.addEventListener('click', () => loadAndDisplayModel(file));
    modelList.appendChild(item);
  });
}

// ============================================================
// 8. DRAG & DROP + FILE INPUT
// ============================================================
dropzone?.addEventListener('click', (e) => {
  // Não disparar se clicar em um card de software (eles têm sua própria lógica)
  if (e.target.closest('.software-card')) return;
  fileInput?.click();
});

dropzone?.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});
dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
/**
 * F5 — aceita pastas inteiras. O modelo principal é detectado por prioridade
 * de formato e todos os demais arquivos viram assets de apoio.
 */
async function handleIncomingFiles(files) {
  if (files.length === 0) return;

  const main = pickMainModel(files);
  if (!main) {
    showToast(t('Nenhum modelo 3D reconhecido nos arquivos selecionados.'), 'warn');

    return;
  }

  const companions = files.filter((file) => file !== main);

  for (const file of files) {
    if (!loadedFiles.some((item) => item.name === file.name)) loadedFiles.push(file);
  }

  await loadAndDisplayModel(main, companions);
  updateModelListUI();
}

dropzone?.addEventListener('drop', async (event) => {
  event.preventDefault();
  dropzone.classList.remove('dragover');

  await handleIncomingFiles(await filesFromDrop(event.dataTransfer));
});

fileInput?.addEventListener('change', async () => {
  await handleIncomingFiles(Array.from(fileInput.files));
  updateModelListUI();
  fileInput.value = ''; // reset para permitir re-seleção do mesmo arquivo
});

// ============================================================
// 9. CARDS DE SOFTWARE (3ds Max, Revit, SketchUp, Lumion)
// ============================================================
const softwareHints = {
  '3dsmax': t('3ds Max: File → Export → FBX (marque "Embed Media" para incluir texturas)'),
  revit: t(
    'Revit: File → Export → CAD Formats → FBX (ou DAE). O FBX exige o conversor FBX2glTF instalado no servidor.'
  ),
  sketchup: t(
    'SketchUp: File → Export → 3D Model → Collada .DAE (marque "Export Texture Maps"). Arraste a PASTA inteira, o .dae vem com uma pasta de texturas ao lado.'
  ),
  lumion: t(
    'Lumion não exporta geometria. Volte ao Revit/SketchUp/ArchiCAD de origem e exporte de lá como FBX ou DAE (com texturas).'
  ),
};
const softwareAccept = {
  '3dsmax': '.fbx,.obj',
  revit: '.fbx,.dae',
  sketchup: '.dae,.obj',
  lumion: '.fbx,.dae',
};

document.querySelectorAll('.software-card').forEach((card) => {
  card.addEventListener('click', () => {
    const sw = card.dataset.software;

    // Deselect se já estava ativo
    if (activeSoftware === sw) {
      activeSoftware = null;
      card.classList.remove('active');
      if (swHintBar) swHintBar.style.display = 'none';
      if (fileInput) fileInput.accept = ACCEPT_ATTRIBUTE;
      return;
    }

    // Ativar card selecionado
    document.querySelectorAll('.software-card').forEach((c) => c.classList.remove('active'));
    card.classList.add('active');
    activeSoftware = sw;

    // Mostrar dica de exportação
    if (swHintText) swHintText.textContent = softwareHints[sw] || '';
    if (swHintBar) swHintBar.style.display = 'flex';

    // Filtrar extensões aceitas para o software
    if (fileInput) fileInput.accept = softwareAccept[sw] || '.fbx,.obj,.dae';

    // Abrir seletor de arquivo
    setTimeout(() => fileInput?.click(), 50);
  });
});

// Botão "Ver guia" dentro da hint bar
document.getElementById('btn-docs-hint')?.addEventListener('click', () => openModal('modal-docs'));

// ============================================================
// 10. MODELOS SAMPLE / DEMONSTRAÇÃO
// ============================================================
sampleSelect?.addEventListener('change', () => {
  const val = sampleSelect.value;
  const creators = {
    villa: () => createModernVillaSample(),
    skyscraper: () => createSkyscraperSample(),
    gear: () => createGearMechanicalSample(),
    knot: () => createTorusKnotSample(),
  };
  const fn = creators[val];
  if (!fn) return;

  releaseCurrent();

  const model = fn();
  currentModel = model;

  viewer.setModel(model);
  buildHierarchyTree(model);
  refreshStats();

  // Os samples entram por um caminho próprio, fora de loadAndDisplayModel —
  // os painéis dependentes do modelo precisam ser atualizados aqui também.
  atualizarPainelBlocos();
  atualizarListaMateriais();
  atualizarIndicadorZoom();
  atualizarStatusUV();
  atualizarSugestaoLayers();
  history.clear();

  const label = sampleSelect.options[sampleSelect.selectedIndex]?.text || val;
  showToast(
    t('Modelo de exemplo carregado: ^1', `<strong>${escapeHtml(label)}</strong>`),
    'success'
  );
  sampleSelect.value = '';
});

// ============================================================
// 11. GIZMO & CONTROLES DA VIEWPORT
// ============================================================
const gizmoBtns = {
  'gizmo-select': 'off',
  'gizmo-move': 'translate',
  'gizmo-rotate': 'rotate',
  'gizmo-scale': 'scale',
};
const nomesModo = { translate: t('mover'), rotate: t('rotacionar'), scale: t('escalar') };
const nomesVista = {
  iso: t('isométrica'),
  top: t('topo'),
  front: t('frontal'),
  side: t('lateral'),
};
Object.entries(gizmoBtns).forEach(([id, mode]) => {
  document.getElementById(id)?.addEventListener('click', () => {
    Object.keys(gizmoBtns).forEach((bid) =>
      document.getElementById(bid)?.classList.remove('active')
    );
    document.getElementById(id)?.classList.add('active');
    viewer.setGizmoMode(mode);
    if (mode !== 'off') showToast(t('Modo: ^1', nomesModo[mode] ?? mode), 'info', 1500);
  });
});

['iso', 'top', 'front', 'side'].forEach((v) => {
  document.getElementById(`view-${v}`)?.addEventListener('click', () => {
    viewer.setViewPreset(v);
    showToast(t('Vista: ^1', nomesVista[v] ?? v), 'info', 1500);
  });
});

// Wireframe toggle
document.getElementById('toggle-wireframe')?.addEventListener('click', function () {
  if (!currentModel) {
    showToast(t('Nenhum modelo carregado.'), 'warn');
    return;
  }
  wireframeOn = !wireframeOn;
  viewer.setRenderMode(wireframeOn ? 'wireframe' : 'shaded');
  this.classList.toggle('active', wireframeOn);
  showToast(wireframeOn ? t('Modo Wireframe ativado') : t('Modo Shaded ativado'), 'info', 1800);
});

// Slicer / Planos de Corte
document.getElementById('toggle-slicer')?.addEventListener('click', function () {
  if (!currentModel) {
    showToast(t('Nenhum modelo carregado.'), 'warn');
    return;
  }
  slicerOn = !slicerOn;
  if (slicerPanel) slicerPanel.style.display = slicerOn ? 'block' : 'none';
  this.classList.toggle('active', slicerOn);
  viewer.setClipping(slicerOn, { x: 1, y: 1, z: 1 });
  showToast(
    slicerOn ? t('Slicer ativado — use os controles no painel direito') : t('Slicer desativado'),
    'info'
  );
});

[sliceX, sliceY, sliceZ].forEach((slider) => {
  slider?.addEventListener('input', () => {
    // F9 — sliders normalizados (0-100 na UI, 0-1 na API), mapeados sobre
    // a bounding box do modelo. Antes eram coordenadas de mundo absolutas.
    if (slicerOn) {
      viewer.setClipping(true, {
        x: Number(sliceX.value) / Number(sliceX.max || 100),
        y: Number(sliceY.value) / Number(sliceY.max || 100),
        z: Number(sliceZ.value) / Number(sliceZ.max || 100),
      });
    }
  });
});

// ============================================================
// 12. FERRAMENTAS GAME ENGINE
// ============================================================
document.getElementById('btn-gen-collider')?.addEventListener('click', async () => {
  if (!currentModel) {
    showToast(t('Carregue um modelo primeiro.'), 'warn');
    return;
  }

  const type = document.getElementById('collider-type-select')?.value || 'box';
  const perMesh = document.getElementById('collider-per-mesh')?.checked ?? true;

  showProgress(true, t('Gerando colisores (^1)...', type));

  try {
    const count = await viewer.generateColliders(type, perMesh);

    showToast(
      count > 0
        ? t('^1 colisor(es) do tipo ^2 gerado(s).', count, `<strong>${escapeHtml(type)}</strong>`)
        : t('Nenhum colisor gerado — verifique se o modelo tem malhas válidas.'),
      count > 0 ? 'success' : 'warn'
    );
  } catch (error) {
    showToast(t('Falha ao gerar colisores: ^1', escapeHtml(error.message)), 'error');
  } finally {
    showProgress(false);
  }
});

document.getElementById('btn-recalc-normals')?.addEventListener('click', () => {
  if (!currentModel) {
    showToast(t('Carregue um modelo primeiro.'), 'warn');
    return;
  }
  viewer.recalculateNormals();
  showToast(t('Normais de vértice recalculadas!'), 'success');
});

document.getElementById('btn-center-pivot')?.addEventListener('click', () => {
  if (!currentModel) {
    showToast(t('Carregue um modelo primeiro.'), 'warn');
    return;
  }
  viewer.centerModel();
  viewer.frameCamera();
  showToast(t('Pivot centralizado e alinhado ao chão!'), 'success');
});

// Correção de eixo
axisFlipSel?.addEventListener('change', () => {
  if (!currentModel) {
    showToast(t('Carregue um modelo primeiro.'), 'warn');
    return;
  }
  const val = axisFlipSel.value;
  if (val !== 'none') {
    viewer.flipAxis(val);
    showToast(t('Eixo convertido: ^1', val), 'info');
  }
});

// ============================================================
// 13. EDITOR DE MATERIAL PBR
// ============================================================
/**
 * Aplica uma alteração de material registrando no histórico.
 * Alterações consecutivas no mesmo alvo são fundidas em um comando só,
 * para arrastar um slider não gerar 200 entradas de undo.
 */
function applyMaterialChange(properties) {
  const root = viewer.selectedObject ?? viewer.currentModel;
  if (!root) {
    showToast(t('Carregue um modelo primeiro.'), 'warn');

    return;
  }

  const materials = [];
  root.traverse((child) => {
    if (child.isMesh) materials.push(...materialsOf(child));
  });

  const unique = [...new Set(materials)];
  if (unique.length === 0) return;

  const before = unique.map(captureMaterial);
  history.push(new MaterialCommand(unique, before, properties));

  refreshStats();
}

matColorPicker?.addEventListener('change', () => {
  applyMaterialChange({ color: matColorPicker.value });
});

matColorPicker?.addEventListener('input', () => {
  // Feedback imediato sem poluir o histórico; o commit vai no 'change'.
  viewer.updateMaterial({ color: matColorPicker.value });
});

matRoughness?.addEventListener('input', () => {
  const value = matRoughness.value;
  const label = document.getElementById('val-roughness');
  if (label) label.textContent = value;
  viewer.updateMaterial({ roughness: Number.parseFloat(value) });
});

matRoughness?.addEventListener('change', () => {
  applyMaterialChange({ roughness: Number.parseFloat(matRoughness.value) });
});

matMetallic?.addEventListener('input', () => {
  const value = matMetallic.value;
  const label = document.getElementById('val-metallic');
  if (label) label.textContent = value;
  viewer.updateMaterial({ metalness: Number.parseFloat(value) });
});

matMetallic?.addEventListener('change', () => {
  applyMaterialChange({ metalness: Number.parseFloat(matMetallic.value) });
});

matOpacity?.addEventListener('input', () => {
  viewer.updateMaterial({ opacity: Number.parseFloat(matOpacity.value) });
});

matOpacity?.addEventListener('change', () => {
  applyMaterialChange({ opacity: Number.parseFloat(matOpacity.value) });
});

// ============================================================
// 14. EXPORTAÇÃO
// ============================================================
/** Nome sugerido: o do arquivo importado, sem extensão. */
function nomeSugerido() {
  const bruto = (currentModel?.name || 'scc_builder_export').replace(/\.[^.]+$/, '');

  return sanitizeFileName(bruto);
}

async function doExport() {
  if (!currentModel) {
    showToast(
      t('Nenhum modelo carregado! Importe ou carregue um modelo de exemplo primeiro.'),
      'warn'
    );
    return;
  }

  // O usuário confere nome, formato e o que será omitido antes de gravar.
  const escolha = await openExportDialog({
    defaultName: nomeSugerido(),
    format: exportFormatSel?.value || 'glb',
    formats: EXPORT_FORMATS,
    resumo: exportPreview(currentModel),
    formatCount,
  });

  if (!escolha) return;

  const format = escolha.format;

  // Mantém o seletor da barra lateral em sincronia com a escolha do modal.
  if (exportFormatSel) exportFormatSel.value = format;

  showSpinner(true, t('Exportando como .^1...', format.toUpperCase()));
  try {
    const blob = await converter.exportModel(currentModel, format);
    const filename = `${escolha.name}.${format}`;

    downloadBlob(blob, filename);

    const relatorio = converter.lastExportReport ?? {};
    const removidas = relatorio.texturasRemovidas ?? 0;
    const ocultos = relatorio.blocosOcultosRemovidos ?? 0;

    const notas = [];
    if (ocultos > 0) {
      notas.push(
        t(
          '^1 bloco(s) oculto(s) omitido(s) — ^2 triângulos a menos.',
          ocultos,
          formatCount(relatorio.triangulosRemovidos ?? 0)
        )
      );
    }
    if (removidas > 0) {
      notas.push(
        t(
          '^1 textura(s) sem imagem foram omitidas — os arquivos não estavam na pasta importada.',
          removidas
        )
      );
    }

    showToast(
      t('Arquivo exportado: ^1', `<strong>${escapeHtml(filename)}</strong>`) +
        (notas.length > 0
          ? `<br><span style="color:#fbbf24;font-size:0.78rem">${notas.map(escapeHtml).join('<br>')}</span>`
          : ''),
      removidas > 0 ? 'warn' : 'success',
      notas.length > 0 ? 7000 : 3500
    );
  } catch (err) {
    mostrarErroExportacao(err);
  } finally {
    showSpinner(false);
  }
}

document.getElementById('btn-export-main')?.addEventListener('click', doExport);
document.getElementById('btn-quick-download')?.addEventListener('click', doExport);

// Batch ZIP
document.getElementById('btn-batch-zip')?.addEventListener('click', async () => {
  if (loadedFiles.length === 0) {
    showToast(t('Nenhum arquivo carregado para conversão em lote.'), 'warn');
    return;
  }
  const format = exportFormatSel?.value || 'glb';
  showSpinner(true, t('Convertendo ^1 arquivo(s)...', loadedFiles.length));
  try {
    const { blob, succeeded, failed } = await converter.batchConvertAndZip(
      loadedFiles,
      format,
      (done, total, name) => showSpinner(true, t('Convertendo ^1/^2: ^3', done, total, name))
    );

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scc_builder_batch_${format}.zip`;
    a.click();
    URL.revokeObjectURL(url);

    // O relatório agora é honesto: a v1 dizia "todos convertidos" mesmo
    // quando arquivos falhavam silenciosamente no catch.
    if (failed.length === 0) {
      showToast(t('^1 arquivo(s) convertidos com sucesso!', succeeded.length), 'success');
    } else {
      showToast(
        t(
          '^1 convertido(s), ^2 falharam. Veja _falhas.txt dentro do ZIP.',
          succeeded.length,
          failed.length
        ),
        'warn',
        6000
      );
    }
  } catch (err) {
    showToast(t('Erro na conversão em lote: ^1', err.message), 'error');
    console.error('[SCC Builder] Batch error:', err);
  } finally {
    showSpinner(false);
  }
});

// ============================================================
// 15. TESTE DA API PHP (Modal)
// ============================================================
document.getElementById('btn-trigger-api-upload')?.addEventListener('click', async () => {
  const apiFileInput = document.getElementById('api-upload-file');
  const outputDiv = document.getElementById('api-response-output');
  if (!apiFileInput?.files.length) {
    showToast(t('Selecione um arquivo 3D para testar o upload na API PHP.'), 'warn');
    return;
  }
  const file = apiFileInput.files[0];

  const write = (text, color = '#9ca3af') => {
    if (!outputDiv) return;
    outputDiv.style.display = 'block';
    outputDiv.textContent = text;
    outputDiv.style.color = color;
  };

  write(t('Enviando ^1 para ^2 ...', file.name, `${apiClient.baseUrl}/convert.php`));

  try {
    // A URL não é mais fixa em /scc-builder/ (A5) e a chamada carrega a API key.
    const data = await apiClient.convert(file, {
      targetFormat: 'glb',
      optimize: 'balanced',
      onProgress: (percent) => write(`Upload: ${percent}%`),
    });

    let job = data.job;

    // Arquivos grandes voltam enfileirados (HTTP 202): acompanhamos o job.
    if (job && job.status !== 'completed' && job.status !== 'failed') {
      write(t('Job ^1 enfileirado. Aguardando o worker...', job.id));
      job = await apiClient.waitForJob(job.id, {
        onTick: (current) => write(`Job ${current.id}: ${current.status} (${current.progress}%)`),
      });
    }

    write(JSON.stringify({ ...data, job }, null, 2), '#86efac');
    showToast(t('API respondeu com sucesso!'), 'success');
  } catch (err) {
    if (outputDiv) {
      const dica = [
        'missing_credentials',
        'invalid_api_key',
        'invalid_token',
        'token_expired',
      ].includes(err.code)
        ? '\n\n→ ' +
          t(
            'Abra o editor pelo jogo (link com #token=) ou, em desenvolvimento, defina VITE_SCC_TOKEN ou VITE_API_KEY no .env.'
          )
        : err.code === 'not_configured'
          ? '\n\n→ ' +
            t('Copie api/config.local.example.php para api/config.local.php e gere uma chave.')
          : '\n\n→ ' +
            t(
              'Verifique se o WAMP está rodando e se a API responde em ^1',
              `${apiClient.baseUrl}/health.php`
            );

      outputDiv.textContent = `[${err.code ?? t('erro')}] ${err.message}${dica}`;
      outputDiv.style.color = '#fca5a5';
    }
    showToast(t('Falha ao conectar com a API PHP. Verifique o WAMP.'), 'error');
  }
});

// ============================================================
// 16. INICIALIZAÇÃO FINAL — Lucide Icons + Welcome
// ============================================================
// Os textos fixos do HTML no idioma de quem abriu (data-t*). Antes dos
// ícones: o renderIcons troca <i data-lucide> e não mexe no texto.
aplicarNoDom();
renderIcons();

setTimeout(() => {
  showToast(
    t(
      'Bem-vindo ao SCC Builder! Selecione um software de origem ou carregue um modelo de exemplo.'
    ),
    'info',
    6000
  );
}, 600);

// ============================================================
// 17. HISTÓRICO — UNDO / REDO  (item 37)
// ============================================================
const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');

function updateHistoryButtons(state) {
  if (btnUndo) {
    btnUndo.disabled = !state.canUndo;
    btnUndo.title = state.canUndo
      ? t('Desfazer: ^1 (Ctrl+Z)', state.undoLabel)
      : t('Nada a desfazer');
    btnUndo.setAttribute('aria-disabled', String(!state.canUndo));
  }
  if (btnRedo) {
    btnRedo.disabled = !state.canRedo;
    btnRedo.title = state.canRedo
      ? t('Refazer: ^1 (Ctrl+Y)', state.redoLabel)
      : t('Nada a refazer');
    btnRedo.setAttribute('aria-disabled', String(!state.canRedo));
  }
}

function doUndo() {
  const command = history.undo();
  if (!command) return;

  viewer.select(viewer.selectedObject);
  syncMaterialPanel(viewer.selectedObject);
  refreshStats();
  buildHierarchyTree(currentModel);
  atualizarPainelBlocos();
  atualizarListaMateriais();
  showToast(t('Desfeito: ^1', escapeHtml(command.label)), 'info', 1800);
}

function doRedo() {
  const command = history.redo();
  if (!command) return;

  viewer.select(viewer.selectedObject);
  syncMaterialPanel(viewer.selectedObject);
  refreshStats();
  buildHierarchyTree(currentModel);
  atualizarPainelBlocos();
  atualizarListaMateriais();
  showToast(t('Refeito: ^1', escapeHtml(command.label)), 'info', 1800);
}

btnUndo?.addEventListener('click', doUndo);
btnRedo?.addEventListener('click', doRedo);

// ============================================================
// 18. ATALHOS DE TECLADO  (item 40 — acessibilidade)
// ============================================================
const SHORTCUTS = [
  ['Ctrl+Z', t('Desfazer')],
  ['Ctrl+Y / Ctrl+Shift+Z', t('Refazer')],
  ['W / E / R', t('Mover / Rotacionar / Escalar')],
  ['Q', t('Desativar gizmo')],
  ['F / Shift+F', t('Enquadrar o ambiente / a seleção')],
  ['+ / −', t('Aproximar / afastar')],
  ['A', t('Zoom por área (arrastar retângulo)')],
  ['1 / 2 / 3 / 4', t('Vista iso / topo / frente / lateral')],
  ['Z', t('Alternar wireframe')],
  ['Delete', t('Limpar colisores')],
  ['Esc', t('Fechar modais / cancelar')],
  ['?', t('Esta lista')],
];

document.addEventListener('keydown', (event) => {
  // Nunca sequestrar o teclado dentro de campos de texto.
  const tag = event.target?.tagName;
  if (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    event.target?.isContentEditable
  ) {
    return;
  }

  const ctrl = event.ctrlKey || event.metaKey;

  if (ctrl && event.key.toLowerCase() === 'z' && !event.shiftKey) {
    event.preventDefault();
    doUndo();

    return;
  }

  if (
    ctrl &&
    (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))
  ) {
    event.preventDefault();
    doRedo();

    return;
  }

  if (ctrl) return;

  const actions = {
    w: () => viewer.setGizmoMode('translate'),
    e: () => viewer.setGizmoMode('rotate'),
    r: () => viewer.setGizmoMode('scale'),
    q: () => viewer.setGizmoMode('off'),
    f: () => {
      viewer.frameCamera();
      atualizarIndicadorZoom();
    },
    z: () => {
      wireframeOn = !wireframeOn;
      viewer.setRenderMode(wireframeOn ? 'wireframe' : 'shaded');
    },
    1: () => viewer.setViewPreset('iso'),
    2: () => viewer.setViewPreset('top'),
    3: () => viewer.setViewPreset('front'),
    4: () => viewer.setViewPreset('side'),
    delete: () => viewer.clearColliders(),
    escape: () => {
      closeAllModals();
      loadAbort?.abort();
    },
    '?': () => showShortcuts(),
  };

  const action = actions[event.key.toLowerCase()];
  if (action) {
    event.preventDefault();
    action();
  }
});

function showShortcuts() {
  const rows = SHORTCUTS.map(
    ([keys, description]) =>
      `<tr><td style="padding:3px 14px 3px 0"><kbd style="background:rgba(255,255,255,0.1);
        padding:2px 6px;border-radius:4px;font-size:0.75rem">${escapeHtml(keys)}</kbd></td>
        <td style="color:#9ca3af">${escapeHtml(description)}</td></tr>`
  ).join('');

  showToast(
    `<strong>${t('Atalhos')}</strong><table style="margin-top:6px">${rows}</table>`,
    'info',
    9000
  );
}

// ============================================================
// 19. OTIMIZAÇÃO NO CLIENTE E LOD  (itens 33 e 35)
// ============================================================
const optimizeLevelSel = document.getElementById('optimize-level-select');

document.getElementById('btn-optimize-preview')?.addEventListener('click', () => {
  if (!currentModel) {
    showToast(t('Carregue um modelo primeiro.'), 'warn');

    return;
  }

  const level = optimizeLevelSel?.value || 'balanced';
  const { before, after } = preview(currentModel, level);

  showToast(
    `<strong>${t('Previsão (^1)', escapeHtml(level))}</strong><br>` +
      `${t('Triângulos: ^1 → ^2', formatCount(before.triangles), formatCount(after.triangles))}<br>` +
      `${t('Vértices: ^1 → ~^2', formatCount(before.vertices), formatCount(after.vertices))}<br>` +
      `<em style="color:#9ca3af;font-size:0.75rem">${t('Estimativa conservadora — o ganho real costuma ser maior.')}</em>`,
    'info',
    7000
  );
});

document.getElementById('btn-optimize-apply')?.addEventListener('click', async () => {
  if (!currentModel) {
    showToast(t('Carregue um modelo primeiro.'), 'warn');

    return;
  }

  const level = optimizeLevelSel?.value || 'balanced';

  if (!(level in CLIENT_PROFILES)) {
    showToast(t('Nível "^1" desconhecido.', escapeHtml(level)), 'error');

    return;
  }

  showProgress(true, t('Otimizando malha...'), 0);

  try {
    const result = await optimize(currentModel, level, {
      onProgress: (percent, stage) => showProgress(true, stage, percent),
    });

    // A otimização altera geometrias no lugar; o histórico não consegue
    // reverter isso de forma barata, então o limpamos e avisamos.
    history.clear();

    viewer.select(null);
    buildHierarchyTree(currentModel);
    refreshStats();

    const reduction =
      result.before.triangles > 0
        ? (1 - result.after.triangles / result.before.triangles) * 100
        : 0;

    showToast(
      `<strong>${t('Otimizado')}</strong><br>` +
        `${t('Triângulos: ^1 → ^2', formatCount(result.before.triangles), formatCount(result.after.triangles))} ` +
        `(${t('^1% menos', reduction.toFixed(1))})<br>` +
        t(
          'Vértices: ^1 → ^2',
          formatCount(result.before.vertices),
          formatCount(result.after.vertices)
        ) +
        (result.warnings.length > 0
          ? `<br><span style="color:#f59e0b">${escapeHtml(result.warnings[0])}</span>`
          : ''),
      result.warnings.length > 0 ? 'warn' : 'success',
      7000
    );
  } catch (error) {
    showToast(t('Falha na otimização: ^1', escapeHtml(error.message)), 'error');
    console.error('[SCC Builder] Otimização:', error);
  } finally {
    showProgress(false);
  }
});

document.getElementById('btn-build-lod')?.addEventListener('click', async () => {
  if (!currentModel) {
    showToast(t('Carregue um modelo primeiro.'), 'warn');

    return;
  }

  showProgress(true, t('Gerando níveis de detalhe...'));

  try {
    const lod = await buildLOD(currentModel);

    if (!lod) {
      showToast(
        t('meshoptimizer não disponível — execute "npm install meshoptimizer".'),
        'warn',
        6000
      );

      return;
    }

    viewer.setModel(lod);
    currentModel = lod;
    buildHierarchyTree(lod);
    refreshStats();

    showToast(
      t(
        'LOD gerado com 3 níveis (100%, 50%, 12,5%). Objetos distantes passam a desenhar muito menos triângulos.'
      ),
      'success',
      6000
    );
  } catch (error) {
    showToast(t('Falha ao gerar LOD: ^1', escapeHtml(error.message)), 'error');
  } finally {
    showProgress(false);
  }
});

// ============================================================
// 20. PRESETS DE EXPORTAÇÃO POR ENGINE  (item 38)
// ============================================================
const enginePresetSel = document.getElementById('engine-preset-select');
const sourceUnitSel = document.getElementById('source-unit-select');
const sourceUpSel = document.getElementById('source-up-select');
const presetHint = document.getElementById('engine-preset-hint');

/** Popula os selects a partir da fonte única de verdade. */
function populatePresetSelects() {
  if (enginePresetSel && enginePresetSel.options.length === 0) {
    for (const [value, preset] of Object.entries(ENGINE_PRESETS)) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = preset.label;
      enginePresetSel.appendChild(option);
    }
    enginePresetSel.value = 'scc';
  }

  if (sourceUnitSel && sourceUnitSel.options.length === 0) {
    for (const [value, unit] of Object.entries(SOURCE_UNITS)) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = unit.label;
      sourceUnitSel.appendChild(option);
    }
    sourceUnitSel.value = 'm';
  }
}

function updatePresetHint() {
  if (!presetHint || !enginePresetSel) return;

  const engine = enginePresetSel.value;
  const notes = presetNotes(engine);

  presetHint.replaceChildren();

  const list = document.createElement('ul');
  list.style.cssText =
    'margin:4px 0 0;padding-left:16px;font-size:0.72rem;color:var(--text-dim,#9ca3af)';

  for (const note of notes) {
    const item = document.createElement('li');
    item.textContent = note;
    list.appendChild(item);
  }

  presetHint.appendChild(list);
}

populatePresetSelects();
updatePresetHint();
enginePresetSel?.addEventListener('change', updatePresetHint);

/** Exporta aplicando o preset de eixo/escala do motor de destino. */
async function exportWithPreset() {
  if (!currentModel) {
    showToast(t('Nenhum modelo carregado.'), 'warn');

    return;
  }

  const engine = enginePresetSel?.value || 'gltf';
  const options = {
    engine,
    sourceUnit: sourceUnitSel?.value || 'm',
    sourceUp: sourceUpSel?.value || 'y',
  };

  const escolha = await openExportDialog({
    // O sufixo da engine entra por padrão, mas o usuário pode remover.
    defaultName: `${nomeSugerido()}_${engine}`,
    format: exportFormatSel?.value || ENGINE_PRESETS[engine]?.format || 'glb',
    formats: EXPORT_FORMATS,
    resumo: exportPreview(currentModel),
    engineLabel: ENGINE_PRESETS[engine]?.label ?? engine,
    formatCount,
  });

  if (!escolha) return;

  const format = escolha.format;
  if (exportFormatSel) exportFormatSel.value = format;

  showProgress(true, t('Exportando para ^1...', ENGINE_PRESETS[engine]?.label ?? engine));

  try {
    const { object, transform } = applyPreset(currentModel, options);

    // O lote recusa prédio acima do orçamento: avisar aqui poupa o envio.
    const limite = ENGINE_PRESETS[engine]?.maxTriangles;
    const triangulos = countTriangles(object);
    if (limite && triangulos > limite) {
      showToast(
        t(
          'O modelo tem ^1 triângulos, acima do limite de ^2 do lote. Otimize antes de enviar.',
          triangulos.toLocaleString(),
          limite.toLocaleString()
        ),
        'warn',
        7000
      );
    }

    const blob = await converter.exportModel(object, format);

    downloadBlob(blob, `${escolha.name}.${format}`);

    showToast(
      t(
        'Exportado para ^1',
        `<strong>${escapeHtml(ENGINE_PRESETS[engine]?.label ?? engine)}</strong>`
      ) +
        '<br>' +
        `<span style="color:#9ca3af;font-size:0.78rem">${escapeHtml(transform.summary)}</span>`,
      'success',
      5000
    );
  } catch (error) {
    showToast(t('Erro na exportação: ^1', escapeHtml(error.message)), 'error');
    console.error('[SCC Builder] Exportação com preset:', error);
  } finally {
    showProgress(false);
  }
}

document.getElementById('btn-export-preset')?.addEventListener('click', exportWithPreset);

/** KB abaixo de 1 MB, MB com uma casa acima, no idioma da tela. */
function formatSize(bytes) {
  if (bytes < 1048576) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString(locale)} KB`;
  return `${(bytes / 1048576).toLocaleString(locale, { maximumFractionDigits: 1 })} MB`;
}

/**
 * Exporta para o mapa da Smart Chain City.
 *
 * Aplica o preset "scc" (Y-up, metros, a partir da unidade e do eixo do
 * painel Destino), ajusta o modelo aos limites da plataforma (LOD0 até 300
 * mil triângulos, LOD1/LOD2, texturas até 2048 px, Meshopt, até 40 MB) e
 * entrega os três LODs à janela do mapa, que o coloca no lote do jogador.
 */
async function exportToMap() {
  if (!currentModel) {
    showToast(
      t('Nenhum modelo carregado! Importe ou carregue um modelo de exemplo primeiro.'),
      'warn'
    );
    return;
  }

  const mapUrl = resolveMapUrl(import.meta.env);
  if (!mapUrl) {
    showToast(t('Mapa não configurado: defina VITE_SCC_MAP_URL no .env.'), 'error');
    return;
  }

  // A janela abre já no clique: depois de um await o navegador a bloquearia
  // como pop-up.
  const mapa = window.open(mapUrl, 'scc-mapa');
  if (!mapa) {
    showToast(t('O navegador bloqueou a janela do mapa. Permita pop-ups para este site.'), 'error');
    return;
  }

  showProgress(true, t('Ajustando o modelo para o mapa...'));

  try {
    const { object } = applyPreset(currentModel, {
      engine: 'scc',
      sourceUnit: sourceUnitSel?.value || 'm',
      sourceUp: sourceUpSel?.value || 'y',
    });
    const glb = await converter.exportModel(object, 'glb');

    const pacote = await preparePackageForMap(glb, ({ attempt, total }) =>
      showProgress(
        true,
        t('Ajustando o modelo para o mapa (tentativa ^1 de ^2)...', attempt, total)
      )
    );

    showProgress(true, t('Enviando ao mapa...'));
    const resposta = await deliverToMap(
      mapa,
      originOf(mapUrl),
      buildModelMessage({ name: nomeSugerido(), ...pacote })
    );

    if (!resposta.ok) {
      throw Object.assign(new Error(resposta.message || resposta.error || 'map_rejected'), {
        code: 'map_rejected',
      });
    }

    const r = pacote.report;
    const linhas = [
      t(
        'Triângulos: ^1 → ^2 (LOD1 ^3, LOD2 ^4)',
        formatCount(r.trianglesBefore),
        formatCount(r.trianglesAfter),
        formatCount(pacote.files[1]?.triangles ?? 0),
        formatCount(pacote.files[2]?.triangles ?? 0)
      ),
      t('Tamanho: ^1 → ^2 (limite 40 MB)', formatSize(r.sourceBytes), formatSize(r.totalBytes)),
    ];
    if (r.texturesResized > 0) {
      linhas.push(t('^1 textura(s) reduzida(s) para ^2 px', r.texturesResized, r.textureMax));
    }
    for (const aviso of r.warnings) {
      if (aviso.code === 'materials') {
        linhas.push(t('Atenção: ^1 materiais; o limite por prédio é ^2.', aviso.value, aviso.max));
      }
    }

    showToast(
      t('Modelo enviado ao mapa da Smart Chain City.') +
        `<br><span style="color:#9ca3af;font-size:0.78rem">${linhas.map(escapeHtml).join('<br>')}</span>`,
      r.warnings.length > 0 ? 'warn' : 'success',
      8000
    );
    mapa.focus();
  } catch (error) {
    const mensagens = {
      too_large_for_platform: t(
        'Mesmo simplificado, o modelo passa dos limites do mapa (300 mil triângulos, 40 MB). Oculte blocos que não fazem parte do prédio (paisagismo, terreno) e tente de novo.'
      ),
      map_closed: t('A janela do mapa foi fechada antes de receber o modelo.'),
      map_timeout: t('O mapa não respondeu. Confira se ele está no ar em ^1', mapUrl),
      map_rejected: t('O mapa recusou o modelo: ^1', error.message),
    };
    showToast(
      escapeHtml(mensagens[error.code] ?? t('Erro na exportação: ^1', error.message)),
      'error',
      8000
    );
    console.error('[SCC Builder] Exportar para o mapa:', error);
  } finally {
    showProgress(false);
  }
}

document.getElementById('btn-export-map')?.addEventListener('click', exportToMap);

/** Exporta a definição dos colisores como JSON para a engine. */
document.getElementById('btn-export-colliders')?.addEventListener('click', () => {
  const colliders = viewer.exportColliders();

  if (colliders.length === 0) {
    showToast(t('Gere colisores antes de exportar.'), 'warn');

    return;
  }

  const payload = {
    generator: 'SCC Builder 2.1.0',
    model: currentModel?.name ?? null,
    engine: enginePresetSel?.value ?? 'gltf',
    count: colliders.length,
    colliders,
  };

  downloadBlob(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    'colliders.json'
  );

  showToast(t('^1 colisor(es) exportado(s) em JSON.', colliders.length), 'success');
});

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

// Estado inicial dos botões de histórico
updateHistoryButtons(history.state);

document.getElementById('btn-shortcuts')?.addEventListener('click', showShortcuts);

// ============================================================
// 21. DIAGNÓSTICO DE MATERIAIS E ORIENTAÇÃO DE FORMATO
// ============================================================

/**
 * Informa o que foi consertado no material e o que ainda está errado.
 *
 * Modelos de Lumion e SketchUp quase sempre chegam com opacidade zero
 * (bug de exportação Collada) e com MeshPhongMaterial, que ignora o
 * environment map da cena. Consertamos os dois na importação — mas o
 * usuário precisa saber que houve intervenção.
 *
 * @param {object} reparo relatório de repairMaterials
 * @param {object} object modelo carregado
 */
function relatarReparo(reparo, object) {
  if (!reparo) return;

  const linhas = [];

  if (reparo.transparenciaCorrigida > 0) {
    linhas.push(
      t(
        '^1 material(is) vinham invisíveis (opacidade zero) e foram tornados opacos.',
        `<strong>${reparo.transparenciaCorrigida}</strong>`
      )
    );
  }

  if (reparo.materiaisConvertidos > 0) {
    linhas.push(
      t('^1 material(is) convertidos para PBR.', `<strong>${reparo.materiaisConvertidos}</strong>`)
    );
  }

  if (reparo.texturasCorrigidas > 0) {
    linhas.push(
      t('^1 textura(s) com cor corrigida.', `<strong>${reparo.texturasCorrigidas}</strong>`)
    );
  }

  const { problemas } = diagnose(object);

  if (linhas.length === 0 && problemas.length === 0) return;

  const corpo =
    (linhas.length > 0
      ? `<strong>${t('Materiais ajustados')}</strong><br>${linhas.join('<br>')}`
      : '') +
    (problemas.length > 0
      ? `${linhas.length > 0 ? '<br><br>' : ''}<strong>${t('Atenção')}</strong><br>` +
        problemas.map((p) => escapeHtml(p)).join('<br>')
      : '');

  showToast(corpo, problemas.length > 0 ? 'warn' : 'info', 9000);
}

/**
 * Mostra o passo a passo de exportação para formatos proprietários.
 *
 * .rvt, .skp, .max e afins não têm leitor público — nenhuma quantidade de
 * código resolveria. O que podemos fazer é não deixar o usuário sem saída.
 *
 * @param {string} extensao
 * @param {string} nomeArquivo
 */
function mostrarOrientacaoFormato(extensao, nomeArquivo) {
  const mensagem = mensagemOrientacao(extensao, escapeHtml, nomeArquivo);

  // Toast comum sumiria antes de o usuário conseguir ler os passos.
  const anterior = document.getElementById('c3d-orientacao');
  anterior?.remove();

  const painel = document.createElement('div');
  painel.id = 'c3d-orientacao';
  painel.setAttribute('role', 'alertdialog');
  painel.setAttribute('aria-modal', 'true');
  painel.setAttribute('aria-label', t('Formato não suportado'));
  painel.style.cssText = `
    position:fixed; inset:0; z-index:99998;
    background:rgba(0,0,0,0.72); backdrop-filter:blur(8px);
    display:flex; align-items:center; justify-content:center; padding:24px;
  `;

  const cartao = document.createElement('div');
  cartao.style.cssText = `
    max-width:560px; width:100%; padding:22px 26px; border-radius:12px;
    background:rgba(12,17,26,0.98); border:1px solid rgba(245,158,11,0.5);
    color:#e5e7eb; font-size:0.88rem; line-height:1.55;
    box-shadow:0 20px 60px rgba(0,0,0,0.7); max-height:80vh; overflow-y:auto;
  `;
  cartao.innerHTML = mensagem;

  const acoes = document.createElement('div');
  acoes.style.cssText = 'margin-top:18px; display:flex; gap:8px; justify-content:flex-end';

  const guia = document.createElement('button');
  guia.type = 'button';
  guia.textContent = t('Ver guia de exportação');
  guia.style.cssText =
    'padding:7px 14px;border-radius:6px;cursor:pointer;background:transparent;' +
    'border:1px solid rgba(255,255,255,0.25);color:#e5e7eb;font-size:0.82rem';
  guia.addEventListener('click', () => {
    painel.remove();
    openModal('modal-docs');
  });

  const fechar = document.createElement('button');
  fechar.type = 'button';
  fechar.textContent = t('Entendi');
  fechar.style.cssText =
    'padding:7px 18px;border-radius:6px;cursor:pointer;background:#00f0ff;' +
    'border:none;color:#06131a;font-weight:600;font-size:0.82rem';
  fechar.addEventListener('click', () => painel.remove());

  acoes.append(guia, fechar);
  cartao.appendChild(acoes);
  painel.appendChild(cartao);

  painel.addEventListener('click', (event) => {
    if (event.target === painel) painel.remove();
  });

  document.addEventListener(
    'keydown',
    function aoTeclar(event) {
      if (event.key === 'Escape') {
        painel.remove();
        document.removeEventListener('keydown', aoTeclar);
      }
    },
    { once: false }
  );

  document.body.appendChild(painel);
  fechar.focus();
}

/**
 * Botão de socorro: força opacidade total em todos os materiais.
 *
 * Rede de segurança para o caso de um exportador inventar uma combinação
 * de transparência que a heurística automática não pegou.
 */
document.getElementById('btn-forcar-opaco')?.addEventListener('click', () => {
  if (!currentModel) {
    showToast(t('Carregue um modelo primeiro.'), 'warn');

    return;
  }

  const materiais = [];
  currentModel.traverse((child) => {
    if (child.isMesh) materiais.push(...materialsOf(child));
  });

  const unicos = [...new Set(materiais)];
  const before = unicos.map(captureMaterial);

  history.push(new MaterialCommand(unicos, before, { opacity: 1, transparent: false }));

  showToast(
    t('^1 material(is) forçados a opaco. Use Ctrl+Z para reverter.', unicos.length),
    'success'
  );
});

/**
 * Traduz falhas de exportação em algo acionável.
 *
 * O caso mais comum vem do GLTFExporter: "No valid image data found" quando
 * um material referencia uma textura cujo arquivo nunca carregou. Isso
 * acontece ao arrastar só o `.dae` sem a pasta de texturas ao lado. Já
 * removemos essas referências automaticamente antes de exportar, mas se
 * algo escapar a mensagem precisa dizer o que fazer.
 *
 * @param {Error} erro
 */
function mostrarErroExportacao(erro) {
  const mensagem = String(erro?.message ?? erro);
  console.error('[SCC Builder] Falha na exportação:', erro);

  if (/No valid image data|Unable to process texture/i.test(mensagem)) {
    showToast(
      t(
        '<strong>Exportação bloqueada por textura sem imagem</strong><br>Um ou mais materiais apontam para arquivos de textura que não foram carregados.<br><br><strong>Como resolver:</strong><br>1. Reimporte arrastando a <strong>pasta inteira</strong> do modelo, com as imagens;<br>2. ou exporte em <strong>OBJ</strong>, que não embute texturas.'
      ),
      'error',
      12000
    );

    return;
  }

  if (/out of memory|Array buffer allocation|Invalid array length/i.test(mensagem)) {
    showToast(
      t(
        '<strong>Memória insuficiente para exportar</strong><br>O modelo é grande demais para ser serializado de uma vez.<br><br>Use o painel <strong>Otimização</strong> com o perfil "Agressiva" antes de exportar, ou envie o arquivo pela API (PHP API &amp; SDK), que processa no servidor sem o limite do browser.'
      ),
      'error',
      12000
    );

    return;
  }

  showToast(t('Erro na exportação: ^1', escapeHtml(mensagem)), 'error', 8000);
}

// ============================================================
// 22. EDITOR DE BLOCOS — ocultar, excluir e isolar antes de exportar
// ============================================================

const blocosInfo = document.getElementById('blocos-info');
const blocosMateriais = document.getElementById('blocos-materiais');

/** Objetos atualmente selecionados na árvore (ou o selecionado na viewport). */
function selecaoAtual() {
  const daArvore = tree?.getSelection() ?? [];
  if (daArvore.length > 0) return daArvore;

  return viewer.selectedObject ? [viewer.selectedObject] : [];
}

/** Exige seleção e avisa quando não há. */
function exigirSelecao() {
  const selecionados = selecaoAtual();

  if (selecionados.length === 0) {
    showToast(
      t(
        'Selecione um bloco na árvore ou clique nele na viewport. Use Ctrl+clique para escolher vários.'
      ),
      'warn',
      5000
    );

    return null;
  }

  return selecionados;
}

/**
 * Atualiza o resumo do que será exportado.
 *
 * O número que importa é o de triângulos visíveis: é ele que determina o
 * peso do arquivo final e o desempenho na engine.
 */
function atualizarPainelBlocos() {
  if (!blocosInfo) return;

  if (!currentModel) {
    blocosInfo.textContent = t('Nenhum modelo carregado.');

    return;
  }

  const resumo = exportPreview(currentModel);
  const selecionados = selecaoAtual().length;

  blocosInfo.replaceChildren();

  const linhas = [
    t(
      'Serão exportados: ^1 triângulos em ^2 malha(s)',
      formatCount(resumo.triangulosVisiveis),
      resumo.visiveis
    ),
  ];

  if (resumo.ocultos > 0) {
    linhas.push(
      t(
        'Ocultos: ^1 triângulos em ^2 malha(s)',
        formatCount(resumo.triangulosOcultos),
        resumo.ocultos
      )
    );
  }

  if (selecionados > 0) {
    linhas.push(t('^1 bloco(s) selecionado(s)', selecionados));
  }

  for (const [i, texto] of linhas.entries()) {
    const linha = document.createElement('div');
    linha.textContent = texto;
    linha.style.cssText =
      'font-size:0.72rem;line-height:1.5;' +
      (i === 0
        ? 'color:var(--accent-cyan,#00f0ff)'
        : i === 1 && resumo.ocultos > 0
          ? 'color:#f59e0b'
          : 'color:var(--text-dim,#9ca3af)');
    blocosInfo.appendChild(linha);
  }
}

// ── Ações ────────────────────────────────────────────────────────────────

document.getElementById('btn-ocultar-selecao')?.addEventListener('click', () => {
  const selecionados = exigirSelecao();
  if (!selecionados) return;

  history.push(new VisibilityCommand(selecionados, false));
  tree?.refresh();
  atualizarPainelBlocos();
  refreshStats();

  showToast(
    t('^1 bloco(s) ocultado(s) — não entrarão na exportação.', selecionados.length),
    'success'
  );
});

document.getElementById('btn-mostrar-selecao')?.addEventListener('click', () => {
  const selecionados = exigirSelecao();
  if (!selecionados) return;

  history.push(new VisibilityCommand(selecionados, true));
  tree?.refresh();
  atualizarPainelBlocos();
  refreshStats();
});

document.getElementById('btn-isolar')?.addEventListener('click', () => {
  const selecionados = exigirSelecao();
  if (!selecionados) return;

  history.push(new IsolateCommand(currentModel, selecionados));
  tree?.refresh();
  atualizarPainelBlocos();
  refreshStats();

  showToast(t('Isolado. Use "Mostrar tudo" ou Ctrl+Z para voltar.'), 'info');
});

document.getElementById('btn-mostrar-tudo')?.addEventListener('click', () => {
  if (!currentModel) {
    showToast(t('Carregue um modelo primeiro.'), 'warn');

    return;
  }

  history.push(new ShowAllCommand(currentModel));
  tree?.refresh();
  atualizarPainelBlocos();
  refreshStats();
});

document.getElementById('btn-excluir-selecao')?.addEventListener('click', () => {
  const selecionados = exigirSelecao();
  if (!selecionados) return;

  // Excluir a raiz esvaziaria a cena inteira sem querer.
  const alvos = selecionados.filter((object) => object !== currentModel);

  if (alvos.length === 0) {
    showToast(t('Não é possível excluir a raiz do modelo.'), 'warn');

    return;
  }

  const comando = new DeleteCommand(alvos);
  history.push(comando);

  viewer.select(null);
  buildHierarchyTree(currentModel);
  atualizarPainelBlocos();
  refreshStats();

  showToast(
    t('^1 bloco(s) excluído(s). <strong>Ctrl+Z</strong> desfaz.', alvos.length),
    'success',
    5000
  );
});

/**
 * Lista os materiais com botão de ocultar.
 *
 * Em arquitetura é o corte mais rápido: esconder tudo que usa "Vegetação"
 * é mais prático do que caçar cada arbusto na árvore.
 */
function atualizarListaMateriais() {
  if (!blocosMateriais) return;

  blocosMateriais.replaceChildren();

  if (!currentModel) return;

  const grupos = groupByMaterial(currentModel).slice(0, 40);

  for (const grupo of grupos) {
    const linha = document.createElement('div');
    linha.style.cssText =
      'display:flex;align-items:center;gap:6px;padding:3px 4px;border-radius:4px;font-size:0.72rem';

    const amostra = document.createElement('span');
    const cor = grupo.material.color ? `#${grupo.material.color.getHexString()}` : '#888';
    amostra.style.cssText =
      `width:11px;height:11px;flex-shrink:0;border-radius:2px;background:${cor};` +
      'border:1px solid rgba(255,255,255,0.25)';

    const nome = document.createElement('span');
    nome.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    nome.textContent = grupo.nome;
    nome.title = t(
      '^1 — ^2 malha(s), ^3 triângulos',
      grupo.nome,
      grupo.meshes.length,
      grupo.triangulos.toLocaleString(locale)
    );

    const tris = document.createElement('span');
    tris.style.cssText = 'flex-shrink:0;color:var(--text-dim,#6b7280);font-size:0.66rem';
    tris.textContent = formatCount(grupo.triangulos);

    const olho = document.createElement('button');
    olho.type = 'button';
    olho.style.cssText =
      'flex-shrink:0;width:18px;padding:0;background:transparent;border:none;cursor:pointer;' +
      `color:${grupo.visivel ? 'var(--accent-cyan,#00f0ff)' : '#6b7280'}`;
    olho.textContent = grupo.visivel ? '◉' : '○';
    olho.setAttribute(
      'aria-label',
      grupo.visivel ? t('Ocultar ^1', grupo.nome) : t('Mostrar ^1', grupo.nome)
    );
    olho.title = grupo.visivel ? t('Ocultar todas as malhas deste material') : t('Mostrar');

    olho.addEventListener('click', () => {
      history.push(
        new VisibilityCommand(
          grupo.meshes,
          !grupo.visivel,
          grupo.visivel
            ? t('Ocultar material ^1', grupo.nome)
            : t('Mostrar material ^1', grupo.nome)
        )
      );
      tree?.refresh();
      atualizarListaMateriais();
      atualizarPainelBlocos();
      refreshStats();
    });

    linha.append(amostra, nome, tris, olho);
    blocosMateriais.appendChild(linha);
  }

  if (grupos.length === 0) {
    const vazio = document.createElement('div');
    vazio.style.cssText = 'font-size:0.72rem;color:var(--text-dim,#6b7280);padding:4px';
    vazio.textContent = t('Nenhum material na cena.');
    blocosMateriais.appendChild(vazio);
  }
}

// Atalhos: H oculta, Shift+H mostra tudo, I isola, Delete exclui.
document.addEventListener('keydown', (event) => {
  const tag = event.target?.tagName;
  if (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    event.target?.isContentEditable
  ) {
    return;
  }
  if (event.ctrlKey || event.metaKey || !currentModel) return;

  const tecla = event.key.toLowerCase();

  if (tecla === 'h') {
    event.preventDefault();
    document.getElementById(event.shiftKey ? 'btn-mostrar-tudo' : 'btn-ocultar-selecao')?.click();
  } else if (tecla === 'i') {
    event.preventDefault();
    document.getElementById('btn-isolar')?.click();
  } else if (event.key === 'Delete' && selecaoAtual().length > 0) {
    event.preventDefault();
    document.getElementById('btn-excluir-selecao')?.click();
  }
});

// ============================================================
// 23. ZOOM — lupas, enquadramento e indicador
// ============================================================

const statZoom = document.getElementById('stat-zoom');

/** Mostra o nível de zoom relativo ao enquadramento total (100% = tudo cabe). */
function atualizarIndicadorZoom() {
  if (!statZoom) return;

  statZoom.textContent = currentModel ? `${viewer.zoomPercent()}%` : '100%';
}

/**
 * O indicador acompanha qualquer movimento de câmera — inclusive o scroll
 * do mouse e o arrasto do orbit, que não passam pelos botões.
 *
 * O evento `change` do OrbitControls dispara a cada frame durante o
 * arrasto; um rAF agendado evita recalcular a distância várias vezes no
 * mesmo quadro.
 */
let zoomAgendado = false;
viewer.orbit.addEventListener('change', () => {
  if (zoomAgendado) return;

  zoomAgendado = true;
  requestAnimationFrame(() => {
    zoomAgendado = false;
    atualizarIndicadorZoom();
  });
});

function exigirModelo() {
  if (currentModel) return true;

  showToast(t('Carregue um modelo primeiro.'), 'warn', 2500);

  return false;
}

document.getElementById('zoom-in')?.addEventListener('click', () => {
  viewer.zoomIn();
  atualizarIndicadorZoom();
});

document.getElementById('zoom-out')?.addEventListener('click', () => {
  viewer.zoomOut();
  atualizarIndicadorZoom();
});

document.getElementById('zoom-fit')?.addEventListener('click', () => {
  if (!exigirModelo()) return;

  viewer.frameCamera();
  atualizarIndicadorZoom();
  showToast(t('Ambiente enquadrado.'), 'info', 1500);
});

document.getElementById('zoom-selection')?.addEventListener('click', () => {
  if (!exigirModelo()) return;

  const alvo = viewer.selectedObject;

  if (!alvo) {
    showToast(
      t('Nenhum bloco selecionado — clique em um objeto na viewport ou na árvore.'),
      'warn',
      4000
    );

    return;
  }

  viewer.frameSelection();
  atualizarIndicadorZoom();
  showToast(
    t('Enquadrado: ^1', `<strong>${escapeHtml(alvo.name || alvo.type)}</strong>`),
    'info',
    2000
  );
});

// Atalhos de zoom. O "+" chega como "=" no teclado ABNT sem Shift.
document.addEventListener('keydown', (event) => {
  const tag = event.target?.tagName;
  if (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    event.target?.isContentEditable
  ) {
    return;
  }
  if (event.ctrlKey || event.metaKey) return;

  if (event.key === '+' || event.key === '=') {
    event.preventDefault();
    viewer.zoomIn();
    atualizarIndicadorZoom();
  } else if (event.key === '-' || event.key === '_') {
    event.preventDefault();
    viewer.zoomOut();
    atualizarIndicadorZoom();
  } else if (event.key.toLowerCase() === 'f' && event.shiftKey) {
    event.preventDefault();
    document.getElementById('zoom-selection')?.click();
  }
});

// Duplo clique na viewport enquadra o objeto sob o cursor — o gesto que
// todo software 3D usa.
canvasContainer?.addEventListener('dblclick', () => {
  if (!currentModel) return;

  if (viewer.selectedObject) {
    viewer.frameSelection();
  } else {
    viewer.frameCamera();
  }

  atualizarIndicadorZoom();
});

// ── Zoom por área (janela livre) ─────────────────────────────────────────

const btnZoomArea = document.getElementById('zoom-area');

/**
 * Alterna o modo de zoom por área.
 *
 * Enquanto está ativo, o arrasto desenha um retângulo em vez de orbitar a
 * câmera. O botão fica destacado e o Esc cancela — sem isso o usuário pode
 * ficar preso no modo sem entender por que a cena parou de girar.
 */
function alternarZoomArea() {
  if (!exigirModelo()) return;

  viewer.startAreaZoom((ativo) => {
    btnZoomArea?.classList.toggle('active', ativo);
    btnZoomArea?.setAttribute('aria-pressed', String(ativo));

    if (ativo) {
      showToast(
        t(
          'Zoom por área: <strong>arraste um retângulo</strong> sobre a região que quer ampliar. Esc cancela.'
        ),
        'info',
        5000
      );
    } else {
      atualizarIndicadorZoom();
    }
  });
}

btnZoomArea?.addEventListener('click', alternarZoomArea);

document.addEventListener('keydown', (event) => {
  const tag = event.target?.tagName;
  if (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    event.target?.isContentEditable
  ) {
    return;
  }
  if (event.ctrlKey || event.metaKey) return;

  if (event.key.toLowerCase() === 'a') {
    event.preventDefault();
    alternarZoomArea();
  } else if (event.key === 'Escape' && viewer.areaZoom.ativo) {
    event.preventDefault();
    viewer.cancelAreaZoom();
  }
});

// ============================================================
// 24. TEXTURIZAÇÃO
// ============================================================

const presetSelect = document.getElementById('material-preset-select');
const texturaInput = document.getElementById('textura-input');
const texturaDrop = document.getElementById('textura-drop');
const projecaoSelect = document.getElementById('projecao-select');
const escalaTextura = document.getElementById('escala-textura');
const valEscalaTextura = document.getElementById('val-escala-textura');
const uvStatus = document.getElementById('uv-status');

/** Popula a biblioteca de materiais. */
function popularPresets() {
  if (!presetSelect || presetSelect.options.length > 0) return;

  for (const item of presetList()) {
    const opcao = document.createElement('option');
    opcao.value = item.value;
    opcao.textContent = item.label;
    presetSelect.appendChild(opcao);
  }
}

/**
 * Informa o estado das UVs do modelo.
 *
 * É a informação que decide o modo de projeção: sem UV, só a triplanar
 * funciona — e exportações de Revit e SketchUp frequentemente vêm assim.
 */
function atualizarStatusUV() {
  if (!uvStatus) return;

  if (!currentModel) {
    uvStatus.textContent = t('Carregue um modelo para ver o estado das UVs.');
    uvStatus.style.color = 'var(--text-dim, #9ca3af)';

    return;
  }

  const uv = analyzeUVs(currentModel);

  if (uv.total === 0) {
    uvStatus.textContent = t('Nenhuma malha na cena.');

    return;
  }

  if (uv.semUV === 0) {
    uvStatus.textContent = t('Todas as ^1 malhas têm UV — qualquer projeção funciona.', uv.total);
    uvStatus.style.color = '#10b981';
  } else if (uv.comUV === 0) {
    uvStatus.textContent = t(
      'Nenhuma das ^1 malhas tem UV. Use a projeção triplanar, ou gere UVs pelo seletor abaixo.',
      uv.total
    );
    uvStatus.style.color = '#f59e0b';
  } else {
    uvStatus.textContent = t(
      '^1 de ^2 malhas têm UV (^3%). A triplanar cobre as demais.',
      uv.comUV,
      uv.total,
      Math.round(uv.cobertura * 100)
    );
    uvStatus.style.color = '#f59e0b';
  }
}

/** Materiais do alvo atual — seleção, ou o modelo inteiro. */
function materiaisAlvo() {
  const raiz = viewer.selectedObject ?? currentModel;
  if (!raiz) return [];

  const lista = [];
  raiz.traverse((child) => {
    if (child.isMesh) lista.push(...materialsOf(child));
  });

  return [...new Set(lista)];
}

/** Malhas do alvo atual — necessário para gerar UV. */
function malhasAlvo() {
  const raiz = viewer.selectedObject ?? currentModel;
  if (!raiz) return [];

  const lista = [];
  raiz.traverse((child) => {
    if (child.isMesh) lista.push(child);
  });

  return lista;
}

popularPresets();

// ── Aplicar material da biblioteca ───────────────────────────────────────

document.getElementById('btn-aplicar-preset')?.addEventListener('click', () => {
  if (!exigirModelo()) return;

  const nome = presetSelect?.value;
  const malhas = malhasAlvo();

  if (malhas.length === 0) {
    showToast(t('Nada selecionado para receber o material.'), 'warn');

    return;
  }

  const material = materialFromPreset(nome);

  if (!material) {
    showToast(t('Material não encontrado na biblioteca.'), 'error');

    return;
  }

  // Um material só, compartilhado por todas as malhas do alvo: menos
  // draw calls e um único ponto de ajuste no painel PBR.
  const anteriores = malhas.map((mesh) => mesh.material);

  history.push(
    new CallbackCommand(
      t('Aplicar ^1 (^2 malhas)', material.name, malhas.length),
      () => {
        for (const mesh of malhas) mesh.material = material;
      },
      () => {
        malhas.forEach((mesh, i) => {
          mesh.material = anteriores[i];
        });
      }
    )
  );

  viewer.renderNow();
  atualizarListaMateriais();

  showToast(
    t(
      '^1 aplicado a ^2 malha(s). Ctrl+Z desfaz.',
      `<strong>${escapeHtml(material.name)}</strong>`,
      malhas.length
    ),
    'success'
  );
});

// ── Aplicar imagem como textura ──────────────────────────────────────────

/**
 * Aplica uma imagem aos materiais do alvo.
 *
 * A projeção escolhida decide o caminho: triplanar injeta shader e ignora
 * UV; as demais precisam de coordenadas, geradas na hora quando o modelo
 * não as tem.
 *
 * @param {File} file
 */
async function aplicarTextura(file) {
  if (!exigirModelo()) return;

  const materiais = materiaisAlvo();

  if (materiais.length === 0) {
    showToast(t('Nada selecionado para receber a textura.'), 'warn');

    return;
  }

  showProgress(true, t('Aplicando ^1...', file.name));

  try {
    const modo = projecaoSelect?.value ?? 'triplanar';
    const escala = Number.parseFloat(escalaTextura?.value ?? '1');
    const textura = await textureFromFile(file);

    if (modo === 'triplanar') {
      // 1 / escala: o slider está em metros por repetição, o shader
      // trabalha em repetições por metro.
      for (const material of materiais) {
        applyTriplanar(material, textura, { escala: 1 / Math.max(0.05, escala) });
      }
    } else {
      if (modo !== 'uv') {
        const geradas = generateUVsForObject(viewer.selectedObject ?? currentModel, modo, escala);
        showToast(t('UVs geradas para ^1 malha(s).', geradas), 'info', 2500);
      }

      for (const material of materiais) {
        removeTriplanar(material);
        material.map = textura;
        material.needsUpdate = true;
      }
    }

    viewer.renderNow();
    atualizarStatusUV();
    atualizarListaMateriais();

    showToast(
      t(
        'Textura ^1 aplicada a ^2 material(is) — projeção ^3.',
        `<strong>${escapeHtml(file.name)}</strong>`,
        materiais.length,
        escapeHtml(modo)
      ),
      'success'
    );
  } catch (error) {
    showToast(t('Falha ao aplicar a textura: ^1', escapeHtml(error.message)), 'error');
    console.error('[SCC Builder] Textura:', error);
  } finally {
    showProgress(false);
  }
}

texturaDrop?.addEventListener('click', () => texturaInput?.click());

texturaInput?.addEventListener('change', async () => {
  const file = texturaInput.files?.[0];
  if (file) await aplicarTextura(file);
  texturaInput.value = '';
});

texturaDrop?.addEventListener('dragover', (event) => {
  event.preventDefault();
  texturaDrop.style.background = 'rgba(0,240,255,0.08)';
});

texturaDrop?.addEventListener('dragleave', () => {
  texturaDrop.style.background = '';
});

texturaDrop?.addEventListener('drop', async (event) => {
  event.preventDefault();
  texturaDrop.style.background = '';

  const file = [...(event.dataTransfer?.files ?? [])].find((item) =>
    item.type.startsWith('image/')
  );

  if (file) {
    await aplicarTextura(file);
  } else {
    showToast(t('Solte um arquivo de imagem (JPG, PNG ou WEBP).'), 'warn');
  }
});

// ── Escala e remoção ─────────────────────────────────────────────────────

escalaTextura?.addEventListener('input', () => {
  const escala = Number.parseFloat(escalaTextura.value);

  if (valEscalaTextura) {
    valEscalaTextura.textContent = escala.toLocaleString(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  // Ajuste ao vivo: triplanar troca o uniform, UV troca o repeat.
  for (const material of materiaisAlvo()) {
    if (material.userData.__triplanar) {
      setTriplanarScale(material, 1 / Math.max(0.05, escala));
    } else if (material.map) {
      material.map.repeat.set(1 / escala, 1 / escala);
      material.map.needsUpdate = true;
    }
  }

  viewer.renderNow();
});

document.getElementById('btn-remover-textura')?.addEventListener('click', () => {
  if (!exigirModelo()) return;

  const materiais = materiaisAlvo();
  let removidas = 0;

  for (const material of materiais) {
    if (removeTriplanar(material)) removidas++;

    if (material.map) {
      material.map.dispose();
      material.map = null;
      material.needsUpdate = true;
      removidas++;
    }
  }

  viewer.renderNow();
  atualizarListaMateriais();

  showToast(
    removidas > 0
      ? t('Textura removida de ^1 material(is).', materiais.length)
      : t('Os materiais selecionados não têm textura.'),
    removidas > 0 ? 'success' : 'info'
  );
});

// ============================================================
// 25. CAMADAS E DIVISÃO DE BLOCOS
// ============================================================

const layerModeSelect = document.getElementById('layer-mode-select');
const layersSugestao = document.getElementById('layers-sugestao');
const layersLista = document.getElementById('layers-lista');
const splitModeSelect = document.getElementById('split-mode-select');
const splitFatiasConf = document.getElementById('split-fatias-config');

/**
 * Sugere a estratégia de camada que melhor separa este arquivo.
 *
 * Nenhuma serve para todos: exportações que preservam a nomenclatura do CAD
 * separam bem por nome; as que perdem tudo só separam por material.
 */
function atualizarSugestaoLayers() {
  if (!layersSugestao) return;

  if (!currentModel) {
    layersSugestao.textContent = t('Carregue um modelo para detectar camadas.');
    layersSugestao.style.color = 'var(--text-dim, #9ca3af)';
    layersLista?.replaceChildren();

    return;
  }

  const sugestao = suggestLayerMode(currentModel);

  if (layerModeSelect && !layerModeSelect.dataset.tocado) {
    layerModeSelect.value = sugestao.modo;
  }

  layersSugestao.textContent = `${t('^1 camada(s) detectada(s).', sugestao.camadas)} ${sugestao.motivo}`;
  layersSugestao.style.color = sugestao.camadas > 1 ? '#10b981' : '#f59e0b';

  atualizarListaLayers();
}

/** Lista as camadas com contagem, cor e botão de visibilidade. */
function atualizarListaLayers() {
  if (!layersLista) return;

  layersLista.replaceChildren();

  if (!currentModel) return;

  const modo = layerModeSelect?.value ?? 'nome';
  const camadas = detectLayers(currentModel, modo).slice(0, 60);

  if (camadas.length === 0) {
    const vazio = document.createElement('div');
    vazio.style.cssText = 'font-size:0.72rem;color:var(--text-dim,#6b7280);padding:4px';
    vazio.textContent = t('Nenhuma camada detectada.');
    layersLista.appendChild(vazio);

    return;
  }

  for (const camada of camadas) {
    const linha = document.createElement('div');
    linha.style.cssText =
      'display:flex;align-items:center;gap:6px;padding:3px 4px;border-radius:4px;font-size:0.72rem';

    if (camada.cor) {
      const amostra = document.createElement('span');
      amostra.style.cssText =
        `width:11px;height:11px;flex-shrink:0;border-radius:2px;background:${camada.cor};` +
        'border:1px solid rgba(255,255,255,0.25)';
      linha.appendChild(amostra);
    }

    const nome = document.createElement('span');
    nome.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    nome.textContent = camada.nome;
    nome.title = t(
      '^1 — ^2 objeto(s), ^3 triângulos',
      camada.nome,
      camada.objetos.length,
      camada.triangulos.toLocaleString(locale)
    );

    const contagem = document.createElement('span');
    contagem.style.cssText = 'flex-shrink:0;color:var(--text-dim,#6b7280);font-size:0.66rem';
    contagem.textContent = formatCount(camada.triangulos);

    const olho = document.createElement('button');
    olho.type = 'button';
    olho.style.cssText =
      'flex-shrink:0;width:18px;padding:0;background:transparent;border:none;cursor:pointer;' +
      `color:${camada.visivel ? 'var(--accent-cyan,#00f0ff)' : '#6b7280'}`;
    olho.textContent = camada.visivel ? '◉' : '○';
    olho.setAttribute(
      'aria-label',
      camada.visivel ? t('Ocultar camada ^1', camada.nome) : t('Mostrar camada ^1', camada.nome)
    );

    olho.addEventListener('click', () => {
      history.push(
        new VisibilityCommand(
          camada.objetos,
          !camada.visivel,
          camada.visivel ? t('Ocultar camada ^1', camada.nome) : t('Mostrar camada ^1', camada.nome)
        )
      );
      tree?.refresh();
      atualizarListaLayers();
      atualizarPainelBlocos();
      refreshStats();
    });

    const isolar = document.createElement('button');
    isolar.type = 'button';
    isolar.style.cssText =
      'flex-shrink:0;width:18px;padding:0;background:transparent;border:none;cursor:pointer;color:#6b7280';
    isolar.textContent = '⊙';
    isolar.title = t('Isolar a camada ^1', camada.nome);
    isolar.setAttribute('aria-label', t('Isolar a camada ^1', camada.nome));

    isolar.addEventListener('click', () => {
      history.push(new IsolateCommand(currentModel, camada.objetos));
      tree?.refresh();
      atualizarListaLayers();
      atualizarPainelBlocos();
      refreshStats();
      showToast(t('Camada ^1 isolada.', `<strong>${escapeHtml(camada.nome)}</strong>`), 'info');
    });

    linha.append(nome, contagem, olho, isolar);
    layersLista.appendChild(linha);
  }
}

layerModeSelect?.addEventListener('change', () => {
  layerModeSelect.dataset.tocado = '1';
  atualizarListaLayers();
});

// ── Organizar a cena em camadas ──────────────────────────────────────────

document.getElementById('btn-organizar-layers')?.addEventListener('click', () => {
  if (!exigirModelo()) return;

  const modo = layerModeSelect?.value ?? 'nome';
  const camadas = detectLayers(currentModel, modo);

  if (camadas.length <= 1) {
    showToast(
      t(
        'Só uma camada foi detectada — organizar não mudaria nada. Tente outra estratégia de agrupamento.'
      ),
      'warn',
      5000
    );

    return;
  }

  if (isOrganized(currentModel)) {
    showToast(
      t(
        'A cena já está organizada em ^1 camada(s). Use Ctrl+Z para desfazer antes de reorganizar.',
        existingLayers(currentModel).length
      ),
      'warn',
      5000
    );

    return;
  }

  history.push(new OrganizeInLayersCommand(currentModel, modo));

  buildHierarchyTree(currentModel);
  atualizarPainelBlocos();
  atualizarSugestaoLayers();

  showToast(
    t(
      'Cena reorganizada em <strong>^1 camadas</strong>. A árvore e a exportação passam a enxergar essa estrutura.',
      camadas.length
    ),
    'success',
    5000
  );
});

// ── Divisão de blocos ────────────────────────────────────────────────────

splitModeSelect?.addEventListener('change', () => {
  if (splitFatiasConf) {
    splitFatiasConf.style.display = splitModeSelect.value === 'fatias' ? 'flex' : 'none';
  }
});

/** A malha selecionada, ou null com aviso. */
function malhaSelecionada() {
  const alvo = viewer.selectedObject;

  if (!alvo?.isMesh) {
    showToast(
      t(
        'Selecione uma <strong>malha</strong> na árvore ou na viewport. Grupos não podem ser divididos — só as malhas dentro deles.'
      ),
      'warn',
      5000
    );

    return null;
  }

  return alvo;
}

document.getElementById('btn-prever-divisao')?.addEventListener('click', () => {
  const mesh = malhaSelecionada();
  if (!mesh) return;

  const modo = splitModeSelect?.value ?? 'conectividade';

  if (modo !== 'conectividade') {
    showToast(t('A previsão está disponível para a divisão por peças soltas.'), 'info');

    return;
  }

  showProgress(true, t('Analisando a geometria...'));

  // Cede um frame: a análise trava a thread em malhas grandes.
  setTimeout(() => {
    try {
      const resultado = previewSplit(mesh);

      if (!resultado.viavel) {
        showToast(
          t(
            'Malha grande demais (^1 triângulos) para a análise por conectividade. Otimize antes ou use fatias.',
            formatCount(resultado.triangulos)
          ),
          'warn',
          7000
        );

        return;
      }

      showToast(
        `<strong>${escapeHtml(mesh.name || t('Malha'))}</strong><br>` +
          t(
            '^1 triângulos em <strong>^2</strong> peça(s) solta(s).',
            formatCount(resultado.triangulos),
            resultado.componentes
          ) +
          (resultado.componentes > 300
            ? `<br><span style="color:#f59e0b">${t('Dividir geraria muitos objetos — a árvore ficaria difícil de navegar.')}</span>`
            : ''),
        'info',
        8000
      );
    } finally {
      showProgress(false);
    }
  }, 30);
});

document.getElementById('btn-dividir-bloco')?.addEventListener('click', () => {
  const mesh = malhaSelecionada();
  if (!mesh) return;

  const modo = splitModeSelect?.value ?? 'conectividade';

  showProgress(true, t('Dividindo a malha...'));

  setTimeout(() => {
    try {
      const { partes, motivo } = splitMesh(mesh, {
        modo,
        eixo: document.getElementById('split-eixo')?.value ?? 'y',
        fatias: Number.parseInt(document.getElementById('split-qtd')?.value ?? '4', 10),
      });

      if (partes.length === 0) {
        showToast(motivo ?? t('Não foi possível dividir esta malha.'), 'warn', 7000);

        return;
      }

      history.push(new SplitMeshCommand(mesh, partes));

      viewer.select(null);
      buildHierarchyTree(currentModel);
      atualizarPainelBlocos();
      atualizarListaLayers();
      refreshStats();

      showToast(
        t(
          'Malha dividida em <strong>^1 peça(s)</strong>. Agora cada uma pode ser ocultada, excluída ou texturizada em separado. Ctrl+Z desfaz.',
          partes.length
        ),
        'success',
        7000
      );
    } catch (error) {
      showToast(t('Falha ao dividir: ^1', escapeHtml(error.message)), 'error');
      console.error('[SCC Builder] Divisão:', error);
    } finally {
      showProgress(false);
    }
  }, 30);
});
