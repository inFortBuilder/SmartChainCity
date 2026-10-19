/**
 * Árvore de hierarquia virtualizada e acessível.
 *
 * F11 da auditoria: a v1 criava um `<div>` com estilos inline para CADA nó
 * da cena, recursivamente. Um modelo de Revit tem 10 mil a 50 mil nós — a
 * aba congelava por dezenas de segundos.
 *
 * Aqui a árvore é achatada em uma lista de nós visíveis (respeitando o que
 * está expandido) e só a janela dentro do viewport é renderizada. Uma cena
 * com 50 mil nós mantém ~40 elementos no DOM.
 *
 * Acessibilidade (item 40): papéis `tree`/`treeitem`, `aria-expanded`,
 * `aria-level`, `aria-selected` e navegação completa por teclado.
 */

import { countTriangles } from '../utils/sceneEditor.js';
import { locale, t } from '../i18n/index.js';

const ROW_HEIGHT = 24;
const OVERSCAN = 8;

export class HierarchyTree {
  /**
   * @param {HTMLElement} container
   * @param {{onSelect?: (object: object) => void}} [options]
   */
  constructor(container, options = {}) {
    this.container = container;
    this.onSelect = options.onSelect ?? (() => {});
    this.onToggleVisibility = options.onToggleVisibility ?? (() => {});
    this.onSelectionChange = options.onSelectionChange ?? (() => {});

    /** @type {Array<{object: object, depth: number, hasChildren: boolean}>} */
    this.flat = [];
    this.expanded = new WeakSet();
    this.selected = null;
    /** @type {Set<object>} seleção múltipla via Ctrl/Shift */
    this.selection = new Set();
    /** Cache de contagem de triângulos — recalcular a cada scroll seria caro. */
    this.trianguloCache = new WeakMap();
    this.root = null;
    this.focusIndex = 0;

    this.#buildShell();
  }

  #buildShell() {
    this.container.replaceChildren();
    this.container.style.position = 'relative';
    this.container.style.overflowY = 'auto';

    this.viewport = document.createElement('div');
    this.viewport.setAttribute('role', 'tree');
    this.viewport.setAttribute('aria-label', t('Hierarquia da cena'));
    this.viewport.tabIndex = 0;
    this.viewport.style.position = 'relative';
    this.viewport.style.outline = 'none';

    // Espaçador: dá ao container a altura total, para a barra de rolagem
    // refletir o tamanho real da árvore.
    this.spacer = document.createElement('div');
    this.spacer.style.position = 'relative';
    this.spacer.style.width = '100%';

    this.rows = document.createElement('div');
    this.rows.style.position = 'absolute';
    this.rows.style.top = '0';
    this.rows.style.left = '0';
    this.rows.style.right = '0';

    this.spacer.appendChild(this.rows);
    this.viewport.appendChild(this.spacer);
    this.container.appendChild(this.viewport);

