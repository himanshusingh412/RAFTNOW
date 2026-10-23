import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ForbiddenException, UnauthorizedException } from '../../common/exceptions/api.exception';
import { verifyAdminToken } from './admin-tokens';
import { ADMIN_PERMISSIONS_KEY, AdminRoleName, Permission, roleHas } from '../permissions';

export interface AdminPrincipal {
  id: string;
  email: string;
  role: AdminRoleName;
}

/**
 * Server-side authorization for every admin route:
 *  1. Bearer token must be an `admin_access` JWT (password + TOTP completed).
 *  2. The admin must still exist, be active, have 2FA enabled, and the token's
 *     version must match (logout / password change / deactivation revoke it).
 *  3. The admin's role must grant every permission declared with
 *     @RequirePermissions on the handler or controller.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header = req.headers?.authorization as string | undefined;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Missing admin session');
    const claims = verifyAdminToken(header.slice(7).trim(), 'admin_access');

    const admin = await this.prisma.admin.findUnique({ where: { id: claims.sub } });
    if (!admin || !admin.active || !admin.totp_enabled || admin.token_version !== claims.tv) {
      throw new UnauthorizedException('Invalid or expired admin session');
    }

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(ADMIN_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const role = admin.role as AdminRoleName;
    const missing = (required ?? []).filter((p) => !roleHas(role, p));
    if (missing.length > 0) {
      throw new ForbiddenException(`Your role (${role}) lacks permission: ${missing.join(', ')}`);
    }

    req.admin = { id: admin.id, email: admin.email, role } satisfies AdminPrincipal;
    return true;
  }
}
