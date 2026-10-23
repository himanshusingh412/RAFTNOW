import type { Request } from 'express';

export interface RequestMeta {
  ip_address?: string;
  user_agent?: string;
}

/** Extracts client IP and user agent for audit logging. */
export function requestMeta(req: Request | any): RequestMeta {
  const forwarded = req?.headers?.['x-forwarded-for'];
  const ip =
    (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : undefined) ??
    req?.ip ??
    req?.socket?.remoteAddress;
  const ua = req?.headers?.['user-agent'];
  return {
    ip_address: ip ? String(ip).slice(0, 64) : undefined,
    user_agent: ua ? String(ua).slice(0, 256) : undefined,
  };
}
