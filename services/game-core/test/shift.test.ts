import { createHash, randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { decayed, newAvatar } from '../src/domain/avatar.js';
import {
  BASE_RANGE,
  DAMAGE_CHANCE,
  HAPPINESS_MULT,
  HEALTH_MULT,
  baseOf,
  draw,
  settle,
  startShift,
} from '../src/domain/shift.js';

const HOUR = 3_600_000;
const t0 = new Date('2026-11-12T08:00:00Z');
const avatar = () => newAvatar({ id: randomUUID(), accountId: randomUUID(), rarity: 'common', jobCode: 'padeiro' }, t0);
const begin = (a = avatar(), hours = 6, extra: Partial<{ hoursToday: number; running: boolean }> = {}) =>
  startShift(a, { id: randomUUID(), hours, hoursToday: 0, running: false, ...extra }, t0);

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return null;
};

describe('startShift', () => {
  it('gasta a energia, marca o fim e publica só o compromisso da semente', () => {
    const { shift, avatar: after } = begin(avatar(), 6);
    expect(after.attributes.energy).toBe(7);
    expect(shift.endsAt.getTime() - shift.startsAt.getTime()).toBe(6 * HOUR);
    expect(shift.seedCommit).toBe(createHash('sha256').update(shift.seed).digest('hex'));
  });

  it('recusa turno de outra duração, turno em andamento, mais de 12 h no dia e falta de energia', () => {
    expect(code(() => begin(avatar(), 8))).toBe('invalid_shift');
    expect(code(() => begin(avatar(), 6, { running: true }))).toBe('shift_running');
    expect(code(() => begin(avatar(), 12, { hoursToday: 6 }))).toBe('daily_limit');
    const tired = { ...avatar(), attributes: { ...avatar().attributes, energy: 2 } };
    expect(code(() => begin(tired, 6))).toBe('too_tired');
  });
});

describe('settle', () => {
  it('é a fórmula do simulador: base × saúde × felicidade × experiência, metade no turno de 6 h', () => {
    const { shift } = begin();
    const r = settle(shift);
    const s = shift.snapshot;
    const expected = s.base * 0.5 * HEALTH_MULT[s.health]! * HAPPINESS_MULT[s.happiness]! * 1 * (r.damaged ? 0.7 : 1);
    expect(r.thalerCents).toBe(BigInt(Math.round(expected * 100)));
  });

  it('o resultado se refaz com a semente revelada', () => {
    const { shift } = begin();
    expect(settle(shift)).toEqual(settle({ ...shift }));
  });

  it('danos saem em cerca de 5% dos turnos', () => {
    const seed = createHash('sha256').update('teste').digest('hex');
    let hits = 0;
    for (let k = 0; k < 20_000; k++) if (draw(seed, `turno-${k}`, 'damage') < DAMAGE_CHANCE) hits++;
    expect(hits / 20_000).toBeGreaterThan(0.04);
    expect(hits / 20_000).toBeLessThan(0.06);
  });

  it('48 h sem comer: o turno não paga (GDD)', () => {
    const hungry = decayed(avatar(), new Date(t0.getTime() + 48 * HOUR));
    const { shift } = startShift(hungry, { id: randomUUID(), hours: 6, hoursToday: 0, running: false }, hungry.updatedAt);
    expect(settle(shift).thalerCents).toBe(0n);
  });
});

describe('baseOf', () => {
  it('é o ganho da profissão no catálogo, dentro da faixa da raridade', () => {
    expect(baseOf('padeiro')).toBe(125);
    expect(baseOf('pedreiro')).toBe(100);
    const b = baseOf('medico');
    expect(b).toBeGreaterThanOrEqual(BASE_RANGE.legendary[0]);
    expect(b).toBeLessThanOrEqual(BASE_RANGE.legendary[1]);
  });
});
