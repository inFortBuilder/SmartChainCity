import { AppError } from '@scc/shared';

import { ATTRIBUTE_MAX, type Avatar, status } from './avatar.js';
import { assertNotInHospital } from './hospital.js';

/**
 * Pets e Pet Shop (E3.1, GDD §3 "Pets e Pet Shop" e §2.4).
 *
 * Do GDD:
 * - Gato ou cachorro, com alimentação, água e felicidade de 0 a 5.
 * - A água só cai no passeio e o pet só bebe em casa.
 * - Alimentação ou água em 0: o pet morre.
 * - Felicidade do pet em 0: o avatar perde 50% da felicidade (no turno, conta a metade).
 * - Pet Shop: banho, tosa e hotel dão +30% (felicidade do pet).
 * - Passeio: +30% de felicidade e saúde e −50% de energia para o avatar.
 * - Nível do pet de 3 a 15, multiplicador de 1,00× a 1,25× (§2.4), com teto conjunto
 *   Experiência × Pet de 2,5× (ADR-0013).
 *
 * PREMISSAS desta etapa, a calibrar no simulador:
 * - A alimentação do pet cai 1 ponto a cada 6 h, e não 1 por hora como diz o GDD. Com 1 por hora, o pet
 *   morreria 5 h depois da última ração, menos que um turno de 6 h. Com 6 h, ele aguenta 30 h sem comer.
 * - A felicidade do pet cai 1 ponto a cada 12 h.
 * - "+30%" vira +2 pontos no pet (30% de 5, arredondado para cima) e +3 no avatar (30% de 10).
 *   "−50% de energia" vira −5.
 * - Um pet por avatar. Quem passeia, dá banho e paga é o avatar dono.
 * - O nível sobe com o cuidado: cada passeio ou serviço do Pet Shop dá 1 de experiência, e 5 de
 *   experiência sobem um nível. Começa no 3 (1,00×).
 * - Preços em THALER, que vão para a queima (sink do Pet Shop, doc 04 §7). A ração, o banho, a tosa e
 *   o hotel de 24 h, em que o pet não perde alimentação nem felicidade, também saem do bolso.
 * - O pet morto fica até o jogador enterrá-lo ou adotar outro.
 * - A queda é calculada na leitura (como a do avatar); sem job próprio.
 */
export const PET_MAX = 5;
export const PET_SPECIES = ['cat', 'dog'] as const;
export type PetSpecies = (typeof PET_SPECIES)[number];
export const SPECIES_LABEL: Record<PetSpecies, string> = { cat: 'Gato', dog: 'Cachorro' };

const HOUR = 3_600_000;
export const PET_DECAY = {
  food: { everyMs: 6 * HOUR, source: 'premissa (GDD: −1/h mataria o pet em 5 h)' },
  happiness: { everyMs: 12 * HOUR, source: 'premissa' },
} as const;
type PetDecaying = keyof typeof PET_DECAY;
const PET_DECAYING = Object.keys(PET_DECAY) as PetDecaying[];

export const PET_LEVEL_MIN = 3;
export const PET_LEVEL_MAX = 15;
export const XP_PER_LEVEL = 5;
export const HOTEL_MS = 24 * HOUR;
export const WALK = { avatarEnergy: -5, avatarHappiness: 3, avatarHealth: 3, petHappiness: 2, petWater: -1 } as const;
export const PET_SHOP_BOOST = 2;

/** Preços em centavos de THALER (premissas). */
export const ADOPTION_CENTS: Record<PetSpecies, bigint> = { cat: 5000n, dog: 8000n };
export const SERVICES = {
  racao: { label: 'Ração', cents: 300n, food: 3, happiness: 0, xp: 0 },
  banho: { label: 'Banho', cents: 800n, food: 0, happiness: PET_SHOP_BOOST, xp: 1 },
  tosa: { label: 'Tosa', cents: 1200n, food: 0, happiness: PET_SHOP_BOOST, xp: 1 },
  hotel: { label: 'Hotel (24 h)', cents: 2000n, food: PET_MAX, happiness: PET_SHOP_BOOST, xp: 1 },
} as const;
export type PetService = keyof typeof SERVICES;
export const PET_SERVICES = Object.keys(SERVICES) as PetService[];
export const isPetService = (s: string): s is PetService => s in SERVICES;

