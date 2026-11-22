import { createHmac, randomBytes } from 'node:crypto';

import { AppError } from '@scc/shared';

import { type Livestock, livestockFromJson, livestockToJson } from './livestock.js';

/**
 * Fazenda: agricultura (E3.4, GDD §6 "Fazenda" e §7 "Alimentos"). A pecuária vem no próximo passo.
 *
 * Do GDD:
 * - A fazenda só existe na zona rural (região A3), num slot de 4 lotes com a casa, vendido pela
 *   Prefeitura.
 * - As estações mudam a cada 7 dias, com produção de verão > primavera > outono > inverno.
 * - Níveis 1 a 3: subir exige pelo menos 3 colheitas e um pagamento. Cada nível libera culturas:
 *   - nível 1: uva e morango (frutas), tomate e cenoura (grãos e legumes);
 *   - nível 2: mais laranja, beterraba e milho;
 *   - nível 3: mais maçã, trigo e batata.
 * - Arar exige enxada e um agricultor (próprio ou contratado), e repete depois de cada colheita.
 * - Riscos e proteções:
 *   - colheita apodrece: 5%;
 *   - pássaros ou doença nas frutas: 5%, com agrotóxico −20% da chance;
 *   - corvos nos grãos: espantalho −50%;
 *   - coelhos: 3%, com cão de pastoreio −50% do dano;
 *   - colheita não colhida perde 5% por dia, e o drone avisa quando está pronta.
 * - Aceleradores: irrigador, drone e separador de sementes (+20% de germinação).
 *
 * Como funciona aqui:
 * - A região A3 ainda não existe no mapa. A fazenda é um slot da conta comprado da Prefeitura, com 4
 *   canteiros (um por lote). Ela ganha lugar no mapa quando a região abrir.
 * - A colheita vai para a despensa de um avatar da conta, como unidades do alimento do catálogo.
 * - Os riscos são sorteados na hora do plantio, com uma semente que fica no canteiro e aparece depois
 *   da colheita.
 *
 * PREMISSAS desta etapa, a calibrar no simulador:
 * - Slot de 10.000 THALER. Níveis 2 e 3 por 5.000 e 10.000. Sementes de 5 THALER por canteiro.
 *   Aragem contratada de 10 THALER; com o próprio agricultor (agricultor, fazendeiro ou agrônomo), custa
 *   1 de energia.
 * - Crescimento de 1 dia (nível 1), 2 dias (nível 2) e 3 dias (nível 3); o irrigador corta 25%.
 * - Cada canteiro dá 10 unidades no verão, × 0,85 na primavera, 0,7 no outono e 0,5 no inverno, e
 *   +20% com o separador de sementes.
 * - Os ciclos de estação contam de 16/11/2026, na ordem verão, outono, inverno, primavera.
 * - Dano: apodrecer perde tudo; pássaros e corvos levam 50%; coelhos levam 30% (15% com o cão).
 *   Os corvos têm 5% de chance (o GDD não dá o número).
 * - A perda de 5% por dia sem colher só começa um dia depois de pronta, e o drone corta a perda pela
 *   metade.
 * - Máquinas, de uma vez e para sempre: enxada 50, irrigador 400, separador 300, drone 500,
 *   agrotóxico 100, espantalho 80, cão de pastoreio 300.
 * - O dinheiro vai para a queima (sinks da fazenda, doc 04 §7).
 */
const DAY = 86_400_000;
const EPOCH = Date.UTC(2026, 10, 16);
export const PLOTS = 4;
export const FARM_CENTS = 1_000_000n;
export const LEVEL_CENTS: Record<number, bigint> = { 2: 500_000n, 3: 1_000_000n };
export const HARVESTS_TO_LEVEL = 3;
export const SEED_CENTS = 500n;
export const HIRED_PLOW_CENTS = 1000n;
export const OWN_PLOW_ENERGY = 1;
export const FARMER_JOBS = ['agricultor', 'fazendeiro', 'agronomo'] as const;
export const BASE_UNITS = 10;
export const IRRIGATION_CUT = 0.25;
export const SEPARATOR_BONUS = 0.2;
export const ROT_CHANCE = 0.05;
export const BIRDS_CHANCE = 0.05;
export const CROWS_CHANCE = 0.05;
export const RABBITS_CHANCE = 0.03;
export const UNHARVESTED_LOSS_PER_DAY = 0.05;

