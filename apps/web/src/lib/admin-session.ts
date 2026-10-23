/**
 * Admin console session (email + password + mandatory TOTP — see
 * apps/api/src/admin/auth). The short-lived admin JWT is kept in
 * sessionStorage only, so it is dropped when the tab closes. Passwords are
 * never stored anywhere in the browser. Authorisation is enforced by the API
 * (AdminAuthGuard); this module only carries the token.
 */
import { request } from './api';

const TOKEN_KEY = 'raftnow.admin.token';

export const readAdminToken = (): string | null => {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

export const writeAdminToken = (t: string | null) => {
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
};

export interface AdminMe {
  id: string;
  email: string;
  role: string;
  permissions: string[];
}

/** Validates the stored admin session against the API. Throws ApiError (401 when expired/revoked). */
export const fetchAdminMe = () => request<AdminMe>('/admin/auth/me', { token: readAdminToken });
