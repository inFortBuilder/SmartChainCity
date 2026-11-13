import { readFileSync } from 'node:fs';

/**
 * Alimentos da Tabela de Atributos (doc 02 §7). Vêm do mesmo seed que semeia
 * o Strapi (cms-strapi/seed/alimentos.json) e, quando o Strapi publica, do
 * catálogo dele, como as profissões.
 */
export const FOOD_GROUPS = ['fruta', 'grao_legume', 'proteina', 'lanche'] as const;
export type FoodGroup = (typeof FOOD_GROUPS)[number];

export interface Food {
  code: string;
  label: string;
  group: FoodGroup;
  /** Pontos de energia e de saúde ao comer uma unidade (podem ser negativos). */
  energy: number;
  health: number;
  /** Unidades por pacote. */
  pack: number;
  /** THALER por pacote. Vazio até o game designer definir. */
  price: number | null;
}

export function validateFoods(foods: Food[]): Food[] {
  const codes = new Set<string>();
  for (const f of foods) {
    if (codes.has(f.code)) throw new Error(`Alimentos: código repetido ${f.code}`);
    codes.add(f.code);
    if (!(FOOD_GROUPS as readonly string[]).includes(f.group)) throw new Error(`Alimentos: grupo inválido em ${f.code}`);
    if (!Number.isInteger(f.pack) || f.pack < 1) throw new Error(`Alimentos: pacote inválido em ${f.code}`);
    for (const k of ['energy', 'health'] as const) {
      if (!Number.isInteger(f[k]) || Math.abs(f[k]) > 10) throw new Error(`Alimentos: ${k} inválido em ${f.code}`);
    }
    // Comida de graça não passa pelo ledger (lançamento de zero não existe).
    if (f.price !== null && !(Number.isInteger(f.price) && f.price >= 1)) {
      throw new Error(`Alimentos: preço inválido em ${f.code}`);
    }
  }
  return foods;
}

const FOODS_FILE = process.env.FOODS_FILE ?? new URL('../../../../cms-strapi/seed/alimentos.json', import.meta.url);

type SeedFood = Omit<Food, 'price'> & { price?: number | null };

export const SEED_FOODS: Food[] = validateFoods(
  (JSON.parse(readFileSync(FOODS_FILE, 'utf8')) as { alimentos: SeedFood[] }).alimentos.map((f) => ({
    code: f.code,
    label: f.label,
    group: f.group,
    energy: f.energy,
    health: f.health,
    pack: f.pack,
    price: f.price ?? null,
  })),
);

let current = SEED_FOODS;
let byCode = new Map(current.map((f) => [f.code, f]));
let origin: 'seed' | 'cms' = 'seed';

/** Troca a lista inteira, depois de conferir. Lista quebrada não entra. */
export function replaceFoods(list: Food[], from: 'seed' | 'cms') {
  current = validateFoods(list);
  byCode = new Map(current.map((f) => [f.code, f]));
  origin = from;
}

export const foods = () => current;
export const foodsOrigin = () => origin;
export const food = (code: string) => byCode.get(code);
