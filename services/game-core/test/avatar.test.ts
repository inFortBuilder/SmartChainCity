import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { DECAY, decayDue, decayed, newAvatar, status } from '../src/domain/avatar.js';

const HOUR = 3_600_000;
const t0 = new Date('2026-11-12T12:00:00Z');
const at = (hours: number) => new Date(t0.getTime() + hours * HOUR);
const make = () => newAvatar({ id: randomUUID(), accountId: randomUUID(), rarity: 'common', jobCode: 'padeiro' }, t0);

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return null;
};

describe('newAvatar', () => {
  it('nasce cheio, com educação zero', () => {
    expect(make().attributes).toEqual({ energy: 10, health: 10, happiness: 10, food: 10, hygiene: 10, education: 0 });
  });

  it('a profissão precisa ser da raridade do avatar', () => {
    expect(code(() => newAvatar({ id: randomUUID(), accountId: randomUUID(), rarity: 'common', jobCode: 'astronauta' }, t0))).toBe('invalid_job');
    expect(code(() => newAvatar({ id: randomUUID(), accountId: randomUUID(), rarity: 'mitico', jobCode: 'padeiro' }, t0))).toBe('invalid_rarity');
  });
});

describe('decayed', () => {
  it('alimentação vai de 10 a 0 em 48 h (GDD), sem passar de zero', () => {
    expect(DECAY.food.everyMs).toBe(4.8 * HOUR);
    expect(decayed(make(), at(24)).attributes.food).toBe(5);
    expect(decayed(make(), at(48)).attributes.food).toBe(0);
    expect(decayed(make(), at(500)).attributes.food).toBe(0);
  });

  it('energia, saúde e educação não caem com o tempo', () => {
    const later = decayed(make(), at(200)).attributes;
    expect([later.energy, later.health, later.education]).toEqual([10, 10, 0]);
  });

  it('aplicar em partes dá o mesmo que de uma vez: a fração de tempo não se perde', () => {
    let step = make();
    for (let h = 1; h <= 30; h++) step = decayed(step, at(h));
    const once = decayed(make(), at(30));
    expect(step.attributes).toEqual(once.attributes);
    expect(step.anchors.food.getTime()).toBe(once.anchors.food.getTime());
  });

  it('decayDue só aponta quem tem queda pendente', () => {
    const a = make();
    expect(decayDue(a, at(4))).toBe(false);
    expect(decayDue(a, at(5))).toBe(true);
    expect(decayDue(decayed(a, at(1000)), at(1001))).toBe(false);
  });
});

describe('status', () => {
  it('sem comida não ganha recompensa (GDD: 48 h sem comer)', () => {
    expect(status(make()).earnsReward).toBe(true);
    expect(status(decayed(make(), at(48))).earnsReward).toBe(false);
  });
});
