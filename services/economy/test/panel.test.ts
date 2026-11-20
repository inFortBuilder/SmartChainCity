import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { AccountRef, LedgerStore, PostingRequest } from '../src/domain/ledger.js';
import { type PanelStore, buildPanel, classify } from '../src/domain/panel.js';
import { MemoryLedgerStore } from '../src/infra/memory-store.js';
import { pool, stores } from './stores.js';

afterAll(async () => {
  await pool?.end();
});

const DAY = 86_400_000;
const INTERNAL = 'chave-interna-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)

const player = (): AccountRef => ({ ownerType: 'player', ownerId: randomUUID(), currency: 'THALER' });
const acc = (ownerType: AccountRef['ownerType'], ownerId: string, currency: AccountRef['currency'] = 'THALER'): AccountRef => ({ ownerType, ownerId, currency });
const tx = (kind: string, legs: [AccountRef, bigint][]): PostingRequest => ({
  kind,
  idempotencyKey: randomUUID(),
  legs: legs.map(([account, amount]) => ({ account, amount })),
});

/**
 * Uma semana de jogo: o pool P2E recebe 10.000 THALER, paga 1.000 de turno
 * a dois jogadores, eles comem 300 e pagam 200 de imposto, e um passa 50 ao outro.
 * Kinds únicos por rodada: no Postgres compartilhado, cada teste vê só os seus.
 */
async function week(store: LedgerStore, t0: Date, tag: string) {
  const [a, b] = [player(), player()];
  const at = (days: number) => new Date(t0.getTime() + days * DAY);
  await store.post(tx('pool_fund', [[acc('system', 'mint'), -1_000_000n], [acc('pool', 'p2e'), 1_000_000n]]), at(0));
  await store.post(tx(`shift_pay_${tag}`, [[acc('pool', 'p2e'), -60_000n], [a, 60_000n]]), at(1));
  await store.post(tx(`shift_pay_${tag}`, [[acc('pool', 'p2e'), -40_000n], [b, 40_000n]]), at(6.5));
  await store.post(tx(`meal_buy_${tag}`, [[a, -30_000n], [acc('burn', 'food'), 30_000n]]), at(6.6));
  await store.post(tx(`tax_pt_${tag}`, [[b, -20_000n], [acc('burn', 'tax'), 20_000n]]), at(6.7));
  await store.post(tx(`gift_${tag}`, [[a, -5_000n], [b, 5_000n]]), at(6.8));
  return at(7);
}

describe('classificação de uma transação', () => {
  it('pelo lado dos jogadores: recebe = emissão, paga = dreno, entre eles = circulação', () => {
    const p = player();
    expect(classify([{ account: acc('pool', 'p2e'), amount: -5n }, { account: p, amount: 5n }], 'THALER')).toMatchObject({ player: 5n, counterpart: 'pool/p2e' });
    expect(classify([{ account: p, amount: -5n }, { account: acc('burn', 'food'), amount: 5n }], 'THALER')).toMatchObject({ player: -5n, counterpart: 'burn/food' });
    expect(classify([{ account: p, amount: -5n }, { account: player(), amount: 5n }], 'THALER')).toMatchObject({ player: 0n, counterpart: '' });
    expect(classify([{ account: acc('system', 'mint'), amount: -5n }, { account: acc('pool', 'p2e'), amount: 5n }], 'THALER').touchesPlayers).toBe(false);
  });
});