export interface Pet {
  species: PetSpecies;
  name: string;
  /** Experiência acumulada: o nível sai dela. */
  xp: number;
  attributes: { food: number; water: number; happiness: number };
  anchors: Record<PetDecaying, Date>;
  /** No hotel até este instante: não perde alimentação nem felicidade. */
  hotelUntil: Date | null;
  adoptedAt: Date;
  /** Quando morreu e por quê; null vivo. */
  diedAt: Date | null;
  deathCause: 'food' | 'water' | null;
}

export const petLevel = (p: Pick<Pet, 'xp'>) => Math.min(PET_LEVEL_MAX, PET_LEVEL_MIN + Math.floor(p.xp / XP_PER_LEVEL));

/** GDD §2.4: nível 3 → 1,00×, +0,02 por nível até o 14 (1,22×), 15 → 1,25×. */
export const petMultiplier = (level: number) => {
  const l = Math.max(PET_LEVEL_MIN, Math.min(PET_LEVEL_MAX, level));
  if (l === PET_LEVEL_MAX) return 1.25;
  return Math.round((1 + (l - PET_LEVEL_MIN) * 0.02) * 100) / 100;
};

export const isAlive = (p: Pet | null | undefined): p is Pet => !!p && p.diedAt === null;
export const inHotel = (p: Pet, now: Date) => p.hotelUntil !== null && p.hotelUntil.getTime() > now.getTime();

/** O pet de agora, com a queda até `now`. Alimentação em 0 mata, no instante em que zerou. */
export function decayedPet(pet: Pet, now: Date): Pet {
  if (!isAlive(pet)) return pet;
  const attributes = { ...pet.attributes };
  const anchors = { ...pet.anchors };
  let diedAt: Date | null = null;
  for (const name of PET_DECAYING) {
    // Tempo no hotel não conta: o relógio começa de novo quando ele sai.
    if (pet.hotelUntil && pet.hotelUntil.getTime() > anchors[name].getTime()) {
      anchors[name] = new Date(Math.min(pet.hotelUntil.getTime(), now.getTime()));
    }
    const { everyMs } = PET_DECAY[name];
    const elapsed = now.getTime() - anchors[name].getTime();
    if (elapsed < everyMs) continue;
    const steps = Math.floor(elapsed / everyMs);
    const lost = Math.min(steps, attributes[name]);
    attributes[name] -= lost;
    if (attributes[name] === 0) {
      const zeroAt = new Date(anchors[name].getTime() + lost * everyMs);
      if (name === 'food') diedAt = zeroAt;
      anchors[name] = now;
    } else {
      anchors[name] = new Date(anchors[name].getTime() + steps * everyMs);
    }
  }
  if (diedAt) return { ...pet, attributes, anchors, diedAt, deathCause: 'food' };
  return { ...pet, attributes, anchors };
}

/** O que o turno usa do pet: o multiplicador e se ele está triste (avatar com metade da felicidade). */
export function petFactors(avatar: Pick<Avatar, 'pet'>): { multiplier: number; sad: boolean } {
  if (!isAlive(avatar.pet)) return { multiplier: 1, sad: false };
  return { multiplier: petMultiplier(petLevel(avatar.pet)), sad: avatar.pet.attributes.happiness === 0 };
}

/** Felicidade que conta no turno: com o pet triste, a metade (GDD). */
export const happinessWithPet = (avatar: Pick<Avatar, 'pet' | 'attributes'>) =>
  petFactors(avatar).sad ? Math.floor(avatar.attributes.happiness / 2) : avatar.attributes.happiness;

const clampPet = (n: number) => Math.max(0, Math.min(PET_MAX, n));
const clampAvatar = (n: number) => Math.max(0, Math.min(ATTRIBUTE_MAX, n));

const requirePet = (avatar: Avatar): Pet => {
  if (!avatar.pet) throw new AppError('no_pet', 'O avatar não tem pet. Adote um no Pet Shop.', 409);
  if (avatar.pet.diedAt !== null) throw new AppError('pet_dead', `${avatar.pet.name} morreu. Enterre ou adote outro.`, 409);
  return avatar.pet;
};

