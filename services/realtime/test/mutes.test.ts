import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { MuteBook } from '../src/moderation.js';
import { MemoryMuteStore, PostgresMuteStore, migrateMutes } from '../src/mute-store.js';
import { configSchema, startRealtime } from '../src/server.js';

/** Silenciamentos guardados em banco: valem depois de reiniciar e em todos os processos do realtime. */
const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const config = configSchema.parse({ NODE_ENV: 'test', PORT: '0', JWT_SECRET: SECRET, EVENTS_ENABLED: 'false', MUTE_SYNC_SECONDS: '3600' });

describe('MuteBook', () => {
  it('avisa cada silenciamento com o motivo; o que vem de fora vale o mais longo e não avisa', () => {
    let t = 1_000_000;
    const book = new MuteBook(() => t);
    const seen: { account: string; reason: string }[] = [];
    book.onMute((m) => seen.push({ account: m.account, reason: m.reason }));
    for (const by of ['a', 'b', 'c']) book.report('alvo', by);
    for (let i = 0; i < 3; i++) book.violation('chato');
    expect(seen).toEqual([
      { account: 'alvo', reason: 'reports' },
      { account: 'chato', reason: 'violations' },
    ]);
    book.restore('outro', t + 60_000);
    book.restore('outro', t + 1_000);
    expect(book.isMuted('outro')).toBe(t + 60_000);
    expect(seen).toHaveLength(2);
    t += 61_000;
    expect(book.isMuted('outro')).toBe(0);
  });
});

describe('silenciamento entre processos', () => {
  it('o processo novo carrega os silêncios que valem e busca os dos outros', async () => {
    const store = new MemoryMuteStore();
    const a = await startRealtime(config, () => {}, { muteStore: store });
    for (const by of ['x', 'y', 'z']) a.mutes.report('conta-1', by);
    await new Promise((r) => setTimeout(r, 20));
    expect(store.rows).toMatchObject([{ account: 'conta-1', reason: 'reports' }]);

    // Reiniciou (ou outro shard): o silêncio continua.
    const b = await startRealtime(config, () => {}, { muteStore: store });
    expect(b.mutes.isMuted('conta-1')).toBeGreaterThan(Date.now());

    // Um silêncio novo no processo A chega ao B na próxima busca.
    for (let i = 0; i < 3; i++) a.mutes.violation('conta-2');
    await new Promise((r) => setTimeout(r, 20));
    expect(b.mutes.isMuted('conta-2')).toBe(0);
    expect(await b.syncMutes()).toBe(1);
    expect(b.mutes.isMuted('conta-2')).toBeGreaterThan(Date.now());
    await Promise.all([a.stop(), b.stop()]);
  });
});

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 2 }) : null;
afterAll(() => pool?.end());

describe.skipIf(!pool)('silenciamentos no Postgres', () => {
  it('cria a tabela, grava e lê os que valem, depois de um instante', async () => {
    await migrateMutes(pool!);
    await migrateMutes(pool!); // idempotente
    const store = new PostgresMuteStore(pool!);
    const account = `teste-${Math.random()}`;
    const now = new Date();
    await store.save({ account, until: new Date(now.getTime() + 600_000), reason: 'reports' });
    await store.save({ account: `${account}-velho`, until: new Date(now.getTime() - 1000), reason: 'violations' });
    const active = (await store.active(now, null)).filter((m) => m.account.startsWith(account));
    expect(active).toMatchObject([{ account, reason: 'reports' }]);
    expect((await store.active(now, active[0]!.id)).filter((m) => m.account.startsWith(account))).toEqual([]);
  });

  it('o servidor com DATABASE_URL cria a tabela e guarda o silêncio', async () => {
    const s = await startRealtime({ ...config, DATABASE_URL: url }, () => {});
    const account = `servidor-${Math.random()}`;
    for (const by of ['x', 'y', 'z']) s.mutes.report(account, by);
    await new Promise((r) => setTimeout(r, 100));
    const r = await pool!.query('SELECT reason FROM realtime.mute WHERE account_id = $1', [account]);
    expect(r.rows).toEqual([{ reason: 'reports' }]);
    await s.stop();
  });
});
