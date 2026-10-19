/**
 * Histórico de undo/redo (command pattern).
 *
 * Item 37 da auditoria: o SCC Builder se apresenta como editor, mas toda
 * edição de transform ou de material era destrutiva — um arrasto errado no
 * gizmo não tinha volta.
 *
 * Cada comando sabe se aplicar e se desfazer. Comandos contíguos do mesmo
 * tipo e alvo podem ser fundidos (`merge`), para que arrastar o gizmo por
 * dois segundos não gere 120 entradas no histórico.
 */
import { t } from '../i18n/index.js';

export class Command {
  /**
   * @param {string} label texto exibido na UI ("Mover Parede_01")
   */
  constructor(label) {
    this.label = label;
    this.timestamp = Date.now();
  }

  execute() {
    throw new Error('Command.execute() não implementado.');
  }

  undo() {
    throw new Error('Command.undo() não implementado.');
  }

  /**
   * @param {Command} _other
   * @returns {boolean} true se absorveu o outro comando
   */
  merge(_other) {
    return false;
  }
}

/** Alteração de posição/rotação/escala de um objeto. */
export class TransformCommand extends Command {
  /**
   * @param {object} object Object3D
   * @param {{position:number[], quaternion:number[], scale:number[]}} before
   * @param {{position:number[], quaternion:number[], scale:number[]}} after
   */
  constructor(object, before, after) {
    super(t('Transformar ^1', object.name || object.type));
    this.object = object;
    this.before = before;
    this.after = after;
  }

  execute() {
    applyTransformState(this.object, this.after);
  }

  undo() {
    applyTransformState(this.object, this.before);
  }

  merge(other) {
    // Arrastos consecutivos no mesmo objeto, num intervalo curto, viram um só.
    if (!(other instanceof TransformCommand)) return false;
    if (other.object !== this.object) return false;
    if (other.timestamp - this.timestamp > 800) return false;

    this.after = other.after;
    this.timestamp = other.timestamp;

    return true;
  }
}

/** Alteração de propriedades de material. */
export class MaterialCommand extends Command {
  /**
   * @param {object[]} materials
   * @param {Array<Record<string, unknown>>} before um snapshot por material
   * @param {Record<string, unknown>} after propriedades aplicadas a todos
   */
  constructor(materials, before, after) {
    super(t('Alterar material (^1)', materials.length));
    this.materials = materials;
    this.before = before;
    this.after = after;
  }

  execute() {
    for (const material of this.materials) {
      assignMaterialProps(material, this.after);
    }
  }

  undo() {
    this.materials.forEach((material, index) => {
      assignMaterialProps(material, this.before[index]);
    });
  }

  merge(other) {
    if (!(other instanceof MaterialCommand)) return false;
    if (other.materials.length !== this.materials.length) return false;
    if (!other.materials.every((m, i) => m === this.materials[i])) return false;
    if (other.timestamp - this.timestamp > 800) return false;

    this.after = { ...this.after, ...other.after };
    this.timestamp = other.timestamp;

    return true;
  }
}

/** Comando genérico a partir de duas funções. */
export class CallbackCommand extends Command {
  /**
   * @param {string} label
   * @param {() => void} doFn
   * @param {() => void} undoFn
   */
  constructor(label, doFn, undoFn) {
    super(label);
    this.doFn = doFn;
    this.undoFn = undoFn;
  }

  execute() {
    this.doFn();
  }

  undo() {
    this.undoFn();
  }
}

/**
 * Pilha de undo/redo com limite de memória.
 */
export class History {
  /**
   * @param {{limit?: number, onChange?: (state: {canUndo:boolean, canRedo:boolean, undoLabel:string|null, redoLabel:string|null}) => void}} [options]
   */
  constructor(options = {}) {
    this.limit = options.limit ?? 50;
    this.onChange = options.onChange ?? (() => {});

    /** @type {Command[]} */
    this.undoStack = [];
    /** @type {Command[]} */
    this.redoStack = [];
  }

  /**
   * Executa um comando e o registra.
   * @param {Command} command
   * @param {{skipExecute?: boolean}} [options] use quando a mudança já ocorreu
   */
  push(command, options = {}) {
    if (!options.skipExecute) {
      command.execute();
    }

    const last = this.undoStack.at(-1);
    if (last && last.merge(command)) {
      this.redoStack.length = 0;
      this.#notify();

      return;
    }

    this.undoStack.push(command);

    // Uma nova ação invalida o caminho de redo.
    this.redoStack.length = 0;

    while (this.undoStack.length > this.limit) {
      this.undoStack.shift();
    }

    this.#notify();
  }

  undo() {
    const command = this.undoStack.pop();
    if (!command) return null;

    command.undo();
    this.redoStack.push(command);
    this.#notify();

    return command;
  }

  redo() {
    const command = this.redoStack.pop();
    if (!command) return null;

    command.execute();
    this.undoStack.push(command);
    this.#notify();

    return command;
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.#notify();
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  get state() {
    return {
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      undoLabel: this.undoStack.at(-1)?.label ?? null,
      redoLabel: this.redoStack.at(-1)?.label ?? null,
      depth: this.undoStack.length,
    };
  }

  #notify() {
    this.onChange(this.state);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Captura o estado de transform de um objeto como arrays simples
 * (não guardamos referências a Vector3/Quaternion, que são mutáveis).
 * @param {object} object
 */
export function captureTransform(object) {
  return {
    position: object.position.toArray(),
    quaternion: object.quaternion.toArray(),
    scale: object.scale.toArray(),
  };
}

function applyTransformState(object, state) {
  object.position.fromArray(state.position);
  object.quaternion.fromArray(state.quaternion);
  object.scale.fromArray(state.scale);
  object.updateMatrixWorld(true);
}

/** Propriedades de material rastreadas pelo histórico. */
const MATERIAL_PROPS = [
  'roughness',
  'metalness',
  'opacity',
  'transparent',
  'wireframe',
  'emissiveIntensity',
];

/**
 * Snapshot das propriedades de um material.
 * @param {object} material
 */
export function captureMaterial(material) {
  const snapshot = {};

  for (const prop of MATERIAL_PROPS) {
    if (prop in material) snapshot[prop] = material[prop];
  }

  if (material.color) snapshot.color = material.color.getHex();
  if (material.emissive) snapshot.emissive = material.emissive.getHex();

  return snapshot;
}

function assignMaterialProps(material, props) {
  if (!props) return;

  for (const [key, value] of Object.entries(props)) {
    if (key === 'color' && material.color) {
      material.color.set(value);
    } else if (key === 'emissive' && material.emissive) {
      material.emissive.set(value);
    } else if (key in material) {
      material[key] = value;
    }
  }

  material.needsUpdate = true;
}
