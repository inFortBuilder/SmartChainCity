import { randomUUID } from 'node:crypto';

import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import {
  AccountRateLimit,
  DEVICE_WINDOW_MS,
  NETWORK_ACCOUNT_ALERT,
  RiskGuard,
  type RiskStore,
  deviceIdOf,
  networkOf,
} from '../src/domain/risk.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';
import { MemoryRiskStore, PostgresRiskStore } from '../src/infra/risk-store.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const INTERNAL = 'chave-interna-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const PEPPER = 'pimenta-do-antifraude-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const T0 = new Date('2026-11-20T12:00:00Z');
const DEVICE = 'aparelho0123456789abcdef';

describe('sinais', () => {
  it('rede é /24 no IPv4 (inclusive mapeado) e /64 no IPv6', () => {
    expect(networkOf('200.150.10.77')).toBe('200.150.10.0/24');
    expect(networkOf('::ffff:200.150.10.77')).toBe('200.150.10.0/24');
    expect(networkOf('2804:14c:abcd:12:1:2:3:4')).toBe('2804:14c:abcd:12::/64');
  });

  it('id de aparelho só vale com 16 a 64 caracteres seguros', () => {
    expect(deviceIdOf(DEVICE)).toBe(DEVICE);
    expect(deviceIdOf('curto')).toBeNull();
    expect(deviceIdOf('<script>alert(1)</script>xxxxxxxx')).toBeNull();
    expect(deviceIdOf(['a'])).toBeNull();
    expect(deviceIdOf(undefined)).toBeNull();
  });
});

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 5 }) : null;
afterAll(async () => {
  await pool?.end();
});

