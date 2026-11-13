import { verifyAccessToken } from '@scc/shared';
import { SignJWT } from 'jose';

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

/** Returns the account id. Same rules as every other service: see @scc/shared. */
export function verifyToken(token: string, options: Pick<TokenOptions, 'secret' | 'issuer'>): Promise<string> {
  return verifyAccessToken(token, options);
}
