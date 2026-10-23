import { Injectable, Logger } from '@nestjs/common';
import { PrismaService, TxClient } from '../common/prisma/prisma.service';

export interface AuditLogInput {
  actor_type: 'ADMIN' | 'VENDOR' | 'CUSTOMER' | 'SYSTEM';
  actor_id?: string;
  admin_id?: string;
  action: string;
  entity_type: string;
  entity_id: string;
  data?: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
}

/** Keys whose values must never be written to the audit trail. */
const REDACTED_KEYS = /pass(word)?|secret|token|otp|totp|pan$|^pan|account_number|bank_account|authorization|signature/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACTED_KEYS.test(k) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  private toData(input: AuditLogInput) {
    return {
      actor_type: input.actor_type,
      actor_id: input.actor_id ?? null,
      admin_id: input.admin_id ?? null,
      action: input.action,
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      data: (redact(input.data ?? {}) as any) ?? {},
      ip_address: input.ip_address ?? null,
      user_agent: input.user_agent ?? null,
    };
  }

  /**
   * Records an audit entry. Best-effort: errors are logged, never thrown.
   * Use for SYSTEM side effects where the primary operation already succeeded.
   */
  async log(input: AuditLogInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({ data: this.toData(input) });
    } catch (err) {
      this.logger.error(
        `Failed to write audit log [${input.action} on ${input.entity_type}/${input.entity_id}]: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  /**
   * Records an audit entry inside the caller's transaction. If the audit write
   * fails, the privileged operation rolls back with it — admin actions are never
   * performed without a trail.
   */
  async logInTx(tx: TxClient, input: AuditLogInput): Promise<void> {
    await tx.auditLog.create({ data: this.toData(input) });
  }

  async getLogsForEntity(entityType: string, entityId: string, limit = 50) {
    return this.prisma.auditLog.findMany({
      where: { entity_type: entityType, entity_id: entityId },
      orderBy: { created_at: 'desc' },
      take: limit,
    });
  }

  async search(params: { entity_type?: string; entity_id?: string; action?: string; actor_id?: string; limit?: number; before?: Date }) {
    return this.prisma.auditLog.findMany({
      where: {
        entity_type: params.entity_type,
        entity_id: params.entity_id,
        action: params.action,
        actor_id: params.actor_id,
        created_at: params.before ? { lt: params.before } : undefined,
      },
      include: { admin: { select: { id: true, email: true, role: true } } },
      orderBy: { created_at: 'desc' },
      take: Math.min(params.limit ?? 100, 500),
    });
  }
}
