import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import type { AccountRef, Currency, LedgerStore, Leg } from '../src/domain/ledger.js';
import { pool, stores } from './stores.js';

afterAll(() => pool?.end());

/**
 * Teste de propriedade do E1.5 (ROADMAP): 10 mil transações aleatórias, de
 * todos os tipos, e no fim o livro inteiro continua fechando. Semente fixa:
 * se falhar, falha igual na próxima vez.
 */
const TRANSACTIONS = Number(process.env.LEDGER_PROPERTY_TX ?? 10_000);

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe.each(stores)('propriedade do ledger: %s', (_name, make, enabled) => {
  it.runIf(enabled)(
    `${TRANSACTIONS} transações aleatórias: soma zero, saldo = entradas, ninguém negativo`,
    async () => {
      const store: LedgerStore = make();
      const rand = mulberry32(20261112);
      const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)]!;
      const amount = () => BigInt(1 + Math.floor(rand() * 5_000));

      const currencies: Currency[] = ['THALER', 'SCITY'];
      // Ids novos a cada execução: no Postgres, o teste convive com dados de outras rodadas.
      const run = randomUUID().slice(0, 8);
      const players = Array.from({ length: 12 }, () => randomUUID());
      const acc = (ownerType: AccountRef['ownerType'], ownerId: string, currency: Currency): AccountRef => ({
        ownerType,
        ownerId,
        currency,
      });
      const mint = (c: Currency) => acc('system', `mint_${run}`, c);
      const pool = (c: Currency) => acc('pool', `p2e_${run}`, c);
      const sink = (c: Currency) => acc('burn', `sink_${run}`, c);
      const escrow = (c: Currency) => acc('escrow', `market_${run}`, c);

      let accepted = 0;
      let rejected = 0;
      for (let k = 0; k < TRANSACTIONS; k++) {
        const c = pick(currencies);
        const v = amount();
        const a = acc('player', pick(players), c);
        let b = acc('player', pick(players), c);
        while (b.ownerId === a.ownerId) b = acc('player', pick(players), c);
        const legs: Leg[] = pick([
          // emissão para o pool e do pool para o jogador
          () => [{ account: mint(c), amount: -v }, { account: pool(c), amount: v }],
          () => [{ account: pool(c), amount: -v }, { account: a, amount: v }],
          // pagamento direto, transferência, gasto, escrow e taxa de três pernas
          () => [{ account: mint(c), amount: -v }, { account: a, amount: v }],
          () => [{ account: a, amount: -v }, { account: b, amount: v }],
          () => [{ account: a, amount: -v }, { account: sink(c), amount: v }],
          () => [{ account: a, amount: -v }, { account: escrow(c), amount: v }],
          () => [{ account: escrow(c), amount: -v }, { account: b, amount: v }],
          () => {
            const fee = v / 10n + 1n;
            return [
              { account: a, amount: -(v + fee) },
              { account: b, amount: v },
              { account: sink(c), amount: fee },
            ];
          },
        ])();
        try {
          const idempotencyKey = `prop-${run}-${k}`;
          await store.post({ kind: 'property_test', idempotencyKey, legs }, new Date());
          accepted++;
          // De vez em quando o mesmo pedido chega de novo (retry de rede): não pode lançar duas vezes.
          if (rand() < 0.05) {
            const again = await store.post({ kind: 'property_test', idempotencyKey, legs }, new Date());
            expect(again.replayed).toBe(true);
          }
        } catch (error) {
          expect((error as { code?: string }).code).toBe('insufficient_funds');
          rejected++;
        }
      }

      const report = await store.audit();
      for (const c of currencies) expect(report.sums.get(c) ?? 0n).toBe(0n);
      expect(report.mismatches).toBe(0);
      expect(report.negatives).toBe(0);
      expect(report.unbalancedTx).toBe(0);
      // O gerador precisa exercitar os dois caminhos.
      expect(accepted).toBeGreaterThan(TRANSACTIONS / 3);
      expect(rejected).toBeGreaterThan(0);
    },
    600_000,
  );
});