export const SEASONS = [
  { code: 'verao', label: 'Verão', factor: 1 },
  { code: 'outono', label: 'Outono', factor: 0.7 },
  { code: 'inverno', label: 'Inverno', factor: 0.5 },
  { code: 'primavera', label: 'Primavera', factor: 0.85 },
] as const;

export const seasonAt = (now: Date) => {
  const n = Math.floor((now.getTime() - EPOCH) / (7 * DAY));
  const s = SEASONS[((n % SEASONS.length) + SEASONS.length) % SEASONS.length]!;
  return { ...s, startsAt: new Date(EPOCH + n * 7 * DAY), endsAt: new Date(EPOCH + (n + 1) * 7 * DAY) };
};

export const CROPS = {
  uva: { kind: 'fruta', level: 1 },
  morango: { kind: 'fruta', level: 1 },
  tomate: { kind: 'grao', level: 1 },
  cenoura: { kind: 'grao', level: 1 },
  laranja: { kind: 'fruta', level: 2 },
  beterraba: { kind: 'grao', level: 2 },
  milho: { kind: 'grao', level: 2 },
  maca: { kind: 'fruta', level: 3 },
  trigo: { kind: 'grao', level: 3 },
  batata: { kind: 'grao', level: 3 },
} as const;
export type CropCode = keyof typeof CROPS;
export const isCrop = (s: string): s is CropCode => s in CROPS;

export const MACHINES = {
  enxada: { label: 'Enxada', cents: 5_000n },
  irrigador: { label: 'Irrigador', cents: 40_000n },
  separador: { label: 'Separador de sementes', cents: 30_000n },
  drone: { label: 'Drone', cents: 50_000n },
  agrotoxico: { label: 'Agrotóxico', cents: 10_000n },
  espantalho: { label: 'Espantalho', cents: 8_000n },
  cao: { label: 'Cão de pastoreio', cents: 30_000n },
} as const;
export type MachineCode = keyof typeof MACHINES;
export const isMachine = (s: string): s is MachineCode => s in MACHINES;

export type Damage = 'apodreceu' | 'passaros' | 'corvos' | 'coelhos';

export interface Planting {
  crop: CropCode;
  plantedAt: Date;
  readyAt: Date;
  seed: string;
  /** Unidades se colher na hora em que fica pronta (já com estação, separador e dano). */
  units: number;
  damage: Damage | null;
}

export interface Plot {
  /** Conta as colheitas do canteiro: entra nas chaves do ledger. */
  cycle: number;
  plowed: boolean;
  planting: Planting | null;
}

export interface Farm {
  accountId: string;
  level: number;
  /** Colheitas no nível atual: 3 liberam a subida. */
  harvestsAtLevel: number;
  harvestsTotal: number;
  machines: MachineCode[];
  plots: Plot[];
  boughtAt: Date;
  /** Trava otimista: cada gravação sobe 1. */
  version: number;
  /** Pecuária (galinheiro, chiqueiro, pasto e os animais); null antes da primeira estrutura. */
  livestock?: Livestock | null;
}

export function newFarm(accountId: string, now: Date): Farm {
  return {
    accountId,
    level: 1,
    harvestsAtLevel: 0,
    harvestsTotal: 0,
    machines: [],
    plots: Array.from({ length: PLOTS }, () => ({ cycle: 0, plowed: false, planting: null })),
    boughtAt: now,
    version: 0,
  };
}

const draw = (seed: string, label: string) =>
  createHmac('sha256', Buffer.from(seed, 'hex')).update(label).digest().readUInt32BE(0) / 2 ** 32;