/** Efeito no pet de uma compra no Pet Shop, guardado na compra até a cobrança passar. */
export type PetEffect =
  | { kind: 'adopt'; species: PetSpecies; name: string }
  | { kind: 'service'; service: PetService };

/** Confere a adoção: sem pet vivo, nome de 1 a 24 letras. O avatar já vem com a queda até agora. */
export function checkAdoption(avatar: Avatar, input: { species: string; name: string }, now: Date): PetEffect & { cents: bigint } {
  if (!(PET_SPECIES as readonly string[]).includes(input.species)) throw new AppError('invalid_species', 'Escolha gato ou cachorro.', 400);
  const name = input.name.trim();
  if (name.length < 1 || name.length > 24) throw new AppError('invalid_name', 'O nome do pet vai de 1 a 24 letras.', 400);
  assertNotInHospital(avatar, now);
  if (isAlive(avatar.pet)) throw new AppError('has_pet', `O avatar já tem ${avatar.pet.name}. Um pet por avatar.`, 409);
  const species = input.species as PetSpecies;
  return { kind: 'adopt', species, name, cents: ADOPTION_CENTS[species] };
}

/** Confere o serviço do Pet Shop. */
export function checkService(avatar: Avatar, service: string, now: Date): PetEffect & { cents: bigint } {
  if (!isPetService(service)) throw new AppError('invalid_service', 'Serviço do Pet Shop desconhecido.', 400);
  assertNotInHospital(avatar, now);
  const pet = requirePet(avatar);
  if (inHotel(pet, now)) throw new AppError('pet_in_hotel', `${pet.name} está no hotel até ${pet.hotelUntil!.toISOString()}.`, 409);
  if (service === 'racao' && pet.attributes.food >= PET_MAX) {
    throw new AppError('pet_not_hungry', `${pet.name} está satisfeito.`, 409);
  }
  return { kind: 'service', service, cents: SERVICES[service].cents };
}

/** Aplica a compra paga ao avatar (que já vem com a queda até agora). */
export function applyPetEffect(avatar: Avatar, effect: PetEffect, now: Date): Avatar {
  if (effect.kind === 'adopt') {
    const pet: Pet = {
      species: effect.species,
      name: effect.name,
      xp: 0,
      attributes: { food: PET_MAX, water: PET_MAX, happiness: PET_MAX },
      anchors: { food: now, happiness: now },
      hotelUntil: null,
      adoptedAt: now,
      diedAt: null,
      deathCause: null,
    };
    return { ...avatar, pet, updatedAt: now };
  }
  // Pago e o pet morreu no meio (raro: a compra fica pendente e o ledger volta): o THALER já saiu,
  // então o efeito simplesmente não tem onde cair. O plano confere antes, com o avatar travado.
  if (!isAlive(avatar.pet)) return avatar;
  const s = SERVICES[effect.service];
  const pet = avatar.pet;
  const attributes = {
    food: clampPet(pet.attributes.food + s.food),
    water: effect.service === 'hotel' ? PET_MAX : pet.attributes.water,
    happiness: clampPet(pet.attributes.happiness + s.happiness),
  };
  // Comer ou ficar feliz recomeça a contagem do zero, como a refeição do avatar.
  const anchors = {
    food: s.food > 0 && pet.attributes.food === 0 ? now : pet.anchors.food,
    happiness: s.happiness > 0 && pet.attributes.happiness === 0 ? now : pet.anchors.happiness,
  };
  const hotelUntil = effect.service === 'hotel' ? new Date(now.getTime() + HOTEL_MS) : pet.hotelUntil;
  return { ...avatar, pet: { ...pet, attributes, anchors, hotelUntil, xp: pet.xp + s.xp }, updatedAt: now };
}

export type PetAction = 'agua' | 'passeio' | 'enterrar';
export const PET_ACTIONS: PetAction[] = ['agua', 'passeio', 'enterrar'];

