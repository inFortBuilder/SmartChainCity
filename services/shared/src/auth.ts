import { timingSafeEqual } from 'node:crypto';

import { errors, jwtVerify } from 'jose';

import { AppError } from './index.js';

export interface VerifyOptions {
  secret: string;
  issuer: string;
}

/**
 * Validates an access token issued by the gateway and returns the account id.
 * Shared by every service that serves players, so the rules live in one place:
 * HS256 is pinned (the token header is never trusted), `exp` and `iss` are
 * required, and the audience must be `scc-api`.
 */
export async function verifyAccessToken(token: string, options: VerifyOptions): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(options.secret), {
      algorithms: ['HS256'],
      issuer: options.issuer,
      audience: 'scc-api',
      requiredClaims: ['exp'],
    });
    if (!payload.sub) throw new AppError('invalid_token', 'Token sem conta.', 401);
    return payload.sub;
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof errors.JWTExpired) {
      throw new AppError('token_expired', 'Token expirado.', 401);
    }
    throw new AppError('invalid_token', 'Token inválido.', 401);
  }
}

/** `Authorization: Bearer <token>` → token, or a 401 with a stable code. */
export function bearerToken(header: string | undefined): string {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? '');
  if (!match?.[1]) throw new AppError('missing_credentials', 'Envie o token.', 401);
  return match[1];
}

/**
 * Confere a chave de serviço (`X-Service-Token`) dos endpoints internos, em
 * tempo constante: a chave não vaza pelo tempo de resposta.
 */
export function requireServiceToken(given: string | string[] | undefined, expected: string): void {
  const a = Buffer.from(typeof given === 'string' ? given : '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AppError('forbidden', 'Só serviços internos usam esta rota.', 403);
  }
}