/** Plantio: crescimento, unidades e dano, sorteados pela semente. */
export function plan(farm: Farm, crop: CropCode, now: Date, seed = randomBytes(32).toString('hex')): Planting {
  const c = CROPS[crop];
  const has = (m: MachineCode) => farm.machines.includes(m);
  const growDays = c.level * (has('irrigador') ? 1 - IRRIGATION_CUT : 1);
  let units = BASE_UNITS * seasonAt(now).factor * (has('separador') ? 1 + SEPARATOR_BONUS : 1);
  let damage: Damage | null = null;
  if (draw(seed, 'apodrece') < ROT_CHANCE) {
    damage = 'apodreceu';
    units = 0;
  } else if (c.kind === 'fruta' && draw(seed, 'passaros') < BIRDS_CHANCE * (has('agrotoxico') ? 0.8 : 1)) {
    damage = 'passaros';
    units *= 0.5;
  } else if (c.kind === 'grao' && draw(seed, 'corvos') < CROWS_CHANCE * (has('espantalho') ? 0.5 : 1)) {
    damage = 'corvos';
    units *= 0.5;
  } else if (draw(seed, 'coelhos') < RABBITS_CHANCE) {
    damage = 'coelhos';
    units *= has('cao') ? 0.85 : 0.7;
  }
  return { crop, plantedAt: now, readyAt: new Date(now.getTime() + growDays * DAY), seed, units: Math.floor(units), damage };
}

/** Unidades se colher agora: depois de 1 dia pronta, perde 5% por dia (metade com o drone). */
export function unitsNow(farm: Pick<Farm, 'machines'>, p: Planting, now: Date) {
  if (now < p.readyAt) return 0;
  const lateDays = Math.max(0, Math.floor((now.getTime() - p.readyAt.getTime()) / DAY) - 1);
  const perDay = UNHARVESTED_LOSS_PER_DAY * (farm.machines.includes('drone') ? 0.5 : 1);
  return Math.floor(p.units * Math.max(0, 1 - perDay * lateDays));
}

const plotOf = (farm: Farm, i: number) => {
  const p = farm.plots[i];
  if (!p) throw new AppError('invalid_plot', `Canteiro de 1 a ${PLOTS}.`, 400);
  return p;
};
const withPlot = (farm: Farm, i: number, plot: Plot): Farm => ({ ...farm, plots: farm.plots.map((p, k) => (k === i ? plot : p)) });

/** Arar: precisa da enxada; o canteiro vazio, sem plantio. */
export function checkPlow(farm: Farm, i: number) {
  const p = plotOf(farm, i);
  if (!farm.machines.includes('enxada')) throw new AppError('needs_hoe', 'Arar precisa de enxada. Compre na loja da fazenda.', 409);
  if (p.planting) throw new AppError('plot_busy', 'O canteiro está plantado.', 409);
  if (p.plowed) throw new AppError('already_plowed', 'O canteiro já está arado.', 409);
  return p;
}
export const applyPlow = (farm: Farm, i: number) => withPlot(farm, i, { ...plotOf(farm, i), plowed: true });

export function checkPlant(farm: Farm, i: number, crop: string) {
  const p = plotOf(farm, i);
  if (!isCrop(crop)) throw new AppError('invalid_crop', 'Cultura desconhecida.', 400);
  if (CROPS[crop].level > farm.level) throw new AppError('crop_locked', `Esta cultura abre no nível ${CROPS[crop].level} da fazenda.`, 409);
  if (p.planting) throw new AppError('plot_busy', 'O canteiro já está plantado.', 409);
  if (!p.plowed) throw new AppError('not_plowed', 'Are o canteiro antes de plantar.', 409);
  return p;
}
export const applyPlant = (farm: Farm, i: number, planting: Planting) => withPlot(farm, i, { ...plotOf(farm, i), plowed: false, planting });

export function checkHarvest(farm: Farm, i: number, now: Date) {
  const p = plotOf(farm, i);
  if (!p.planting) throw new AppError('nothing_planted', 'O canteiro não tem plantio.', 409);
  if (now < p.planting.readyAt) throw new AppError('not_ready', 'A colheita ainda não está pronta.', 409);
  return { plot: p, planting: p.planting, units: unitsNow(farm, p.planting, now) };
}
export const applyHarvest = (farm: Farm, i: number): Farm => {
  const p = plotOf(farm, i);
  return {
    ...withPlot(farm, i, { cycle: p.cycle + 1, plowed: false, planting: null }),
    harvestsAtLevel: farm.harvestsAtLevel + 1,
    harvestsTotal: farm.harvestsTotal + 1,
  };
};

