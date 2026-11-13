import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { SEED_PROFESSIONS, catalogOrigin, profession, replaceCatalog } from '../src/domain/catalog.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';

/** Strapi falso: devolve em /api/jobs o que o teste mandar, no formato da API REST do Strapi 5. */
let jobs: unknown[] = [];
let server: Server;
let cmsUrl = '';
beforeAll(async () => {
  server = createServer((req, res) => {
    if (!req.url?.startsWith('/api/jobs')) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: jobs, meta: {} }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cmsUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
afterEach(() => replaceCatalog(SEED_PROFESSIONS, 'seed'));

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const INTERNAL = 'chave-interna-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const app = () =>
  buildApp(
    loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: INTERNAL, CMS_URL: cmsUrl }),
    new MemoryAvatarStore(),
  );
const asStrapi = (list = SEED_PROFESSIONS) => list.map((p) => ({ id: 1, documentId: p.code, ...p }));
const refresh = async (token = INTERNAL) =>
  (await app()).inject({ method: 'POST', url: '/internal/v1/catalog/refresh', headers: { 'x-service-token': token } });

describe('catálogo publicado no Strapi', () => {
  it('a publicação chega ao jogo pelo webhook, sem deploy', async () => {
    jobs = asStrapi(SEED_PROFESSIONS.map((p) => (p.code === 'padeiro' ? { ...p, label: 'Padeiro Artesão' } : p)));
    const r = await refresh();
    expect(r.json()).toEqual({ professions: 44, origin: 'cms' });
    expect(profession('padeiro')?.label).toBe('Padeiro Artesão');
    expect(catalogOrigin()).toBe('cms');
  });

  it('catálogo quebrado no CMS é recusado e o jogo segue com o anterior', async () => {
    jobs = asStrapi(SEED_PROFESSIONS.map((p) => (p.code === 'padeiro' ? { ...p, tokens: 9999 } : p)));
    const r = await refresh();
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe('catalog_rejected');
    expect(profession('padeiro')?.tokens).toBe(125);
  });

  it('despublicar uma profissão em uso não vale: os avatares dela ficariam sem turno', async () => {
    jobs = asStrapi(SEED_PROFESSIONS.filter((p) => p.code !== 'padeiro'));
    const r = await refresh();
    expect(r.statusCode).toBe(422);
    expect(r.json().error.message).toMatch(/padeiro/);
    expect(profession('padeiro')).toBeDefined();
  });

  it('publicação de outro tipo do catálogo (alimento, imóvel...) não recarrega as profissões', async () => {
    jobs = []; // se recarregasse, seria recusado por faltar profissão em uso
    const r = await (await app()).inject({
      method: 'POST',
      url: '/internal/v1/catalog/refresh',
      headers: { 'x-service-token': INTERNAL },
      payload: { event: 'entry.publish', model: 'food', entry: { code: 'milho' } },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ignored: 'food' });
    expect(catalogOrigin()).toBe('seed');
  });

  it('só serviços (o webhook do Strapi, com a chave) atualizam', async () => {
    expect((await refresh('chave-errada')).statusCode).toBe(403);
  });
});
