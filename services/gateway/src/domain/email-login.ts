import { createHmac, randomInt } from 'node:crypto';

import { AppError } from '@scc/shared';

import type { Account, AuthStore } from './ports.js';
import { issueToken, type TokenOptions } from './token.js';

/** Quem entrega o código. No MVP local, o log do gateway (sem provedor pago). */
export interface Mailer {
  sendLoginCode(email: string, code: string, expiresAt: Date): Promise<void>;
}

export interface EmailLoginOptions {
  /** Chave do HMAC que guarda o código: o banco nunca vê o código em claro. */
  secret: string;
  ttlSeconds: number;
  /** Intervalo mínimo entre dois códigos para o mesmo e-mail. */
  resendSeconds: number;
  /** Tentativas erradas que inutilizam o código. */
  maxAttempts: number;
  token: TokenOptions;
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/**
 * Login por e-mail com código de 6 dígitos (doc 06 §3). O código vale
 * `ttlSeconds`, serve uma vez e queima depois de `maxAttempts` erros. A resposta
 * de `start` é a mesma exista a conta ou não, e mesmo quando o reenvio é
 * segurado pelo intervalo: ninguém descobre quais e-mails jogam.
 */
export class EmailLogin {
  constructor(
    private readonly store: AuthStore,
    private readonly mailer: Mailer,
    private readonly options: EmailLoginOptions,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private hash(email: string, code: string) {
    return createHmac('sha256', this.options.secret).update(`email-code:${email}:${code}`).digest('hex');
  }

  async start(rawEmail: string) {
    const email = normalizeEmail(rawEmail);
    const now = this.now();
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const expiresAt = new Date(now.getTime() + this.options.ttlSeconds * 1000);
    const saved = await this.store.saveEmailCode(email, this.hash(email, code), expiresAt, now, this.options.resendSeconds);
    if (saved) await this.mailer.sendLoginCode(email, code, expiresAt);
    return { expiresIn: this.options.ttlSeconds };
  }

  async verify(rawEmail: string, code: string) {
    const email = normalizeEmail(rawEmail);
    const now = this.now();
    await this.consume(email, code, now);
    const account = await this.store.findOrCreateAccountByEmail(email, now);
    if (account.status !== 'active') throw new AppError('account_blocked', 'Conta bloqueada.', 403);
    return { account, ...(await issueToken(account.id, this.options.token, now)) };
  }

  /**
   * Põe o e-mail na conta logada (a de carteira, por exemplo): manda o código
   * como no login. Conta que já tem e-mail não troca por aqui.
   */
  async startLink(account: Account, rawEmail: string) {
    if (account.email !== null) {
      throw new AppError('email_already_set', 'Esta conta já tem e-mail.', 409);
    }
    return this.start(rawEmail);
  }

  /**
   * Confere o código e grava o e-mail. Só aqui, depois de provar que o e-mail é
   * dele, o jogador fica sabendo se outra conta já usa o endereço.
   */
  async verifyLink(accountId: string, rawEmail: string, code: string) {
    const email = normalizeEmail(rawEmail);
    await this.consume(email, code, this.now());
    const result = await this.store.setAccountEmail(accountId, email);
    if (result === 'taken') throw new AppError('email_in_use', 'Este e-mail já é de outra conta.', 409);
    if (result === 'has_other') throw new AppError('email_already_set', 'Esta conta já tem e-mail.', 409);
    return { linked: result === 'set' };
  }

  private async consume(email: string, code: string, now: Date) {
    const ok = await this.store.consumeEmailCode(email, this.hash(email, code), now, this.options.maxAttempts);
    if (!ok) throw new AppError('invalid_code', 'Código inválido, vencido ou já usado.', 401);
  }
}
