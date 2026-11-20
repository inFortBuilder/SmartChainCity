import type { FastifyBaseLogger } from 'fastify';

import type { Mailer } from '../domain/email-login.js';

/**
 * Entrega o código de login no log do gateway, em vez de mandar e-mail: o MVP
 * roda só na máquina local, sem provedor pago. main.ts recusa este carteiro em
 * produção, porque quem lê o log entraria em qualquer conta.
 */
export class LogMailer implements Mailer {
  constructor(private readonly log: FastifyBaseLogger) {}

  async sendLoginCode(email: string, code: string, expiresAt: Date) {
    this.log.warn({ email, code, expiresAt: expiresAt.toISOString() }, `código de login para ${email}: ${code} (só desenvolvimento)`);
  }
}
