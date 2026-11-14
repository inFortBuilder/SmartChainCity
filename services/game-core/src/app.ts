import { randomUUID } from 'node:crypto';

import { AppError, bearerToken, observe, requireServiceToken, serverOptions, verifyAccessToken } from '@scc/shared';
import cors from '@fastify/cors';
import Fastify, { type FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { Config } from './config.js';
import { type Avatar, type AvatarStore, decayed, newAvatar, status } from './domain/avatar.js';
import { catalogOrigin, professionLabel, professions, professionsByRarity, replaceCatalog } from './domain/catalog.js';
import { foods, foodsOrigin, replaceFoods } from './domain/foods.js';
import { type HospitalPayer, type HospitalStay, type HospitalStore, needsHospital } from './domain/hospital.js';
import { MEAL_FOOD_POINTS, type Meal, type MealPayer, type MealStore, planMeal, unitPriceCents } from './domain/meal.js';
import { fetchCmsFoods, fetchCmsProfessions } from './infra/cms-catalog.js';
import { type Payer, type Shift, type ShiftStore, startShift } from './domain/shift.js';
import { chargeStay } from './jobs/hospital.js';
import { completeShifts } from './jobs/shift.js';

const uuid = z.uuid();

const workBody = z.object({ shift: z.number().int() });
const mealBody = z.object({ food: z.string().min(1).max(64) });
const idempotencyKey = z.string().min(8).max(128).optional();

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
const avatarDto = (a: Avatar, at: Date) => ({
  id: a.id,
  rarity: a.rarity,
  job: { code: a.jobCode, label: professionLabel(a.rarity, a.jobCode) },
  attributes: a.attributes,
  status: status(a, at),
  hospital_until: status(a, at).inHospital ? a.hospitalUntil!.toISOString() : null,
  created_at: a.createdAt.toISOString(),
});

const stayDto = (h: HospitalStay) => ({
  id: h.id,
  reason: h.reason,
  fee: h.feeCents.toString(),
  decimals: 2,
  fee_status: h.feeStatus,
  admitted_at: h.admittedAt.toISOString(),
  discharge_at: h.dischargeAt.toISOString(),
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

const mealDto = (m: Meal) => ({
  id: m.id,
  food: m.foodCode,
  status: m.status,
  price: m.priceCents.toString(),
  decimals: 2,
  effects: m.effects,
  created_at: m.createdAt.toISOString(),
  eaten_at: m.eatenAt?.toISOString() ?? null,
});

export async function buildApp(
  config: Config,
  store: AvatarStore & ShiftStore & MealStore & HospitalStore,
  now: () => Date = () => new Date(),
  payer: Payer | null = null,
  mealPayer: MealPayer | null = null,
  hospitalPayer: HospitalPayer | null = null,
) {
  const app = Fastify({
    ...serverOptions({
      service: 'game-core',
      nodeEnv: config.NODE_ENV,
      logLevel: config.LOG_LEVEL,
    }),
  });
  observe(app, { service: 'game-core', nodeEnv: config.NODE_ENV, metricsToken: config.METRICS_TOKEN });

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

  // Catálogo público das profissões (do GDD), para a tela de avatar e a Lucky Box.
  // Sem o ganho por tarefa: o GDD pede que a tela mostre só a direção (+/−) dos atributos.
  app.get('/v1/catalog/professions', async () => ({
    origin: catalogOrigin(),
    professions: professions().map((p) => ({
      code: p.code,
      label: p.label,
      rarity: p.rarity,
      thaler_per_day: p.tokens,
      minutes: p.minutes,
      tasks: p.tasks.map((t) => ({
        name: t.name,
        minutes: t.minutes,
        energy: Math.sign(t.energy),
        happiness: Math.sign(t.happiness),
      })),
    })),
  }));

  /**
   * Hospital compulsório: quem chegou a saúde 0 ou energia 0 é internado já, sem
   * esperar o job, e a taxa é cobrada na hora. Se o ledger não responder, a
   * internação vale do mesmo jeito e o job cobra depois.
   */
  const hospitalize = async (a: Avatar, request: FastifyRequest): Promise<Avatar> => {
    if (!needsHospital(a, now())) return a;
    const [stay] = await store.admitDue(now(), 1, a.id);
    if (stay && hospitalPayer) {
      await chargeStay(store, hospitalPayer, stay, request.id).catch((error) =>
        request.log.warn(`taxa do hospital fica para o job: ${(error as Error).message}`),
      );
    }
    return stay ? ((await store.get(a.id)) ?? a) : a;
  };

  app.get('/v1/avatars', async (request) => {
    const avatars = await store.listByAccount(await player(request));
    const current = await Promise.all(avatars.map((a) => hospitalize(a, request)));
    const at = now();
    return { avatars: current.map((a) => avatarDto(decayed(a, at), at)) };
  });

  const ownAvatar = async (request: FastifyRequest) => {
    const accountId = await player(request);
    const { id } = z.object({ id: uuid }).parse(request.params);
    const found = await store.get(id);
    // Só o dono vê o próprio avatar: de outra conta é 404, para não confirmar que existe.
    if (!found || found.accountId !== accountId) throw new AppError('not_found', 'Avatar não encontrado.', 404);
    return hospitalize(found, request);
  };

  app.get('/v1/avatars/:id', async (request) => {
    const avatar = await ownAvatar(request);
    const at = now();
    return { avatar: avatarDto(decayed(avatar, at), at) };
  });

  // Internações do avatar, a mais recente primeiro.
  app.get('/v1/avatars/:id/hospital', async (request) => {
    const avatar = await ownAvatar(request);
    return { stays: (await store.listStays(avatar.id, 20)).map(stayDto) };
  });

  // Começa o turno. Depois disso o cliente pode fechar: o job conclui no horário.
  app.post('/v1/avatars/:id/work', async (request, reply) => {
    const { shift } = workBody.parse(request.body);
    // O turno que já venceu não segura o próximo, mesmo antes da passada do job.
    await completeShifts(store, now());
    const { id, accountId } = await ownAvatar(request);
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

  // Mercado do jogo (E2.3): a lista com o preço de uma unidade, em centavos de THALER.
  app.get('/v1/catalog/foods', async () => ({
    origin: foodsOrigin(),
    foods: foods().map((f) => ({
      code: f.code,
      label: f.label,
      group: f.group,
      energy: f.energy,
      health: f.health,
      food: MEAL_FOOD_POINTS,
      price: unitPriceCents(f).toString(),
      decimals: 2,
      provisional_price: f.price === null,
    })),
  }));

  /**
   * Cobra e aplica a refeição. Se o ledger não responder, ela fica `pending` e
   * a próxima chamada termina o serviço: a cobrança é idempotente pela chave
   * `meal:<id>`, então nunca sai duas vezes.
   */
  const settleMeal = async (meal: Meal, requestId: string) => {
    if (meal.status !== 'pending') return meal;
    try {
      await mealPayer!.chargeMeal(meal, requestId);
    } catch (error) {
      if (error instanceof AppError && error.code === 'insufficient_thaler') {
        await store.failMeal(meal.id);
      }
      throw error;
    }
    return store.finishMeal(meal.id, now());
  };

  /** Refeições paradas no meio (ledger fora na hora): termina antes de qualquer outra. */
  const settlePending = async (avatarId: string, requestId: string) => {
    const pending = (await store.listMeals(avatarId, 20)).filter((m) => m.status === 'pending');
    for (const meal of pending.reverse()) {
      await settleMeal(meal, requestId).catch((error) => {
        if (!(error instanceof AppError && error.code === 'insufficient_thaler')) throw error;
      });
    }
  };

  // Come uma unidade do alimento, comprada no mercado do jogo.
  app.post('/v1/avatars/:id/meals', async (request, reply) => {
    const avatar = await ownAvatar(request);
    if (!mealPayer) throw new AppError('ledger_unavailable', 'O mercado está fechado: o ledger está desligado.', 503);
    const { food: foodCode } = mealBody.parse(request.body);
    const clientKey = idempotencyKey.parse(request.headers['idempotency-key']) ?? null;
    await settlePending(avatar.id, request.id);
    const meal = await store.beginMeal(avatar.id, avatar.accountId, clientKey, now(), (current) =>
      planMeal(current, { id: randomUUID(), foodCode, clientKey }, now()),
    );
    const done = await settleMeal(meal, request.id);
    if (done.status === 'failed') {
      throw new AppError('insufficient_thaler', 'THALER insuficiente para esta refeição.', 409);
    }
    // Uma refeição que derruba a saúde a 0 já interna.
    const fresh = await hospitalize((await store.get(avatar.id))!, request);
    const at = now();
    return reply.status(201).send({ meal: mealDto(done), avatar: avatarDto(decayed(fresh, at), at) });
  });

  app.get('/v1/avatars/:id/meals', async (request) => {
    const avatar = await ownAvatar(request);
    if (mealPayer) await settlePending(avatar.id, request.id).catch(() => undefined);
    return { meals: (await store.listMeals(avatar.id, 20)).map(mealDto) };
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
      if (cents > 0n) await payer.payShift(shift, cents, request.id);
      await store.markClaimed(shift.id);
      total += cents;
      claimed.push(shift.id);
    }
    return { claimed, thaler: total.toString(), decimals: 2 };
  });

  /** Busca o catálogo publicado no Strapi e troca, se passar na conferência. */
  const loadCatalog = async () => {
    if (!config.CMS_URL) throw new AppError('cms_disabled', 'CMS_URL não está configurado.', 503);
    const list = await fetchCmsProfessions(config.CMS_URL);
    replaceCatalog(list, 'cms');
    return list.length;
  };
  app.decorate('loadCatalog', loadCatalog);

  /** O mesmo para os alimentos do mercado. Lista vazia no Strapi não apaga o mercado. */
  const loadFoods = async () => {
    if (!config.CMS_URL) throw new AppError('cms_disabled', 'CMS_URL não está configurado.', 503);
    const list = await fetchCmsFoods(config.CMS_URL);
    if (!list.length) throw new Error('Strapi sem alimentos publicados');
    replaceFoods(list, 'cms');
    return list.length;
  };
  app.decorate('loadFoods', loadFoods);

  // Webhook do Strapi (entry.publish): o jogo muda sem deploy (trilha do CMS, passo 6).
  app.post('/internal/v1/catalog/refresh', async (request) => {
    requireServiceToken(request.headers['x-service-token'], config.INTERNAL_TOKEN);
    // O webhook dispara para todo tipo do catálogo; o game-core usa profissões e alimentos.
    const model = (request.body as { model?: unknown } | undefined)?.model;
    if (typeof model === 'string' && model !== 'job' && model !== 'food') return { ignored: model };
    try {
      if (model === 'food') return { foods: await loadFoods(), origin: foodsOrigin() };
      return { professions: await loadCatalog(), origin: catalogOrigin() };
    } catch (error) {
      if (error instanceof AppError) throw error;
      request.log.warn(`catálogo do CMS recusado: ${(error as Error).message}`);
      throw new AppError('catalog_rejected', (error as Error).message, 422);
    }
  });

  // Só desenvolvimento: enquanto não existe Lucky Box (E2.1), quem entra no
  // mapa sem avatar ganha um comum de profissão sorteada. Desligado, é 404.
  app.post('/v1/dev/avatar', async (request, reply) => {
    if (!config.DEV_FREE_AVATAR) throw new AppError('not_found', 'Rota não encontrada.', 404);
    const accountId = await player(request);
    const [existing] = await store.listByAccount(accountId);
    if (existing) return { avatar: avatarDto(decayed(existing, now()), now()) };
    const jobs = Object.keys(professionsByRarity().common);
    const jobCode = jobs[Math.floor(Math.random() * jobs.length)]!;
    const created = await store.create(newAvatar({ id: randomUUID(), accountId, rarity: 'common', jobCode }, now()));
    return reply.status(201).send({ avatar: avatarDto(created, now()) });
  });

  // Criação pelo serviço que entrega o avatar: hoje o ambiente de testes; na
  // Etapa 2, o chain-indexer ao ver o mint da Lucky Box (E2.1).
  app.post('/internal/v1/avatars', async (request, reply) => {
    requireServiceToken(request.headers['x-service-token'], config.INTERNAL_TOKEN);
    const body = createBody.parse(request.body);
    const created = await store.create(
      newAvatar({ id: randomUUID(), accountId: body.account_id, rarity: body.rarity, jobCode: body.job_code }, now()),
    );
    return reply.status(201).send({ avatar: avatarDto(created, now()) });
  });

  return app;
}
