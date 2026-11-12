import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  type AccountRef,
  type PostingRequest,
  applyLegs,
  accountKey,
  fingerprint,
  validatePosting,
} from '../src/domain/ledger.js';

const player = (id: string = randomUUID()): AccountRef => ({ ownerType: 'player', ownerId: id, currency: 'THALER' });
const mint: AccountRef = { ownerType: 'system', ownerId: 'mint', currency: 'THALER' };
const burn: AccountRef = { ownerType: 'burn', ownerId: 'sink', currency: 'THALER' };

const request = (legs: PostingRequest['legs'], extra: Partial<PostingRequest> = {}): PostingRequest => ({
  kind: 'shift_pay',
  idempotencyKey: `teste-${randomUUID()}`,
  legs,
  ...extra,
});

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return null;
};

describe('validatePosting', () => {
  it('aceita lançamentos que somam zero', () => {
    expect(code(() => validatePosting(request([{ account: mint, amount: -500n }, { account: player(), amount: 500n }])))).toBeNull();
  });

  it('recusa soma diferente de zero, valor zero, conta repetida e lançamento único', () => {
    const p = player();
    expect(code(() => validatePosting(request([{ account: mint, amount: -500n }, { account: p, amount: 499n }])))).toBe('invalid_posting');
    expect(code(() => validatePosting(request([{ account: mint, amount: 0n }, { account: p, amount: 0n }])))).toBe('invalid_posting');
    expect(code(() => validatePosting(request([{ account: p, amount: -1n }, { account: p, amount: 1n }])))).toBe('invalid_posting');
    expect(code(() => validatePosting(request([{ account: p, amount: 1n }])))).toBe('invalid_posting');
  });

  it('soma zero é por moeda: THALER não compensa SCITY', () => {
    const p = player();
    const scity: AccountRef = { ...mint, currency: 'SCITY' };
    expect(code(() => validatePosting(request([{ account: mint, amount: -5n }, { account: { ...p, currency: 'SCITY' }, amount: 5n }, { account: scity, amount: 0n + 1n }, { account: p, amount: -1n }])))).toBe('invalid_posting');
  });

  it('queima só recebe; jogador precisa de uuid; chave e tipo têm formato', () => {
    const p = player();
    expect(code(() => validatePosting(request([{ account: burn, amount: -5n }, { account: p, amount: 5n }])))).toBe('invalid_posting');
    expect(code(() => validatePosting(request([{ account: mint, amount: -5n }, { account: player('nao-e-uuid'), amount: 5n }])))).toBe('invalid_posting');
    expect(code(() => validatePosting(request([{ account: mint, amount: -5n }, { account: p, amount: 5n }], { idempotencyKey: 'curta' })))).toBe('invalid_posting');
    expect(code(() => validatePosting(request([{ account: mint, amount: -5n }, { account: p, amount: 5n }], { kind: 'Turno Pago' })))).toBe('invalid_posting');
  });
});

describe('applyLegs', () => {
  it('só a emissora fica negativa', () => {
    const p = player();
    const next = applyLegs(new Map(), [{ account: mint, amount: -100n }, { account: p, amount: 100n }]);
    expect(next.get(accountKey(mint))).toBe(-100n);
    expect(code(() => applyLegs(new Map(), [{ account: p, amount: -1n }, { account: burn, amount: 1n }]))).toBe('insufficient_funds');
  });
});

describe('fingerprint', () => {
  it('não depende da ordem dos lançamentos, mas depende dos valores', () => {
    const p = player();
    const a = request([{ account: mint, amount: -5n }, { account: p, amount: 5n }]);
    const b = { ...a, legs: [...a.legs].reverse() };
    const c = request([{ account: mint, amount: -6n }, { account: p, amount: 6n }]);
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(fingerprint(a)).not.toBe(fingerprint(c));
  });
});
