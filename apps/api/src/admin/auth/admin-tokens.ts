import * as jwt from 'jsonwebtoken';
import { HttpStatus } from '@nestjs/common';
import { ApiException, UnauthorizedException } from '../../common/exceptions/api.exception';

/**
 * Admin JWTs (HS256, JWT_SECRET). Three token types with distinct audiences so
 * one can never be used in place of another:
 *   admin_access  full session, issued only after password + TOTP
 *   admin_mfa     5 min, proves the password step; exchangeable for access via TOTP
 *   admin_enroll  15 min, password verified but TOTP not yet enrolled — can only
 *                 call the TOTP setup/enable endpoints
 * `tv` (token_version) lets logout / password change revoke all issued tokens.
 */
export type AdminTokenType = 'admin_access' | 'admin_mfa' | 'admin_enroll';

export interface AdminTokenClaims {
  sub: string;
  typ: AdminTokenType;
  tv: number;
  role: string;
}

const ISSUER = 'raftnow-api';
const TTL: Record<AdminTokenType, string> = {
  admin_access: process.env.JWT_EXPIRES_IN ?? '8h',
  admin_mfa: '5m',
  admin_enroll: '15m',
};

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32 || s.startsWith('change-me')) {
    throw new ApiException('ADMIN_AUTH_NOT_CONFIGURED', 'Admin authentication is not configured (JWT_SECRET)', HttpStatus.SERVICE_UNAVAILABLE);
  }
  return s;
}

export function signAdminToken(claims: AdminTokenClaims): { token: string; expires_at: string } {
  const token = jwt.sign({ typ: claims.typ, tv: claims.tv, role: claims.role }, secret(), {
    algorithm: 'HS256',
    subject: claims.sub,
    issuer: ISSUER,
    audience: claims.typ,
    expiresIn: TTL[claims.typ] as jwt.SignOptions['expiresIn'],
  });
  const decoded = jwt.decode(token) as { exp: number };
  return { token, expires_at: new Date(decoded.exp * 1000).toISOString() };
}

export function verifyAdminToken(token: string, expected: AdminTokenType): AdminTokenClaims {
  try {
    const payload = jwt.verify(token, secret(), { algorithms: ['HS256'], issuer: ISSUER, audience: expected }) as jwt.JwtPayload;
    if (payload.typ !== expected || typeof payload.sub !== 'string' || typeof payload.tv !== 'number') {
      throw new Error('bad claims');
    }
    return { sub: payload.sub, typ: expected, tv: payload.tv, role: String(payload.role) };
  } catch (err) {
    if (err instanceof ApiException) throw err;
    throw new UnauthorizedException('Invalid or expired admin session');
  }
}
