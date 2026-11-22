import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { AppError } from '@scc/shared';

import { profession } from './catalog.js';

/**
 * Eventos semanais por profissão e GamePass da temporada (E3.10; GDD §8, doc 04 §4 e §8).
 *
 * Do GDD e do doc 04:
 * - Toda semana um grupo de profissões recebe bônus, para equilibrar o valor das raridades.
 * - O bônus entra no ganho do turno como `fator_evento_semanal`.
 * - GamePass sazonal com níveis, pago em SCITY (sink): reduz o risco de desastre e dá itens exclusivos.
 *
 * Os grupos de evento e as temporadas moram no Strapi (tipos `event-group` e `season`), com o seed em
 * `cms-strapi/seed/eventos.json` e `temporadas.json`. O seed vale até o Strapi responder, e se ele cair; a
 * publicação no CMS chega pelo webhook, sem deploy. Dado quebrado não entra: o jogo segue com o anterior.
 *
 * Regras fixas do jogo (o CMS não muda):
 * - A semana é a ISO (segunda a domingo, UTC), contada de 16/11/2026. Os grupos se revezam pela ordem, um
 *   por semana, e o nome do evento gira na lista do grupo. O fator vale para o turno que começa na semana.
 * - Itens sazonais (os do GamePass) valem só na temporada: `earn` soma ao ganho do turno, `damage` corta
 *   mais a chance de dano, `cosmetic` só aparece. Tetos: +15% de ganho e 60% de corte de dano.
 */
const WEEK = 7 * 86_400_000;
/** Segunda-feira, 00:00 UTC, de uma semana de referência: as semanas contam a partir dela. */
const EPOCH = Date.UTC(2026, 10, 16);
const WEI = 10n ** 18n;
export const MAX_EARN_BONUS = 0.15;
export const MAX_DAMAGE_CUT = 0.6;
/** Maior nível que uma temporada pode ter (o banco confere o mesmo teto em `game_pass`). */
export const PASS_LEVEL_CAP = 10;

export interface EventGroup {
  code: string;
  label: string;
  order: number;
  factor: number;
  jobs: string[];
  events: string[];
}

export type ItemEffect = 'cosmetic' | 'earn' | 'damage';

export interface SeasonItem {
  level: number;
  code: string;
  label: string;
  effect: ItemEffect;
  value: number;
}

export interface Season {
  code: string;
  label: string;
  startsAt: Date;
  endsAt: Date;
  maxLevel: number;
  /** SCITY por nível (inteiro). */
  levelPriceScity: number;
  damageCutPerLevel: number;
  items: SeasonItem[];
}

// ---------------------------------------------------------------- conferência

const bad = (what: string) => new Error(`Eventos: ${what}`);

/** Confere os grupos: códigos e ordens únicos, fator de 1 a 2, profissões que existem e em um grupo só. */
export function validateEventGroups(list: EventGroup[]): EventGroup[] {
  if (!list.length) throw bad('nenhum grupo de evento');
  const codes = new Set<string>();
  const orders = new Set<number>();
  const jobs = new Map<string, string>();
  for (const g of list) {
    if (codes.has(g.code)) throw bad(`grupo repetido ${g.code}`);
    if (orders.has(g.order)) throw bad(`ordem repetida ${g.order} em ${g.code}`);
    codes.add(g.code);
    orders.add(g.order);
    if (!(g.factor >= 1 && g.factor <= 2)) throw bad(`${g.code}: fator ${g.factor} fora de 1 a 2`);
    if (!g.events.length || g.events.some((e) => typeof e !== 'string' || !e.trim())) throw bad(`${g.code}: sem nomes de evento`);
    if (!g.jobs.length) throw bad(`${g.code}: sem profissões`);
    for (const j of g.jobs) {
      if (!profession(j)) throw bad(`${g.code}: profissão desconhecida ${j}`);
      if (jobs.has(j)) throw bad(`${j} está em ${jobs.get(j)} e em ${g.code}`);
      jobs.set(j, g.code);
    }
  }
  return [...list].sort((a, b) => a.order - b.order);
}