    this.container.addEventListener('scroll', () => this.#render());
    this.viewport.addEventListener('keydown', (event) => this.#onKeyDown(event));

    this.resizeObserver = new ResizeObserver(() => this.#render());
    this.resizeObserver.observe(this.container);
  }

  /**
   * Define a raiz e reconstrói a árvore.
   * @param {object} root Object3D
   */
  setRoot(root) {
    this.root = root;
    this.expanded = new WeakSet();
    this.selected = null;
    this.selection = new Set();
    this.trianguloCache = new WeakMap();
    this.focusIndex = 0;

    // Abre os dois primeiros níveis: o suficiente para orientar sem
    // materializar a cena inteira.
    if (root) {
      this.expanded.add(root);
      for (const child of root.children ?? []) {
        if ((child.children?.length ?? 0) > 0) this.expanded.add(child);
      }
    }

    this.#flatten();
    this.container.scrollTop = 0;
    this.#render();
  }

  /** Recalcula a lista linear de nós visíveis. */
  #flatten() {
    this.flat = [];
    if (!this.root) return;

    const stack = [{ object: this.root, depth: 0 }];

    while (stack.length > 0) {
      const { object, depth } = stack.pop();
      const children = object.children ?? [];

      this.flat.push({ object, depth, hasChildren: children.length > 0 });

      if (children.length > 0 && this.expanded.has(object)) {
        // Empilha ao contrário para preservar a ordem original.
        for (let i = children.length - 1; i >= 0; i--) {
          stack.push({ object: children[i], depth: depth + 1 });
        }
      }
    }

    this.spacer.style.height = `${this.flat.length * ROW_HEIGHT}px`;
  }

  /** Renderiza apenas a janela visível. */
  #render() {
    const scrollTop = this.container.scrollTop;
    const height = this.container.clientHeight || 300;

    const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const last = Math.min(
      this.flat.length,
      Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN
    );

    this.rows.style.transform = `translateY(${first * ROW_HEIGHT}px)`;
    this.rows.replaceChildren();

    if (this.flat.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:10px;font-size:0.78rem;color:var(--text-dim,#6b7280)';
      empty.textContent = t('Nenhum modelo carregado.');
      this.rows.appendChild(empty);

      return;
    }

    const fragment = document.createDocumentFragment();

    for (let i = first; i < last; i++) {
      fragment.appendChild(this.#createRow(this.flat[i], i));
    }

    this.rows.appendChild(fragment);
  }

  /** Triângulos da subárvore, memorizado. */
  #triangulos(object) {
    if (!this.trianguloCache.has(object)) {
      this.trianguloCache.set(object, countTriangles(object));
    }

    return this.trianguloCache.get(object);
  }

  #createRow(entry, index) {
    const { object, depth, hasChildren } = entry;
    const isExpanded = hasChildren && this.expanded.has(object);
    const isSelected = this.selected === object || this.selection.has(object);
    const oculto = !object.visible;

    const row = document.createElement('div');
    row.className = 'c3d-tree-row';
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-level', String(depth + 1));
    row.setAttribute('aria-selected', String(isSelected));
    row.tabIndex = -1;

    if (hasChildren) {
      row.setAttribute('aria-expanded', String(isExpanded));
    }

    row.style.cssText = `
      height:${ROW_HEIGHT}px; display:flex; align-items:center; gap:5px;
      padding-left:${depth * 14 + 6}px; padding-right:6px;
      font-size:0.77rem; cursor:pointer; border-radius:4px;
      color:${object.isMesh ? 'var(--text-main,#e5e7eb)' : 'var(--text-muted,#9ca3af)'};
      background:${isSelected ? 'rgba(0,240,255,0.14)' : 'transparent'};
      outline:${index === this.focusIndex ? '1px solid rgba(0,240,255,0.5)' : 'none'};
      opacity:${oculto ? '0.42' : '1'};
    `;

    const toggle = document.createElement('span');
    toggle.style.cssText = 'width:12px;flex-shrink:0;text-align:center;opacity:0.75';
    toggle.textContent = hasChildren ? (isExpanded ? '▾' : '▸') : '';
    toggle.setAttribute('aria-hidden', 'true');

    if (hasChildren) {
      toggle.addEventListener('click', (event) => {
        event.stopPropagation();
        this.toggle(object);
      });
    }

    const icon = document.createElement('span');
    icon.style.flexShrink = '0';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = object.isMesh ? '◈' : hasChildren ? '📁' : '⬡';

    const label = document.createElement('span');
    label.style.cssText =
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1' +
      (oculto ? ';text-decoration:line-through' : '');
    // textContent, nunca innerHTML: o nome vem do arquivo do usuário (F13).
    label.textContent = object.name || object.type;

    // Contagem de triângulos: mostra de imediato o que pesa na cena.
    const tris = this.#triangulos(object);
    const contador = document.createElement('span');
    contador.style.cssText =
      'flex-shrink:0;font-size:0.68rem;color:var(--text-dim,#6b7280);font-variant-numeric:tabular-nums';
    contador.textContent = tris > 0 ? formatarTris(tris) : '';

    // Olho: alterna a visibilidade do bloco.
    const olho = document.createElement('button');
    olho.type = 'button';
    olho.tabIndex = -1;
    olho.setAttribute(
      'aria-label',
      object.visible
        ? t('Ocultar ^1', object.name || object.type)
        : t('Mostrar ^1', object.name || object.type)
    );
    olho.title = object.visible ? t('Ocultar (não será exportado)') : t('Mostrar');
    olho.style.cssText = `
      flex-shrink:0; width:18px; height:18px; padding:0; cursor:pointer;
      background:transparent; border:none; line-height:1; font-size:0.8rem;
      color:${object.visible ? 'var(--accent-cyan,#00f0ff)' : '#6b7280'};
    `;
    olho.textContent = object.visible ? '◉' : '○';

    olho.addEventListener('click', (event) => {
      event.stopPropagation();
      this.onToggleVisibility(object);
    });

    const suffix = hasChildren ? ` · ${t('^1 filho(s)', object.children.length)}` : '';
    row.title =
      `${object.name || object.type}${suffix}` +
      (tris > 0 ? ` · ${t('^1 triângulos', tris.toLocaleString(locale))}` : '') +
      (oculto ? ` · ${t('OCULTO (não será exportado)')}` : '');

    row.append(toggle, icon, label, contador, olho);

    row.addEventListener('click', (event) => {
      this.focusIndex = index;

      // Ctrl/Cmd acumula; Shift seleciona o intervalo desde o último foco.
      if (event.ctrlKey || event.metaKey) {
        this.toggleInSelection(object);
      } else if (event.shiftKey) {
        this.selectRange(index);
      } else {
        this.selection = new Set([object]);
        this.select(object);
        this.onSelectionChange([...this.selection]);
      }
    });

    row.addEventListener('dblclick', () => {
      if (hasChildren) this.toggle(object);
    });

    return row;
  }