describe.each([
  ['memória', () => new MemoryRiskStore() as RiskStore, true],
  ['postgres', () => new PostgresRiskStore(pool!) as RiskStore, pool !== null],
] as const)('RiskGuard (%s)', (_name, make, enabled) => {
  /** Aparelho único por teste: no Postgres compartilhado, um não vê o outro. */
  const device = () => `ap${randomUUID().replace(/-/g, '')}`;
  const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.9`;

  it.skipIf(!enabled)('até 3 contas por aparelho ganham; a 4ª vai para revisão; a decisão manual vence', async () => {
    const store = make();
    const counts: Record<string, number> = {};
    const metrics = { inc: (name: string, _h: string, l: Record<string, string> = {}) => void (counts[`${name}:${l.rule ?? ''}`] = (counts[`${name}:${l.rule ?? ''}`] ?? 0) + 1) };
    const guard = new RiskGuard(store, PEPPER, metrics);
    const d = device();
    const net = ip();
    const accounts = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const verdicts = [];
    for (const [k, accountId] of accounts.entries()) {
      verdicts.push(await guard.check({ accountId, deviceHeader: d, ip: net, action: 'work' }, new Date(T0.getTime() + k * 1000)));
    }
    expect(verdicts.map((v) => v.ok)).toEqual([true, true, true, false]);
    expect(verdicts[3]!.rule).toBe('device_limit');
    // A ordem é a da primeira vez: as 3 primeiras continuam ganhando.
    expect((await guard.check({ accountId: accounts[0]!, deviceHeader: d, ip: net, action: 'claim' }, T0)).ok).toBe(true);
    expect(counts['risk_blocks_total:device']).toBe(1);

    await store.decide(accounts[3]!, 'allow', 'irmãos no mesmo celular', T0);
    expect((await guard.check({ accountId: accounts[3]!, deviceHeader: d, ip: net, action: 'work' }, T0)).rule).toBe('manual_allow');
    await store.decide(accounts[0]!, 'block', 'bot', T0);
    await expect(guard.assert({ accountId: accounts[0]!, deviceHeader: d, ip: net, action: 'work' }, T0)).rejects.toMatchObject({
      code: 'risk_review',
      status: 403,
    });
  });

  it.skipIf(!enabled)('contas antigas no aparelho saem da conta depois de 30 dias', async () => {
    const guard = new RiskGuard(make(), PEPPER);
    const d = device();
    for (let k = 0; k < 3; k++) await guard.check({ accountId: randomUUID(), deviceHeader: d, ip: ip(), action: 'work' }, T0);
    const later = new Date(T0.getTime() + DEVICE_WINDOW_MS + 60_000);
    expect((await guard.check({ accountId: randomUUID(), deviceHeader: d, ip: ip(), action: 'work' }, later)).ok).toBe(true);
  });

  it.skipIf(!enabled)('muitas contas na mesma rede só geram alerta; sem aparelho, segue', async () => {
    const guard = new RiskGuard(make(), PEPPER);
    const net = ip();
    let last;
    for (let k = 0; k <= NETWORK_ACCOUNT_ALERT; k++) {
      last = await guard.check({ accountId: randomUUID(), deviceHeader: undefined, ip: net, action: 'work' }, T0);
    }
    expect(last).toMatchObject({ ok: true, networkAlert: true, device: null });
  });

  it.skipIf(!enabled)('o banco guarda só HMAC, nunca o IP nem o id puro', async () => {
    const store = make();
    const guard = new RiskGuard(store, PEPPER);
    const d = device();
    const v = await guard.check({ accountId: randomUUID(), deviceHeader: d, ip: '200.150.10.77', action: 'work' }, T0);
    expect(v.device).toMatch(/^[0-9a-f]{32}$/);
    expect(v.device).not.toContain(d);
    const shared = await store.sharedDevices(new Date(T0.getTime() - 1000), 1);
    expect(JSON.stringify(shared)).not.toContain('200.150');
    expect(JSON.stringify(shared)).not.toContain(d);
  });
});

describe('velocidade', () => {
  it('passou de N pedidos por minuto, 429; o balde enche de novo', () => {
    const rl = new AccountRateLimit(3);
    const a = randomUUID();
    rl.take(a, 0);
    rl.take(a, 0);
    rl.take(a, 0);
    expect(() => rl.take(a, 0)).toThrow(expect.objectContaining({ code: 'too_many_requests', status: 429 }));
    expect(() => rl.take(a, 20_000)).not.toThrow();
  });
});

describe('API do game-core com o antifraude', () => {
  const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: INTERNAL, DEV_FREE_AVATAR: 'true' });
  const auth = async (accountId: string) => ({
    authorization: `Bearer ${await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(accountId)
      .setIssuer('scc-gateway')
      .setAudience('scc-api')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(SECRET))}`,
  });

  it('a 4ª conta no mesmo aparelho não começa turno até a revisão liberar; métricas no /metrics', async () => {
    const risk = new MemoryRiskStore();
    let clock = T0;
    const app = await buildApp(config, new MemoryAvatarStore(), () => clock, null, null, null, Math.random, risk);
    const work = async (accountId: string) => {
      clock = new Date(clock.getTime() + 1000); // cada conta chega num instante diferente
      const headers = { ...(await auth(accountId)), 'x-device-id': DEVICE };
      const avatar = (await app.inject({ method: 'POST', url: '/v1/dev/avatar', headers })).json().avatar;
      return app.inject({ method: 'POST', url: `/v1/avatars/${avatar.id}/work`, headers, payload: { shift: 6 } });
    };
    const accounts = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const status = [];
    for (const a of accounts) status.push((await work(a)).statusCode);
    expect(status).toEqual([201, 201, 201, 403]);

    const queue = await app.inject({ method: 'GET', url: '/internal/v1/risk/devices', headers: { 'x-service-token': INTERNAL } });
    expect(queue.json().devices).toHaveLength(1);
    expect(queue.json().devices[0].accounts).toHaveLength(4);

    const allow = await app.inject({
      method: 'POST',
      url: `/internal/v1/risk/accounts/${accounts[3]}`,
      headers: { 'x-service-token': INTERNAL },
      payload: { decision: 'allow', note: 'família' },
    });
    expect(allow.statusCode).toBe(200);
    expect((await work(accounts[3]!)).statusCode).toBe(201);

    const metrics = (await app.inject({ method: 'GET', url: '/metrics' })).body;
    expect(metrics).toContain('risk_blocks_total{service="game-core",rule="device"} 1');
    expect(metrics).toContain('risk_decisions_total{service="game-core",decision="allow"} 1');
    expect(metrics).toMatch(/risk_signals_total\{service="game-core",action="work",device="sim"\} \d+/);
  });

  it('revisão exige o token interno', async () => {
    const app = await buildApp(config, new MemoryAvatarStore(), () => T0, null, null, null, Math.random, new MemoryRiskStore());
    expect((await app.inject({ method: 'GET', url: '/internal/v1/risk/devices' })).statusCode).toBe(403);
  });
});
