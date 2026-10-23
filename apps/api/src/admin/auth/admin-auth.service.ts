import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { Admin } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { ApiException, ConflictException, NotFoundException, UnauthorizedException } from '../../common/exceptions/api.exception';
import { decryptField, encryptField } from '../../common/crypto/field-encryption';
import { signAdminToken, verifyAdminToken } from './admin-tokens';
import { ROLE_PERMISSIONS, AdminRoleName } from '../permissions';

const BCRYPT_COST = 12;
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;
const TOTP_ISSUER = 'RaftNow Admin';
/** bcrypt hash of a random string; compared against when the email is unknown so timing does not reveal accounts. */
let dummyHash: string | null = null;
const getDummyHash = () => (dummyHash ??= bcrypt.hashSync(randomBytes(16).toString('hex'), BCRYPT_COST));

const totp = authenticator.clone({ window: 1, step: 30 });

export interface Meta {
  ip_address?: string;
  user_agent?: string;
}

export function validatePasswordStrength(pw: string) {
  const problems: string[] = [];
  if (pw.length < 12) problems.push('at least 12 characters');
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw)) problems.push('upper and lower case letters');
  if (!/\d/.test(pw)) problems.push('a digit');
  if (pw.length > 128) problems.push('at most 128 characters');
  if (problems.length) {
    throw new ApiException('WEAK_PASSWORD', `Password needs ${problems.join(', ')}`, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

/**
 * Admin authentication: email + password (bcrypt) + mandatory TOTP 2FA.
 *
 * login ──password ok──▶ totp enrolled?  ──yes──▶ mfa_token ──/mfa/verify(code)──▶ access_token
 *                                         └─no──▶ enrollment_token ──/totp/setup──▶ /totp/enable(code)──▶ access_token
 *
 * Passwords, TOTP secrets and codes are never logged or returned (the TOTP
 * secret is shown exactly once, during enrolment, so it can be added to an
 * authenticator app).
 */
@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  publicView(a: Admin) {
    return {
      id: a.id,
      email: a.email,
      name: a.name,
      role: a.role,
      active: a.active,
      totp_enabled: a.totp_enabled,
      last_login_at: a.last_login_at?.toISOString() ?? null,
      permissions: ROLE_PERMISSIONS[a.role as AdminRoleName],
    };
  }

  async login(email: string, password: string, meta: Meta) {
    const admin = await this.prisma.admin.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!admin) {
      await bcrypt.compare(password, getDummyHash());
      await this.audit.log({ actor_type: 'SYSTEM', action: 'ADMIN_LOGIN_FAILED', entity_type: 'Admin', entity_id: '00000000-0000-0000-0000-000000000000', data: { reason: 'UNKNOWN_EMAIL' }, ...meta });
      throw new UnauthorizedException('Invalid email or password');
    }
    if (admin.locked_until && admin.locked_until > new Date()) {
      throw new ApiException('ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.', 423 as HttpStatus, {
        locked_until: admin.locked_until.toISOString(),
      });
    }
    const ok = await bcrypt.compare(password, admin.password_hash);
    if (!ok || !admin.active) {
      const failures = admin.failed_login_count + 1;
      const lock = failures >= MAX_FAILED_LOGINS;
      await this.prisma.admin.update({
        where: { id: admin.id },
        data: {
          failed_login_count: lock ? 0 : failures,
          locked_until: lock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : admin.locked_until,
        },
      });
      await this.audit.log({
        actor_type: 'ADMIN',
        actor_id: admin.id,
        admin_id: admin.id,
        action: lock ? 'ADMIN_ACCOUNT_LOCKED' : 'ADMIN_LOGIN_FAILED',
        entity_type: 'Admin',
        entity_id: admin.id,
        data: { reason: admin.active ? 'BAD_PASSWORD' : 'INACTIVE', failures },
        ...meta,
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.prisma.admin.update({ where: { id: admin.id }, data: { failed_login_count: 0, locked_until: null } });

    if (!admin.totp_enabled) {
      const t = signAdminToken({ sub: admin.id, typ: 'admin_enroll', tv: admin.token_version, role: admin.role });
      return { step: 'ENROLL_TOTP' as const, enrollment_token: t.token, expires_at: t.expires_at };
    }
    const t = signAdminToken({ sub: admin.id, typ: 'admin_mfa', tv: admin.token_version, role: admin.role });
    return { step: 'VERIFY_TOTP' as const, mfa_token: t.token, expires_at: t.expires_at };
  }

  private async adminForToken(token: string, typ: 'admin_mfa' | 'admin_enroll') {
    const claims = verifyAdminToken(token, typ);
    const admin = await this.prisma.admin.findUnique({ where: { id: claims.sub } });
    if (!admin || !admin.active || admin.token_version !== claims.tv) {
      throw new UnauthorizedException('Invalid or expired admin session');
    }
    return admin;
  }

  /**
   * Verifies a TOTP code and records its time-step so the same code cannot be
   * replayed within its validity window.
   */
  private async consumeTotp(admin: Admin, code: string): Promise<boolean> {
    if (!admin.totp_secret || !/^\d{6}$/.test(code)) return false;
    const secret = decryptField(admin.totp_secret);
    const delta = totp.checkDelta(code, secret);
    if (delta === null) return false;
    const step = Math.floor(Date.now() / 1000 / 30) + delta;
    const res = await this.prisma.admin.updateMany({
      where: { id: admin.id, OR: [{ totp_last_used_step: null }, { totp_last_used_step: { lt: step } }] },
      data: { totp_last_used_step: step },
    });
    return res.count === 1;
  }

  async verifyMfa(mfaToken: string, code: string, meta: Meta) {
    const admin = await this.adminForToken(mfaToken, 'admin_mfa');
    if (!admin.totp_enabled) throw new UnauthorizedException('Two-factor authentication is not enrolled');
    if (!(await this.consumeTotp(admin, code))) {
      await this.audit.log({ actor_type: 'ADMIN', actor_id: admin.id, admin_id: admin.id, action: 'ADMIN_MFA_FAILED', entity_type: 'Admin', entity_id: admin.id, ...meta });
      throw new UnauthorizedException('Invalid authentication code');
    }
    return this.issueSession(admin, meta, 'ADMIN_LOGIN');
  }

  /** Generates (or regenerates) a pending TOTP secret during enrolment. */
  async setupTotp(enrollmentToken: string) {
    const admin = await this.adminForToken(enrollmentToken, 'admin_enroll');
    if (admin.totp_enabled) throw new ConflictException('TOTP_ALREADY_ENABLED', 'Two-factor authentication is already enabled');
    const secret = totp.generateSecret(20);
    await this.prisma.admin.update({ where: { id: admin.id }, data: { totp_secret: encryptField(secret), totp_last_used_step: null } });
    const otpauthUrl = totp.keyuri(admin.email, TOTP_ISSUER, secret);
    return {
      otpauth_url: otpauthUrl,
      qr_data_url: await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 }),
      secret, // shown once so it can be typed into an authenticator app
    };
  }

  async enableTotp(enrollmentToken: string, code: string, meta: Meta) {
    const admin = await this.adminForToken(enrollmentToken, 'admin_enroll');
    if (admin.totp_enabled) throw new ConflictException('TOTP_ALREADY_ENABLED', 'Two-factor authentication is already enabled');
    if (!admin.totp_secret) throw new ApiException('TOTP_SETUP_REQUIRED', 'Call /admin/auth/totp/setup first', HttpStatus.CONFLICT);
    if (!(await this.consumeTotp(admin, code))) throw new UnauthorizedException('Invalid authentication code');
    const enabled = await this.prisma.admin.update({ where: { id: admin.id }, data: { totp_enabled: true } });
    await this.audit.log({ actor_type: 'ADMIN', actor_id: admin.id, admin_id: admin.id, action: 'ADMIN_2FA_ENROLLED', entity_type: 'Admin', entity_id: admin.id, ...meta });
    return this.issueSession(enabled, meta, 'ADMIN_LOGIN');
  }

  private async issueSession(admin: Admin, meta: Meta, action: string) {
    const updated = await this.prisma.admin.update({ where: { id: admin.id }, data: { last_login_at: new Date() } });
    await this.audit.log({ actor_type: 'ADMIN', actor_id: admin.id, admin_id: admin.id, action, entity_type: 'Admin', entity_id: admin.id, ...meta });
    const t = signAdminToken({ sub: admin.id, typ: 'admin_access', tv: admin.token_version, role: admin.role });
    return { step: 'DONE' as const, access_token: t.token, expires_at: t.expires_at, admin: this.publicView(updated) };
  }

  /** Revokes every token issued to this admin. */
  async logout(adminId: string, meta: Meta) {
    await this.prisma.admin.update({ where: { id: adminId }, data: { token_version: { increment: 1 } } });
    await this.audit.log({ actor_type: 'ADMIN', actor_id: adminId, admin_id: adminId, action: 'ADMIN_LOGOUT', entity_type: 'Admin', entity_id: adminId, ...meta });
    return { logged_out: true };
  }

  async changePassword(adminId: string, current: string, next: string, code: string, meta: Meta) {
    const admin = await this.prisma.admin.findUniqueOrThrow({ where: { id: adminId } });
    if (!(await bcrypt.compare(current, admin.password_hash))) throw new UnauthorizedException('Current password is incorrect');
    if (!(await this.consumeTotp(admin, code))) throw new UnauthorizedException('Invalid authentication code');
    validatePasswordStrength(next);
    await this.prisma.admin.update({
      where: { id: adminId },
      data: { password_hash: await bcrypt.hash(next, BCRYPT_COST), token_version: { increment: 1 } },
    });
    await this.audit.log({ actor_type: 'ADMIN', actor_id: adminId, admin_id: adminId, action: 'ADMIN_PASSWORD_CHANGED', entity_type: 'Admin', entity_id: adminId, ...meta });
    return { changed: true, reauthenticate: true };
  }

  // ── Admin management (SUPER_ADMIN) ───────────────────────────────────────

  async list() {
    const admins = await this.prisma.admin.findMany({ orderBy: { created_at: 'asc' } });
    return admins.map((a) => this.publicView(a));
  }

  /** Creates an admin with a one-time temporary password (returned once). */
  async create(actorId: string, email: string, role: AdminRoleName, name: string | undefined, meta: Meta) {
    const normalized = email.trim().toLowerCase();
    if (await this.prisma.admin.findUnique({ where: { email: normalized } })) {
      throw new ConflictException('ADMIN_EXISTS', 'An admin with this email already exists');
    }
    const tempPassword = `${randomBytes(12).toString('base64url')}A9a`;
    const admin = await this.prisma.withTransaction(async (tx) => {
      const a = await tx.admin.create({
        data: { email: normalized, name: name ?? null, role, password_hash: await bcrypt.hash(tempPassword, BCRYPT_COST) },
      });
      await this.audit.logInTx(tx, {
        actor_type: 'ADMIN', actor_id: actorId, admin_id: actorId, action: 'ADMIN_CREATED', entity_type: 'Admin', entity_id: a.id,
        data: { email: normalized, role }, ...meta,
      });
      return a;
    });
    return { admin: this.publicView(admin), temporary_password: tempPassword };
  }

  async update(actorId: string, targetId: string, patch: { role?: AdminRoleName; active?: boolean }, meta: Meta) {
    if (actorId === targetId && (patch.active === false || (patch.role && patch.role !== 'SUPER_ADMIN'))) {
      throw new ConflictException('SELF_LOCKOUT', 'You cannot deactivate or demote yourself');
    }
    return this.prisma.withTransaction(async (tx) => {
      const before = await tx.admin.findUnique({ where: { id: targetId } });
      if (!before) throw new NotFoundException('Admin');
      const after = await tx.admin.update({
        where: { id: targetId },
        data: { ...patch, ...(patch.active === false || patch.role ? { token_version: { increment: 1 } } : {}) },
      });
      await this.audit.logInTx(tx, {
        actor_type: 'ADMIN', actor_id: actorId, admin_id: actorId, action: 'ADMIN_UPDATED', entity_type: 'Admin', entity_id: targetId,
        data: { before: { role: before.role, active: before.active }, after: { role: after.role, active: after.active } }, ...meta,
      });
      return this.publicView(after);
    });
  }

  async resetTotp(actorId: string, targetId: string, meta: Meta) {
    return this.prisma.withTransaction(async (tx) => {
      const a = await tx.admin.update({
        where: { id: targetId },
        data: { totp_enabled: false, totp_secret: null, totp_last_used_step: null, token_version: { increment: 1 } },
      });
      await this.audit.logInTx(tx, {
        actor_type: 'ADMIN', actor_id: actorId, admin_id: actorId, action: 'ADMIN_2FA_RESET', entity_type: 'Admin', entity_id: targetId, ...meta,
      });
      return this.publicView(a);
    });
  }
}
