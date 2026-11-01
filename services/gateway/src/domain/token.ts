import { AppError } from '@scc/shared';
import { SignJWT, errors, jwtVerify } from 'jose';

/** This API, plus the SCC Builder, which validates the same token. */
export const AUDIENCES = ['scc-api', 'scc-builder'];

export interface TokenOptions {
  secret: string;
  issuer: string;
  ttlSeconds: number;
}

const key = (secret: string) => new TextEncoder().encode(secret);

export async function issueToken(accountId: string, options: TokenOptions, now: Date) {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAt = issuedAt + options.ttlSeconds;
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(accountId)
    .setIssuer(options.issuer)
    .setAudience(AUDIENCES)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(key(options.secret));

  return { token, expiresIn: options.ttlSeconds };
}

/** Returns the account id. The algorithm is pinned: the token header is never trusted. */
export async function verifyToken(
  token: string,
  options: Pick<TokenOptions, 'secret' | 'issuer'>,
): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, key(options.secret), {
      algorithms: ['HS256'],
      issuer: options.issuer,
      audience: 'scc-api',
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
