import { readFileSync } from 'node:fs';

/**
 * Raridades e profissões. As profissões vêm do catálogo gerado do GDD original
 * (cms-strapi/seed/profissoes.json, capítulo 4), o mesmo que vai semear o
 * Strapi (trilha do CMS, passo 5). Quando o Strapi publicar o catálogo, o
 * game-core passa a ler de lá pelo cache (passo 6); o formato é o mesmo.
 */
export const RARITIES = ['common', 'rare', 'epic', 'legendary'] as const;
export type Rarity = (typeof RARITIES)[number];

/** Faixa de ganho por dia de cada raridade (doc 02 §2.2), a mesma do simulador econômico. */
export const BASE_RANGE: Record<Rarity, [number, number]> = {
  common: [100, 125],
  rare: [140, 165],
  epic: [180, 205],
  legendary: [225, 250],
};

export interface JobTask {
  name: string;
  energy: number;
  happiness: number;
  minutes: number;
  tokens: number;
}

export interface Profession {
  code: string;
  label: string;
  rarity: Rarity;
  /** Ganho de um dia de trabalho, em THALER (o cabeçalho de cada profissão no GDD). */
  tokens: number;
  minutes: number;
  tasks: JobTask[];
  /** Diferenças entre as tarefas e o cabeçalho no GDD, para o game designer revisar. */
  conferir?: string[];
}

export const isRarity = (value: string): value is Rarity => (RARITIES as readonly string[]).includes(value);

/** Confere o catálogo ao carregar: um erro aqui impede o serviço de subir com dados quebrados. */
export function validateCatalog(professions: Profession[]): Profession[] {
  const codes = new Set<string>();
  for (const p of professions) {
    if (!isRarity(p.rarity)) throw new Error(`Catálogo: raridade inválida em ${p.code}`);
    if (codes.has(p.code)) throw new Error(`Catálogo: profissão repetida ${p.code}`);
    codes.add(p.code);
    const [min, max] = BASE_RANGE[p.rarity];
    if (!(p.tokens >= min && p.tokens <= max)) {
      throw new Error(`Catálogo: ${p.code} ganha ${p.tokens}, fora da faixa ${min}–${max} da raridade ${p.rarity}`);
    }
    if (!p.tasks.length) throw new Error(`Catálogo: ${p.code} sem tarefas`);
  }
  return professions;
}

const CATALOG_FILE =
  process.env.CATALOG_FILE ?? new URL('../../../../cms-strapi/seed/profissoes.json', import.meta.url);

export const PROFESSION_LIST: Profession[] = validateCatalog(
  (JSON.parse(readFileSync(CATALOG_FILE, 'utf8')) as { profissoes: Profession[] }).profissoes,
);

/** Por raridade e código: `PROFESSIONS.common.padeiro` → "Padeiro". */
export const PROFESSIONS: Record<Rarity, Record<string, string>> = Object.fromEntries(
  RARITIES.map((r) => [r, Object.fromEntries(PROFESSION_LIST.filter((p) => p.rarity === r).map((p) => [p.code, p.label]))]),
) as Record<Rarity, Record<string, string>>;

const BY_CODE = new Map(PROFESSION_LIST.map((p) => [p.code, p]));
export const profession = (code: string) => BY_CODE.get(code);

/** A profissão precisa ser da raridade do avatar (a profissão inicial sai da mesma raridade). */
export const professionFits = (rarity: Rarity, jobCode: string) => BY_CODE.get(jobCode)?.rarity === rarity;

export const professionLabel = (_rarity: Rarity, jobCode: string) => BY_CODE.get(jobCode)?.label ?? jobCode;
