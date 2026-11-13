import { randomUUID } from 'node:crypto';

import { AppError, bearerToken, requireServiceToken, verifyAccessToken } from '@scc/shared';
import cors from '@fastify/cors';
import Fastify, { type FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { Config } from './config.js';
import { type Avatar, type AvatarStore, decayed, newAvatar, status } from './domain/avatar.js';
import { PROFESSIONS, professionLabel } from './domain/catalog.js';
import { type Payer, type Shift, type ShiftStore, startShift } from './domain/shift.js';
import { completeShifts } from './jobs/shift.js';

const uuid = z.uuid();

const workBody = z.object({ shift: z.number().int() });

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

/**
 * O jogador vê o compromisso da semente desde o começo; a semente só aparece
 * quando o turno acaba. Com ela, qualquer um refaz o sorteio dos danos.
 */
const shiftDto = (s: Shift) => ({
  id: s.id,
  hours: s.hours,
  status: s.status,
  starts_at: s.startsAt.toISOString(),
  ends_at: s.endsAt.toISOString(),
  seed_commit: s.seedCommit,
  seed: s.status === 'running' ? null : s.seed,
  result: s.result && {
    thaler: s.result.thalerCents.toString(),
    decimals: 2,
    damaged: s.result.damaged,
    factors: s.result.factors,
  },
});

export async function buildApp(
  config: Config,
  store: AvatarStore & ShiftStore,
  now: () => Date = () => new Date(),
  payer: Payer | null = null,
) {
  const app = Fastify({
    logger:
      config.NODE_ENV === 'test'
        ? false
        : { redact: ['req.headers.authorization', 'req.headers["x-service-token"]'] },
  });

  await app.register(cors, { origin: config.CORS_ORIGINS });

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

  const ownAvatar = async (request: FastifyRequest) => {
    const accountId = await player(request);
    const { id } = z.object({ id: uuid }).parse(request.params);
    const found = await store.get(id);
    if (!found || found.accountId !== accountId) throw new AppError('not_found', 'Avatar não encontrado.', 404);
    return found;
  };

  // Começa o turno. Depois disso o cliente pode fechar: o job conclui no horário.
  app.post('/v1/avatars/:id/work', async (request, reply) => {
    const accountId = await player(request);
    const { id } = z.object({ id: uuid }).parse(request.params);
    const { shift } = workBody.parse(request.body);
    const started = await store.beginShift(id, accountId, now(), (avatar, context) =>
      startShift(
        avatar,
        {
          id: randomUUID(),
          hours: shift,
          ...context,
          durationMs: config.DEV_SHIFT_MINUTES ? config.DEV_SHIFT_MINUTES * 60_000 : undefined,
        },
        now(),
      ),
    );
    return reply.status(201).send({ shift: shiftDto(started) });
  });

  app.get('/v1/avatars/:id/shifts', async (request) => {
    const avatar = await ownAvatar(request);
    // Não espera a próxima passada do job: o que já venceu aparece concluído.
    await completeShifts(store, now());
    return { shifts: (await store.listShifts(avatar.id, 20)).map(shiftDto) };
  });

  // Coleta: paga pelo ledger cada turno concluído e ainda não coletado.
  app.post('/v1/avatars/:id/claim', async (request) => {
    const avatar = await ownAvatar(request);
    if (!payer) throw new AppError('ledger_unavailable', 'O pagamento de turnos está desligado.', 503);
    await completeShifts(store, now());
    const done = (await store.listShifts(avatar.id, 50)).filter((s) => s.status === 'done');
    let total = 0n;
    const claimed: string[] = [];
    for (const shift of done) {
      const cents = shift.result?.thalerCents ?? 0n;
      // Turno sem ganho (48 h sem comer) não vai ao ledger: lançamento de zero não existe.
      if (cents > 0n) await payer.payShift(shift, cents);
      await store.markClaimed(shift.id);
      total += cents;
      claimed.push(shift.id);
    }
    return { claimed, thaler: total.toString(), decimals: 2 };
  });

  // Só desenvolvimento: enquanto não existe Lucky Box (E2.1), quem entra no
  // mapa sem avatar ganha um comum de profissão sorteada. Desligado, é 404.
  app.post('/v1/dev/avatar', async (request, reply) => {
    if (!config.DEV_FREE_AVATAR) throw new AppError('not_found', 'Rota não encontrada.', 404);
    const accountId = await player(request);
    const [existing] = await store.listByAccount(accountId);
    if (existing) return { avatar: avatarDto(decayed(existing, now())) };
    const jobs = Object.keys(PROFESSIONS.common);
    const jobCode = jobs[Math.floor(Math.random() * jobs.length)]!;
    const created = await store.create(newAvatar({ id: randomUUID(), accountId, rarity: 'common', jobCode }, now()));
    return reply.status(201).send({ avatar: avatarDto(created) });
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
