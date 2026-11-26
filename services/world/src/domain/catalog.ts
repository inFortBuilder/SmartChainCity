import { DEFAULT_PROPERTY_TYPES, type PropertyLevel, type PropertyType } from './properties.js';

/**
 * Catálogo de imóveis vindo do Strapi (`api::property-type`, cms-strapi/seed/imoveis.json). O game designer
 * preenche preço, obra e renda no CMS; o world troca o catálogo sem deploy.
 *
 * Regras da junção com o catálogo de partida (properties.ts):
 * - o que o CMS traz vale; o que falta vem do tipo de mesmo código no código (preço, renda, níveis);
 * - o que só o código sabe fica do código: o negócio de lazer (`venue`), o uso na Prefeitura e as premissas;
 * - sem preço ou sem renda do nível 1, o tipo aparece, mas não constrói (`available: false`);
 * - tipos raros (só em eventos) e de lote duplo também não constroem ainda;
 * - tipos do código que o CMS não publicou continuam valendo.
 */
export interface CmsPropertyType {
  code: string;
  label: string;
  zone: 'residential' | 'commercial' | 'industrial' | 'rural';
  lots?: number | null;
  availability?: 'always' | 'events' | null;
  upgradesFrom?: string | null;
  price?: number | null;
  buildMinutes?: number | null;
  levels?: { level: number; maxIncome?: number | null; upgradeCost?: number | null }[] | null;
  conferir?: string[] | null;
}

/** Zonas do lote em que cada zona do CMS constrói (o uso misto aceita residencial e comercial). */
const ZONES: Record<CmsPropertyType['zone'], string[]> = {
  residential: ['residential', 'mixed'],
  commercial: ['commercial', 'mixed'],
  industrial: ['industrial'],
  rural: ['rural'],
};

const DAY_MINUTES = 24 * 60;

export function mergeCatalog(cms: CmsPropertyType[], defaults: PropertyType[] = DEFAULT_PROPERTY_TYPES): PropertyType[] {
  if (!cms.length) return defaults;
  const byCode = new Map(defaults.map((t) => [t.code, t]));
  const merged: PropertyType[] = cms.map((c) => {
    const base = byCode.get(c.code);
    const priceCents = c.price != null ? c.price * 100 : (base?.priceCents ?? null);
    const levels: PropertyLevel[] = [];
    for (const l of [...(c.levels ?? [])].sort((a, b) => a.level - b.level)) {
      const baseLevel = base?.levels.find((x) => x.level === l.level);
      const income = l.maxIncome != null ? l.maxIncome * 100 : baseLevel?.incomeCentsPerDay;
      // Os níveis acima do 1 precisam do custo para subir; sem ele, o nível ainda não existe.
      const upgrade = l.upgradeCost != null ? l.upgradeCost * 100 : baseLevel?.upgradeCostCents;
      if (income === undefined || (l.level > 1 && upgrade === undefined)) break;
      levels.push({ level: l.level, incomeCentsPerDay: income, ...(l.level > 1 ? { upgradeCostCents: upgrade } : {}) });
    }
    const reason =
      priceCents === null || !levels.length
        ? 'Aguardando preço e renda do game designer (Figura 16 do GDD).'
        : c.availability === 'events'
          ? 'Raro: só em eventos.'
          : (c.lots ?? 1) > 1
            ? 'Lote duplo ainda não existe no jogo.'
            : null;
    return {
      code: c.code,
      label: c.label,
      zones: base?.zones ?? ZONES[c.zone] ?? [],
      use: base?.use ?? (c.zone === 'residential' ? 'residencial' : 'comercial'),
      ...(c.upgradesFrom ? { upgradesFrom: c.upgradesFrom } : base?.upgradesFrom ? { upgradesFrom: base.upgradesFrom } : {}),
      priceCents: priceCents ?? 0,
      buildMinutes: c.buildMinutes ?? base?.buildMinutes ?? DAY_MINUTES,
      levels: levels.length ? levels : [{ level: 1, incomeCentsPerDay: 0 }],
      provisional: [...(base?.provisional ?? []), ...(c.conferir ?? [])],
      ...(base?.venue ? { venue: base.venue } : {}),
      ...(reason ? { available: false, unavailableReason: reason } : {}),
    };
  });
  const seen = new Set(merged.map((t) => t.code));
  return [...merged, ...defaults.filter((t) => !seen.has(t.code))];
}

/** Lê os tipos publicados no Strapi (API REST pública do catálogo, ADR-0006). */
export async function fetchCmsPropertyTypes(baseUrl: string, fetchFn: typeof fetch = fetch): Promise<CmsPropertyType[]> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/property-types?pagination[pageSize]=200&populate=levels&sort=code`;
  const response = await fetchFn(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Strapi respondeu ${response.status} em /api/property-types`);
  const body = (await response.json()) as { data: CmsPropertyType[] };
  return body.data;
}
