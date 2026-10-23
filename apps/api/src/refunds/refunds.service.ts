import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, TxClient } from '../common/prisma/prisma.service';
import { TransfersService } from '../transfers/transfers.service';
import { AuditService } from '../audit/audit.service';
import { RazorpayGateway, GatewayError } from '../common/razorpay/razorpay.gateway';

export interface QueueRefundInput {
  bookingId: string;
  amountPaise: bigint;
  reason: string;
  /** One refund per cause, enforced by a UNIQUE index. */
  idempotencyKey: string;
  initiatedByType: 'CUSTOMER' | 'VENDOR' | 'ADMIN' | 'SYSTEM';
  initiatedById?: string | null;
  /** Refund against a specific captured payment (defaults to the latest captured). */
  paymentId?: string;
}

const MAX_REFUND_ATTEMPTS = 6;
const AMBIGUOUS_AFTER_MS = 10 * 60 * 1000;

/**
 * Customer refunds via Razorpay.
 *
 * States: PENDING ──claim──▶ PROCESSING ──webhook/reconcile──▶ PROCESSED
 *                                │                └────────────▶ FAILED
 *                                └─(gateway 4xx: not created)──▶ PENDING (backoff) / FAILED
 *
 * Duplicate-refund protection (the previous implementation re-submitted every
 * PENDING refund on each job run, issuing a second Razorpay refund every
 * 5 minutes until the webhook arrived):
 *  1. A refund is claimed (PENDING → PROCESSING) before Razorpay is called;
 *     the job only ever selects PENDING rows.
 *  2. If the gateway outcome is unknown, the row stays PROCESSING; reconciliation
 *     looks the refund up on Razorpay by notes.refund_id before any retry.
 *  3. The total of non-failed refunds for a payment can never exceed the
 *     captured amount (checked under a payment row lock).
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transfers: TransfersService,
    private readonly audit: AuditService,
    private readonly gateway: RazorpayGateway,
  ) {}

  /**
   * Queues a refund inside the caller's transaction and adjusts the vendor
   * transfer accordingly. Returns null when nothing is refundable (e.g. the
   * booking was never paid). Idempotent on idempotencyKey.
   */
  async queueRefundInTx(tx: TxClient, input: QueueRefundInput) {
    const existing = await tx.refund.findUnique({ where: { idempotency_key: input.idempotencyKey } });
    if (existing) return existing;
    if (input.amountPaise <= 0n) return null;

    const payments = await tx.$queryRaw<Array<{ id: string; amount_paise: bigint }>>`
      SELECT id, amount_paise FROM payments
      WHERE booking_id = ${input.bookingId}::uuid
        AND status = 'CAPTURED'
        ${input.paymentId ? Prisma.sql`AND id = ${input.paymentId}::uuid` : Prisma.empty}
      ORDER BY captured_at DESC NULLS LAST
      LIMIT 1
      FOR UPDATE
    `;
    const payment = payments[0];
    if (!payment) return null;

    const already = await tx.refund.aggregate({
      where: { payment_id: payment.id, status: { not: 'FAILED' } },
      _sum: { amount_paise: true },
    });
    const remaining = payment.amount_paise - (already._sum.amount_paise ?? 0n);
    const amount = input.amountPaise > remaining ? remaining : input.amountPaise;
    if (amount <= 0n) {
      this.logger.warn(`Refund ${input.idempotencyKey}: payment ${payment.id} already fully refunded`);
      return null;
    }

    const refund = await tx.refund.create({
      data: {
        booking_id: input.bookingId,
        payment_id: payment.id,
        amount_paise: amount,
        reason: input.reason,
        status: 'PENDING',
        initiated_by_type: input.initiatedByType,
        initiated_by_id: input.initiatedById ?? null,
        idempotency_key: input.idempotencyKey,
      },
    });
    await this.transfers.applyRefundToTransferInTx(tx, input.bookingId);
    return refund;
  }

  // ── Submission ───────────────────────────────────────────────────────────

  async processPendingRefunds(limit = 50) {
    // Exponential backoff between attempts: 1, 2, 4, 8 ... minutes.
    const claimed = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE refunds
      SET status = 'PROCESSING', attempt_count = attempt_count + 1, last_attempt_at = NOW(), updated_at = NOW()
      WHERE id IN (
        SELECT id FROM refunds
        WHERE status = 'PENDING'
          AND (last_attempt_at IS NULL
               OR last_attempt_at < NOW() - make_interval(mins => LEAST(60, POWER(2, GREATEST(attempt_count - 1, 0))::int)))
        ORDER BY created_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `;
    const stats = { claimed: claimed.length, submitted: 0, retry: 0, failed: 0, unknown: 0 };
    for (const { id } of claimed) {
      stats[await this.submitClaimedRefund(id)]++;
    }
    if (claimed.length) this.logger.log(`Refund run: ${JSON.stringify(stats)}`);
    return stats;
  }

  private async submitClaimedRefund(id: string): Promise<'submitted' | 'retry' | 'failed' | 'unknown'> {
    const refund = await this.prisma.refund.findUniqueOrThrow({
      where: { id },
      include: { payment: true },
    });
    const rzpPaymentId = refund.payment?.razorpay_payment_id;
    if (!rzpPaymentId) {
      await this.prisma.refund.update({
        where: { id },
        data: { status: 'FAILED', failure_reason: 'NO_CAPTURED_PAYMENT' },
      });
      return 'failed';
    }

    try {
      const rzp: any = await this.gateway.refundPayment(rzpPaymentId, {
        amount: Number(refund.amount_paise),
        speed: 'normal',
        receipt: refund.id,
        notes: { refund_id: refund.id, booking_id: refund.booking_id, reason: refund.reason },
      });
      await this.prisma.refund.update({
        where: { id },
        data: {
          razorpay_refund_id: rzp.id,
          submitted_at: new Date(),
          failure_reason: null,
          ...(rzp.status === 'processed' ? { status: 'PROCESSED', processed_at: new Date() } : {}),
        },
      });
      await this.audit.log({
        actor_type: 'SYSTEM',
        action: 'REFUND_SUBMITTED',
        entity_type: 'Refund',
        entity_id: id,
        data: { razorpay_refund_id: rzp.id, amount_paise: refund.amount_paise.toString(), booking_id: refund.booking_id },
      });
      return 'submitted';
    } catch (err) {
      if (err instanceof GatewayError && err.notCreated) {
        const giveUp = refund.attempt_count >= MAX_REFUND_ATTEMPTS && err.code !== 'GATEWAY_NOT_CONFIGURED';
        await this.prisma.refund.update({
          where: { id },
          data: {
            status: giveUp ? 'FAILED' : 'PENDING',
            failure_reason: `${err.code ?? 'GATEWAY_ERROR'}: ${err.message}`.slice(0, 300),
          },
        });
        return giveUp ? 'failed' : 'retry';
      }
      await this.prisma.refund.update({
        where: { id },
        data: { failure_reason: `UNKNOWN_OUTCOME: ${(err as Error).message}`.slice(0, 300) },
      });
      return 'unknown';
    }
  }

  // ── Reconciliation ───────────────────────────────────────────────────────

  /**
   * - PROCESSING without a gateway ID (outcome unknown): look up the payment's
   *   refunds on Razorpay by notes.refund_id. Found → record it. Not found →
   *   back to PENDING (safe: Razorpay confirms it does not exist).
   * - PROCESSING with a gateway ID but no webhook for a long time: fetch status.
   */
  async reconcileRefunds() {
    const cutoff = new Date(Date.now() - AMBIGUOUS_AFTER_MS);
    const stuck = await this.prisma.refund.findMany({
      where: { status: 'PROCESSING', last_attempt_at: { lt: cutoff } },
      include: { payment: true },
      take: 25,
    });
    let updated = 0;
    for (const r of stuck) {
      try {
        if (!r.razorpay_refund_id) {
          const list: any = await this.gateway.listPaymentRefunds(r.payment!.razorpay_payment_id!);
          const hit = (list?.items ?? []).find((i: any) => i?.notes?.refund_id === r.id);
          if (hit) {
            await this.applyGatewayRefundState(r.id, hit);
          } else {
            await this.prisma.refund.updateMany({
              where: { id: r.id, status: 'PROCESSING', razorpay_refund_id: null },
              data: { status: 'PENDING', failure_reason: 'RECONCILED_NOT_FOUND' },
            });
          }
        } else {
          const g: any = await this.gateway.fetchRefund(r.razorpay_refund_id);
          await this.applyGatewayRefundState(r.id, g);
        }
        updated++;
      } catch (err) {
        this.logger.warn(`Reconcile refund ${r.id} failed: ${(err as Error).message}`);
      }
    }
    return { examined: stuck.length, updated };
  }

  private async applyGatewayRefundState(refundId: string, g: any) {
    const status = g?.status;
    await this.prisma.refund.update({
      where: { id: refundId },
      data: {
        razorpay_refund_id: g.id,
        submitted_at: new Date((g.created_at ?? Date.now() / 1000) * 1000),
        ...(status === 'processed' ? { status: 'PROCESSED', processed_at: new Date() } : {}),
        ...(status === 'failed' ? { status: 'FAILED', failure_reason: 'GATEWAY_REPORTED_FAILED' } : {}),
      },
    });
  }

  /** Webhook: refund.processed / refund.failed. Matches by gateway ID or notes.refund_id. */
  async markFromWebhook(entity: any, outcome: 'PROCESSED' | 'FAILED') {
    const refund = await this.prisma.refund.findFirst({
      where: {
        OR: [
          { razorpay_refund_id: entity.id },
          ...(entity?.notes?.refund_id && /^[0-9a-f-]{36}$/i.test(entity.notes.refund_id) ? [{ id: entity.notes.refund_id }] : []),
        ],
      },
    });
    if (!refund) return null;
    if (refund.status === outcome) return { refund, changed: false };
    if (refund.status === 'PROCESSED') return { refund, changed: false }; // terminal success wins

    const updated = await this.prisma.refund.update({
      where: { id: refund.id },
      data:
        outcome === 'PROCESSED'
          ? { status: 'PROCESSED', processed_at: new Date(), razorpay_refund_id: entity.id }
          : { status: 'FAILED', failure_reason: entity?.error_description ?? 'Razorpay refund failed', razorpay_refund_id: entity.id },
    });
    if (outcome === 'FAILED') {
      // A failed refund no longer reduces the vendor's share.
      await this.prisma.withTransaction((tx) => this.transfers.applyRefundToTransferInTx(tx, refund.booking_id));
    }
    return { refund: updated, changed: true };
  }

  /** Admin: put a FAILED refund back in the queue. */
  async retryFailed(refundId: string) {
    const r = await this.prisma.refund.updateMany({
      where: { id: refundId, status: 'FAILED', razorpay_refund_id: null },
      data: { status: 'PENDING', attempt_count: 0, last_attempt_at: null, failure_reason: null },
    });
    return r.count === 1;
  }
}
