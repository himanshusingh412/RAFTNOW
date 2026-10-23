import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { BookingsService } from '../bookings/bookings.service';
import { RefundsService } from '../refunds/refunds.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { hmacSha256Hex, safeEqual } from '../common/crypto/field-encryption';

const MAX_WEBHOOK_ATTEMPTS = 12;
/** A webhook being processed is "leased" for this long before another worker may retry it. */
const LEASE_MS = 2 * 60 * 1000;

export interface CapturedPaymentEntity {
  id: string;
  order_id: string;
  amount: number;
  currency?: string;
  status?: string;
}

/**
 * Razorpay webhooks.
 *
 * 1. The signature is verified over the RAW body (HMAC-SHA256, constant time).
 * 2. The event is persisted BEFORE we answer 200 (gateway_event_id UNIQUE →
 *    duplicate deliveries are no-ops). Razorpay's event ID comes from the
 *    X-Razorpay-Event-Id header — the JSON body has no top-level "id".
 * 3. Processing runs asynchronously and is retried by the durable job until it
 *    succeeds; every handler is idempotent.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookingsService: BookingsService,
    private readonly refundsService: RefundsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      this.logger.error('RAZORPAY_WEBHOOK_SECRET not configured — rejecting webhook');
      return false;
    }
    return safeEqual(signature, hmacSha256Hex(secret, rawBody));
  }

  /** Checkout callback signature: HMAC_SHA256(order_id|payment_id, key_secret). */
  verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) return false;
    return safeEqual(signature, hmacSha256Hex(secret, `${orderId}|${paymentId}`));
  }

  static eventIdFor(headerId: string | undefined, payload: Record<string, unknown>, rawBody: Buffer): string {
    if (headerId && /^[A-Za-z0-9_\-]{6,64}$/.test(headerId)) return headerId;
    if (typeof payload?.id === 'string' && payload.id) return payload.id as string;
    return `sha256:${createHash('sha256').update(rawBody).digest('hex')}`;
  }

  /** Persists the event. Returns false when it was already processed. */
  async recordEvent(eventId: string, eventType: string, payload: Record<string, unknown>) {
    const existing = await this.prisma.webhookEvent.findUnique({ where: { gateway_event_id: eventId } });
    if (existing) return { id: existing.id, duplicate: true, processed: !!existing.processed_at };
    try {
      const created = await this.prisma.webhookEvent.create({
        data: { gateway: 'razorpay', gateway_event_id: eventId, event_type: eventType, payload: payload as Prisma.InputJsonValue },
      });
      return { id: created.id, duplicate: false, processed: false };
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const again = await this.prisma.webhookEvent.findUniqueOrThrow({ where: { gateway_event_id: eventId } });
        return { id: again.id, duplicate: true, processed: !!again.processed_at };
      }
      throw err;
    }
  }

  /** Claims (leases) and processes one stored event. */
  async processStoredEvent(webhookRowId: string): Promise<'processed' | 'failed' | 'skipped'> {
    const leaseCutoff = new Date(Date.now() - LEASE_MS);
    const claim = await this.prisma.webhookEvent.updateMany({
      where: {
        id: webhookRowId,
        processed_at: null,
        attempts: { lt: MAX_WEBHOOK_ATTEMPTS },
        OR: [{ last_attempt_at: null }, { last_attempt_at: { lt: leaseCutoff } }],
      },
      data: { attempts: { increment: 1 }, last_attempt_at: new Date() },
    });
    if (claim.count === 0) return 'skipped';

    const ev = await this.prisma.webhookEvent.findUniqueOrThrow({ where: { id: webhookRowId } });
    try {
      await this.handleEvent(ev.event_type, ev.payload as Record<string, unknown>);
      await this.prisma.webhookEvent.update({
        where: { id: ev.id },
        data: { processed_at: new Date(), processing_error: null },
      });
      this.logger.log(`Webhook ${ev.gateway_event_id} (${ev.event_type}) processed`);
      return 'processed';
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      this.logger.error(`Webhook ${ev.gateway_event_id} (${ev.event_type}) attempt ${ev.attempts} failed: ${message}`);
      await this.prisma.webhookEvent.update({ where: { id: ev.id }, data: { processing_error: message } });
      return 'failed';
    }
  }

  /** Durable retry sweep (job). */
  async retryUnprocessed(limit = 50) {
    const leaseCutoff = new Date(Date.now() - LEASE_MS);
    const due = await this.prisma.webhookEvent.findMany({
      where: {
        processed_at: null,
        attempts: { lt: MAX_WEBHOOK_ATTEMPTS },
        OR: [{ last_attempt_at: null }, { last_attempt_at: { lt: leaseCutoff } }],
      },
      orderBy: { created_at: 'asc' },
      select: { id: true },
      take: limit,
    });
    const stats = { due: due.length, processed: 0, failed: 0, skipped: 0 };
    for (const e of due) stats[await this.processStoredEvent(e.id)]++;
    return stats;
  }

  private async handleEvent(eventType: string, payload: Record<string, unknown>) {
    const p = (payload as any)?.payload ?? {};
    switch (eventType) {
      case 'payment.captured':
      case 'order.paid':
        if (!p.payment?.entity) throw new Error('Missing payment entity');
        await this.handleCapturedPayment(p.payment.entity);
        return;
      case 'payment.authorized':
        await this.handlePaymentAuthorized(p.payment?.entity);
        return;
      case 'payment.failed':
        await this.handlePaymentFailed(p.payment?.entity);
        return;
      case 'refund.processed':
        await this.handleRefund(p.refund?.entity, 'PROCESSED');
        return;
      case 'refund.failed':
        await this.handleRefund(p.refund?.entity, 'FAILED');
        return;
      case 'transfer.processed':
        await this.handleTransferProcessed(p.transfer?.entity);
        return;
      case 'transfer.failed':
        await this.handleTransferFailed(p.transfer?.entity);
        return;
      case 'settlement.processed':
        await this.handleSettlementProcessed(p.settlement?.entity);
        return;
      default:
        if (eventType.startsWith('product.route.') || eventType.startsWith('account.')) {
          await this.handleRouteAccountEvent(eventType, payload);
          return;
        }
        this.logger.log(`Unhandled Razorpay event type: ${eventType}`);
    }
  }

  /**
   * Shared by the webhook, the checkout verify callback and payment
   * reconciliation. Idempotent.
   */
  async handleCapturedPayment(entity: CapturedPaymentEntity) {
    const payment = await this.prisma.payment.findUnique({ where: { razorpay_order_id: entity.order_id } });
    if (!payment) throw new Error(`No payment record for order ${entity.order_id}`);
    if (BigInt(entity.amount) !== payment.amount_paise) {
      // Never confirm on an amount mismatch. Flag for ops; do not auto-retry forever.
      await this.audit.log({
        actor_type: 'SYSTEM',
        action: 'PAYMENT_AMOUNT_MISMATCH',
        entity_type: 'Payment',
        entity_id: payment.id,
        data: { expected_paise: payment.amount_paise.toString(), received_paise: String(entity.amount), razorpay_payment_id: entity.id },
      });
      throw new Error(`Amount mismatch on order ${entity.order_id}`);
    }
    if (entity.currency && entity.currency !== 'INR') throw new Error(`Unexpected currency ${entity.currency}`);

    if (payment.status !== 'CAPTURED') {
      await this.prisma.payment.updateMany({
        where: { id: payment.id, status: { not: 'CAPTURED' } },
        data: { status: 'CAPTURED', razorpay_payment_id: entity.id, captured_at: new Date(), failure_reason: null },
      });
    }
    return this.bookingsService.confirmBookingAfterPayment(payment.id, entity.id);
  }

  private async handlePaymentAuthorized(entity: any) {
    if (!entity?.order_id) return;
    await this.prisma.payment.updateMany({
      where: { razorpay_order_id: entity.order_id, status: 'CREATED' },
      data: { status: 'AUTHORIZED', razorpay_payment_id: entity.id },
    });
  }

  /**
   * A failed attempt does NOT expire the booking: Razorpay lets the customer
   * retry on the same order while the hold is valid. The hold-expiry job
   * releases the seats if no successful payment follows.
   */
  private async handlePaymentFailed(entity: any) {
    if (!entity?.order_id) return;
    await this.prisma.payment.updateMany({
      where: { razorpay_order_id: entity.order_id, status: { in: ['CREATED', 'AUTHORIZED'] } },
      data: {
        failed_at: new Date(),
        failure_reason: String(entity.error_description ?? entity.error_code ?? 'payment failed').slice(0, 300),
      },
    });
  }

  private async handleRefund(entity: any, outcome: 'PROCESSED' | 'FAILED') {
    if (!entity?.id) return;
    const r = await this.refundsService.markFromWebhook(entity, outcome);
    if (!r) throw new Error(`No refund matches ${entity.id}`); // may arrive before we stored the ID → retried
    if (!r.changed) return;
    if (outcome === 'PROCESSED') {
      await this.notifications.sendRefundProcessed(r.refund.booking_id, r.refund.amount_paise, r.refund.id);
    } else {
      await this.notifications.sendRefundFailed(r.refund.booking_id, r.refund.amount_paise, r.refund.id);
    }
  }

  private async handleTransferProcessed(entity: any) {
    if (!entity?.id) return;
    const transferId = entity?.notes?.transfer_id;
    await this.prisma.transfer.updateMany({
      where: {
        OR: [
          { razorpay_transfer_id: entity.id },
          ...(transferId && /^[0-9a-f-]{36}$/i.test(transferId) ? [{ id: transferId, status: 'PROCESSING' as const }] : []),
        ],
        status: { in: ['PROCESSING', 'RELEASED'] },
      },
      data: {
        status: 'RELEASED',
        razorpay_transfer_id: entity.id,
        released_at: new Date(),
        ...(entity.recipient_settlement_id ? { razorpay_settlement_id: entity.recipient_settlement_id } : {}),
      },
    });
  }

  private async handleTransferFailed(entity: any) {
    if (!entity?.id) return;
    await this.prisma.transfer.updateMany({
      where: { razorpay_transfer_id: entity.id },
      data: { status: 'FAILED', failed_at: new Date(), last_error: `GATEWAY_TRANSFER_FAILED: ${entity.error?.description ?? ''}`.slice(0, 300) },
    });
    this.logger.error(`Razorpay reported transfer ${entity.id} FAILED — needs ops attention`);
  }

  private async handleSettlementProcessed(entity: any) {
    if (!entity?.id) return;
    await this.prisma.transfer.updateMany({
      where: { razorpay_settlement_id: entity.id, status: 'RELEASED' },
      data: { status: 'SETTLED', settled_at: new Date(), utr: entity.utr ?? null },
    });
  }

  private async handleRouteAccountEvent(eventType: string, payload: any) {
    const accountId: string | undefined =
      payload?.account_id ?? payload?.payload?.account?.entity?.id ?? payload?.payload?.merchant_product?.entity?.merchant_id;
    const status: string | undefined =
      payload?.payload?.merchant_product?.entity?.activation_status ?? payload?.payload?.account?.entity?.status ?? eventType;
    if (!accountId) return;
    await this.prisma.vendor.updateMany({
      where: { razorpay_linked_account_id: accountId },
      data: { razorpay_kyc_status: String(status).slice(0, 64) },
    });
  }
}
