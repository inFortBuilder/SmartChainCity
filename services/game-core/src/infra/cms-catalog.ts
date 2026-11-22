import type { Profession, Rarity } from '../domain/catalog.js';
import { type EventGroup, type Season, parseSeasons } from '../domain/events.js';
import type { Food, FoodGroup } from '../domain/foods.js';

/**
 * Lê as profissões publicadas no Strapi (API REST pública do catálogo,
 * ADR-0006). Só as publicadas: rascunho no CMS não muda o jogo.
 */
export async function fetchCmsProfessions(baseUrl: string, fetchFn: typeof fetch = fetch): Promise<Profession[]> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/jobs?pagination[pageSize]=200&populate=tasks&sort=code`;
  const response = await fetchFn(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Strapi respondeu ${response.status} em /api/jobs`);
  const body = (await response.json()) as {
    data: {
      code: string;
      label: string;
      rarity: Rarity;
      tokens: number;
      minutes: number;
      tasks?: { name: string; energy: number; happiness: number; minutes: number; tokens: number }[];
      conferir?: string[] | null;
    }[];
  };
  return body.data.map((j) => ({
    code: j.code,
    label: j.label,
    rarity: j.rarity,
    tokens: j.tokens,
    minutes: j.minutes,
    tasks: (j.tasks ?? []).map((t) => ({
      name: t.name,
      energy: t.energy ?? 0,
      happiness: t.happiness ?? 0,
      minutes: t.minutes ?? 0,
      tokens: t.tokens ?? 0,
    })),
    ...(j.conferir?.length ? { conferir: j.conferir } : {}),
  }));
}

/** Alimentos publicados no Strapi, no formato do seed. */
export async function fetchCmsFoods(baseUrl: string, fetchFn: typeof fetch = fetch): Promise<Food[]> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/foods?pagination[pageSize]=200&sort=code`;
  const response = await fetchFn(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Strapi respondeu ${response.status} em /api/foods`);
  const body = (await response.json()) as {
    data: { code: string; label: string; group: FoodGroup; energy: number; health: number; pack: number; price?: number | null }[];
  };
  return body.data.map((f) => ({
    code: f.code,
    label: f.label,
    group: f.group,
    energy: f.energy ?? 0,
    health: f.health ?? 0,
    pack: f.pack ?? 1,
    price: f.price ?? null,
  }));
}

/** Grupos de evento publicados no Strapi (E3.10). */
export async function fetchCmsEventGroups(baseUrl: string, fetchFn: typeof fetch = fetch): Promise<EventGroup[]> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/event-groups?pagination[pageSize]=100&sort=order`;
  const response = await fetchFn(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Strapi respondeu ${response.status} em /api/event-groups`);
  const body = (await response.json()) as {
    data: { code: string; label: string; order: number; factor: number | string; jobs: string[]; events: string[] }[];
  };
  return body.data.map((g) => ({
    code: g.code,
    label: g.label,
    order: Number(g.order),
    factor: Number(g.factor),
    jobs: Array.isArray(g.jobs) ? g.jobs : [],
    events: Array.isArray(g.events) ? g.events : [],
  }));
}

/** Temporadas do GamePass publicadas no Strapi, com os itens sazonais (E3.10). */
export async function fetchCmsSeasons(baseUrl: string, fetchFn: typeof fetch = fetch): Promise<Season[]> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/seasons?pagination[pageSize]=100&populate=items&sort=startsAt`;
  const response = await fetchFn(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Strapi respondeu ${response.status} em /api/seasons`);
  const body = (await response.json()) as { data: Parameters<typeof parseSeasons>[0] };
  return parseSeasons(body.data);
}
