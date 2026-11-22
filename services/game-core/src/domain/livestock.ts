import { createHmac, randomBytes, randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';

import type { Farm } from './farm.js';

/**
 * Pecuária (E3.4, GDD §6 "Pecuária" e "Riscos e proteções").
 *
 * Do GDD:
 * - Galinhas no galinheiro: no máximo 12, com 1 galo para 12 galinhas e limpeza a cada 5 dias por 30
 *   THALER.
 * - Porcos no chiqueiro (80 THALER): morrem com 3 dias sem comida.
 * - Gado de corte e de leite no pasto com curral e comedouro: no máximo 15, intervalo de 3 dias,
 *   vida útil de 45 dias.
 * - O animal vira adulto depois de alimentado 3 vezes; o abate antes disso não dá item.
 * - Reprodução com trigo ou milho. Níveis do animal: 1 a 3, com +0, +10 e +20% de itens.
 * - Chocadeira: 3% de chance de galinha dos ovos de ouro (2× eficiência).
 * - Riscos:
 *   - febre aftosa (gado): 3%, mata 25%;
 *   - raposas (galinheiro com mais de 4 galinhas): 3%, mata 50%, e o cão de pastoreio protege;
 *   - gripe aviária: 3%, −25% de ovos.
 *
 * PREMISSAS desta etapa, a calibrar no simulador:
 * - Estruturas e preços em THALER:
 *   - galinheiro 300;
 *   - chiqueiro 80 (do GDD);
 *   - pasto com curral 600 e comedouro 200 (o gado precisa dos dois);
 *   - chocadeira 250.
 * - Animais: galinha 20, galo 25, leitão 60, bezerro de corte 150, bezerra de leite 180. No máximo 6
 *   porcos.
 * - Alimentar: 1 unidade de milho ou trigo da despensa do avatar, uma vez por dia por animal. O nível
 *   sobe com 10 e 20 alimentações.
 * - Produção, guardada até coletar (no máximo 3 dias):
 *   - galinha adulta: 1 ovo por dia alimentada, com o galinheiro limpo;
 *   - vaca de leite adulta: 1 leite a cada 3 dias ("intervalo de 3 dias").
 * - Abate de adulto em carne crua: galinha 1, porco 3, boi 6.
 * - Reprodução: casal adulto (galo e galinha, dois porcos, dois do gado) e 1 trigo ou milho dão um
 *   filhote. O mesmo casal espera 3 dias.
 * - Chocadeira: transforma 1 ovo da despensa num pinto (3% de ser dos ovos de ouro).
 * - Os riscos são sorteados uma vez por dia (UTC) com a semente da fazenda. A raposa respeita o cão; a
 *   gripe corta 25% dos ovos daquele dia.
 * - Porco 3 dias sem comida morre; boi e vaca morrem aos 45 dias de vida.
 */
const DAY = 86_400_000;

export const STRUCTURES = {
  galinheiro: { label: 'Galinheiro', cents: 30_000n },
  chiqueiro: { label: 'Chiqueiro', cents: 8_000n },
  pasto: { label: 'Pasto com curral', cents: 60_000n },
  comedouro: { label: 'Comedouro', cents: 20_000n },
  chocadeira: { label: 'Chocadeira', cents: 25_000n },
} as const;
export type StructureCode = keyof typeof STRUCTURES;
export const isStructure = (s: string): s is StructureCode => s in STRUCTURES;

export const BREEDS = {
  galinha: { label: 'Galinha', species: 'ave', cents: 2_000n, needs: ['galinheiro'], meat: 1 },
  galo: { label: 'Galo', species: 'ave', cents: 2_500n, needs: ['galinheiro'], meat: 1 },
  porco: { label: 'Porco', species: 'porco', cents: 6_000n, needs: ['chiqueiro'], meat: 3 },
  boi: { label: 'Boi de corte', species: 'gado', cents: 15_000n, needs: ['pasto', 'comedouro'], meat: 6 },
  vaca: { label: 'Vaca de leite', species: 'gado', cents: 18_000n, needs: ['pasto', 'comedouro'], meat: 6 },
} as const;
export type Breed = keyof typeof BREEDS;
export const isBreed = (s: string): s is Breed => s in BREEDS;

export const MAX_HENS = 12;
export const HENS_PER_ROOSTER = 12;
export const MAX_PIGS = 6;
export const MAX_CATTLE = 15;
export const ADULT_FEEDS = 3;
export const LEVEL_FEEDS = [0, 10, 20] as const;
export const LEVEL_BONUS = [0, 0.1, 0.2] as const;
export const FEED_FOODS = ['milho', 'trigo'] as const;
export const PIG_STARVE_MS = 3 * DAY;
export const CATTLE_LIFE_MS = 45 * DAY;
export const BREED_INTERVAL_MS = 3 * DAY;
export const MILK_EVERY_MS = 3 * DAY;
export const COOP_CLEAN_MS = 5 * DAY;
export const COOP_CLEAN_CENTS = 3_000n;
export const STORE_DAYS = 3;
export const GOLDEN_CHANCE = 0.03;
export const RISKS = { aftosa: 0.03, raposas: 0.03, gripe: 0.03 } as const;

export interface Animal {
  id: string;
  breed: Breed;
  bornAt: Date;
  feeds: number;
  lastFedAt: Date | null;
  /** Galinha dos ovos de ouro: produz em dobro. */
  golden: boolean;
  /** Último filhote do casal: espera 3 dias. */
  lastBredAt: Date | null;
  /** Produção guardada até a coleta (ovos ou leite) e até quando ela foi contada. */
  stock: number;
  producedUntil: Date;
}

export interface Livestock {
  structures: StructureCode[];
  animals: Animal[];
  coopCleanedAt: Date | null;
  /** Semente dos riscos diários e o último dia (UTC) já sorteado. */
  seed: string;
  riskDay: number;
  /** O que aconteceu nos riscos e nas mortes, para a tela. */
  log: { at: Date; text: string }[];
  /** Animais comprados até hoje: entra na chave da cobrança (repetir não cobra outra vez). */
  bought: number;
}

export const emptyLivestock = (now: Date): Livestock => ({
  structures: [],
  animals: [],
  coopCleanedAt: null,
  seed: randomBytes(32).toString('hex'),
  riskDay: Math.floor(now.getTime() / DAY),
  log: [],
  bought: 0,
});

export const levelOf = (a: Pick<Animal, 'feeds'>) => (a.feeds >= LEVEL_FEEDS[2] ? 3 : a.feeds >= LEVEL_FEEDS[1] ? 2 : 1);
export const isAdult = (a: Pick<Animal, 'feeds'>) => a.feeds >= ADULT_FEEDS;
const fedWithin = (a: Animal, now: Date, ms: number) => !!a.lastFedAt && now.getTime() - a.lastFedAt.getTime() < ms;
const countBreed = (l: Livestock, breeds: Breed[]) => l.animals.filter((a) => breeds.includes(a.breed)).length;

const draw = (seed: string, label: string) =>
  createHmac('sha256', Buffer.from(seed, 'hex')).update(label).digest().readUInt32BE(0) / 2 ** 32;

/** O galinheiro está limpo? A limpeza vale 5 dias; o galinheiro novo nasce limpo. */
export const coopClean = (l: Livestock, now: Date) => !!l.coopCleanedAt && now.getTime() - l.coopCleanedAt.getTime() < COOP_CLEAN_MS;

/**
 * O rebanho até agora: produção do tempo passado (com galinheiro limpo e animal alimentado), mortes por
 * fome e por idade, e os riscos de cada dia ainda não sorteado. Puro: quem grava é a rota.
 */
export function advance(l: Livestock, hasDog: boolean, now: Date): Livestock {
  const log = [...l.log];
  // 1. Produção até agora, dia a dia, só com o animal alimentado nas últimas 24 h daquele dia.
  let animals = l.animals.map((a) => {
    if (!isAdult(a) || (a.breed !== 'galinha' && a.breed !== 'vaca')) return { ...a, producedUntil: now };
    const every = a.breed === 'galinha' ? DAY : MILK_EVERY_MS;
    const cap = a.breed === 'galinha' ? STORE_DAYS * (a.golden ? 2 : 1) : STORE_DAYS;
    let stock = a.stock;
    let t = a.producedUntil.getTime();
    while (t + every <= now.getTime()) {
      t += every;
      const fed = !!a.lastFedAt && a.lastFedAt.getTime() > t - every - DAY;
      const clean = a.breed !== 'galinha' || (!!l.coopCleanedAt && t - l.coopCleanedAt.getTime() < COOP_CLEAN_MS);
      if (fed && clean) stock = Math.min(cap, stock + (a.golden ? 2 : 1));
    }
    return { ...a, stock, producedUntil: new Date(t) };
  });
  // 2. Mortes: porco 3 dias sem comida, gado aos 45 dias.
  animals = animals.filter((a) => {
    if (a.breed === 'porco' && now.getTime() - (a.lastFedAt ?? a.bornAt).getTime() >= PIG_STARVE_MS) {
      log.push({ at: now, text: 'Um porco morreu de fome (3 dias sem comida).' });
      return false;
    }
    if (BREEDS[a.breed].species === 'gado' && now.getTime() - a.bornAt.getTime() >= CATTLE_LIFE_MS) {
      log.push({ at: now, text: `${BREEDS[a.breed].label} chegou ao fim da vida útil (45 dias).` });
      return false;
    }
    return true;
  });
  // 3. Riscos de cada dia novo.
  const today = Math.floor(now.getTime() / DAY);
  for (let d = l.riskDay + 1; d <= today; d++) {
    const cattle = animals.filter((a) => BREEDS[a.breed].species === 'gado');
    if (cattle.length && draw(l.seed, `aftosa:${d}`) < RISKS.aftosa) {
      const dead = new Set(cattle.slice(0, Math.max(1, Math.floor(cattle.length * 0.25))).map((a) => a.id));
      animals = animals.filter((a) => !dead.has(a.id));
      log.push({ at: new Date(d * DAY), text: `Febre aftosa: ${dead.size} do gado morreram.` });
    }
    const hens = animals.filter((a) => a.breed === 'galinha');
    if (hens.length > 4 && draw(l.seed, `raposas:${d}`) < RISKS.raposas) {
      if (hasDog) log.push({ at: new Date(d * DAY), text: 'Raposas rondaram o galinheiro; o cão espantou.' });
      else {
        const dead = new Set(hens.slice(0, Math.floor(hens.length * 0.5)).map((a) => a.id));
        animals = animals.filter((a) => !dead.has(a.id));
        log.push({ at: new Date(d * DAY), text: `Raposas: ${dead.size} galinhas mortas.` });
      }
    }
    if (draw(l.seed, `gripe:${d}`) < RISKS.gripe) {
      animals = animals.map((a) => (a.breed === 'galinha' ? { ...a, stock: Math.floor(a.stock * 0.75) } : a));
      log.push({ at: new Date(d * DAY), text: 'Gripe aviária: −25% dos ovos guardados.' });
    }
  }
  return { ...l, animals, riskDay: Math.max(l.riskDay, today), log: log.slice(-10) };
}

// ---------------------------------------------------------------- ações

export function checkStructure(l: Livestock, code: string) {
  if (!isStructure(code)) throw new AppError('invalid_structure', 'Estrutura desconhecida.', 400);
  if (l.structures.includes(code)) throw new AppError('structure_owned', 'A fazenda já tem esta estrutura.', 409);
  return { cents: STRUCTURES[code].cents, code };
}
export const applyStructure = (l: Livestock, code: StructureCode, now: Date): Livestock => ({
  ...l,
  structures: [...l.structures, code],
  // O galinheiro novo vem limpo.
  coopCleanedAt: code === 'galinheiro' ? now : l.coopCleanedAt,
});

/** Confere a compra do animal: estruturas e lotação. */
export function checkAnimal(l: Livestock, breed: string) {
  if (!isBreed(breed)) throw new AppError('invalid_breed', 'Animal desconhecido.', 400);
  const b = BREEDS[breed];
  const missing = b.needs.filter((s) => !l.structures.includes(s));
  if (missing.length) {
    throw new AppError('needs_structure', `${b.label} precisa de: ${missing.map((s) => STRUCTURES[s].label.toLowerCase()).join(' e ')}.`, 409);
  }
  checkRoom(l, breed);
  return { cents: b.cents };
}

function checkRoom(l: Livestock, breed: Breed) {
  if (breed === 'galinha' && countBreed(l, ['galinha']) >= MAX_HENS) throw new AppError('coop_full', `O galinheiro vai até ${MAX_HENS} galinhas.`, 409);
  if (breed === 'galo' && countBreed(l, ['galo']) >= Math.max(1, Math.ceil(countBreed(l, ['galinha']) / HENS_PER_ROOSTER))) {
    throw new AppError('too_many_roosters', 'Um galo para cada 12 galinhas.', 409);
  }
  if (breed === 'porco' && countBreed(l, ['porco']) >= MAX_PIGS) throw new AppError('pigsty_full', `O chiqueiro vai até ${MAX_PIGS} porcos.`, 409);
  if (BREEDS[breed].species === 'gado' && countBreed(l, ['boi', 'vaca']) >= MAX_CATTLE) {
    throw new AppError('pasture_full', `O pasto vai até ${MAX_CATTLE} cabeças.`, 409);
  }
}

export const newAnimal = (breed: Breed, now: Date, golden = false): Animal => ({
  id: randomUUID(),
  breed,
  bornAt: now,
  feeds: 0,
  lastFedAt: null,
  golden,
  lastBredAt: null,
  stock: 0,
  producedUntil: now,
});

const animalOf = (l: Livestock, id: string) => {
  const a = l.animals.find((x) => x.id === id);
  if (!a) throw new AppError('animal_not_found', 'Animal não encontrado.', 404);
  return a;
};
const replace = (l: Livestock, a: Animal): Livestock => ({ ...l, animals: l.animals.map((x) => (x.id === a.id ? a : x)) });

/** Alimentar com 1 milho ou trigo, uma vez por dia. */
export function checkFeed(l: Livestock, id: string, food: string, pantry: Record<string, number>, now: Date) {
  const a = animalOf(l, id);
  if (!(FEED_FOODS as readonly string[]).includes(food)) throw new AppError('invalid_feed', 'Os animais comem milho ou trigo.', 400);
  if ((pantry[food] ?? 0) < 1) throw new AppError('not_in_pantry', 'Esse alimento não está na despensa do avatar.', 409);
  if (fedWithin(a, now, DAY)) throw new AppError('already_fed', 'Já comeu hoje.', 409);
  return a;
}
export const applyFeed = (l: Livestock, id: string, now: Date) => {
  const a = animalOf(l, id);
  return replace(l, { ...a, feeds: a.feeds + 1, lastFedAt: now });
};

/** Coletar ovos e leite guardados, com o bônus do nível do animal. */
export function collect(l: Livestock): { livestock: Livestock; eggs: number; milk: number } {
  let eggs = 0;
  let milk = 0;
  const animals = l.animals.map((a) => {
    if (!a.stock) return a;
    const units = Math.floor(a.stock * (1 + LEVEL_BONUS[levelOf(a) - 1]!));
    if (a.breed === 'galinha') eggs += units;
    else milk += units;
    return { ...a, stock: 0 };
  });
  return { livestock: { ...l, animals }, eggs, milk };
}

/** Abate: só o adulto dá carne (crua), com o bônus do nível. */
export function slaughter(l: Livestock, id: string): { livestock: Livestock; meat: number } {
  const a = animalOf(l, id);
  const meat = isAdult(a) ? Math.floor(BREEDS[a.breed].meat * (1 + LEVEL_BONUS[levelOf(a) - 1]!)) : 0;
  return { livestock: { ...l, animals: l.animals.filter((x) => x.id !== id) }, meat };
}

/** Reprodução: casal adulto da mesma espécie e 1 trigo ou milho; o casal espera 3 dias. */
export function checkBreed(l: Livestock, ids: [string, string], food: string, pantry: Record<string, number>, now: Date) {
  const [a, b] = ids.map((id) => animalOf(l, id)) as [Animal, Animal];
  if (a.id === b.id) throw new AppError('invalid_pair', 'Escolha dois animais.', 400);
  const sa = BREEDS[a.breed].species;
  if (sa !== BREEDS[b.breed].species) throw new AppError('invalid_pair', 'O casal precisa ser da mesma espécie.', 409);
  if (!isAdult(a) || !isAdult(b)) throw new AppError('not_adult', 'Os dois precisam ser adultos (3 alimentações).', 409);
  if (sa === 'ave' && !(new Set([a.breed, b.breed]).size === 2)) throw new AppError('invalid_pair', 'Galinhas reproduzem com um galo.', 409);
  for (const x of [a, b]) {
    if (x.lastBredAt && now.getTime() - x.lastBredAt.getTime() < BREED_INTERVAL_MS) throw new AppError('breed_wait', 'O casal espera 3 dias.', 409);
  }
  if (!(FEED_FOODS as readonly string[]).includes(food)) throw new AppError('invalid_feed', 'A reprodução usa milho ou trigo.', 400);
  if ((pantry[food] ?? 0) < 1) throw new AppError('not_in_pantry', 'Esse alimento não está na despensa do avatar.', 409);
  // O filhote: aves nascem galinha; porco porco; o gado puxa a raça da mãe (vaca) ou do pai.
  const baby: Breed = sa === 'ave' ? 'galinha' : sa === 'porco' ? 'porco' : a.breed === 'vaca' || b.breed === 'vaca' ? 'vaca' : 'boi';
  checkRoom(l, baby);
  return { a, b, baby };
}
export const applyBreed = (l: Livestock, a: Animal, b: Animal, baby: Breed, now: Date): Livestock => ({
  ...replace(replace(l, { ...a, lastBredAt: now }), { ...b, lastBredAt: now }),
  animals: [...replace(replace(l, { ...a, lastBredAt: now }), { ...b, lastBredAt: now }).animals, newAnimal(baby, now)],
});

/** Chocadeira: 1 ovo da despensa vira pinto (galinha), com 3% de ser dos ovos de ouro. */
export function hatch(l: Livestock, pantry: Record<string, number>, now: Date, roll = Math.random()) {
  if (!l.structures.includes('chocadeira')) throw new AppError('needs_structure', 'Precisa de chocadeira.', 409);
  if (!l.structures.includes('galinheiro')) throw new AppError('needs_structure', 'Precisa de galinheiro.', 409);
  if ((pantry.ovos ?? 0) < 1) throw new AppError('not_in_pantry', 'Precisa de 1 ovo na despensa do avatar.', 409);
  checkRoom(l, 'galinha');
  const chick = newAnimal('galinha', now, roll < GOLDEN_CHANCE);
  return { livestock: { ...l, animals: [...l.animals, chick] }, golden: chick.golden };
}

export function checkClean(l: Livestock, now: Date) {
  if (!l.structures.includes('galinheiro')) throw new AppError('needs_structure', 'Não há galinheiro.', 409);
  if (coopClean(l, now) && now.getTime() - l.coopCleanedAt!.getTime() < COOP_CLEAN_MS - DAY) {
    throw new AppError('coop_clean', 'O galinheiro está limpo.', 409);
  }
  return { cents: COOP_CLEAN_CENTS };
}

// ---------------------------------------------------------------- persistência e tela

export const livestockOf = (farm: Farm & { livestock?: Livestock | null }, now: Date): Livestock => farm.livestock ?? emptyLivestock(now);

export function livestockDto(l: Livestock, now: Date) {
  return {
    structures: l.structures,
    coop_clean: coopClean(l, now),
    coop_clean_until: l.coopCleanedAt ? new Date(l.coopCleanedAt.getTime() + COOP_CLEAN_MS).toISOString() : null,
    animals: l.animals.map((a) => ({
      id: a.id,
      breed: a.breed,
      label: BREEDS[a.breed].label,
      adult: isAdult(a),
      feeds: a.feeds,
      level: levelOf(a),
      fed_today: fedWithin(a, now, DAY),
      golden: a.golden,
      stock: a.stock,
      born_at: a.bornAt.toISOString(),
      // Porco: até quando aguenta sem comer; gado: fim da vida útil.
      dies_at:
        a.breed === 'porco'
          ? new Date((a.lastFedAt ?? a.bornAt).getTime() + PIG_STARVE_MS).toISOString()
          : BREEDS[a.breed].species === 'gado'
            ? new Date(a.bornAt.getTime() + CATTLE_LIFE_MS).toISOString()
            : null,
      can_breed_at: a.lastBredAt ? new Date(a.lastBredAt.getTime() + BREED_INTERVAL_MS).toISOString() : null,
    })),
    log: l.log.map((x) => ({ at: x.at.toISOString(), text: x.text })),
  };
}

export const livestockToJson = (l: Livestock | null | undefined) =>
  l
    ? {
        ...l,
        coopCleanedAt: l.coopCleanedAt?.toISOString() ?? null,
        animals: l.animals.map((a) => ({
          ...a,
          bornAt: a.bornAt.toISOString(),
          lastFedAt: a.lastFedAt?.toISOString() ?? null,
          lastBredAt: a.lastBredAt?.toISOString() ?? null,
          producedUntil: a.producedUntil.toISOString(),
        })),
        log: l.log.map((x) => ({ at: x.at.toISOString(), text: x.text })),
      }
    : null;

export function livestockFromJson(v: unknown): Livestock | null {
  if (!v) return null;
  const j = v as Record<string, unknown> & { animals: Record<string, unknown>[]; log?: { at: string; text: string }[] };
  const d = (x: unknown) => (x ? new Date(x as string) : null);
  return {
    structures: ((j.structures as string[]) ?? []).filter(isStructure),
    coopCleanedAt: d(j.coopCleanedAt),
    seed: j.seed as string,
    riskDay: Number(j.riskDay),
    animals: (j.animals ?? []).map((a) => ({
      id: a.id as string,
      breed: a.breed as Breed,
      bornAt: new Date(a.bornAt as string),
      feeds: Number(a.feeds),
      lastFedAt: d(a.lastFedAt),
      golden: !!a.golden,
      lastBredAt: d(a.lastBredAt),
      stock: Number(a.stock),
      producedUntil: new Date(a.producedUntil as string),
    })),
    log: (j.log ?? []).map((x) => ({ at: new Date(x.at), text: x.text })),
    bought: Number(j.bought ?? 0),
  };
}