/** Ações de graça, em casa: dar água, passear e enterrar o pet morto. */
export function petAction(avatar: Avatar, action: string, now: Date): Avatar {
  if (action === 'enterrar') {
    if (!avatar.pet) throw new AppError('no_pet', 'O avatar não tem pet.', 409);
    if (isAlive(avatar.pet)) throw new AppError('pet_alive', `${avatar.pet.name} está vivo.`, 409);
    return { ...avatar, pet: null, updatedAt: now };
  }
  if (action !== 'agua' && action !== 'passeio') throw new AppError('invalid_action', 'Ação desconhecida.', 400);
  assertNotInHospital(avatar, now);
  const pet = requirePet(avatar);
  if (inHotel(pet, now)) throw new AppError('pet_in_hotel', `${pet.name} está no hotel.`, 409);
  if (action === 'agua') {
    if (pet.attributes.water >= PET_MAX) throw new AppError('pet_not_thirsty', `${pet.name} não está com sede.`, 409);
    return { ...avatar, pet: { ...pet, attributes: { ...pet.attributes, water: PET_MAX } }, updatedAt: now };
  }
  // Passeio: a água cai 1 e o pet só bebe em casa; com 1 de água, o passeio o mataria.
  if (pet.attributes.water <= 1) throw new AppError('pet_thirsty', `Dê água para ${pet.name} antes de passear.`, 409);
  const a = avatar.attributes;
  if (!status(avatar, now).canLeisure || a.energy < -WALK.avatarEnergy) {
    throw new AppError('too_tired', `O passeio gasta ${-WALK.avatarEnergy} de energia do avatar.`, 409);
  }
  const happiness = clampPet(pet.attributes.happiness + WALK.petHappiness);
  return {
    ...avatar,
    attributes: {
      ...a,
      energy: clampAvatar(a.energy + WALK.avatarEnergy),
      happiness: clampAvatar(a.happiness + WALK.avatarHappiness),
      health: clampAvatar(a.health + WALK.avatarHealth),
    },
    // A felicidade do avatar subiu: a contagem dela continua de onde estava.
    pet: {
      ...pet,
      xp: pet.xp + 1,
      attributes: { ...pet.attributes, water: pet.attributes.water + WALK.petWater, happiness },
      anchors: { ...pet.anchors, happiness: pet.attributes.happiness === 0 ? now : pet.anchors.happiness },
    },
    updatedAt: now,
  };
}

/** Pet como a API mostra. */
export function petDto(pet: Pet | null | undefined, now: Date) {
  if (!pet) return null;
  const level = petLevel(pet);
  return {
    species: pet.species,
    species_label: SPECIES_LABEL[pet.species],
    name: pet.name,
    alive: isAlive(pet),
    level,
    xp: pet.xp,
    next_level_xp: level >= PET_LEVEL_MAX ? null : (level - PET_LEVEL_MIN + 1) * XP_PER_LEVEL,
    multiplier: isAlive(pet) ? petMultiplier(level) : 1,
    attributes: pet.attributes,
    sad: isAlive(pet) && pet.attributes.happiness === 0,
    hotel_until: inHotel(pet, now) ? pet.hotelUntil!.toISOString() : null,
    adopted_at: pet.adoptedAt.toISOString(),
    died_at: pet.diedAt?.toISOString() ?? null,
    death_cause: pet.deathCause,
  };
}

/** Datas do pet em JSON (banco) e de volta. */
export const petToJson = (p: Pet | null | undefined) =>
  p
    ? {
        ...p,
        anchors: { food: p.anchors.food.toISOString(), happiness: p.anchors.happiness.toISOString() },
        hotelUntil: p.hotelUntil?.toISOString() ?? null,
        adoptedAt: p.adoptedAt.toISOString(),
        diedAt: p.diedAt?.toISOString() ?? null,
      }
    : null;

export function petFromJson(v: unknown): Pet | null {
  if (!v) return null;
  const j = v as Record<string, unknown> & { anchors: { food: string; happiness: string }; attributes: Pet['attributes'] };
  const date = (x: unknown) => (x ? new Date(x as string) : null);
  return {
    species: j.species as PetSpecies,
    name: j.name as string,
    xp: Number(j.xp ?? 0),
    attributes: { ...j.attributes },
    anchors: { food: new Date(j.anchors.food), happiness: new Date(j.anchors.happiness) },
    hotelUntil: date(j.hotelUntil),
    adoptedAt: new Date(j.adoptedAt as string),
    diedAt: date(j.diedAt),
    deathCause: (j.deathCause as Pet['deathCause']) ?? null,
  };
}

export const clonePet = (p: Pet | null | undefined): Pet | null => petFromJson(petToJson(p));
