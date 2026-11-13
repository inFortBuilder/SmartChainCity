import { randomUUID } from 'node:crypto';

import { AppError, bearerToken, requireServiceToken, verifyAccessToken } from '@scc/shared';
import Fastify, { type FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { Config } from './config.js';
import { type Avatar, type AvatarStore, decayed, newAvatar, status } from './domain/avatar.js';
import { professionLabel } from './domain/catalog.js';

const uuid = z.uuid();

const createBody = z.object({
  account_id: uuid,
  rarity: z.string(),
  job_code: z.string(),
});

/**
 * A tela mostra os atributos atuais (com a queda até agora) e a direção do
 * jogo. Valores exatos de ganho por atividade não são mostrados (GDD §2.4),
 * mas o nível de cada atributo é.
 */
const avatarDto = (a: Avatar) => ({
  id: a.id,
  rarity: a.rarity,
  job: { code: a.jobCode, label: professionLabel(a.rarity, a.jobCode) },
  attributes: a.attributes,
  status: status(a),
  created_at: a.createdAt.toISOString(),
});

export async function buildApp(config: Config, store: AvatarStore, now: () => Date = () => new Date()) {
  const app = Fastify({
    logger:
      config.NODE_ENV === 'test'
        ? false
        : { redact: ['req.headers.authorization', 'req.headers["x-service-token"]'] },
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.status).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof z.ZodError) {
      return reply.status(400).send({ error: { code: 'invalid_request', message: 'Requisição inválida.' } });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.status(status).send({ error: { code: 'invalid_request', message: 'Requisição inválida.' } });
    }
    request.log.error(error);
    return reply.status(500).send({ error: { code: 'internal_error', message: 'Erro interno.' } });
  });

  const player = (request: FastifyRequest) =>
    verifyAccessToken(bearerToken(request.headers.authorization), {
      secret: config.JWT_SECRET,
      issuer: config.JWT_ISSUER,
    });

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/v1/avatars', async (request) => {
    const avatars = await store.listByAccount(await player(request));
    const at = now();
    return { avatars: avatars.map((a) => avatarDto(decayed(a, at))) };
  });

  // Só o dono vê o próprio avatar: de outra conta é 404, para não confirmar que existe.
  app.get('/v1/avatars/:id', async (request) => {
    const accountId = await player(request);
    const { id } = z.object({ id: uuid }).parse(request.params);
    const found = await store.get(id);
    if (!found || found.accountId !== accountId) throw new AppError('not_found', 'Avatar não encontrado.', 404);
    return { avatar: avatarDto(decayed(found, now())) };
  });

  // Criação pelo serviço que entrega o avatar: hoje o ambiente de testes; na
  // Etapa 2, o chain-indexer ao ver o mint da Lucky Box (E2.1).
  app.post('/internal/v1/avatars', async (request, reply) => {
    requireServiceToken(request.headers['x-service-token'], config.INTERNAL_TOKEN);
    const body = createBody.parse(request.body);
    const created = await store.create(
      newAvatar({ id: randomUUID(), accountId: body.account_id, rarity: body.rarity, jobCode: body.job_code }, now()),
    );
    return reply.status(201).send({ avatar: avatarDto(created) });
  });

  return app;
}
