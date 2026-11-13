import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { observe, serverOptions } from '../src/observability.js';

const TOKEN = 'token-de-metricas-de-teste-com-32-caracteres'; // gitleaks:allow (só no teste)

async function app(nodeEnv = 'development', metricsToken?: string) {
  const a = Fastify(serverOptions({ service: 'teste', nodeEnv: 'test' }));
  observe(a, { service: 'teste', nodeEnv, metricsToken });
  a.get('/v1/coisas/:id', async () => ({ ok: true }));
  a.get('/falha', async () => {
    throw new Error('quebrou');
  });
  await a.ready();
  return a;
}

describe('id da requisição', () => {
  it('gera um id e devolve em x-request-id', async () => {
    const r = await (await app()).inject({ url: '/v1/coisas/1' });
    expect(r.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('aceita o id que vem do gateway, para seguir a requisição entre serviços', async () => {
    const r = await (await app()).inject({ url: '/v1/coisas/1', headers: { 'x-request-id': 'gw-abc.123' } });
    expect(r.headers['x-request-id']).toBe('gw-abc.123');
  });

  it('troca id de fora que poderia estragar o log', async () => {
    const r = await (await app()).inject({ url: '/v1/coisas/1', headers: { 'x-request-id': 'a b"\n{x}' } });
    expect(r.headers['x-request-id']).not.toBe('a b"\n{x}');
    expect(r.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('métricas', () => {
  it('conta por rota registrada (não por URL) e status, com o tempo de resposta', async () => {
    const a = await app();
    await a.inject({ url: '/v1/coisas/1' });
    await a.inject({ url: '/v1/coisas/2' });
    await a.inject({ url: '/falha' });
    await a.inject({ url: '/nao-existe' });
    const text = (await a.inject({ url: '/metrics' })).body;
    expect(text).toContain('http_requests_total{service="teste",method="GET",route="/v1/coisas/:id",status="200"} 2');
    expect(text).toContain('http_requests_total{service="teste",method="GET",route="/falha",status="500"} 1');
    expect(text).toContain('route="sem_rota",status="404"} 1');
    expect(text).toContain('http_request_duration_seconds_count{service="teste",method="GET",route="/v1/coisas/:id"} 2');
    expect(text).toMatch(/process_resident_memory_bytes\{service="teste"\} \d+/);
    // A própria leitura de métricas não entra na conta.
    expect(text).not.toContain('route="/metrics"');
  });

  it('com token, só o Prometheus com o token lê', async () => {
    const a = await app('production', TOKEN);
    expect((await a.inject({ url: '/metrics' })).statusCode).toBe(401);
    expect((await a.inject({ url: '/metrics', headers: { authorization: 'Bearer errado' } })).statusCode).toBe(401);
    const ok = await a.inject({ url: '/metrics', headers: { authorization: `Bearer ${TOKEN}` } });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toContain('text/plain');
  });

  it('em produção sem token, /metrics fica desligado', async () => {
    expect((await (await app('production')).inject({ url: '/metrics' })).statusCode).toBe(404);
  });
});
