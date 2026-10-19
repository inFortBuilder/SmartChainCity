/**
 * Modal de exportação.
 *
 * Antes o clique em "Export GLB" baixava o arquivo na hora, com um nome
 * derivado do modelo (`Modern_Villa_Project.glb`). Sem chance de renomear,
 * de conferir o formato, nem de ver o que ia junto — e um estande com
 * blocos ocultos merece essa conferência antes de virar arquivo.
 *
 * O diálogo é construído com DOM (não innerHTML) porque o nome do modelo
 * vem do arquivo do usuário.
 */
import { t } from '../i18n/index.js';

/**
 * Caracteres que o Windows e o Linux recusam em nome de arquivo.
 *
 * Uso uma lista em vez de expressão regular de propósito: o intervalo de
 * controle (0x00–0x1F) também precisa ser barrado, e escrevê-lo dentro de
 * um regex traz caracteres de controle para o código-fonte. Comparar por
 * código é mais legível e não tem o problema de estado do `lastIndex`.
 */
const PROIBIDOS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

/** Nomes reservados pelo Windows — um arquivo "CON.glb" não pode ser criado. */
const RESERVADOS = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

/** O caractere é aceito em nome de arquivo? */
function caractereValido(char) {
  return !PROIBIDOS.has(char) && char.charCodeAt(0) >= 32;
}

/**
 * Normaliza um nome de arquivo, sem a extensão.
 *
 * @param {string} bruto
 * @returns {string}
 */
export function sanitizeFileName(bruto) {
  let nome = [...String(bruto ?? '')]
    .map((char) => (caractereValido(char) ? char : '_'))
    .join('')
    // Espaço é legal no Windows, mas atrapalha em URL e linha de comando.
    .replace(/\s+/g, '_')
    .trim()
    // O Windows descarta ponto e espaço no fim do nome.
    .replace(/[. _]+$/, '');

  if (nome === '' || /^[._]+$/.test(nome)) {
    nome = 'modelo';
  }

  if (RESERVADOS.has(nome.toUpperCase())) {
    nome = `${nome}_arquivo`;
  }

  // 120 caracteres deixam folga para o caminho e a extensão no limite de 255.
  return nome.slice(0, 120);
}

/**
 * Valida o nome digitado e devolve o problema, se houver.
 *
 * @param {string} bruto
 * @returns {string|null}
 */
export function validateFileName(bruto) {
  const nome = String(bruto ?? '').trim();

  if (nome === '') return t('Informe um nome para o arquivo.');

  if ([...nome].some((char) => !caractereValido(char))) {
    return t('Evite os caracteres < > : " / \\ | ? * e caracteres de controle.');
  }

  if (RESERVADOS.has(nome.toUpperCase())) {
    return t('"^1" é um nome reservado pelo Windows.', nome);
  }

  if (nome.length > 120) return t('O nome é longo demais (máximo 120 caracteres).');

  return null;
}

/**
 * Abre o modal e resolve com as escolhas do usuário, ou `null` se cancelar.
 *
 * @param {object} options
 * @param {string} options.defaultName nome sugerido, sem extensão
 * @param {string} options.format extensão inicial
 * @param {string[]} options.formats formatos disponíveis
 * @param {{visiveis:number, ocultos:number, triangulosVisiveis:number, triangulosOcultos:number}} [options.resumo]
 * @param {string} [options.engineLabel] preset de destino, quando houver
 * @param {(valor: number) => string} [options.formatCount]
 * @returns {Promise<{name: string, format: string}|null>}
 */
