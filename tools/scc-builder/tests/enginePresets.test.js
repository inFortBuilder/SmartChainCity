import { describe, expect, it } from 'vitest';

import {
  ENGINE_PRESETS,
  SOURCE_UNITS,
  presetNotes,
  presetOptions,
  resolveTransform,
} from '../src/utils/enginePresets.js';

describe('ENGINE_PRESETS', () => {
  it('descreve todos os motores com os campos obrigatórios', () => {
    for (const [key, preset] of Object.entries(ENGINE_PRESETS)) {
      expect(preset.label, key).toBeTruthy();
      expect(['y', 'z'], key).toContain(preset.upAxis);
      expect(preset.unitsPerMeter, key).toBeGreaterThan(0);
      expect(Array.isArray(preset.notes), key).toBe(true);
    }
  });

  it('mantém as convenções documentadas de cada engine', () => {
    // Unreal é o caso que mais quebra na prática: Z-up e centímetros.
    expect(ENGINE_PRESETS.unreal.upAxis).toBe('z');
    expect(ENGINE_PRESETS.unreal.unitsPerMeter).toBe(100);

    // Unity e Three.js seguem a spec glTF: Y-up, metros.
    expect(ENGINE_PRESETS.unity.upAxis).toBe('y');
    expect(ENGINE_PRESETS.unity.unitsPerMeter).toBe(1);
    expect(ENGINE_PRESETS.threejs.upAxis).toBe('y');
    expect(ENGINE_PRESETS.threejs.unitsPerMeter).toBe(1);
  });
});

describe('resolveTransform — escala', () => {
  it('não altera nada de metros para uma engine em metros', () => {
    const result = resolveTransform({ engine: 'unity', sourceUnit: 'm', sourceUp: 'y' });

    expect(result.scale).toBe(1);
    expect(result.rotationX).toBe(0);
    expect(result.summary).toMatch(/nenhuma transformação/);
  });

  it('converte metros para centímetros no Unreal', () => {
    const result = resolveTransform({ engine: 'unreal', sourceUnit: 'm', sourceUp: 'z' });

    expect(result.scale).toBe(100);
  });

  it('converte milímetros (padrão de Revit/CAD) para metros', () => {
    const result = resolveTransform({ engine: 'unity', sourceUnit: 'mm', sourceUp: 'y' });

    expect(result.scale).toBeCloseTo(0.001, 6);
  });

  it('combina milímetros de origem com centímetros do Unreal', () => {
    // 1 mm = 0,001 m; Unreal quer centímetros (×100) → fator 0,1
    const result = resolveTransform({ engine: 'unreal', sourceUnit: 'mm', sourceUp: 'z' });

    expect(result.scale).toBeCloseTo(0.1, 6);
  });

  it('converte polegadas (SketchUp) corretamente', () => {
    const result = resolveTransform({ engine: 'threejs', sourceUnit: 'in', sourceUp: 'y' });

    expect(result.scale).toBeCloseTo(0.0254, 6);
  });

  it('converte pés', () => {
    const result = resolveTransform({ engine: 'threejs', sourceUnit: 'ft', sourceUp: 'y' });

    expect(result.scale).toBeCloseTo(0.3048, 6);
  });
});

describe('resolveTransform — eixo', () => {
  it('rotaciona -90° em X ao ir de Z-up para Y-up', () => {
    const result = resolveTransform({ engine: 'unity', sourceUp: 'z' });

    expect(result.rotationX).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('rotaciona +90° em X ao ir de Y-up para Z-up', () => {
    const result = resolveTransform({ engine: 'unreal', sourceUp: 'y' });

    expect(result.rotationX).toBeCloseTo(Math.PI / 2, 6);
  });

  it('não rotaciona quando os eixos já coincidem', () => {
    expect(resolveTransform({ engine: 'unreal', sourceUp: 'z' }).rotationX).toBe(0);
    expect(resolveTransform({ engine: 'unity', sourceUp: 'y' }).rotationX).toBe(0);
  });

  it('descreve a transformação de forma legível', () => {
    const result = resolveTransform({ engine: 'unreal', sourceUnit: 'm', sourceUp: 'y' });

    expect(result.summary).toMatch(/escala/);
    expect(result.summary).toMatch(/Y-up → Z-up/);
  });
});

describe('resolveTransform — robustez', () => {
  it('cai no preset glTF para engine desconhecida', () => {
    const result = resolveTransform({ engine: 'inexistente' });

    expect(result.preset).toBe(ENGINE_PRESETS.gltf);
  });

  it('assume metros quando a unidade é desconhecida', () => {
    expect(resolveTransform({ engine: 'unity', sourceUnit: 'parsec' }).scale).toBe(1);
  });

  it('assume Y-up quando a origem não é informada', () => {
    expect(resolveTransform({ engine: 'unity' }).rotationX).toBe(0);
  });
});

describe('SOURCE_UNITS', () => {
  it('define fatores positivos e coerentes', () => {
    expect(SOURCE_UNITS.m.metersPerUnit).toBe(1);
    expect(SOURCE_UNITS.cm.metersPerUnit).toBeLessThan(SOURCE_UNITS.m.metersPerUnit);
    expect(SOURCE_UNITS.mm.metersPerUnit).toBeLessThan(SOURCE_UNITS.cm.metersPerUnit);

    for (const [key, unit] of Object.entries(SOURCE_UNITS)) {
      expect(unit.metersPerUnit, key).toBeGreaterThan(0);
    }
  });
});

describe('helpers de UI', () => {
  it('presetOptions devolve uma opção por engine', () => {
    const options = presetOptions();

    expect(options).toHaveLength(Object.keys(ENGINE_PRESETS).length);
    expect(options[0]).toHaveProperty('value');
    expect(options[0]).toHaveProperty('label');
  });

  it('presetNotes devolve as anotações do preset', () => {
    expect(presetNotes('unreal').length).toBeGreaterThan(0);
    expect(presetNotes('inexistente')).toEqual([]);
  });
});