/** Confere as temporadas: datas sem sobreposição, níveis, itens e os tetos dos efeitos. */
export function validateSeasons(list: Season[]): Season[] {
  const sorted = [...list].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const codes = new Set<string>();
  for (const [i, s] of sorted.entries()) {
    if (codes.has(s.code)) throw bad(`temporada repetida ${s.code}`);
    codes.add(s.code);
    if (Number.isNaN(s.startsAt.getTime()) || Number.isNaN(s.endsAt.getTime()) || s.endsAt <= s.startsAt) {
      throw bad(`${s.code}: datas inválidas`);
    }
    const prev = sorted[i - 1];
    if (prev && s.startsAt < prev.endsAt) throw bad(`${s.code} começa antes de ${prev.code} acabar`);
    if (!Number.isInteger(s.maxLevel) || s.maxLevel < 1 || s.maxLevel > PASS_LEVEL_CAP) throw bad(`${s.code}: nível máximo inválido`);
    if (!Number.isInteger(s.levelPriceScity) || s.levelPriceScity < 1) throw bad(`${s.code}: preço por nível inválido`);
    if (!(s.damageCutPerLevel >= 0 && s.damageCutPerLevel <= 0.1)) throw bad(`${s.code}: corte por nível fora de 0 a 0,1`);
    const items = new Set<string>();
    for (const it of s.items) {
      if (items.has(it.code)) throw bad(`${s.code}: item repetido ${it.code}`);
      items.add(it.code);
      if (!Number.isInteger(it.level) || it.level < 1 || it.level > s.maxLevel) throw bad(`${s.code}: ${it.code} fora dos níveis`);
      if (!['cosmetic', 'earn', 'damage'].includes(it.effect)) throw bad(`${s.code}: efeito desconhecido em ${it.code}`);
      if (!(it.value >= 0 && it.value <= MAX_EARN_BONUS)) throw bad(`${s.code}: valor de ${it.code} fora de 0 a 0,15`);
    }
    // Sem os tetos de `perks`: a soma crua de tudo no nível máximo.
    const total = (effect: ItemEffect) => s.items.filter((i) => i.effect === effect).reduce((sum, i) => sum + i.value, 0);
    if (total('earn') > MAX_EARN_BONUS + 1e-9) throw bad(`${s.code}: itens somam mais de 15% de ganho`);
    if (s.maxLevel * s.damageCutPerLevel + total('damage') > MAX_DAMAGE_CUT + 1e-9) {
      throw bad(`${s.code}: corte de dano passa de 60%`);
    }
  }
  return sorted;
}

// ---------------------------------------------------------------- seed e troca

const seedFile = (name: string) => new URL(`../../../../cms-strapi/seed/${name}`, import.meta.url);

type RawSeason = Omit<Season, 'startsAt' | 'endsAt'> & { startsAt: string; endsAt: string };
export const parseSeasons = (raw: RawSeason[]): Season[] =>
  raw.map((s) => ({
    code: s.code,
    label: s.label,
    startsAt: new Date(s.startsAt),
    endsAt: new Date(s.endsAt),
    maxLevel: Number(s.maxLevel),
    levelPriceScity: Number(s.levelPriceScity),
    damageCutPerLevel: Number(s.damageCutPerLevel),
    items: (s.items ?? []).map((i) => ({ level: Number(i.level), code: i.code, label: i.label, effect: i.effect, value: Number(i.value) })),
  }));

export const SEED_EVENT_GROUPS = validateEventGroups(
  (JSON.parse(readFileSync(process.env.EVENTS_FILE ?? seedFile('eventos.json'), 'utf8')) as { grupos: EventGroup[] }).grupos,
);
export const SEED_SEASONS = validateSeasons(
  parseSeasons(
    (JSON.parse(readFileSync(process.env.SEASONS_FILE ?? seedFile('temporadas.json'), 'utf8')) as { temporadas: RawSeason[] }).temporadas,
  ),
);

let groups = SEED_EVENT_GROUPS;
let seasons = SEED_SEASONS;
let groupsFrom: 'seed' | 'cms' = 'seed';
let seasonsFrom: 'seed' | 'cms' = 'seed';

export function replaceEventGroups(list: EventGroup[], from: 'seed' | 'cms') {
  groups = validateEventGroups(list);
  groupsFrom = from;
}

/** Temporada aberta não some nem muda de código: quem pagou o GamePass dela perderia o nível. */
export function replaceSeasons(list: Season[], from: 'seed' | 'cms', now: Date = new Date()) {
  const next = validateSeasons(list);
  const open = seasonAt(now);
  if (open && !next.some((s) => s.code === open.code && s.startsAt <= now && now < s.endsAt)) {
    throw bad(`a temporada aberta ${open.code} sumiu ou mudou de datas`);
  }
  seasons = next;
  seasonsFrom = from;
}

