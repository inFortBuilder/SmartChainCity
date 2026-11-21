import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

import { AppError } from '@scc/shared';

import type { AuthStore } from './ports.js';

/**
 * Captcha de prova de trabalho, sem serviço de terceiros (doc 10: "captcha no
 * cadastro"). Formato do ALTCHA (MIT), para dar para trocar o resolvedor pelo
 * widget oficial sem mexer no servidor:
 *
 * - o gateway sorteia `number` em [0, maxnumber], publica `challenge =
 *   sha256(salt + number)` e assina o desafio com HMAC;
 * - o navegador testa 0, 1, 2… até achar o número (frações de segundo para uma
 *   pessoa, custo real para quem cria milhares de contas);
 * - cada desafio vale uma vez e expira (`?expires=` no salt), guardado na mesma
 *   tabela de uso único do nonce do SIWE.
 *
 * Não guarda IP nem nada da pessoa (LGPD).
 */
export interface CaptchaOptions {
  /** Segredo do HMAC (derivado do JWT_SECRET no app). */
  secret: string;
  maxNumber: number;
  ttlSeconds: number;
}

export interface CaptchaChallenge {
  algorithm: 'SHA-256';
  challenge: string;
  maxnumber: number;
  salt: string;
  signature: string;
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const PREFIX = 'captcha:';

export const captchaRequired = () => new AppError('captcha_required', 'Resolva o captcha antes de entrar.', 400);
const invalid = () => new AppError('captcha_invalid', 'Captcha inválido, vencido ou já usado. Peça outro.', 403);

export class Captcha {
  constructor(
    private readonly store: Pick<AuthStore, 'saveNonce' | 'consumeNonce'>,
    private readonly options: CaptchaOptions,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private sign(challenge: string) {
    return createHmac('sha256', this.options.secret).update(challenge).digest('hex');
  }

  async challenge(): Promise<CaptchaChallenge> {
    const expiresAt = new Date(this.now().getTime() + this.options.ttlSeconds * 1000);
    const salt = `${randomBytes(12).toString('hex')}?expires=${Math.floor(expiresAt.getTime() / 1000)}`;
    const challenge = sha256(salt + randomInt(0, this.options.maxNumber + 1));
    await this.store.saveNonce(PREFIX + challenge, expiresAt);
    return { algorithm: 'SHA-256', challenge, maxnumber: this.options.maxNumber, salt, signature: this.sign(challenge) };
  }

  /** Confere a solução (base64 de `{algorithm, challenge, number, salt, signature}`) e a gasta. */
  async verify(payload: string | undefined) {
    if (!payload) throw captchaRequired();
    let p: { algorithm?: unknown; challenge?: unknown; number?: unknown; salt?: unknown; signature?: unknown };
    try {
      p = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    } catch {
      throw invalid();
    }
    if (
      p.algorithm !== 'SHA-256' ||
      typeof p.challenge !== 'string' ||
      typeof p.salt !== 'string' ||
      typeof p.signature !== 'string' ||
      !Number.isSafeInteger(p.number)
    ) {
      throw invalid();
    }
    const expires = Number(/[?&]expires=(\d+)/.exec(p.salt)?.[1]);
    if (!expires || expires * 1000 <= this.now().getTime()) throw invalid();
    if (sha256(p.salt + String(p.number)) !== p.challenge) throw invalid();
    const expected = Buffer.from(this.sign(p.challenge), 'hex');
    const given = Buffer.from(p.signature, 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw invalid();
    // Uso único: o mesmo desafio resolvido não serve para uma segunda conta.
    if (!(await this.store.consumeNonce(PREFIX + p.challenge, this.now()))) throw invalid();
  }
}

/** Resolve um desafio (testes e scripts; o navegador tem o próprio resolvedor). */
export function solveCaptcha(c: CaptchaChallenge) {
  for (let n = 0; n <= c.maxnumber; n++) {
    if (sha256(c.salt + n) === c.challenge) {
      return Buffer.from(JSON.stringify({ algorithm: c.algorithm, challenge: c.challenge, number: n, salt: c.salt, signature: c.signature })).toString('base64');
    }
  }
  throw new Error('captcha sem solução');
}
