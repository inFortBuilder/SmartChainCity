import { randomUUID } from 'node:crypto';

import { AppError, bearerToken, observe, requireServiceToken, serverOptions, verifyAccessToken } from '@scc/shared';
import cors from '@fastify/cors';
import Fastify, { type FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { Config } from './config.js';
import { type Avatar, type AvatarStore, decayed, mayWork, newAvatar, overAvatarLimit, status } from './domain/avatar.js';
import { catalogOrigin, professionLabel, professions, professionsByRarity, replaceCatalog } from './domain/catalog.js';
import { foods, foodsOrigin, replaceFoods } from './domain/foods.js';
import { type HospitalPayer, type HospitalStay, type HospitalStore, needsHospital } from './domain/hospital.js';
import { CONDITIONS, CONDITION_CODES, activeConditions } from './domain/conditions.js';
import {
  ADOPTION_CENTS,
  PET_ACTIONS,
  PET_DECAY,
  PET_MAX,
  PET_SPECIES,
  SERVICES,
  SPECIES_LABEL,
  WALK,
  checkAdoption,
  checkService,
  petAction,
  petDto,
  petMultiplier,
} from './domain/pet.js';
import { CHANGE_CENTS, CHANGE_MS, CLASS, GRADES, checkChange, checkClass, schoolDto } from './domain/school.js';
import {
  type ChampionshipPayer,
  type ChampionshipStore,
  ENTRY_CENTS,
  MIN_TEAMS,
  PRIZE_BPS,
  PRIZE_SHARE_BPS,
  TEAM_SIZE,
  type Championship,
  assertOpen,
  checkTeamName,
  monthOf,
  settleDue,
  settleEntry,
} from './domain/championship.js';
import {
  BUYBACK_BPS,
  FULL_DAYS,
  IPVA_BPS,
  IPVA_PERIOD_MS,
  LICENSE_CENTS,
  LICENSE_MS,
  LIFE_DAYS,
  MIN_FACTOR,
  MODELS,
  RENT_BPS,
  RENT_MS,
  type VehiclePayer,
  type VehicleStore,
  checkIpva,
  checkLicense,
  checkSale,
  isBroken,
  licensed,
  newVehicle,
  rentCents,
  settleVehicle,
  vehicleDto,
} from './domain/vehicle.js';
import {
  CROPS,
  FARMER_JOBS,
  FARM_CENTS,
  type FarmPayer,
  type FarmStore,
  HARVESTS_TO_LEVEL,
  HIRED_PLOW_CENTS,
  LEVEL_CENTS,
  MACHINES,
  OWN_PLOW_ENERGY,
  PLOTS,
  SEASONS as FARM_SEASONS,
  SEED_CENTS,
  type Farm,
  applyHarvest,
  applyLevelUp,
  applyMachine,
  applyPlant,
  applyPlow,
  checkHarvest,
  checkLevelUp,
  checkMachine,
  checkPlant,
  checkPlow,
  farmDto,
  newFarm,
  plan as planCrop,
} from './domain/farm.js';
import {
  BREEDS,
  COOP_CLEAN_CENTS,
  FEED_FOODS,
  type Livestock,
  STRUCTURES,
  advance,
  applyBreed,
  applyFeed,
  applyStructure,
  checkAnimal,
  checkBreed,
  checkClean,
  checkFeed,
  checkStructure,
  collect,
  hatch,
  livestockDto,
  livestockOf,
  newAnimal,
  slaughter,
} from './domain/livestock.js';
import {
  type GamePassPayer,
  type GamePassStore,
  checkPassUpgrade,
  eventAt,
  eventDto,
  eventOfWeek,
  eventsOrigin,
  itemDto,
  passKey,
  passPriceWei,
  perks,
  replaceEventGroups,
  replaceSeasons,
  seasonAt,
  weekOf,
} from './domain/events.js';
import {
  FUEL_CENTS,
  PRIZES_CENTS,
  RACES_PER_DAY,
  REVISION_BPS,
  REVISION_MS,
  RIVALS,
  type RacePayer,
  type RaceStore,
  SEVERITIES,
  checkRace,
  dayOf,
  newRace,
  raceDto,
  repairCents,
  settleRace,
} from './domain/race.js';
import { ACTIVITIES, COOLDOWN_MS, OWNER_SHARE_BPS, type VenueDirectory, applyLeisure, checkActivity, leisureDto } from './domain/leisure.js';
import {
  CURE_CHANCE,
  MEAL_FOOD_POINTS,
  MEDICINE_PRICE_CENTS,
  type Meal,
  type MealPayer,
  type MealPlanner,
  type MealStore,
  eatFromPantry,
  isMedicine,
  isPetShop,
  isLeisure,
  isLicense,
  isSchool,
  planLeisure,
  planLicense,
  planPetShop,
  planSchool,
  isPack,
  packPriceCents,
  planMedicine,
  planMeal,
  planPack,
  unitPriceCents,
} from './domain/meal.js';
import { fetchCmsEventGroups, fetchCmsFoods, fetchCmsProfessions, fetchCmsSeasons } from './infra/cms-catalog.js';
import { type Payer, type Shift, type ShiftStore, startShift } from './domain/shift.js';
import { chargeStay } from './jobs/hospital.js';
import { completeShifts } from './jobs/shift.js';
import { MVP_PROFESSIONS, type Minigame, minigameOf } from './domain/minigame.js';
import { AccountRateLimit, DEVICE_ACCOUNT_LIMIT, RiskGuard, type RiskStore } from './domain/risk.js';

const uuid = z.uuid();

const workBody = z.object({ shift: z.number().int() });
const mealBody = z.object({ food: z.string().min(1).max(64) });
const medicineBody = z.object({ condition: z.string().min(1).max(64) });
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
  /** Token do AvatarNFT; null no avatar que só existe no jogo. */
  token_id: a.tokenId,
  rarity: a.rarity,
  job: { code: a.jobCode, label: professionLabel(a.rarity, a.jobCode) },
  attributes: a.attributes,
  status: status(a, at),
  hospital_until: status(a, at).inHospital ? a.hospitalUntil!.toISOString() : null,
  pantry: Object.entries(a.pantry).map(([code, units]) => ({ food: code, units })),
  pet: petDto(a.pet, at),
  school: schoolDto(a, at),
  // Quando cada atividade de lazer libera de novo (null: já pode).
  leisure: leisureDto(a, at),
  // Habilitação (E3.5): null sem; com a autoescola em curso, `licensed` é falso até `ready_at`.
  license: a.license ? { ready_at: a.license.readyAt.toISOString(), licensed: licensed(a, at) } : null,
  // Só as que estão em curso: a sorteada no turno aparece quando o turno acaba.
  conditions: activeConditions(a.conditions, at).map((c) => ({
    code: c.code,
    label: CONDITIONS[c.code].label,
    blocks_work: CONDITIONS[c.code].blocksWork,
    yield_factor: CONDITIONS[c.code].yieldFactor,
    hospital_only: CONDITIONS[c.code].serious,
    ends_at: c.endsAt.toISOString(),
  })),
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
const minigameDto = (m: Minigame | null) =>
  m && {
    job: m.job,
    current: m.current,
    progress: Math.round(m.progress * 1000) / 1000,
    tasks: m.tasks.map((t) => ({
      name: t.name,
      energy: t.energy,
      happiness: t.happiness,
      starts_at: t.startsAt.toISOString(),
      ends_at: t.endsAt.toISOString(),
      state: t.state,
    })),
    damage: m.damage,
  };

const shiftDto = (s: Shift, now: Date = new Date()) => ({
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
  // Minigame (E2.2): as tarefas da profissão ao longo do turno.
  minigame: minigameDto(minigameOf(s, now)),
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
  /** Sorteio da dor de barriga e da cura do remédio; os testes trocam. */
  random: () => number = Math.random,
  /** Antifraude (E2.9): sinais por aparelho e rede. Sem ele, só o limite de velocidade vale. */
  riskStore: RiskStore | null = null,
  /** Lazer (E3.3): academias e galerias de jogador no world. Sem ele, só o parque. */
  venues: VenueDirectory | null = null,
  /** Campeonato de futebol de botão (E3.3). Sem ele, as rotas do campeonato respondem 503. */
  championships: { store: ChampionshipStore; payer: ChampionshipPayer } | null = null,
  /** Veículos (E3.5): agência e IPVA. Sem ele, as rotas de veículos respondem 503. */
  vehicles: { store: VehicleStore; payer: VehiclePayer & RacePayer; races?: RaceStore } | null = null,
  /** GamePass (E3.10). Sem ele, os eventos funcionam e o GamePass responde 503. */
  passes: { store: GamePassStore; payer: GamePassPayer } | null = null,
  /** Fazenda (E3.4). Sem ela, as rotas da fazenda respondem 503. */
  farms: { store: FarmStore; payer: FarmPayer } | null = null,
) {
  const app = Fastify({
    trustProxy: config.TRUST_PROXY,
    ...serverOptions({
      service: 'game-core',
      nodeEnv: config.NODE_ENV,
      logLevel: config.LOG_LEVEL,
    }),
  });
  const metrics = observe(app, { service: 'game-core', nodeEnv: config.NODE_ENV, metricsToken: config.METRICS_TOKEN });
  const risk = riskStore
    ? new RiskGuard(riskStore, config.RISK_PEPPER ?? config.JWT_SECRET, metrics, (msg, data) => app.log.warn(data, msg))
    : null;
  const p2eRate = new AccountRateLimit(config.RISK_RATE_PER_MINUTE, metrics);
  /** Antes de emitir P2E: velocidade e, com o store, aparelho e rede. */
  const guardP2E = async (request: FastifyRequest, accountId: string, action: 'work' | 'claim' | 'race') => {
    p2eRate.take(accountId, now().getTime());
    await risk?.assert({ accountId, deviceHeader: request.headers['x-device-id'], ip: request.ip, action }, now());
  };

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
      // As 12 do MVP (E2.2): 11 comuns e o Cozinheiro.
      mvp: (MVP_PROFESSIONS as readonly string[]).includes(p.code),
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

  // Tratamento voluntário (E2.3): febre, enxaqueca e virose só o hospital cura. 4 h internado e a taxa.
  app.post('/v1/avatars/:id/hospital/treat', async (request, reply) => {
    const avatar = await ownAvatar(request);
    let stay = await store.treat(avatar.id, now(), randomUUID());
    if (hospitalPayer) {
      await chargeStay(store, hospitalPayer, stay, request.id).catch((error) =>
        request.log.warn(`taxa do tratamento fica para o job: ${(error as Error).message}`),
      );
      stay = (await store.listStays(avatar.id, 1))[0] ?? stay;
    }
    const at = now();
    const fresh = (await store.get(avatar.id))!;
    return reply.status(201).send({ stay: stayDto(stay), avatar: avatarDto(decayed(fresh, at), at) });
  });

  // Começa o turno. Depois disso o cliente pode fechar: o job conclui no horário.
  app.post('/v1/avatars/:id/work', async (request, reply) => {
    const { shift } = workBody.parse(request.body);
    // O turno que já venceu não segura o próximo, mesmo antes da passada do job.
    await completeShifts(store, now());
    const { id, accountId } = await ownAvatar(request);
    // Avatares comprados na blockchain entram fora do limite, mas só os mais antigos na conta trabalham.
    if (!mayWork(await store.listByAccount(accountId), id)) throw overAvatarLimit();
    await guardP2E(request, accountId, 'work');
    // GamePass da temporada: corta a chance de dano do turno (E3.10).
    const season = seasonAt(now());
    const passLevel = passes && season ? await passes.store.level(accountId, season.code) : 0;
    // Níveis e itens sazonais da temporada: corte de dano e bônus de ganho.
    const perk = perks(season, passLevel);
    const started = await store.beginShift(id, accountId, now(), (avatar, context) =>
      startShift(
        avatar,
        {
          id: randomUUID(),
          hours: shift,
          damageCut: perk.damageCut,
          earnBonus: perk.earnBonus,
          ...context,
          durationMs: config.DEV_SHIFT_MINUTES ? config.DEV_SHIFT_MINUTES * 60_000 : undefined,
        },
        now(),
      ),
    );
    return reply.status(201).send({ shift: shiftDto(started, now()) });
  });

  app.get('/v1/avatars/:id/shifts', async (request) => {
    const avatar = await ownAvatar(request);
    // Não espera a próxima passada do job: o que já venceu aparece concluído.
    await completeShifts(store, now());
    return { shifts: (await store.listShifts(avatar.id, 20)).map((s) => shiftDto(s, now())) };
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
      pack: f.pack,
      pack_price: packPriceCents(f).toString(),
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

  /** Compra no mercado ou na farmácia: grava pendente, cobra e aplica. */
  const purchase = async (request: FastifyRequest, plan: (clientKey: string | null) => MealPlanner) => {
    const avatar = await ownAvatar(request);
    if (!mealPayer) throw new AppError('ledger_unavailable', 'O mercado está fechado: o ledger está desligado.', 503);
    const clientKey = idempotencyKey.parse(request.headers['idempotency-key']) ?? null;
    await settlePending(avatar.id, request.id);
    const meal = await store.beginMeal(avatar.id, avatar.accountId, clientKey, now(), plan(clientKey));
    const done = await settleMeal(meal, request.id);
    if (done.status === 'failed') {
      const what = isLicense(done) ? 'a autoescola' : isLeisure(done) ? 'a entrada' : isSchool(done) ? 'a escola' : isPetShop(done) ? 'o Pet Shop' : isMedicine(done) ? 'o remédio' : isPack(done) ? 'o pacote' : 'esta refeição';
      throw new AppError('insufficient_thaler', `THALER insuficiente para ${what}.`, 409);
    }
    return { avatar, done };
  };

  // Come uma unidade do alimento, comprada no mercado do jogo.
  app.post('/v1/avatars/:id/meals', async (request, reply) => {
    const { food: foodCode } = mealBody.parse(request.body);
    const { avatar, done } = await purchase(request, (clientKey) => (current) =>
      planMeal(current, { id: randomUUID(), foodCode, clientKey, roll: random() }, now()),
    );
    // Uma refeição que derruba a saúde a 0 já interna.
    const fresh = await hospitalize((await store.get(avatar.id))!, request);
    const at = now();
    return reply.status(201).send({ meal: mealDto(done), avatar: avatarDto(decayed(fresh, at), at) });
  });

  // Despensa: compra o pacote inteiro do alimento e guarda as unidades.
  app.post('/v1/avatars/:id/pantry', async (request, reply) => {
    const { food: foodCode } = mealBody.parse(request.body);
    const { avatar, done } = await purchase(request, (clientKey) => (current) =>
      planPack(current, { id: randomUUID(), foodCode, clientKey }, now()),
    );
    const fresh = (await store.get(avatar.id))!;
    const at = now();
    return reply.status(201).send({ purchase: mealDto(done), avatar: avatarDto(decayed(fresh, at), at) });
  });

  // Come uma unidade guardada na despensa (doc 06: consume), sem cobrar de novo.
  app.post('/v1/avatars/:id/consume', async (request) => {
    const { food: foodCode } = mealBody.parse(request.body);
    const avatar = await ownAvatar(request);
    const fed = await store.updateAvatar(avatar.id, avatar.accountId, now(), (current) =>
      eatFromPantry(current, { foodCode, roll: random() }, now()),
    );
    const fresh = await hospitalize(fed, request);
    const at = now();
    return { avatar: avatarDto(decayed(fresh, at), at) };
  });

  // Farmácia do jogo: compra o remédio da doença e toma na hora (cura com 70%).
  app.post('/v1/avatars/:id/medicine', async (request, reply) => {
    const { condition } = medicineBody.parse(request.body);
    const { avatar, done } = await purchase(request, (clientKey) => (current) =>
      planMedicine(current, { id: randomUUID(), condition, clientKey, roll: random() }, now()),
    );
    const fresh = (await store.get(avatar.id))!;
    const at = now();
    return reply.status(201).send({ medicine: mealDto(done), cured: done.effects.cure?.success ?? false, avatar: avatarDto(decayed(fresh, at), at) });
  });

  // Pet Shop (E3.1): adoção e serviços, preços em centavos de THALER (premissas, pet.ts).
  app.get('/v1/catalog/petshop', async () => ({
    decimals: 2,
    provisional_price: true,
    max: PET_MAX,
    species: PET_SPECIES.map((code) => ({ code, label: SPECIES_LABEL[code], price: ADOPTION_CENTS[code].toString() })),
    services: Object.entries(SERVICES).map(([code, sv]) => ({ code, label: sv.label, price: sv.cents.toString() })),
    walk: { avatar_energy: WALK.avatarEnergy, avatar_happiness: WALK.avatarHappiness, avatar_health: WALK.avatarHealth, pet_water: WALK.petWater },
    decay_hours: { food: PET_DECAY.food.everyMs / 3_600_000, happiness: PET_DECAY.happiness.everyMs / 3_600_000 },
    levels: Array.from({ length: 13 }, (_, i) => ({ level: i + 3, multiplier: petMultiplier(i + 3) })),
  }));

  // Adota um gato ou cachorro no Pet Shop: um por avatar, pago pelo ledger.
  app.post('/v1/avatars/:id/pet', async (request, reply) => {
    const body = z.object({ species: z.string(), name: z.string() }).parse(request.body);
    const { avatar, done } = await purchase(request, (clientKey) => (current) => {
      const { cents, ...effect } = checkAdoption(current, body, now());
      return planPetShop(current, { id: randomUUID(), clientKey, effect, cents }, now());
    });
    const fresh = (await store.get(avatar.id))!;
    const at = now();
    return reply.status(201).send({ purchase: mealDto(done), avatar: avatarDto(decayed(fresh, at), at) });
  });

  // Serviço do Pet Shop: ração, banho, tosa ou hotel.
  app.post('/v1/avatars/:id/pet/services', async (request, reply) => {
    const { service } = z.object({ service: z.string() }).parse(request.body);
    const { avatar, done } = await purchase(request, (clientKey) => (current) => {
      const { cents, ...effect } = checkService(current, service, now());
      return planPetShop(current, { id: randomUUID(), clientKey, effect, cents }, now());
    });
    const fresh = (await store.get(avatar.id))!;
    const at = now();
    return reply.status(201).send({ purchase: mealDto(done), avatar: avatarDto(decayed(fresh, at), at) });
  });

  // De graça, em casa: dar água, passear (gasta energia do avatar) e enterrar o pet morto.
  app.post('/v1/avatars/:id/pet/actions', async (request) => {
    const { action } = z.object({ action: z.enum(PET_ACTIONS as [string, ...string[]]) }).parse(request.body);
    const avatar = await ownAvatar(request);
    const next = await store.updateAvatar(avatar.id, avatar.accountId, now(), (current) => petAction(current, action, now()));
    const at = now();
    return { avatar: avatarDto(decayed(next, at), at) };
  });

  // Escola (E3.2): aula e troca de profissão, preços em centavos de THALER (premissas, school.ts).
  app.get('/v1/catalog/school', async () => ({
    decimals: 2,
    provisional_price: true,
    class: { price: CLASS.cents.toString(), education: CLASS.education, energy: CLASS.energy, per_day: 1 },
    change: { price: CHANGE_CENTS.toString(), days: CHANGE_MS / 86_400_000, same_rarity: true },
    grades: GRADES,
  }));

  // Aula do dia: +educação, −energia, paga pelo ledger.
  app.post('/v1/avatars/:id/school/class', async (request, reply) => {
    const { avatar, done } = await purchase(request, (clientKey) => (current) => {
      const { cents, ...effect } = checkClass(current, now());
      return planSchool(current, { id: randomUUID(), clientKey, effect, cents }, now());
    });
    const fresh = (await store.get(avatar.id))!;
    const at = now();
    return reply.status(201).send({ purchase: mealDto(done), avatar: avatarDto(decayed(fresh, at), at) });
  });

  // Troca de profissão: 4 dias de escola, sem trabalhar; a nova vale no fim.
  app.post('/v1/avatars/:id/school/change', async (request, reply) => {
    const { job } = z.object({ job: z.string() }).parse(request.body);
    const own = await ownAvatar(request);
    await completeShifts(store, now());
    const running = (await store.listShifts(own.id, 5)).some((s) => s.status === 'running');
    const { avatar, done } = await purchase(request, (clientKey) => (current) => {
      const { cents, ...effect } = checkChange(current, job, running, now());
      return planSchool(current, { id: randomUUID(), clientKey, effect, cents }, now());
    });
    const fresh = (await store.get(avatar.id))!;
    const at = now();
    return reply.status(201).send({ purchase: mealDto(done), avatar: avatarDto(decayed(fresh, at), at) });
  });

  // Lazer (E3.3): as atividades, onde acontecem e o efeito (premissas, leisure.ts).
  app.get('/v1/catalog/leisure', async () => ({
    cooldown_hours: COOLDOWN_MS / 3_600_000,
    owner_share: OWNER_SHARE_BPS / 10_000,
    venues_on: venues !== null,
    activities: Object.entries(ACTIVITIES).map(([code, a]) => ({
      code,
      label: a.label,
      place: a.place,
      // A tela mostra só a direção, como nas profissões (GDD §2.4).
      energy: Math.sign(a.energy),
      happiness: Math.sign(a.happiness),
      health: Math.sign(a.health),
      education: Math.sign(a.education),
    })),
  }));

  /**
   * Atividade de lazer `{activity, venue_id?}`. Parque de graça; academia e galeria são
   * negócios de jogador: o world diz o dono e a entrada, cobrada pelo ledger antes do efeito.
   */
  app.post('/v1/avatars/:id/leisure', async (request, reply) => {
    const body = z.object({ activity: z.string(), venue_id: z.uuid().optional() }).parse(request.body);
    const own = await ownAvatar(request);
    const place = (ACTIVITIES as Record<string, { place: string }>)[body.activity]?.place;
    if (place === 'parque' || !place) {
      const next = await store.updateAvatar(own.id, own.accountId, now(), (current) => {
        const { effect } = checkActivity(current, { activity: body.activity, venue: null }, now());
        return applyLeisure(current, effect, now());
      });
      const at = now();
      return reply.status(201).send({ purchase: null, avatar: avatarDto(decayed(next, at), at) });
    }
    if (!venues) throw new AppError('venues_unavailable', 'Academias e galerias estão desligadas: o world não está ligado.', 503);
    const venue = body.venue_id ? await venues.venue(body.venue_id) : null;
    const { avatar, done } = await purchase(request, (clientKey) => (current) => {
      const { effect, cents } = checkActivity(current, { activity: body.activity, venue, venueId: body.venue_id }, now());
      return planLeisure(current, { id: randomUUID(), clientKey, effect, cents }, now());
    });
    const fresh = (await store.get(avatar.id))!;
    const at = now();
    return reply.status(201).send({ purchase: mealDto(done), avatar: avatarDto(decayed(fresh, at), at) });
  });

  // ---------------------------------------------------------------- veículos (E3.5)

  const vehiclesOn = () => {
    if (!vehicles) throw new AppError('vehicles_disabled', 'A agência está fechada: o ledger não está ligado.', 503);
    return vehicles;
  };

  app.get('/v1/catalog/vehicles', async () => ({
    decimals: 2,
    provisional_price: true,
    models: Object.entries(MODELS).map(([code, m]) => ({
      code,
      label: m.label,
      rarity: m.rarity,
      price: m.priceCents.toString(),
      rent_price: rentCents(code as keyof typeof MODELS).toString(),
      speed: m.speed,
      power: m.power,
    })),
    races: {
      per_day: RACES_PER_DAY,
      rivals: RIVALS,
      fuel: FUEL_CENTS.toString(),
      prizes: PRIZES_CENTS.map((p) => p.toString()),
      breakdown_chance: 0.05,
      breakdown_chance_revised: 0.02,
      repairs: Object.entries(SEVERITIES).map(([code, sv]) => ({ code, days: sv.days, share: sv.repairBps / 10_000 })),
      revision_share: REVISION_BPS / 10_000,
      revision_days: REVISION_MS / 86_400_000,
    },
    rules: {
      full_days: FULL_DAYS,
      life_days: LIFE_DAYS,
      min_factor: MIN_FACTOR,
      ipva_share: IPVA_BPS / 10_000,
      ipva_days: IPVA_PERIOD_MS / 86_400_000,
      rent_share: RENT_BPS / 10_000,
      rent_days: RENT_MS / 86_400_000,
      buyback_share: BUYBACK_BPS / 10_000,
      license_price: LICENSE_CENTS.toString(),
      license_hours: LICENSE_MS / 3_600_000,
    },
  }));

  // Autoescola: paga e fica 3 h parado; depois, habilitado.
  app.post('/v1/avatars/:id/license', async (request, reply) => {
    const { avatar, done } = await purchase(request, (clientKey) => (current) => {
      const { cents } = checkLicense(current, now());
      return planLicense(current, { id: randomUUID(), clientKey, cents }, now());
    });
    const fresh = (await store.get(avatar.id))!;
    const at = now();
    return reply.status(201).send({ purchase: mealDto(done), avatar: avatarDto(decayed(fresh, at), at) });
  });

  /** Carros pendentes da conta (ledger fora na hora): termina antes de listar. */
  const settlePendingVehicles = async (accountId: string, requestId: string) => {
    const v = vehiclesOn();
    for (const p of (await v.store.listByAccount(accountId)).filter((x) => x.status === 'pending')) {
      await settleVehicle(v, p, requestId).catch(() => undefined);
    }
  };

  app.get('/v1/vehicles', async (request) => {
    const accountId = await player(request);
    const v = vehiclesOn();
    await settlePendingVehicles(accountId, request.id);
    const at = now();
    return { vehicles: (await v.store.listByAccount(accountId)).filter((x) => x.status !== 'sold').map((x) => vehicleDto(x, at)) };
  });

  // Agência: compra `{model}` ou aluga `{model, rent: true}` (3 dias por 5% do valor).
  app.post('/v1/vehicles', async (request, reply) => {
    const accountId = await player(request);
    const body = z.object({ model: z.string(), rent: z.boolean().optional() }).parse(request.body);
    const v = vehiclesOn();
    const car = newVehicle({ id: randomUUID(), accountId, model: body.model, rent: body.rent ?? false }, now());
    await v.store.create(car);
    const active = await settleVehicle(v, car, request.id);
    return reply.status(201).send({ vehicle: vehicleDto(active, now()) });
  });

  const ownVehicle = async (request: FastifyRequest) => {
    const accountId = await player(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const car = await vehiclesOn().store.get(id);
    if (!car || car.accountId !== accountId || car.status === 'sold') throw new AppError('not_found', 'Carro não encontrado.', 404);
    return car;
  };

  // IPVA do semestre: cobre os próximos 182 dias; atrasado, tira a suspensão.
  app.post('/v1/vehicles/:id/ipva', async (request) => {
    const car = await ownVehicle(request);
    const v = vehiclesOn();
    const { cents, period, until } = checkIpva(car, now());
    await v.payer.chargeVehicle(
      { key: `vehicle-ipva:${car.id}:${period}`, kind: 'vehicle_ipva', accountId: car.accountId, cents, sink: 'ipva', refId: car.id },
      request.id,
    );
    // A chave do semestre segura a cobrança dupla; o prazo só anda uma vez.
    await v.store.extendIpva(car.id, car.ipvaPaidUntil!, until);
    return { vehicle: vehicleDto((await v.store.get(car.id))!, now()) };
  });

  // Venda para a agência pela depreciação.
  app.post('/v1/vehicles/:id/sell', async (request) => {
    const car = await ownVehicle(request);
    const v = vehiclesOn();
    const { cents } = checkSale(car, now());
    // Paga antes de marcar: dois pedidos juntos têm a mesma chave e o ledger paga uma vez.
    await v.payer.payBuyback({ key: `vehicle-buyback:${car.id}`, accountId: car.accountId, cents, refId: car.id }, request.id);
    await v.store.markSold(car.id, now());
    return { sold: { id: car.id, cents: cents.toString() } };
  });

  // ---------------------------------------------------------------- fazenda (E3.4)

  const farmsOn = () => {
    if (!farms) throw new AppError('farms_disabled', 'A fazenda está desligada: o ledger não está ligado.', 503);
    return farms;
  };
  const myFarm = async (accountId: string) => {
    const f = await farmsOn().store.get(accountId);
    if (!f) throw new AppError('no_farm', 'Você ainda não tem fazenda. Compre um slot da Prefeitura.', 404);
    return f;
  };
  /** Grava com a trava otimista; outra gravação no meio é 409 (a cobrança tem chave: tentar de novo não cobra outra vez). */
  const saveFarm = async (f: Farm) => {
    if (!(await farmsOn().store.save(f))) {
      throw new AppError('farm_conflict', 'A fazenda mudou agora. Tente de novo: a cobrança não se repete.', 409);
    }
    return (await farmsOn().store.get(f.accountId))!;
  };
  const charge = (accountId: string, key: string, kind: string, cents: bigint, requestId: string) =>
    farmsOn().payer.chargeFarm({ key, kind, accountId, cents }, requestId);
  const plotParam = z.object({ i: z.coerce.number().int().min(1).max(PLOTS) });

  app.get('/v1/farm', async (request) => {
    const accountId = await player(request);
    const f = farms ? await farms.store.get(accountId) : null;
    return {
      price: FARM_CENTS.toString(),
      plots: PLOTS,
      seed_price: SEED_CENTS.toString(),
      hired_plow_price: HIRED_PLOW_CENTS.toString(),
      farmer_jobs: FARMER_JOBS,
      harvests_to_level: HARVESTS_TO_LEVEL,
      level_prices: Object.fromEntries(Object.entries(LEVEL_CENTS).map(([k, v]) => [k, v.toString()])),
      seasons: FARM_SEASONS,
      crops: Object.entries(CROPS).map(([code, c]) => ({ code, ...c })),
      machines: Object.entries(MACHINES).map(([code, m]) => ({ code, label: m.label, price: m.cents.toString() })),
      region: 'A3 (zona rural): a fazenda ganha lugar no mapa quando a região abrir',
      structures: Object.entries(STRUCTURES).map(([code, x]) => ({ code, label: x.label, price: x.cents.toString() })),
      breeds: Object.entries(BREEDS).map(([code, x]) => ({ code, label: x.label, species: x.species, price: x.cents.toString(), needs: x.needs })),
      feed_foods: FEED_FOODS,
      coop_clean_price: COOP_CLEAN_CENTS.toString(),
      farm: f ? farmDto(f, now()) : null,
      livestock: f ? livestockDto(advance(livestockOf(f, now()), f.machines.includes('cao'), now()), now()) : null,
    };
  });

  // ---------------- pecuária (E3.4): mesma fazenda, mesma trava

  /** A fazenda com o rebanho andado até agora (produção, mortes e riscos dos dias que passaram). */
  const herd = async (accountId: string) => {
    const f = await myFarm(accountId);
    return { f, l: advance(livestockOf(f, now()), f.machines.includes('cao'), now()) };
  };
  const saveHerd = (f: Farm, l: Livestock) => saveFarm({ ...f, livestock: l });
  /** O avatar da conta que dá ou recebe da despensa. */
  const pantryAvatar = async (accountId: string, avatarId: string) => {
    const a = await store.get(avatarId);
    if (!a || a.accountId !== accountId) throw new AppError('not_found', 'Avatar não encontrado.', 404);
    return decayed(a, now());
  };
  const movePantry = (avatarId: string, accountId: string, changes: Record<string, number>) =>
    store.updateAvatar(avatarId, accountId, now(), (cur) => {
      const pantry = { ...cur.pantry };
      for (const [food, delta] of Object.entries(changes)) {
        const n = (pantry[food] ?? 0) + delta;
        if (n < 0) throw new AppError('not_in_pantry', 'O alimento saiu da despensa no meio do caminho.', 409);
        if (n === 0) delete pantry[food];
        else pantry[food] = n;
      }
      return { ...cur, pantry, updatedAt: now() };
    });
  const herdOut = (f: Farm) => ({ farm: farmDto(f, now()), livestock: livestockDto(livestockOf(f, now()), now()) });

  app.post('/v1/farm/structures', async (request, reply) => {
    const accountId = await player(request);
    const { structure } = z.object({ structure: z.string() }).parse(request.body);
    const { f, l } = await herd(accountId);
    const { cents, code } = checkStructure(l, structure);
    await charge(accountId, `farm-structure:${accountId}:${code}`, 'farm_structure', cents, request.id);
    return reply.status(201).send(herdOut(await saveHerd(f, applyStructure(l, code, now()))));
  });

  app.post('/v1/farm/animals', async (request, reply) => {
    const accountId = await player(request);
    const { breed } = z.object({ breed: z.string() }).parse(request.body);
    const { f, l } = await herd(accountId);
    const { cents } = checkAnimal(l, breed);
    await charge(accountId, `farm-animal:${accountId}:${l.bought}`, 'farm_animal', cents, request.id);
    const next = { ...l, bought: l.bought + 1, animals: [...l.animals, newAnimal(breed as keyof typeof BREEDS, now())] };
    return reply.status(201).send(herdOut(await saveHerd(f, next)));
  });

  // Alimenta com 1 milho ou trigo da despensa do avatar.
  app.post('/v1/farm/animals/:id/feed', async (request) => {
    const accountId = await player(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = z.object({ avatar_id: z.uuid(), food: z.string() }).parse(request.body);
    const a = await pantryAvatar(accountId, body.avatar_id);
    const { f, l } = await herd(accountId);
    checkFeed(l, id, body.food, a.pantry, now());
    const saved = await saveHerd(f, applyFeed(l, id, now()));
    await movePantry(a.id, accountId, { [body.food]: -1 });
    return herdOut(saved);
  });

  // Coleta os ovos e o leite guardados para a despensa do avatar.
  app.post('/v1/farm/collect', async (request) => {
    const accountId = await player(request);
    const { avatar_id } = z.object({ avatar_id: z.uuid() }).parse(request.body);
    await pantryAvatar(accountId, avatar_id);
    const { f, l } = await herd(accountId);
    const got = collect(l);
    const saved = await saveHerd(f, got.livestock);
    if (got.eggs || got.milk) await movePantry(avatar_id, accountId, { ...(got.eggs ? { ovos: got.eggs } : {}), ...(got.milk ? { leite: got.milk } : {}) });
    return { ...herdOut(saved), collected: { ovos: got.eggs, leite: got.milk } };
  });

  // Abate: adulto vira carne crua na despensa; filhote não dá nada.
  app.post('/v1/farm/animals/:id/slaughter', async (request) => {
    const accountId = await player(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const { avatar_id } = z.object({ avatar_id: z.uuid() }).parse(request.body);
    await pantryAvatar(accountId, avatar_id);
    const { f, l } = await herd(accountId);
    const got = slaughter(l, id);
    const saved = await saveHerd(f, got.livestock);
    if (got.meat) await movePantry(avatar_id, accountId, { carne_crua: got.meat });
    return { ...herdOut(saved), meat: got.meat };
  });

  // Reprodução: casal adulto e 1 milho ou trigo da despensa.
  app.post('/v1/farm/breed', async (request, reply) => {
    const accountId = await player(request);
    const body = z.object({ ids: z.tuple([z.uuid(), z.uuid()]), avatar_id: z.uuid(), food: z.string() }).parse(request.body);
    const a = await pantryAvatar(accountId, body.avatar_id);
    const { f, l } = await herd(accountId);
    const { a: x, b: y, baby } = checkBreed(l, body.ids, body.food, a.pantry, now());
    const saved = await saveHerd(f, applyBreed(l, x, y, baby, now()));
    await movePantry(a.id, accountId, { [body.food]: -1 });
    return reply.status(201).send({ ...herdOut(saved), baby });
  });

  // Chocadeira: 1 ovo da despensa vira pinto (3% de ser dos ovos de ouro).
  app.post('/v1/farm/hatch', async (request, reply) => {
    const accountId = await player(request);
    const { avatar_id } = z.object({ avatar_id: z.uuid() }).parse(request.body);
    const a = await pantryAvatar(accountId, avatar_id);
    const { f, l } = await herd(accountId);
    const got = hatch(l, a.pantry, now(), random());
    const saved = await saveHerd(f, got.livestock);
    await movePantry(a.id, accountId, { ovos: -1 });
    return reply.status(201).send({ ...herdOut(saved), golden: got.golden });
  });

  // Limpeza do galinheiro (a cada 5 dias): sem ela, as galinhas não põem.
  app.post('/v1/farm/coop/clean', async (request) => {
    const accountId = await player(request);
    const { f, l } = await herd(accountId);
    const { cents } = checkClean(l, now());
    await charge(accountId, `farm-coop:${accountId}:${l.coopCleanedAt?.toISOString() ?? 'nunca'}`, 'farm_coop_clean', cents, request.id);
    return herdOut(await saveHerd(f, { ...l, coopCleanedAt: now() }));
  });

  // Slot da Prefeitura: 4 canteiros e a casa, um por conta.
  app.post('/v1/farm', async (request, reply) => {
    const accountId = await player(request);
    const fs = farmsOn();
    if (await fs.store.get(accountId)) throw new AppError('farm_owned', 'Você já tem fazenda.', 409);
    await charge(accountId, `farm-buy:${accountId}`, 'farm_buy', FARM_CENTS, request.id);
    await fs.store.create(newFarm(accountId, now()));
    return reply.status(201).send({ farm: farmDto((await fs.store.get(accountId))!, now()) });
  });

  app.post('/v1/farm/machines', async (request, reply) => {
    const accountId = await player(request);
    const { machine } = z.object({ machine: z.string() }).parse(request.body);
    const f = await myFarm(accountId);
    const { cents, code } = checkMachine(f, machine);
    await charge(accountId, `farm-machine:${accountId}:${code}`, 'farm_machine', cents, request.id);
    return reply.status(201).send({ farm: farmDto(await saveFarm(applyMachine(f, code)), now()) });
  });

  // Arar: com o próprio agricultor (`avatar_id`, −1 de energia) ou contratado (10 THALER).
  app.post('/v1/farm/plots/:i/plow', async (request) => {
    const accountId = await player(request);
    const { i } = plotParam.parse(request.params);
    const { avatar_id } = z.object({ avatar_id: z.uuid().optional() }).parse(request.body ?? {});
    const f = await myFarm(accountId);
    const plot = checkPlow(f, i - 1);
    if (avatar_id) {
      const a = await store.get(avatar_id);
      if (!a || a.accountId !== accountId) throw new AppError('not_found', 'Avatar não encontrado.', 404);
      if (!(FARMER_JOBS as readonly string[]).includes(a.jobCode)) {
        throw new AppError('not_a_farmer', 'Só agricultor, fazendeiro ou agrônomo ara. Ou contrate a aragem.', 409);
      }
      if (decayed(a, now()).attributes.energy < OWN_PLOW_ENERGY) throw new AppError('too_tired', 'Arar gasta 1 de energia.', 409);
      const saved = await saveFarm(applyPlow(f, i - 1));
      await store.updateAvatar(a.id, accountId, now(), (cur) => ({
        ...cur,
        attributes: { ...cur.attributes, energy: Math.max(0, cur.attributes.energy - OWN_PLOW_ENERGY) },
        updatedAt: now(),
      }));
      return { farm: farmDto(saved, now()), hired: false };
    }
    await charge(accountId, `farm-plow:${accountId}:${i}:${plot.cycle}`, 'farm_plow', HIRED_PLOW_CENTS, request.id);
    return { farm: farmDto(await saveFarm(applyPlow(f, i - 1)), now()), hired: true };
  });

  app.post('/v1/farm/plots/:i/plant', async (request) => {
    const accountId = await player(request);
    const { i } = plotParam.parse(request.params);
    const { crop } = z.object({ crop: z.string() }).parse(request.body);
    const f = await myFarm(accountId);
    const plot = checkPlant(f, i - 1, crop);
    await charge(accountId, `farm-seed:${accountId}:${i}:${plot.cycle}`, 'farm_seed', SEED_CENTS, request.id);
    return { farm: farmDto(await saveFarm(applyPlant(f, i - 1, planCrop(f, crop as keyof typeof CROPS, now()))), now()) };
  });

  // Colhe para a despensa de um avatar da conta.
  app.post('/v1/farm/plots/:i/harvest', async (request) => {
    const accountId = await player(request);
    const { i } = plotParam.parse(request.params);
    const { avatar_id } = z.object({ avatar_id: z.uuid() }).parse(request.body);
    const a = await store.get(avatar_id);
    if (!a || a.accountId !== accountId) throw new AppError('not_found', 'Avatar não encontrado.', 404);
    const f = await myFarm(accountId);
    const { planting, units } = checkHarvest(f, i - 1, now());
    const saved = await saveFarm(applyHarvest(f, i - 1));
    if (units > 0) {
      await store.updateAvatar(a.id, accountId, now(), (cur) => ({
        ...cur,
        pantry: { ...cur.pantry, [planting.crop]: (cur.pantry[planting.crop] ?? 0) + units },
        updatedAt: now(),
      }));
    }
    return { farm: farmDto(saved, now()), harvest: { crop: planting.crop, units, damage: planting.damage, seed: planting.seed } };
  });

  app.post('/v1/farm/level', async (request) => {
    const accountId = await player(request);
    const f = await myFarm(accountId);
    const { cents, to } = checkLevelUp(f);
    await charge(accountId, `farm-level:${accountId}:${to}`, 'farm_level', cents, request.id);
    return { farm: farmDto(await saveFarm(applyLevelUp(f)), now()) };
  });

  // ---------------------------------------------------------------- eventos semanais e GamePass (E3.10)

  // O evento da semana e os próximos 3: o calendário é público.
  app.get('/v1/events', async () => {
    const week = weekOf(now());
    const current = eventAt(now());
    return {
      factor: current.factor,
      origin: eventsOrigin().groups,
      current: eventDto(current),
      next: [1, 2, 3].map((n) => eventDto(eventOfWeek(week + n))),
    };
  });

  const passesOn = () => {
    if (!passes) throw new AppError('gamepass_disabled', 'O GamePass está desligado: o ledger não está ligado.', 503);
    return passes;
  };

  app.get('/v1/gamepass', async (request) => {
    const accountId = request.headers.authorization ? await player(request) : null;
    const season = seasonAt(now());
    const level = season && accountId && passes ? await passes.store.level(accountId, season.code) : 0;
    const perk = perks(season, level);
    return {
      origin: eventsOrigin().seasons,
      season: season ? { code: season.code, label: season.label, starts_at: season.startsAt.toISOString(), ends_at: season.endsAt.toISOString() } : null,
      max_level: season?.maxLevel ?? 0,
      level_price_wei: season ? passPriceWei(season, 1).toString() : '0',
      damage_cut_per_level: season?.damageCutPerLevel ?? 0,
      level,
      damage_cut: perk.damageCut,
      earn_bonus: perk.earnBonus,
      items: (season?.items ?? []).map((i) => itemDto(i, level)),
    };
  });

  // Sobe o GamePass da temporada para `{level}`, pagando só a diferença em SCITY.
  app.post('/v1/gamepass', async (request) => {
    const accountId = await player(request);
    const { level } = z.object({ level: z.number().int() }).parse(request.body);
    const p = passesOn();
    const season = seasonAt(now());
    const current = season ? await p.store.level(accountId, season.code) : 0;
    const { wei } = checkPassUpgrade(current, level, season);
    // A chave é do nível pedido: o clique repetido não cobra de novo.
    await p.payer.chargePass({ key: passKey(season!.code, accountId, level), accountId, wei, season: season!.code }, request.id);
    if (!(await p.store.setLevel(accountId, season!.code, current, level, now()))) {
      throw new AppError('gamepass_conflict', 'Outro pedido mudou o GamePass agora. Tente de novo: a cobrança não se repete.', 409);
    }
    const perk = perks(season, level);
    return { level, wei: wei.toString(), damage_cut: perk.damageCut, earn_bonus: perk.earnBonus, items: perk.items };
  });

  // ---------------------------------------------------------------- corridas e oficina (E3.5)

  const racesOn = () => {
    const v = vehiclesOn();
    if (!v.races) throw new AppError('races_disabled', 'As corridas estão desligadas.', 503);
    return { ...v, races: v.races };
  };
  const raceDeps = () => {
    const v = racesOn();
    return {
      races: v.races,
      payer: v.payer,
      vehicles: v.store,
      updateAvatar: (race: { avatarId: string; accountId: string }, apply: (a: Avatar) => Avatar) =>
        store.updateAvatar(race.avatarId, race.accountId, now(), apply),
    };
  };

  // Corrida do dia: `{avatar_id}` é o piloto (habilitado). Gasolina antes, prêmio do pool P2E.
  app.post('/v1/vehicles/:id/races', async (request, reply) => {
    const car = await ownVehicle(request);
    const { avatar_id } = z.object({ avatar_id: z.uuid() }).parse(request.body);
    const v = racesOn();
    await guardP2E(request, car.accountId, 'race');
    const pilot = await store.get(avatar_id);
    if (!pilot || pilot.accountId !== car.accountId) throw new AppError('not_found', 'Avatar não encontrado.', 404);
    const at = now();
    const fresh = decayed(pilot, at);
    checkRace(car, fresh, await v.races.countToday(fresh.id, dayOf(at)), at);
    const race = newRace({ id: randomUUID(), vehicle: car, avatar: fresh }, at);
    if (!(await v.races.createWithinLimit(race, RACES_PER_DAY))) {
      throw new AppError('race_limit', `Até ${RACES_PER_DAY} corridas por dia para cada piloto.`, 409);
    }
    const done = await settleRace(raceDeps(), race, at, request.id);
    const after = (await store.get(avatar_id))!;
    return reply.status(201).send({
      race: raceDto(done),
      vehicle: vehicleDto((await v.store.get(car.id))!, now()),
      avatar: avatarDto(decayed(after, now()), now()),
      races_left_today: RACES_PER_DAY - (await v.races.countToday(avatar_id, dayOf(at))),
    });
  });

  app.get('/v1/races', async (request) => {
    const accountId = await player(request);
    const v = racesOn();
    // Corridas paradas no meio (ledger fora): termina antes de listar.
    for (const r of (await v.races.listByAccount(accountId, 20)).filter((x) => x.status === 'pending' || x.status === 'charged')) {
      await settleRace(raceDeps(), r, now(), request.id).catch(() => undefined);
    }
    return { races: (await v.races.listByAccount(accountId, 20)).map(raceDto) };
  });

  // Oficina do jogo: conserta a pane em 1, 3 ou 7 dias, pago pelo ledger.
  app.post('/v1/vehicles/:id/repair', async (request) => {
    const car = await ownVehicle(request);
    const v = vehiclesOn();
    if (!isBroken(car, now()) || !car.breakdown || !car.brokenAt) throw new AppError('not_broken', 'O carro não está com pane.', 409);
    if (car.repairUntil) throw new AppError('in_repair', 'O carro já está na oficina.', 409);
    const cents = repairCents(car, car.breakdown, MODELS[car.model].priceCents);
    await v.payer.chargeVehicle(
      { key: `vehicle-repair:${car.id}:${car.brokenAt.toISOString()}`, kind: 'vehicle_repair', accountId: car.accountId, cents, sink: 'workshop', refId: car.id },
      request.id,
    );
    const started = await v.store.startRepair(car.id, car.brokenAt, new Date(now().getTime() + SEVERITIES[car.breakdown].days * 86_400_000));
    // A cobrança tem a chave da pane: tentar de novo não cobra outra vez.
    if (!started) throw new AppError('repair_conflict', 'A oficina não registrou o reparo. Tente de novo: a cobrança não se repete.', 409);
    return { vehicle: vehicleDto((await v.store.get(car.id))!, now()), cents: cents.toString() };
  });

  // Revisão: 30 dias com menos panes.
  app.post('/v1/vehicles/:id/revision', async (request) => {
    const car = await ownVehicle(request);
    const v = vehiclesOn();
    const at = now();
    if (car.revisionUntil && car.revisionUntil > at) throw new AppError('revision_valid', 'A revisão ainda está em dia.', 409);
    const cents = (MODELS[car.model].priceCents * BigInt(REVISION_BPS)) / 10_000n;
    // Uma revisão por carro por dia de pedido: a chave segura o clique repetido.
    await v.payer.chargeVehicle(
      { key: `vehicle-revision:${car.id}:${dayOf(at)}`, kind: 'vehicle_revision', accountId: car.accountId, cents, sink: 'workshop', refId: car.id },
      request.id,
    );
    await v.store.setRevision(car.id, car.revisionUntil, new Date(at.getTime() + REVISION_MS));
    return { vehicle: vehicleDto((await v.store.get(car.id))!, now()), cents: cents.toString() };
  });

  // ---------------------------------------------------------------- campeonato de botão (E3.3)

  const championshipsOn = () => {
    if (!championships) throw new AppError('championships_disabled', 'O campeonato está desligado: o ledger não está ligado.', 503);
    return championships;
  };
  const previousMonth = (month: string) => {
    const [y, m] = month.split('-').map(Number) as [number, number];
    return monthOf(new Date(Date.UTC(y, m - 2, 1)));
  };

  /** O campeonato como a API mostra. Os outros jogadores aparecem só pelo número no time. */
  const championshipDto = async (c: Championship, me: string | null) => {
    const { store: cs } = championshipsOn();
    const [teams, members] = await Promise.all([cs.teams(c.id), cs.members(c.id)]);
    const paid = members.filter((m) => m.status === 'paid');
    const mine = me ? members.find((m) => m.accountId === me) : undefined;
    return {
      id: c.id,
      status: c.status,
      ends_at: c.endsAt.toISOString(),
      seed_commit: c.seedCommit,
      // A semente só aparece depois da disputa (commit-reveal).
      seed: c.status === 'settled' ? c.seed : null,
      entry: ENTRY_CENTS.toString(),
      team_size: TEAM_SIZE,
      pool: paid.reduce((sum, m) => sum + m.feeCents, 0n).toString(),
      teams: teams.map((t) => {
        const n = members.filter((m) => m.teamId === t.id).length;
        return { id: t.id, name: t.name, players: n, full: n >= TEAM_SIZE, mine: mine?.teamId === t.id };
      }),
      me: mine ? { team_id: mine.teamId, avatar_id: mine.avatarId, status: mine.status } : null,
      result: c.result,
    };
  };

  /** Disputa o que venceu e cobra as inscrições paradas. O ledger fora não derruba a leitura. */
  const catchUp = async () => {
    const ch = championshipsOn();
    await settleDue(
      { ...ch, attrsOf: async (id) => {
        const a = await store.get(id);
        return a ? decayed(a, now()).attributes : null;
      } },
      now(),
    ).catch(() => undefined);
  };

  app.get('/v1/championships/current', async (request) => {
    const me = request.headers.authorization ? await player(request) : null;
    const { store: cs } = championshipsOn();
    await catchUp();
    const month = monthOf(now());
    const current = await cs.getOrCreate(month);
    const last = await cs.get(previousMonth(month));
    return {
      rules: { entry: ENTRY_CENTS.toString(), team_size: TEAM_SIZE, prize_share: PRIZE_SHARE_BPS / 10_000, prizes: PRIZE_BPS.map((b) => b / 10_000), min_teams: MIN_TEAMS },
      championship: await championshipDto(current, me),
      last: last ? await championshipDto(last, me) : null,
    };
  });

  app.get('/v1/championships/:month', async (request) => {
    const { month } = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).parse(request.params);
    const me = request.headers.authorization ? await player(request) : null;
    await catchUp();
    const c = await championshipsOn().store.get(month);
    if (!c) throw new AppError('not_found', 'Campeonato não encontrado.', 404);
    return { championship: await championshipDto(c, me) };
  });

  /** O avatar do jogador para a inscrição; de outra conta, 404. */
  const ownAvatarById = async (accountId: string, avatarId: string) => {
    const a = await store.get(avatarId);
    if (!a || a.accountId !== accountId) throw new AppError('not_found', 'Avatar não encontrado.', 404);
    return a;
  };

  /** Inscreve (pendente), cobra e confirma; sem THALER, desfaz. */
  const enroll = async (request: FastifyRequest, register: (m: { accountId: string; avatarId: string; at: Date; championshipId: string }) => Promise<void>) => {
    const accountId = await player(request);
    const { avatar_id } = z.object({ avatar_id: z.uuid() }).passthrough().parse(request.body);
    await ownAvatarById(accountId, avatar_id);
    const ch = championshipsOn();
    const c = await ch.store.getOrCreate(monthOf(now()));
    assertOpen(c, now());
    const at = now();
    await register({ accountId, avatarId: avatar_id, at, championshipId: c.id });
    const member = (await ch.store.members(c.id)).find((m) => m.accountId === accountId)!;
    await settleEntry(ch, member, request.id);
    return championshipDto((await ch.store.get(c.id))!, accountId);
  };

  app.post('/v1/championships/current/teams', async (request, reply) => {
    const { name } = z.object({ name: z.string() }).passthrough().parse(request.body);
    const teamName = checkTeamName(name);
    const out = await enroll(request, async ({ accountId, avatarId, at, championshipId }) => {
      const teamId = randomUUID();
      await championshipsOn().store.createTeam(
        { id: teamId, championshipId, name: teamName, captainAccountId: accountId, createdAt: at },
        { championshipId, teamId, accountId, avatarId, feeCents: ENTRY_CENTS, status: 'pending', joinedAt: at },
      );
    });
    return reply.status(201).send({ championship: out });
  });

  app.post('/v1/championships/current/teams/:teamId/members', async (request, reply) => {
    const { teamId } = z.object({ teamId: z.uuid() }).parse(request.params);
    const out = await enroll(request, ({ accountId, avatarId, at, championshipId }) =>
      championshipsOn().store.addMember({ championshipId, teamId, accountId, avatarId, feeCents: ENTRY_CENTS, status: 'pending', joinedAt: at }),
    );
    return reply.status(201).send({ championship: out });
  });

  app.get('/v1/catalog/pharmacy', async () => ({
    price: MEDICINE_PRICE_CENTS.toString(),
    decimals: 2,
    cure_chance: CURE_CHANCE,
    provisional_price: true,
    conditions: CONDITION_CODES.map((code) => ({
      code,
      label: CONDITIONS[code].label,
      chance: CONDITIONS[code].chance,
      trigger: CONDITIONS[code].trigger,
      hours: CONDITIONS[code].durationMs / 3_600_000,
      blocks_work: CONDITIONS[code].blocksWork,
      yield_factor: CONDITIONS[code].yieldFactor,
      // Grave: a farmácia não cura, só o hospital; tira 1 de saúde a cada 15 min.
      hospital_only: CONDITIONS[code].serious,
    })),
  }));

  app.get('/v1/avatars/:id/meals', async (request) => {
    const avatar = await ownAvatar(request);
    if (mealPayer) await settlePending(avatar.id, request.id).catch(() => undefined);
    return { meals: (await store.listMeals(avatar.id, 20)).map(mealDto) };
  });

  // Coleta: paga pelo ledger cada turno concluído e ainda não coletado.
  app.post('/v1/avatars/:id/claim', async (request) => {
    const avatar = await ownAvatar(request);
    await guardP2E(request, avatar.accountId, 'claim');
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

  /** Grupos de evento e temporadas do GamePass (E3.10). Lista vazia no Strapi não apaga o calendário. */
  const loadEvents = async () => {
    if (!config.CMS_URL) throw new AppError('cms_disabled', 'CMS_URL não está configurado.', 503);
    const [list, seasons] = await Promise.all([fetchCmsEventGroups(config.CMS_URL), fetchCmsSeasons(config.CMS_URL)]);
    if (!list.length) throw new Error('Strapi sem grupos de evento publicados');
    if (!seasons.length) throw new Error('Strapi sem temporadas publicadas');
    replaceEventGroups(list, 'cms');
    replaceSeasons(seasons, 'cms', now());
    return { groups: list.length, seasons: seasons.length };
  };
  app.decorate('loadEvents', loadEvents);

  // Webhook do Strapi (entry.publish): o jogo muda sem deploy (trilha do CMS, passo 6).
  app.post('/internal/v1/catalog/refresh', async (request) => {
    requireServiceToken(request.headers['x-service-token'], config.INTERNAL_TOKEN);
    // O webhook dispara para todo tipo do catálogo; o game-core usa profissões, alimentos, eventos e temporadas.
    const model = (request.body as { model?: unknown } | undefined)?.model;
    const used = ['job', 'food', 'event-group', 'season'];
    if (typeof model === 'string' && !used.includes(model)) return { ignored: model };
    try {
      if (model === 'food') return { foods: await loadFoods(), origin: foodsOrigin() };
      if (model === 'event-group' || model === 'season') return { events: await loadEvents(), origin: eventsOrigin() };
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

  // ---------------------------------------------------------------- antifraude (revisão humana)

  const riskOn = () => {
    if (!riskStore) throw new AppError('risk_disabled', 'O antifraude está desligado.', 503);
    return riskStore;
  };

  // Aparelhos com mais contas que o limite, nos últimos `days` dias (fila da revisão).
  app.get('/internal/v1/risk/devices', async (request) => {
    requireServiceToken(request.headers['x-service-token'], config.INTERNAL_TOKEN);
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }).parse(request.query);
    const since = new Date(now().getTime() - days * 86_400_000);
    const list = await riskOn().sharedDevices(since, DEVICE_ACCOUNT_LIMIT + 1);
    return { limit: DEVICE_ACCOUNT_LIMIT, devices: list.map((d) => ({ device: d.device, accounts: d.accounts })) };
  });

  // Decisão da revisão: `allow` libera a conta mesmo no aparelho cheio; `block` barra os ganhos.
  app.post('/internal/v1/risk/accounts/:accountId', async (request) => {
    requireServiceToken(request.headers['x-service-token'], config.INTERNAL_TOKEN);
    const { accountId } = z.object({ accountId: uuid }).parse(request.params);
    const body = z.object({ decision: z.enum(['allow', 'block']), note: z.string().max(500).optional() }).parse(request.body);
    await riskOn().decide(accountId, body.decision, body.note ?? null, now());
    metrics.inc('risk_decisions_total', 'Decisões da revisão do antifraude.', { decision: body.decision });
    return { account_id: accountId, decision: body.decision };
  });

  return app;
}