export function checkLevelUp(farm: Farm) {
  if (farm.level >= 3) throw new AppError('max_level', 'A fazenda já está no nível 3.', 409);
  if (farm.harvestsAtLevel < HARVESTS_TO_LEVEL) {
    throw new AppError('needs_harvests', `Subir de nível exige ${HARVESTS_TO_LEVEL} colheitas neste nível (tem ${farm.harvestsAtLevel}).`, 409);
  }
  return { cents: LEVEL_CENTS[farm.level + 1]!, to: farm.level + 1 };
}
export const applyLevelUp = (farm: Farm): Farm => ({ ...farm, level: farm.level + 1, harvestsAtLevel: 0 });

export function checkMachine(farm: Farm, code: string) {
  if (!isMachine(code)) throw new AppError('invalid_machine', 'Máquina desconhecida.', 400);
  if (farm.machines.includes(code)) throw new AppError('machine_owned', 'A fazenda já tem esta máquina.', 409);
  return { cents: MACHINES[code].cents, code };
}
export const applyMachine = (farm: Farm, code: MachineCode): Farm => ({ ...farm, machines: [...farm.machines, code] });

export interface FarmStore {
  get(accountId: string): Promise<Farm | null>;
  /** Cria; false se a conta já tem fazenda. */
  create(farm: Farm): Promise<boolean>;
  /** Grava se a versão ainda for `farm.version` e sobe a versão. */
  save(farm: Farm): Promise<boolean>;
}

/** Cobranças da fazenda: THALER do jogador para a queima `burn/farm`, com a chave da operação. */
export interface FarmPayer {
  chargeFarm(input: { key: string; kind: string; accountId: string; cents: bigint }, requestId?: string): Promise<void>;
}

export function farmDto(farm: Farm, now: Date) {
  const season = seasonAt(now);
  return {
    level: farm.level,
    harvests_at_level: farm.harvestsAtLevel,
    harvests_total: farm.harvestsTotal,
    can_level_up: farm.level < 3 && farm.harvestsAtLevel >= HARVESTS_TO_LEVEL,
    level_up_cents: farm.level < 3 ? LEVEL_CENTS[farm.level + 1]!.toString() : null,
    machines: farm.machines,
    season: { code: season.code, label: season.label, factor: season.factor, ends_at: season.endsAt.toISOString() },
    crops: Object.entries(CROPS)
      .filter(([, c]) => c.level <= farm.level)
      .map(([code, c]) => ({ code, kind: c.kind, days: c.level * (farm.machines.includes('irrigador') ? 1 - IRRIGATION_CUT : 1) })),
    plots: farm.plots.map((p, i) => {
      const ready = !!p.planting && p.planting.readyAt <= now;
      return {
        index: i,
        plowed: p.plowed,
        crop: p.planting?.crop ?? null,
        ready_at: p.planting?.readyAt.toISOString() ?? null,
        ready,
        // As unidades e o dano só aparecem com a colheita pronta (o drone avisa).
        units_now: ready ? unitsNow(farm, p.planting!, now) : null,
        damage: ready ? p.planting!.damage : null,
      };
    }),
  };
}

export const farmToJson = (f: Farm) => ({
  machines: f.machines,
  livestock: livestockToJson(f.livestock),
  plots: f.plots.map((p) => ({
    cycle: p.cycle,
    plowed: p.plowed,
    planting: p.planting ? { ...p.planting, plantedAt: p.planting.plantedAt.toISOString(), readyAt: p.planting.readyAt.toISOString() } : null,
  })),
});

export function farmFromJson(v: { machines?: string[]; plots?: unknown[]; livestock?: unknown }): Pick<Farm, 'machines' | 'plots' | 'livestock'> {
  return {
    livestock: livestockFromJson(v.livestock),
    machines: (v.machines ?? []).filter(isMachine),
    plots: (v.plots ?? []).map((raw) => {
      const p = raw as { cycle: number; plowed: boolean; planting: (Omit<Planting, 'plantedAt' | 'readyAt'> & { plantedAt: string; readyAt: string }) | null };
      return {
        cycle: p.cycle,
        plowed: p.plowed,
        planting: p.planting ? { ...p.planting, plantedAt: new Date(p.planting.plantedAt), readyAt: new Date(p.planting.readyAt) } : null,
      };
    }),
  };
}