  /** Adiciona ou remove um objeto da seleção múltipla. */
  toggleInSelection(object) {
    if (this.selection.has(object)) {
      this.selection.delete(object);
    } else {
      this.selection.add(object);
    }

    this.selected = [...this.selection].at(-1) ?? null;
    this.#render();
    this.onSelectionChange([...this.selection]);
  }

  /** Seleciona do último item focado até o índice informado. */
  selectRange(index) {
    const ancora = this.flat.findIndex((entry) => entry.object === this.selected);
    const inicio = Math.min(ancora < 0 ? index : ancora, index);
    const fim = Math.max(ancora < 0 ? index : ancora, index);

    this.selection = new Set(this.flat.slice(inicio, fim + 1).map((entry) => entry.object));
    this.#render();
    this.onSelectionChange([...this.selection]);
  }

  /** Objetos atualmente selecionados. */
  getSelection() {
    return this.selection.size > 0 ? [...this.selection] : this.selected ? [this.selected] : [];
  }

  /** Redesenha sem recalcular a estrutura — usado após mudar visibilidade. */
  refresh() {
    this.#render();
  }

  /** Expande ou colapsa um nó. */
  toggle(object) {
    if (this.expanded.has(object)) {
      this.expanded.delete(object);
    } else {
      this.expanded.add(object);
    }

    this.#flatten();
    this.#render();
  }

  /**
   * Seleciona um nó e dispara o callback.
   * @param {object} object
   * @param {boolean} [notify]
   */
  select(object, notify = true) {
    this.selected = object;

    const index = this.flat.findIndex((entry) => entry.object === object);
    if (index >= 0) this.focusIndex = index;

    this.#render();

    if (notify) this.onSelect(object);
  }

  /**
   * Sincroniza com uma seleção feita fora (clique na viewport), expandindo
   * os ancestrais até o nó ficar visível.
   * @param {object} object
   */
  revealAndSelect(object) {
    if (!object) {
      this.selected = null;
      this.#render();

      return;
    }

    let parent = object.parent;
    let changed = false;
    while (parent) {
      if (!this.expanded.has(parent)) {
        this.expanded.add(parent);
        changed = true;
      }
      parent = parent.parent;
    }

    if (changed) this.#flatten();

    this.select(object, false);
    this.scrollTo(object);
  }

  scrollTo(object) {
    const index = this.flat.findIndex((entry) => entry.object === object);
    if (index < 0) return;

    const top = index * ROW_HEIGHT;
    const viewTop = this.container.scrollTop;
    const viewBottom = viewTop + this.container.clientHeight;

    if (top < viewTop || top + ROW_HEIGHT > viewBottom) {
      this.container.scrollTop = top - this.container.clientHeight / 2;
    }
  }

  /** Navegação por teclado no padrão WAI-ARIA de treeview. */
  #onKeyDown(event) {
    if (this.flat.length === 0) return;

    const entry = this.flat[this.focusIndex];
    let handled = true;

    switch (event.key) {
      case 'ArrowDown':
        this.focusIndex = Math.min(this.flat.length - 1, this.focusIndex + 1);
        break;

      case 'ArrowUp':
        this.focusIndex = Math.max(0, this.focusIndex - 1);
        break;

      case 'ArrowRight':
        if (entry?.hasChildren && !this.expanded.has(entry.object)) {
          this.toggle(entry.object);
        } else {
          this.focusIndex = Math.min(this.flat.length - 1, this.focusIndex + 1);
        }
        break;

      case 'ArrowLeft':
        if (entry?.hasChildren && this.expanded.has(entry.object)) {
          this.toggle(entry.object);
        } else {
          // Sobe para o pai
          for (let i = this.focusIndex - 1; i >= 0; i--) {
            if (this.flat[i].depth < entry.depth) {
              this.focusIndex = i;
              break;
            }
          }
        }
        break;

      case 'Home':
        this.focusIndex = 0;
        break;

      case 'End':
        this.focusIndex = this.flat.length - 1;
        break;

      case 'Enter':
      case ' ':
        if (entry) this.select(entry.object);
        break;

      default:
        handled = false;
    }

    if (!handled) return;

    event.preventDefault();

    const focused = this.flat[this.focusIndex];
    if (focused) this.scrollTo(focused.object);
    this.#render();
  }

  dispose() {
    this.resizeObserver?.disconnect();
    this.container.replaceChildren();
  }
}

/** 85.432 → "85,4k" — cabe na coluna estreita da árvore. */
function formatarTris(valor) {
  if (valor < 1000) return String(valor);
  const decimal = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
  if (valor < 1_000_000) return `${(valor / 1000).toLocaleString(locale, decimal)}k`;

  return `${(valor / 1_000_000).toLocaleString(locale, decimal)}M`;
}
