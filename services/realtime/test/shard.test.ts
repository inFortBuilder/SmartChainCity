import { randomUUID } from 'node:crypto';

import { Client } from '@colyseus/sdk';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// O mesmo arquivo que o mapa carrega no navegador.
import * as browser from '../../../docs/proposta-cidade-realista/realtime-shard.js';
import { configSchema, startRealtime } from '../src/server.js';
import { districtKey, fnv1a, interiorKey, owns, parseShard, shardIndex } from '../src/shard.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)

describe('divisão por bairro', () => {
  it('o cliente e o servidor dividem igual', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
    for (let d = 0; d < 300; d++) {
      for (const n of [1, 2, 3, 5]) {
        expect(browser.shardIndex(browser.districtKey('pittsburg', d), n)).toBe(shardIndex(districtKey('pittsburg', d), n));
        expect(browser.shardIndex(browser.interiorKey('pittsburg', d * 97), n)).toBe(shardIndex(interiorKey('pittsburg', d * 97), n));
      }
    }
    // Espalha: com 3 processos, nenhum fica com menos de 25% de 300 bairros.
    const counts = [0, 0, 0];
    for (let d = 0; d < 300; d++) counts[shardIndex(districtKey('pittsburg', d), 3)]!++;
    expect(Math.min(...counts)).toBeGreaterThan(75);
    // O cliente escolhe a URL do processo do bairro.
    const urls = ['http://a', 'http://b', 'http://c'];
    expect(browser.realtimeFor(browser.districtKey('pittsburg', 7), urls)).toBe(urls[shardIndex(districtKey('pittsburg', 7), 3)]);
  });

  it('SHARD=i/n', () => {
    expect(parseShard(undefined)).toBeNull();
    expect(parseShard('1/3')).toEqual({ index: 1, count: 3 });
    expect(() => parseShard('3/3')).toThrow();
    expect(() => parseShard('um')).toThrow();
    expect(owns(null, 'qualquer')).toBe(true);
  });
});

describe('processo com SHARD', () => {
  let server: Awaited<ReturnType<typeof startRealtime>>;
  let endpoint: string;
  beforeAll(async () => {
    server = await startRealtime(configSchema.parse({ NODE_ENV: 'test', PORT: '0', JWT_SECRET: SECRET, SHARD: '0/2' }));
    endpoint = `http://127.0.0.1:${server.port}`;
  });
  afterAll(async () => {
    await server.stop();
  });

  const token = () =>
    new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(randomUUID())
      .setIssuer('scc-gateway')
      .setAudience('scc-api')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));

  it('aceita os bairros dele e recusa os do outro processo', async () => {
    const mine = [...Array(50).keys()].find((d) => shardIndex(districtKey('pittsburg', d), 2) === 0)!;
    const other = [...Array(50).keys()].find((d) => shardIndex(districtKey('pittsburg', d), 2) === 1)!;
    const c = new Client(endpoint);
    c.auth.token = await token();
    const room = await c.joinOrCreate('district', { city: 'pittsburg', district: mine });
    expect(room.roomId).toBeTruthy();
    await room.leave();
    const c2 = new Client(endpoint);
    c2.auth.token = await token();
    await expect(c2.joinOrCreate('district', { city: 'pittsburg', district: other })).rejects.toMatchObject({ code: 421 });
  });
});
