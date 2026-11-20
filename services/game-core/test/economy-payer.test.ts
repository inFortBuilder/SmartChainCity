import { describe, expect, it } from 'vitest';

import type { Shift } from '../src/domain/shift.js';
import { EconomyPayer } from '../src/infra/economy-payer.js';

const shift = { id: 's-1', accountId: 'a-1' } as Shift;

function payerWith(calls: Headers[]) {
  const fake = (async (_url: string, init?: RequestInit) => {
    calls.push(new Headers(init?.headers));
    return new Response('{}', { status: 201 });
  }) as typeof fetch;
  return new EconomyPayer('http://economy', 'x'.repeat(32), fake);
}

describe('EconomyPayer', () => {
  it('repassa o x-request-id ao ledger, para seguir o pagamento nos dois logs', async () => {
    const calls: Headers[] = [];
    await payerWith(calls).payShift(shift, 150n, 'req-123');
    expect(calls[0]!.get('x-request-id')).toBe('req-123');
    expect(calls[0]!.get('idempotency-key')).toBe('shift:s-1');
  });

  it('sem id, não manda o cabeçalho', async () => {
    const calls: Headers[] = [];
    await payerWith(calls).payShift(shift, 150n);
    expect(calls[0]!.has('x-request-id')).toBe(false);
  });
});