export function openExportDialog(options) {
  const {
    defaultName = 'modelo',
    format = 'glb',
    formats = ['glb'],
    resumo = null,
    engineLabel = null,
    formatCount = (valor) => String(valor),
  } = options;

  return new Promise((resolve) => {
    const anterior = document.activeElement;

    const overlay = document.createElement('div');
    overlay.className = 'c3d-export-dialog';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'c3d-export-titulo');
    overlay.style.cssText = `
      position:fixed; inset:0; z-index:99997; padding:24px;
      background:rgba(0,0,0,0.72); backdrop-filter:blur(8px);
      display:flex; align-items:center; justify-content:center;
    `;

    const card = document.createElement('div');
    card.style.cssText = `
      width:100%; max-width:460px; padding:24px 26px; border-radius:12px;
      background:rgba(12,17,26,0.98); border:1px solid rgba(0,240,255,0.28);
      box-shadow:0 20px 60px rgba(0,0,0,0.7); color:#e5e7eb;
      font-family:var(--font-body, system-ui); font-size:0.88rem;
    `;

    // ── Título ───────────────────────────────────────────────────────────
    const titulo = document.createElement('h2');
    titulo.id = 'c3d-export-titulo';
    titulo.textContent = t('Exportar modelo');
    titulo.style.cssText =
      'margin:0 0 16px; font-size:1.05rem; font-weight:700; color:var(--accent-cyan,#00f0ff);' +
      'font-family:var(--font-heading, inherit)';

    // ── Nome do arquivo ──────────────────────────────────────────────────
    const rotuloNome = document.createElement('label');
    rotuloNome.htmlFor = 'c3d-export-nome';
    rotuloNome.textContent = t('Nome do arquivo');
    rotuloNome.style.cssText =
      'display:block; font-size:0.74rem; text-transform:uppercase; letter-spacing:0.04em;' +
      'color:var(--text-dim,#9ca3af); margin-bottom:6px';

    const linhaNome = document.createElement('div');
    linhaNome.style.cssText = 'display:flex; align-items:stretch; gap:0; margin-bottom:4px';

    const campoNome = document.createElement('input');
    campoNome.id = 'c3d-export-nome';
    campoNome.type = 'text';
    campoNome.value = defaultName;
    campoNome.autocomplete = 'off';
    campoNome.spellcheck = false;
    campoNome.style.cssText = `
      flex:1; min-width:0; padding:9px 12px; font-size:0.9rem;
      border-radius:6px 0 0 6px; border:1px solid rgba(255,255,255,0.18);
      border-right:none; background:rgba(255,255,255,0.05); color:#fff;
      font-family:var(--font-mono, monospace);
    `;

    const sufixo = document.createElement('span');
    sufixo.style.cssText = `
      display:flex; align-items:center; padding:0 12px; font-size:0.9rem;
      border-radius:0 6px 6px 0; border:1px solid rgba(255,255,255,0.18);
      background:rgba(0,240,255,0.1); color:var(--accent-cyan,#00f0ff);
      font-family:var(--font-mono, monospace); white-space:nowrap;
    `;
    sufixo.textContent = `.${format}`;

    linhaNome.append(campoNome, sufixo);

    const erro = document.createElement('div');
    erro.setAttribute('role', 'alert');
    erro.style.cssText = 'min-height:18px; font-size:0.74rem; color:#fda4af; margin-bottom:12px';

    // ── Formato ──────────────────────────────────────────────────────────
    const rotuloFormato = document.createElement('label');
    rotuloFormato.htmlFor = 'c3d-export-formato';
    rotuloFormato.textContent = t('Formato');
    rotuloFormato.style.cssText = rotuloNome.style.cssText;

    const seletorFormato = document.createElement('select');
    seletorFormato.id = 'c3d-export-formato';
    seletorFormato.style.cssText = `
      width:100%; padding:9px 12px; margin-bottom:14px; font-size:0.88rem;
      border-radius:6px; border:1px solid rgba(255,255,255,0.18);
      background:rgba(255,255,255,0.05); color:#fff;
    `;

    const descricoes = {
      glb: t('GLB — binário, tudo em um arquivo (recomendado)'),
      gltf: t('glTF — JSON legível, assets separados'),
      obj: t('OBJ — geometria simples, sem texturas embutidas'),
      stl: t('STL — só malha, para impressão 3D'),
      ply: t('PLY — malha com cores por vértice'),
    };

    for (const item of formats) {
      const opcao = document.createElement('option');
      opcao.value = item;
      opcao.textContent = descricoes[item] ?? item.toUpperCase();
      seletorFormato.appendChild(opcao);
    }
    seletorFormato.value = format;

    // ── Resumo ───────────────────────────────────────────────────────────
    const caixaResumo = document.createElement('div');
    caixaResumo.style.cssText = `
      padding:10px 12px; border-radius:6px; margin-bottom:18px;
      background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08);
      font-size:0.76rem; line-height:1.65;
    `;

    if (resumo) {
      const linhas = [
        {
          texto: t(
            '^1 triângulos em ^2 malha(s)',
            formatCount(resumo.triangulosVisiveis),
            resumo.visiveis
          ),
          cor: 'var(--accent-cyan,#00f0ff)',
        },
      ];

      if (resumo.ocultos > 0) {
        linhas.push({
          texto: t(
            '^1 bloco(s) oculto(s) serão omitidos (^2 triângulos a menos)',
            resumo.ocultos,
            formatCount(resumo.triangulosOcultos)
          ),
          cor: '#f59e0b',
        });
      }

      if (engineLabel) {
        linhas.push({ texto: t('Destino: ^1', engineLabel), cor: 'var(--text-dim,#9ca3af)' });
      }

      for (const linha of linhas) {
        const div = document.createElement('div');
        div.textContent = linha.texto;
        div.style.color = linha.cor;
        caixaResumo.appendChild(div);
      }
    } else {
      caixaResumo.textContent = t('Pronto para exportar.');
      caixaResumo.style.color = 'var(--text-dim,#9ca3af)';
    }

    // ── Ações ────────────────────────────────────────────────────────────
    const acoes = document.createElement('div');
    acoes.style.cssText = 'display:flex; gap:8px; justify-content:flex-end';

    const btnCancelar = document.createElement('button');
    btnCancelar.type = 'button';
    btnCancelar.textContent = t('Cancelar');
    btnCancelar.style.cssText = `
      padding:9px 18px; border-radius:6px; cursor:pointer; font-size:0.84rem;
      background:transparent; border:1px solid rgba(255,255,255,0.22); color:#e5e7eb;
    `;

    const btnSalvar = document.createElement('button');
    btnSalvar.type = 'button';
    btnSalvar.textContent = t('Salvar arquivo');
    btnSalvar.style.cssText = `
      padding:9px 22px; border-radius:6px; cursor:pointer; font-size:0.84rem;
      background:var(--accent-cyan,#00f0ff); border:none; color:#06131a; font-weight:600;
    `;

    acoes.append(btnCancelar, btnSalvar);

    card.append(
      titulo,
      rotuloNome,
      linhaNome,
      erro,
      rotuloFormato,
      seletorFormato,
      caixaResumo,
      acoes
    );
    overlay.appendChild(card);

    // ── Comportamento ────────────────────────────────────────────────────
    const validar = () => {
      const problema = validateFileName(campoNome.value);

      erro.textContent = problema ?? '';
      btnSalvar.disabled = Boolean(problema);
      btnSalvar.style.opacity = problema ? '0.5' : '1';
      btnSalvar.style.cursor = problema ? 'not-allowed' : 'pointer';
      campoNome.setAttribute('aria-invalid', String(Boolean(problema)));

      return !problema;
    };

    const fechar = (resultado) => {
      document.removeEventListener('keydown', aoTeclar, true);
      overlay.remove();
      anterior?.focus?.();
      resolve(resultado);
    };

    const confirmar = () => {
      if (!validar()) {
        campoNome.focus();

        return;
      }

      fechar({
        name: sanitizeFileName(campoNome.value),
        format: seletorFormato.value,
      });
    };

    function aoTeclar(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        fechar(null);
      } else if (event.key === 'Enter' && event.target !== btnCancelar) {
        event.preventDefault();
        confirmar();
      } else if (event.key === 'Tab') {
        // Prende o foco dentro do diálogo.
        const focaveis = [campoNome, seletorFormato, btnCancelar, btnSalvar].filter(
          (el) => !el.disabled
        );
        const primeiro = focaveis[0];
        const ultimo = focaveis.at(-1);

        if (event.shiftKey && document.activeElement === primeiro) {
          event.preventDefault();
          ultimo.focus();
        } else if (!event.shiftKey && document.activeElement === ultimo) {
          event.preventDefault();
          primeiro.focus();
        }
      }
    }

    campoNome.addEventListener('input', validar);
    seletorFormato.addEventListener('change', () => {
      sufixo.textContent = `.${seletorFormato.value}`;
    });

    btnCancelar.addEventListener('click', () => fechar(null));
    btnSalvar.addEventListener('click', confirmar);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) fechar(null);
    });

    document.addEventListener('keydown', aoTeclar, true);
    document.body.appendChild(overlay);

    validar();
    campoNome.focus();
    // Seleciona o nome inteiro: o caso comum é digitar outro por cima.
    campoNome.select();
  });
}