describe.each(stores)('fluxos no store (%s)', (_name, make, enabled) => {
  it.runIf(enabled)('soma emissão, dreno e circulação por tipo, na janela', async () => {
    const store = make() as LedgerStore & PanelStore;
    // Data própria no futuro: a janela só pega as transações deste teste.
    const t0 = new Date(Date.UTC(2200 + Math.floor(Math.random() * 500), 0, 1));
    const tag = randomUUID().slice(0, 8);
    const end = await week(store, t0, tag);

    const rows = (await store.flows('THALER', new Date(end.getTime() - 7 * DAY))).filter((r) => r.kind.endsWith(tag));
    const by = (k: string) => rows.find((r) => r.kind === `${k}_${tag}`)!;
    expect(by('shift_pay')).toMatchObject({ counterpart: 'pool/p2e', faucet: 100_000n, sink: 0n, txs: 2 });
    expect(by('meal_buy')).toMatchObject({ counterpart: 'burn/food', faucet: 0n, sink: 30_000n });
    expect(by('tax_pt')).toMatchObject({ counterpart: 'burn/tax', sink: 20_000n });
    expect(by('gift')).toMatchObject({ transfers: 1, faucet: 0n, sink: 0n });

    // Janela de 24 h: o turno do dia 1 fica de fora.
    const day = (await store.flows('THALER', new Date(end.getTime() - DAY))).filter((r) => r.kind.endsWith(tag));
    expect(day.find((r) => r.kind === `shift_pay_${tag}`)?.faucet).toBe(40_000n);
  });
});

describe('painel', () => {
  it('razão dreno ÷ emissão, por jogador, duração do pool e alertas', async () => {
    const store = new MemoryLedgerStore();
    const end = await week(store, new Date('2026-11-13T12:00:00Z'), 'x');
    const p = await buildPanel(store, 'THALER', end);

    expect(p.window_7d).toMatchObject({ faucet: '100000', sink: '50000', sink_ratio: 0.5, transfers: 1 });
    expect(p.players).toBe(2);
    expect(p.player_total).toBe('50000'); // 1.000 recebidos − 500 gastos
    expect(p.per_capita).toBe('25000');
    expect(p.pools).toEqual([{ owner_id: 'p2e', balance: '900000' }]);
    // 9.000 no pool, saindo 1.000 por semana: 63 dias.
    expect(p.p2e_runway_days).toBe(63);
    // 50% está abaixo da meta de 55%.
    expect(p.alerts.map((a) => a.code)).toEqual(['sink_ratio_low']);
  });

  it('pool perto do fim vira alerta crítico; sem emissão, a razão é nula e não alerta', async () => {
    const store = new MemoryLedgerStore();
    const t = new Date('2026-11-20T12:00:00Z');
    await store.post(tx('pool_fund', [[acc('system', 'mint'), -50_000n], [acc('pool', 'p2e'), 50_000n]]), t);
    await store.post(tx('shift_pay', [[acc('pool', 'p2e'), -45_000n], [player(), 45_000n]]), t);
    const p = await buildPanel(store, 'THALER', t);
    expect(p.p2e_runway_days).toBe(0.8);
    expect(p.alerts).toContainEqual(expect.objectContaining({ code: 'p2e_runway_short', severity: 'critical' }));

    const empty = await buildPanel(new MemoryLedgerStore(), 'THALER', t);
    expect(empty.window_7d.sink_ratio).toBeNull();
    expect(empty.alerts).toEqual([]);
  });

  it('rota interna e indicadores no /metrics', async () => {
    const store = new MemoryLedgerStore();
    const end = await week(store, new Date(Date.now() - 7 * DAY + 60_000), 'api');
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: INTERNAL, PANEL_EVERY_SECONDS: '3600' }), store, () => end);
    await app.ready();

    expect((await app.inject({ method: 'GET', url: '/internal/v1/economy/panel' })).statusCode).toBe(403);
    const r = await app.inject({ method: 'GET', url: '/internal/v1/economy/panel?currency=THALER', headers: { 'x-service-token': INTERNAL } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ currency: 'THALER', decimals: 2, p2e_runway_days: 63 });

    const metrics = (await app.inject({ method: 'GET', url: '/metrics' })).body;
    expect(metrics).toContain('economy_sink_ratio{service="economy",currency="THALER",window="7d"} 0.5');
    expect(metrics).toContain('economy_p2e_runway_days{service="economy",currency="THALER"} 63');
    expect(metrics).toContain('economy_pool_units{service="economy",currency="THALER",pool="p2e"} 9000');
    await app.close();
  });
});