export const eventGroups = () => groups;
export const seasonList = () => seasons;
export const eventsOrigin = () => ({ groups: groupsFrom, seasons: seasonsFrom });

// ---------------------------------------------------------------- evento da semana

export interface WeeklyEvent {
  /** Semana desde a referência (0 = 16/11/2026). */
  week: number;
  group: string;
  groupLabel: string;
  name: string;
  jobs: readonly string[];
  factor: number;
  startsAt: Date;
  endsAt: Date;
}

export const weekOf = (now: Date) => Math.floor((now.getTime() - EPOCH) / WEEK);

/** O evento de uma semana: os grupos se revezam pela ordem; o nome gira na lista do grupo. */
export function eventOfWeek(week: number): WeeklyEvent {
  const n = groups.length;
  const g = groups[((week % n) + n) % n]!;
  const round = Math.floor(week / n);
  const names = g.events;
  return {
    week,
    group: g.code,
    groupLabel: g.label,
    name: names[((round % names.length) + names.length) % names.length]!,
    jobs: g.jobs,
    factor: g.factor,
    startsAt: new Date(EPOCH + week * WEEK),
    endsAt: new Date(EPOCH + (week + 1) * WEEK),
  };
}

export const eventAt = (now: Date) => eventOfWeek(weekOf(now));

/** Fator do evento para a profissão agora (1 fora do evento). */
export const eventFactor = (jobCode: string, now: Date) => {
  const e = eventAt(now);
  return e.jobs.includes(jobCode) ? e.factor : 1;
};

export const eventDto = (e: WeeklyEvent) => ({
  week: e.week,
  group: e.group,
  group_label: e.groupLabel,
  name: e.name,
  jobs: e.jobs,
  factor: e.factor,
  starts_at: e.startsAt.toISOString(),
  ends_at: e.endsAt.toISOString(),
});

// ---------------------------------------------------------------- GamePass

export const seasonAt = (now: Date) => seasons.find((s) => s.startsAt <= now && now < s.endsAt) ?? null;

export const passPriceWei = (season: Season, level: number) => BigInt(level) * BigInt(season.levelPriceScity) * WEI;

/** O que o nível dá na temporada: corte de dano (níveis + itens) e bônus de ganho dos itens, com os tetos. */
export function perks(season: Season | null, level: number) {
  if (!season || level <= 0) return { damageCut: 0, earnBonus: 0, items: [] as SeasonItem[] };
  const lvl = Math.min(season.maxLevel, level);
  const items = season.items.filter((i) => i.level <= lvl);
  const sum = (effect: ItemEffect) => items.filter((i) => i.effect === effect).reduce((s, i) => s + i.value, 0);
  const round = (x: number) => Math.round(x * 10_000) / 10_000;
  return {
    damageCut: round(Math.min(MAX_DAMAGE_CUT, lvl * season.damageCutPerLevel + sum('damage'))),
    earnBonus: round(Math.min(MAX_EARN_BONUS, sum('earn'))),
    items,
  };
}

/** Confere a subida de nível e devolve quanto cobrar (só a diferença). */
export function checkPassUpgrade(current: number, target: number, season: Season | null) {
  if (!season) throw new AppError('no_season', 'Não há temporada aberta agora.', 409);
  if (!Number.isInteger(target) || target < 1 || target > season.maxLevel) {
    throw new AppError('invalid_level', `O GamePass vai do nível 1 ao ${season.maxLevel}.`, 400);
  }
  if (target <= current) throw new AppError('level_owned', `Você já tem o nível ${current}.`, 409);
  return { wei: passPriceWei(season, target) - passPriceWei(season, current) };
}

export const itemDto = (i: SeasonItem, level: number) => ({ ...i, unlocked: i.level <= level });

export interface GamePassStore {
  level(accountId: string, season: string): Promise<number>;
  /** Sobe para `level` se o atual ainda for `expected`. */
  setLevel(accountId: string, season: string, expected: number, level: number, now: Date): Promise<boolean>;
}

/** Quem cobra o GamePass: SCITY do jogador para a queima. Chave `gamepass:<temporada>:<conta>:<nível>`. */
export interface GamePassPayer {
  chargePass(input: { key: string; accountId: string; wei: bigint; season: string }, requestId?: string): Promise<void>;
}

/** A chave do sorteio do dano não muda com o GamePass: só o limite da chance. */
export const passKey = (season: string, accountId: string, level: number) =>
  `gamepass:${season}:${createHash('sha256').update(accountId).digest('hex').slice(0, 16)}:${level}`;
