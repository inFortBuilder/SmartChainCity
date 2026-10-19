import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CallbackCommand,
  Command,
  History,
  MaterialCommand,
  TransformCommand,
  captureMaterial,
  captureTransform,
} from '../src/utils/history.js';

/** Stub mínimo de Object3D — evita carregar o Three.js nos testes. */
function fakeObject(name = 'Cubo') {
  const vec = (x, y, z) => ({
    _v: [x, y, z],
    toArray() {
      return [...this._v];
    },
    fromArray(array) {
      this._v = [...array];
    },
  });

  return {
    name,
    type: 'Mesh',
    position: vec(0, 0, 0),
    quaternion: { ...vec(0, 0, 0), _v: [0, 0, 0, 1] },
    scale: vec(1, 1, 1),
    updateMatrixWorld: vi.fn(),
  };
}

function fakeMaterial(overrides = {}) {
  let hex = overrides.colorHex ?? 0xff0000;

  return {
    roughness: 0.5,
    metalness: 0.1,
    opacity: 1,
    transparent: false,
    wireframe: false,
    needsUpdate: false,
    color: {
      getHex: () => hex,
      set: (value) => {
        hex = value;
      },
    },
  };
}

describe('captureTransform', () => {
  it('captura arrays independentes do objeto', () => {
    const object = fakeObject();
    const snapshot = captureTransform(object);

    object.position.fromArray([9, 9, 9]);

    expect(snapshot.position).toEqual([0, 0, 0]);
  });
});

describe('TransformCommand', () => {
  it('aplica e desfaz a transformação', () => {
    const object = fakeObject();
    const before = captureTransform(object);

    object.position.fromArray([5, 0, 0]);
    const after = captureTransform(object);

    const command = new TransformCommand(object, before, after);

    command.undo();
    expect(object.position.toArray()).toEqual([0, 0, 0]);

    command.execute();
    expect(object.position.toArray()).toEqual([5, 0, 0]);
  });

  it('funde arrastos consecutivos no mesmo objeto', () => {
    const object = fakeObject();
    const a = new TransformCommand(object, captureTransform(object), {
      position: [1, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    });
    const b = new TransformCommand(
      object,
      { position: [1, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
      { position: [2, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] }
    );

    expect(a.merge(b)).toBe(true);
    expect(a.after.position).toEqual([2, 0, 0]);
  });

  it('não funde comandos de objetos diferentes', () => {
    const a = new TransformCommand(
      fakeObject('A'),
      captureTransform(fakeObject()),
      captureTransform(fakeObject())
    );
    const b = new TransformCommand(
      fakeObject('B'),
      captureTransform(fakeObject()),
      captureTransform(fakeObject())
    );

    expect(a.merge(b)).toBe(false);
  });

  it('não funde comandos distantes no tempo', () => {
    const object = fakeObject();
    const a = new TransformCommand(object, captureTransform(object), captureTransform(object));
    const b = new TransformCommand(object, captureTransform(object), captureTransform(object));
    b.timestamp = a.timestamp + 5000;

    expect(a.merge(b)).toBe(false);
  });
});

describe('MaterialCommand', () => {
  it('restaura as propriedades anteriores', () => {
    const material = fakeMaterial();
    const before = [captureMaterial(material)];

    const command = new MaterialCommand([material], before, { roughness: 0.9 });
    command.execute();
    expect(material.roughness).toBe(0.9);

    command.undo();
    expect(material.roughness).toBe(0.5);
  });

  it('restaura cores por hexadecimal', () => {
    const material = fakeMaterial({ colorHex: 0x00ff00 });
    const before = [captureMaterial(material)];

    const command = new MaterialCommand([material], before, { color: 0x0000ff });
    command.execute();
    expect(material.color.getHex()).toBe(0x0000ff);

    command.undo();
    expect(material.color.getHex()).toBe(0x00ff00);
  });
});

describe('History', () => {
  let history;
  let log;

  beforeEach(() => {
    log = [];
    history = new History({ limit: 3 });
  });

  const makeCommand = (label) =>
    new CallbackCommand(
      label,
      () => log.push(`do:${label}`),
      () => log.push(`undo:${label}`)
    );

  it('começa vazio', () => {
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it('executa ao empilhar', () => {
    history.push(makeCommand('a'));

    expect(log).toEqual(['do:a']);
    expect(history.canUndo).toBe(true);
  });

  it('respeita skipExecute para mudanças já aplicadas', () => {
    history.push(makeCommand('a'), { skipExecute: true });

    expect(log).toEqual([]);
    expect(history.canUndo).toBe(true);
  });

  it('desfaz e refaz na ordem correta', () => {
    history.push(makeCommand('a'));
    history.push(makeCommand('b'));

    history.undo();
    expect(log.at(-1)).toBe('undo:b');
    expect(history.canRedo).toBe(true);

    history.redo();
    expect(log.at(-1)).toBe('do:b');
    expect(history.canRedo).toBe(false);
  });

  it('invalida o redo após uma nova ação', () => {
    history.push(makeCommand('a'));
    history.undo();
    expect(history.canRedo).toBe(true);

    history.push(makeCommand('b'));
    expect(history.canRedo).toBe(false);
  });

  it('respeita o limite descartando os mais antigos', () => {
    for (const label of ['a', 'b', 'c', 'd', 'e']) {
      history.push(makeCommand(label));
    }

    expect(history.state.depth).toBe(3);
    expect(history.state.undoLabel).toBe('e');
  });

  it('devolve null ao desfazer com a pilha vazia', () => {
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBeNull();
  });

  it('notifica mudanças de estado', () => {
    const onChange = vi.fn();
    const tracked = new History({ onChange });

    tracked.push(makeCommand('a'));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ canUndo: true, canRedo: false, undoLabel: 'a' })
    );
  });

  it('limpa as duas pilhas', () => {
    history.push(makeCommand('a'));
    history.undo();
    history.clear();

    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });
});

describe('Command (classe base)', () => {
  it('exige implementação de execute e undo', () => {
    const command = new Command('teste');

    expect(() => command.execute()).toThrow(/não implementado/);
    expect(() => command.undo()).toThrow(/não implementado/);
    expect(command.merge(command)).toBe(false);
  });
});
