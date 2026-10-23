import { SetMetadata } from '@nestjs/common';

/**
 * Role-based access control for the admin API. Authorization is enforced by
 * AdminAuthGuard on the server for every privileged route — the React admin UI
 * merely mirrors these rules for display.
 */
export const PERMISSIONS = [
  'closures:read',
  'closures:write',
  'vendors:read',
  'vendors:review',
  'vendors:kyc_documents',
  'vendors:route',
  'vendors:commission',
  'bookings:read',
  'bookings:cancel',
  'finance:read',
  'finance:write',
  'audit:read',
  'admins:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type AdminRoleName = 'SUPER_ADMIN' | 'OPS' | 'FINANCE';

export const ROLE_PERMISSIONS: Record<AdminRoleName, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS,
  OPS: [
    'closures:read',
    'closures:write',
    'vendors:read',
    'vendors:review',
    'vendors:kyc_documents',
    'bookings:read',
    'bookings:cancel',
    'finance:read',
    'audit:read',
  ],
  FINANCE: [
    'closures:read',
    'vendors:read',
    'vendors:route',
    'vendors:commission',
    'bookings:read',
    'finance:read',
    'finance:write',
    'audit:read',
  ],
};

export function roleHas(role: AdminRoleName, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export const ADMIN_PERMISSIONS_KEY = 'raftnow:admin_permissions';
/** Every listed permission is required. */
export const RequirePermissions = (...perms: Permission[]) => SetMetadata(ADMIN_PERMISSIONS_KEY, perms);
