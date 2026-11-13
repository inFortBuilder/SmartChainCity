/**
 * Abastece o pool P2E do economy local, para a coleta de turnos ter de onde
 * pagar. Só para desenvolvimento: emite THALER da conta `system/mint`.
 *
 *   pnpm dev:fund-pool [THALER]        (padrão: 100.000 THALER)
 *
 * Lê PORT e INTERNAL_TOKEN de services/economy/.env.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve(import.meta.dirname, '../../services/economy/.env');
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
if (!env.INTERNAL_TOKEN) throw new Error('Preencha INTERNAL_TOKEN em services/economy/.env.');

const thaler = Number(process.argv[2] ?? 100_000);
const cents = String(Math.round(thaler * 100));
const url = `http://127.0.0.1:${env.PORT ?? 8010}/internal/v1/ledger/transactions`;
const response = await fetch(url, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-service-token': env.INTERNAL_TOKEN,
    'idempotency-key': `dev-pool-${randomUUID()}`,
  },
  body: JSON.stringify({
    kind: 'pool_mint',
    ref_type: 'dev',
    legs: [
      { owner_type: 'system', owner_id: 'mint', currency: 'THALER', amount: `-${cents}` },
      { owner_type: 'pool', owner_id: 'p2e', currency: 'THALER', amount: cents },
    ],
  }),
});
const body = await response.json();
if (!response.ok) throw new Error(JSON.stringify(body));
console.log(`Pool P2E abastecido com ${thaler.toLocaleString('pt-BR')} THALER.`);
