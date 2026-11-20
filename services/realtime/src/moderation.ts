/**
 * Moderação do chat (doc 10: "chat tóxico → filtro, denúncia, moderação, silenciamento").
 *
 * - Texto: até 200 caracteres, espaços colapsados, sem caracteres de controle.
 * - Links e convites (http, www, domínios, @usuário de rede social) são recusados:
 *   golpe de "carteira grátis" é o risco mais comum num jogo com token.
 * - Palavrões da lista são trocados por asteriscos; a mensagem passa.
 * - Quem tem 3 mensagens recusadas em 10 minutos fica silenciado por 10 minutos.
 * - 3 denúncias de jogadores diferentes silenciam por 15 minutos.
 *
 * A lista é curta de propósito (MVP); a versão final vem do CMS, por idioma.
 */

export const MAX_CHAT_LENGTH = 200;
export const MAX_NAME_LENGTH = 24;

// Termos ofensivos comuns em português, espanhol e inglês (sem variações exaustivas).
const BLOCKLIST = [
  'porra', 'caralho', 'merda', 'puta', 'puto', 'viado', 'buceta', 'cacete', 'arrombado', 'otario', 'otário',
  'idiota', 'imbecil', 'retardado', 'mierda', 'pendejo', 'cabron', 'cabrón', 'fuck', 'shit', 'bitch', 'asshole',
];

const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|xyz|gg|me|ly|br|app|link|site|online)\b|t\.me\/|discord\.gg)/i;
const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g;

/** Tira acentos e repetições ("puuuuta" → "puta") para comparar com a lista. */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/(.)\1{2,}/g, '$1');

const BLOCKED = new Set(BLOCKLIST.map(fold));

export type ModerationResult =
  | { ok: true; text: string; masked: boolean }
  | { ok: false; reason: 'empty' | 'too_long' | 'link' };

export function moderateText(raw: string, max = MAX_CHAT_LENGTH): ModerationResult {
  const text = raw.replace(CONTROL, '').replace(/\s+/g, ' ').trim();
  if (!text) return { ok: false, reason: 'empty' };
  if (text.length > max) return { ok: false, reason: 'too_long' };
  if (LINK.test(text)) return { ok: false, reason: 'link' };

  let masked = false;
  const out = text.replace(/[\p{L}\p{N}]+/gu, (word) => {
    if (!BLOCKED.has(fold(word))) return word;
    masked = true;
    return '*'.repeat(word.length);
  });
  return { ok: true, text: out, masked };
}

/** Nome exibido na sala: moderado; sem nome válido, vira "Visitante". */
export function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') return 'Visitante';
  const r = moderateText(raw, MAX_NAME_LENGTH);
  return r.ok && !r.masked ? r.text : 'Visitante';
}

/** Silenciamento por conta: violações recentes e denúncias de quem é diferente. */
export class MuteBook {
  private readonly violations = new Map<string, number[]>();
  private readonly reports = new Map<string, Set<string>>();
  private readonly mutedUntil = new Map<string, number>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    readonly rules = { violations: 3, windowMs: 10 * 60_000, muteMs: 10 * 60_000, reports: 3, reportMuteMs: 15 * 60_000 },
  ) {}

  isMuted(account: string): number {
    const until = this.mutedUntil.get(account) ?? 0;
    return until > this.now() ? until : 0;
  }

  /** Registra uma mensagem recusada; devolve até quando ficou silenciado (0 se não ficou). */
  violation(account: string): number {
    const t = this.now();
    const recent = (this.violations.get(account) ?? []).filter((x) => t - x < this.rules.windowMs);
    recent.push(t);
    this.violations.set(account, recent);
    if (recent.length >= this.rules.violations) {
      this.violations.delete(account);
      this.mutedUntil.set(account, t + this.rules.muteMs);
      return t + this.rules.muteMs;
    }
    return 0;
  }

  /** Denúncia de `by` contra `target`; denunciar a si mesmo não conta. */
  report(target: string, by: string): number {
    if (target === by) return 0;
    const set = this.reports.get(target) ?? new Set<string>();
    set.add(by);
    this.reports.set(target, set);
    if (set.size >= this.rules.reports) {
      this.reports.delete(target);
      const until = this.now() + this.rules.reportMuteMs;
      this.mutedUntil.set(target, until);
      return until;
    }
    return 0;
  }
}

/** Balde de fichas por cliente: `rate` por segundo, rajada de até `burst`. */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly rate: number,
    private readonly burst: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  take(key: string): boolean {
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.burst, at: t };
    b.tokens = Math.min(this.burst, b.tokens + ((t - b.at) / 1000) * this.rate);
    b.at = t;
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(key, b);
    return true;
  }

  forget(key: string) {
    this.buckets.delete(key);
  }
}
