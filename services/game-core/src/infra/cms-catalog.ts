import type { Profession, Rarity } from '../domain/catalog.js';
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
