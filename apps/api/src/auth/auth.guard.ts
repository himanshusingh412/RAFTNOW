import { Injectable, CanActivate, ExecutionContext, Logger, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FirebaseAuthService } from './firebase-auth.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { UnauthorizedException, ForbiddenException } from '../common/exceptions/api.exception';

export interface CustomerPrincipal {
  id: string;
  firebaseUid: string;
  phone: string;
  role: 'CUSTOMER';
}

export interface VendorPrincipal {
  id: string; // VendorMember ID
  firebaseUid: string;
  phone: string;
  role: 'OWNER' | 'MANAGER' | 'GUIDE';
  vendorId: string;
  vendorStatus: string;
}

export interface FirebasePrincipal {
  firebaseUid: string;
  phone: string | null;
}

function bearer(request: any): string {
  const authHeader = request.headers?.authorization as string | undefined;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new UnauthorizedException('Missing Bearer token');
  }
  return authHeader.slice(7).trim();
}

/**
 * Verifies a Firebase ID token only — no customer/vendor record required.
 * Used for vendor self-onboarding (the phone user becomes the vendor OWNER).
 */
@Injectable()
export class FirebaseUserGuard implements CanActivate {
  constructor(private readonly firebaseAuth: FirebaseAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const decoded = await this.firebaseAuth.verifyIdToken(bearer(request));
    request.firebaseUser = { firebaseUid: decoded.uid, phone: decoded.phone_number ?? null } as FirebasePrincipal;
    return true;
  }
}

@Injectable()
export class CustomerAuthGuard implements CanActivate {
  private readonly logger = new Logger(CustomerAuthGuard.name);

  constructor(
    private readonly firebaseAuth: FirebaseAuthService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const decoded = await this.firebaseAuth.verifyIdToken(bearer(request));

    if (!decoded.phone_number) {
      throw new UnauthorizedException('Token must have a phone number claim');
    }

    const user = await this.loadOrCreateUser(decoded.uid, decoded.phone_number);

    if (user.deleted_at) {
      throw new ForbiddenException('This account has been deleted');
    }

    request.user = {
      id: user.id,
      firebaseUid: decoded.uid,
      phone: user.phone,
      role: 'CUSTOMER',
    } satisfies CustomerPrincipal;

    return true;
  }

  /**
   * Load or create the customer. Concurrent first requests and a phone that was
   * previously registered under another Firebase UID (Firebase account
   * re-created) are handled: phone ownership was just proven by OTP, so the
   * existing customer record is re-linked to the new UID.
   */
  private async loadOrCreateUser(firebaseUid: string, phone: string) {
    const existing = await this.prisma.user.findUnique({ where: { firebase_uid: firebaseUid } });
    if (existing) return existing;
    try {
      return await this.prisma.user.create({ data: { firebase_uid: firebaseUid, phone } });
    } catch (err: any) {
      if (err?.code !== 'P2002') throw err;
      const raced = await this.prisma.user.findUnique({ where: { firebase_uid: firebaseUid } });
      if (raced) return raced;
      this.logger.warn(`Re-linking existing customer phone to a new Firebase UID`);
      return this.prisma.user.update({ where: { phone }, data: { firebase_uid: firebaseUid } });
    }
  }
}

export const VENDOR_ROLES_KEY = 'raftnow:vendor_roles';
/** Restricts a vendor endpoint to specific staff roles (default: any active member). */
export const VendorRoles = (...roles: Array<'OWNER' | 'MANAGER' | 'GUIDE'>) => SetMetadata(VENDOR_ROLES_KEY, roles);

@Injectable()
export class VendorAuthGuard implements CanActivate {
  constructor(
    private readonly firebaseAuth: FirebaseAuthService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const decoded = await this.firebaseAuth.verifyIdToken(bearer(request));

    const member = await this.prisma.vendorMember.findUnique({
      where: { firebase_uid: decoded.uid },
      include: { vendor: { select: { id: true, status: true } } },
    });

    if (!member || !member.active) {
      throw new UnauthorizedException('Not a registered vendor staff member');
    }

    const allowed = this.reflector.getAllAndOverride<string[] | undefined>(VENDOR_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed && allowed.length > 0 && !allowed.includes(member.role)) {
      throw new ForbiddenException(`Requires vendor role: ${allowed.join(' or ')}`);
    }

    request.user = {
      id: member.id,
      firebaseUid: decoded.uid,
      phone: member.phone,
      role: member.role,
      vendorId: member.vendor_id,
      vendorStatus: member.vendor.status,
    } satisfies VendorPrincipal;

    return true;
  }
}
