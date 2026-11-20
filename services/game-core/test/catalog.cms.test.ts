import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { SEED_PROFESSIONS, catalogOrigin, profession, replaceCatalog } from '../src/domain/catalog.js';
import { SEED_FOODS, food, foodsOrigin, replaceFoods } from '../src/domain/foods.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';

/** Strapi falso: devolve em /api/jobs e /api/foods o que o teste mandar, no formato da API REST do Strapi 5. */
let jobs: unknown[] = [];
let cmsFoods: unknown[] = [];
let server: Server;
let cmsUrl = '';
beforeAll(async () => {
  server = createServer((req, res) => {
    const data = req.url?.startsWith('/api/jobs') ? jobs : req.url?.startsWith('/api/foods') ? cmsFoods : null;
    if (!data) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data, meta: {} }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cmsUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
afterEach(() => {
  replaceCatalog(SEED_PROFESSIONS, 'seed');
  replaceFoods(SEED_FOODS, 'seed');
});

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

  it('publicação de outro tipo do catálogo (imóvel, atividade...) não recarrega nada', async () => {
    jobs = []; // se recarregasse, seria recusado por faltar profissão em uso
    const r = await (await app()).inject({
      method: 'POST',
      url: '/internal/v1/catalog/refresh',
      headers: { 'x-service-token': INTERNAL },
      payload: { event: 'entry.publish', model: 'property-type', entry: { code: 'casa_t1' } },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ignored: 'property-type' });
    expect(catalogOrigin()).toBe('seed');
  });

  it('publicar um alimento recarrega o mercado, e só ele', async () => {
    jobs = []; // as profissões não podem ser tocadas
    cmsFoods = SEED_FOODS.map((f) => ({ id: 1, documentId: f.code, ...f, price: f.code === 'maca' ? 15 : null }));
    const r = await (await app()).inject({
      method: 'POST',
      url: '/internal/v1/catalog/refresh',
      headers: { 'x-service-token': INTERNAL },
      payload: { event: 'entry.publish', model: 'food', entry: { code: 'maca' } },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ foods: SEED_FOODS.length, origin: 'cms' });
    expect(food('maca')?.price).toBe(15);
    expect(foodsOrigin()).toBe('cms');
    expect(catalogOrigin()).toBe('seed');
  });

  it('alimento quebrado no Strapi é recusado, e o mercado segue com a lista anterior', async () => {
    cmsFoods = [{ code: 'maca', label: 'Maçã', group: 'fruta', energy: 30, health: 1, pack: 5 }];
    const r = await (await app()).inject({
      method: 'POST',
      url: '/internal/v1/catalog/refresh',
      headers: { 'x-service-token': INTERNAL },
      payload: { event: 'entry.publish', model: 'food' },
    });
    expect(r.statusCode).toBe(422);
    expect(foodsOrigin()).toBe('seed');
    expect(food('milho')).toBeDefined();
  });

  it('só serviços (o webhook do Strapi, com a chave) atualizam', async () => {
    expect((await refresh('chave-errada')).statusCode).toBe(403);
  });
});
