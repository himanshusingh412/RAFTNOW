import { Injectable, Logger } from '@nestjs/common';
import { applyBps } from '@raftnow/shared';
import { PrismaService, TxClient } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundException } from '../common/exceptions/api.exception';
import { RazorpayGateway, GatewayError } from '../common/razorpay/razorpay.gateway';

const TRANSFER_HOLD_HOURS = () => parseInt(process.env.TRANSFER_HOLD_HOURS ?? '24', 10);
const MAX_TRANSFER_ATTEMPTS = 5;
/** A PROCESSING transfer older than this with no gateway ID is reconciled. */
const AMBIGUOUS_AFTER_MS = 10 * 60 * 1000;
/** Booking states in which the vendor has earned the payout. */
const PAYOUT_ELIGIBLE = ['CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW'];
/** Holds the release job may lift automatically once the cause is resolved. */
const AUTO_HOLD_REASONS = ['NO_LINKED_ACCOUNT'];

/**
 * Vendor payouts via Razorpay Route (direct transfers).
 *
 * Lifecycle:  ON_HOLD ──(release_at reached, claimed)──▶ PROCESSING ──▶ RELEASED ──▶ SETTLED
 *                │                                         │
 *                └─(full refund)──▶ REVERSED               └─(gateway 4xx)──▶ ON_HOLD (retry) / FAILED
 *
 * The platform holds the vendor's share in its own Razorpay balance until the
 * release time (slot end + TRANSFER_HOLD_HOURS); this is a payout delay, not a
 * regulated escrow account.
 *
 * Money-safety rules:
 *  - A transfer row is claimed (ON_HOLD → PROCESSING) with a conditional UPDATE
 *    before Razorpay is called, so two workers can never both pay it.
 *  - If the gateway outcome is unknown (timeout/5xx), the row stays PROCESSING
 *    and is reconciled against Razorpay (notes.transfer_id) before any retry.
 *  - Every gateway operation stores the Razorpay ID on the row.
 */
@Injectable()
export class TransfersService {
  private readonly logger = new Logger(TransfersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly gateway: RazorpayGateway,
  ) {}

  /**
   * Creates the ON_HOLD transfer for a confirmed booking. Idempotent: one
   * transfer per booking (unique booking_id). The linked account is resolved at
   * release time, so vendors still finishing Route onboarding are not skipped.
   */
  async createTransferOnHoldInTx(tx: TxClient, bookingId: string) {
    const existing = await tx.transfer.findUnique({ where: { booking_id: bookingId } });
    if (existing) return existing;

    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: { slot: { select: { end_time: true, trip: { select: { vendor_id: true } } } } },
    });
    if (!booking) throw new NotFoundException('Booking');

    const releaseAt = new Date(booking.slot.end_time.getTime() + TRANSFER_HOLD_HOURS() * 3600_000);
    const transfer = await tx.transfer.create({
      data: {
        booking_id: bookingId,
        vendor_id: booking.slot.trip.vendor_id,
        amount_paise: booking.vendor_payout_paise,
        original_amount_paise: booking.vendor_payout_paise,
        status: 'ON_HOLD',
        release_at: releaseAt,
      },
    });
    this.logger.log(`Transfer ${transfer.id} ON_HOLD for booking ${bookingId}, releases ${releaseAt.toISOString()}`);
    return transfer;
  }

  async createTransferOnHold(bookingId: string) {
    return this.prisma.withTransaction((tx) => this.createTransferOnHoldInTx(tx, bookingId));
  }

  /**
   * Re-computes the vendor share after refunds. The vendor's payout is the
   * commission split (booking's snapshotted commission_bps) of the amount the
   * customer ultimately keeps paid. Called inside the refund transaction.
   */
  async applyRefundToTransferInTx(tx: TxClient, bookingId: string) {
    const transfer = await tx.transfer.findUnique({ where: { booking_id: bookingId } });
    if (!transfer) return null;

    const booking = await tx.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { amount_paise: true, commission_bps: true },
    });
    const refunds = await tx.refund.aggregate({
      where: { booking_id: bookingId, status: { not: 'FAILED' } },
      _sum: { amount_paise: true },
    });
    const refunded = refunds._sum.amount_paise ?? 0n;
    const retained = booking.amount_paise - refunded > 0n ? booking.amount_paise - refunded : 0n;
    const targetVendorPaise = retained - applyBps(retained, BigInt(booking.commission_bps));

    if (transfer.status === 'ON_HOLD' || transfer.status === 'CREATED') {
      const fullyReversed = targetVendorPaise === 0n;
      return tx.transfer.update({
        where: { id: transfer.id },
        data: {
          amount_paise: targetVendorPaise,
          status: fullyReversed ? 'REVERSED' : transfer.status,
          reversed_at: fullyReversed ? new Date() : null,
          // reversed_amount_paise is reserved for GATEWAY reversals of money that
          // already left; an ON_HOLD adjustment never touched Razorpay.
        },
      });
    }

    if (transfer.status === 'PROCESSING' || transfer.status === 'RELEASED' || transfer.status === 'SETTLED') {
      // Money already left (or is leaving) — schedule a gateway reversal of the excess.
      const reversal = transfer.amount_paise - targetVendorPaise;
      if (reversal <= 0n) return transfer;
      if (transfer.razorpay_reversal_id) {
        return tx.transfer.update({
          where: { id: transfer.id },
          data: { last_error: 'MANUAL_REVERSAL_REQUIRED: second reversal after an executed reversal' },
        });
      }
      return tx.transfer.update({ where: { id: transfer.id }, data: { reversed_amount_paise: reversal } });
    }
    return transfer;
  }

  // ── Release ──────────────────────────────────────────────────────────────

  /** Claims due transfers and pays them out. Safe under concurrent workers. */
  async releaseDueTransfers(limit = 50) {
    const claimed = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE transfers
      SET status = 'PROCESSING', claimed_at = NOW(), updated_at = NOW()
      WHERE id IN (
        SELECT t.id FROM transfers t
        JOIN bookings b ON b.id = t.booking_id
        WHERE t.status = 'ON_HOLD'
          AND t.release_at <= NOW()
          AND t.amount_paise > 0
          AND (t.hold_reason IS NULL OR t.hold_reason = ANY(${AUTO_HOLD_REASONS}::text[]))
          AND b.status::text = ANY(${PAYOUT_ELIGIBLE}::text[])
          AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.booking_id = b.id AND r.status IN ('PENDING','PROCESSING'))
        ORDER BY t.release_at
        LIMIT ${limit}
        FOR UPDATE OF t SKIP LOCKED
      )
      RETURNING id
    `;
    const results = { claimed: claimed.length, released: 0, held: 0, retry: 0, failed: 0, unknown: 0 };
    for (const { id } of claimed) {
      const r = await this.executeClaimedTransfer(id);
      results[r]++;
    }
    return results;
  }

  /** Releases one transfer now (admin action) using the same claim protocol. */
  async releaseTransferNow(transferId: string) {
    const claimed = await this.prisma.transfer.updateMany({
      where: { id: transferId, status: 'ON_HOLD', amount_paise: { gt: 0 } },
      data: { status: 'PROCESSING', claimed_at: new Date(), hold_reason: null },
    });
    if (claimed.count === 0) {
      const t = await this.prisma.transfer.findUnique({ where: { id: transferId } });
      if (!t) throw new NotFoundException('Transfer');
      return { outcome: 'not_claimable' as const, status: t.status };
    }
    return { outcome: await this.executeClaimedTransfer(transferId) };
  }

  private async executeClaimedTransfer(id: string): Promise<'released' | 'held' | 'retry' | 'failed' | 'unknown'> {
    const t = await this.prisma.transfer.findUniqueOrThrow({
      where: { id },
      include: {
        vendor: { select: { razorpay_linked_account_id: true, razorpay_kyc_status: true, status: true } },
        booking: { select: { status: true } },
      },
    });

    const account = t.vendor.razorpay_linked_account_id;
    // Razorpay only accepts transfers to linked accounts whose Route product is activated.
    if (!account || t.vendor.razorpay_kyc_status !== 'activated') {
      await this.prisma.transfer.update({
        where: { id },
        data: { status: 'ON_HOLD', hold_reason: 'NO_LINKED_ACCOUNT', claimed_at: null },
      });
      return 'held';
    }

    try {
      const rzp: any = await this.gateway.createTransfer({
        account,
        amount: Number(t.amount_paise),
        currency: 'INR',
        notes: { transfer_id: t.id, booking_id: t.booking_id },
      });
      await this.prisma.transfer.update({
        where: { id },
        data: {
          status: 'RELEASED',
          razorpay_transfer_id: rzp.id,
          linked_account_id: account,
          released_at: new Date(),
          last_error: null,
          hold_reason: null,
        },
      });
      await this.audit.log({
        actor_type: 'SYSTEM',
        action: 'VENDOR_TRANSFER_RELEASED',
        entity_type: 'Transfer',
        entity_id: id,
        data: { razorpay_transfer_id: rzp.id, amount_paise: t.amount_paise.toString(), vendor_id: t.vendor_id },
      });
      this.logger.log(`Transfer ${id} released (${rzp.id})`);
      return 'released';
    } catch (err) {
      const g = err as GatewayError;
      if (g instanceof GatewayError && g.notCreated) {
        const attempts = t.retry_count + 1;
        const failed = attempts >= MAX_TRANSFER_ATTEMPTS;
        await this.prisma.transfer.update({
          where: { id },
          data: {
            status: failed ? 'FAILED' : 'ON_HOLD',
            failed_at: failed ? new Date() : null,
            retry_count: attempts,
            last_error: `${g.code ?? 'GATEWAY_ERROR'}: ${g.message}`.slice(0, 300),
            claimed_at: null,
          },
        });
        return failed ? 'failed' : 'retry';
      }
      // Outcome unknown — leave PROCESSING for reconciliation. Never blind-retry.
      await this.prisma.transfer.update({
        where: { id },
        data: { last_error: `UNKNOWN_OUTCOME: ${(err as Error).message}`.slice(0, 300) },
      });
      return 'unknown';
    }
  }

  // ── Reconciliation ───────────────────────────────────────────────────────

  /**
   * Resolves PROCESSING transfers whose gateway outcome is unknown by searching
   * Razorpay for a transfer carrying our notes.transfer_id. Found → RELEASED.
   * Not found after the ambiguity window → back to ON_HOLD for a safe retry.
   */
  async reconcileProcessingTransfers() {
    const cutoff = new Date(Date.now() - AMBIGUOUS_AFTER_MS);
    const stuck = await this.prisma.transfer.findMany({
      where: { status: 'PROCESSING', razorpay_transfer_id: null, claimed_at: { lt: cutoff } },
      take: 20,
    });
    let resolved = 0;
    for (const t of stuck) {
      try {
        const from = Math.floor((t.claimed_at!.getTime() - 5 * 60_000) / 1000);
        const match = await this.findGatewayTransfer(t.id, from);
        if (match) {
          await this.prisma.transfer.update({
            where: { id: t.id },
            data: { status: 'RELEASED', razorpay_transfer_id: match.id, released_at: new Date((match.created_at ?? Date.now() / 1000) * 1000), last_error: null },
          });
        } else {
          await this.prisma.transfer.updateMany({
            where: { id: t.id, status: 'PROCESSING', razorpay_transfer_id: null },
            data: { status: 'ON_HOLD', claimed_at: null, last_error: 'RECONCILED_NOT_FOUND' },
          });
        }
        resolved++;
      } catch (err) {
        this.logger.warn(`Reconcile transfer ${t.id} failed: ${(err as Error).message}`);
      }
    }

    // Settlement status for released transfers (Razorpay → linked account bank).
    const released = await this.prisma.transfer.findMany({
      where: { status: 'RELEASED', razorpay_transfer_id: { not: null } },
      orderBy: { released_at: 'asc' },
      take: 20,
    });
    for (const t of released) {
      try {
        const g: any = await this.gateway.fetchTransfer(t.razorpay_transfer_id!);
        const settlementId = g?.recipient_settlement_id ?? g?.recipient_settlement?.id ?? null;
        const settlementStatus = g?.recipient_settlement?.status;
        if (settlementId && settlementId !== t.razorpay_settlement_id) {
          await this.prisma.transfer.update({
            where: { id: t.id },
            data: {
              razorpay_settlement_id: settlementId,
              ...(settlementStatus === 'processed'
                ? { status: 'SETTLED', settled_at: new Date(), utr: g?.recipient_settlement?.utr ?? null }
                : {}),
            },
          });
        }
      } catch (err) {
        this.logger.warn(`Settlement check for transfer ${t.id} failed: ${(err as Error).message}`);
      }
    }
    return { ambiguous: stuck.length, resolved };
  }

  private async findGatewayTransfer(transferId: string, fromUnix: number): Promise<any | null> {
    for (let skip = 0; skip < 500; skip += 100) {
      const page: any = await this.gateway.listTransfers({ from: fromUnix, count: 100, skip });
      const items: any[] = page?.items ?? [];
      const hit = items.find((i) => i?.notes?.transfer_id === transferId);
      if (hit) return hit;
      if (items.length < 100) return null;
    }
    return null;
  }

  /** Executes scheduled reversals (refunds after money already moved). */
  async executePendingReversals(limit = 20) {
    const due = await this.prisma.transfer.findMany({
      where: {
        status: { in: ['RELEASED', 'SETTLED'] },
        reversed_amount_paise: { gt: 0 },
        razorpay_reversal_id: null,
        razorpay_transfer_id: { not: null },
      },
      take: limit,
    });
    let done = 0;
    for (const t of due) {
      const lease = new Date(Date.now() - 15 * 60_000);
      const claim = await this.prisma.transfer.updateMany({
        where: { id: t.id, razorpay_reversal_id: null, OR: [{ claimed_at: null }, { claimed_at: { lt: lease } }] },
        data: { claimed_at: new Date() },
      });
      if (claim.count === 0) continue;
      try {
        // A previous attempt may have succeeded without being recorded.
        const g: any = await this.gateway.fetchTransfer(t.razorpay_transfer_id!);
        if (Number(g?.amount_reversed ?? 0) > 0) {
          await this.prisma.transfer.update({
            where: { id: t.id },
            data: { razorpay_reversal_id: `reconciled:${t.razorpay_transfer_id}`, reversed_at: new Date() },
          });
          continue;
        }
        const rev: any = await this.gateway.reverseTransfer(t.razorpay_transfer_id!, {
          amount: Number(t.reversed_amount_paise),
          notes: { transfer_id: t.id, booking_id: t.booking_id },
        });
        const full = t.reversed_amount_paise! >= t.amount_paise;
        await this.prisma.transfer.update({
          where: { id: t.id },
          data: {
            razorpay_reversal_id: rev.id,
            reversed_at: new Date(),
            status: full ? 'REVERSED' : t.status,
            amount_paise: t.amount_paise - t.reversed_amount_paise!,
            last_error: null,
          },
        });
        await this.audit.log({
          actor_type: 'SYSTEM',
          action: 'VENDOR_TRANSFER_REVERSED',
          entity_type: 'Transfer',
          entity_id: t.id,
          data: { razorpay_reversal_id: rev.id, amount_paise: t.reversed_amount_paise!.toString() },
        });
        done++;
      } catch (err) {
        await this.prisma.transfer.update({
          where: { id: t.id },
          data: { last_error: `REVERSAL_FAILED: ${(err as Error).message}`.slice(0, 300) },
        });
      }
    }
    return { due: due.length, reversed: done };
  }

  // ── Admin controls ───────────────────────────────────────────────────────

  async placeHold(transferId: string, reason: string) {
    const r = await this.prisma.transfer.updateMany({
      where: { id: transferId, status: 'ON_HOLD' },
      data: { hold_reason: reason },
    });
    return r.count === 1;
  }

  async liftHold(transferId: string) {
    const r = await this.prisma.transfer.updateMany({
      where: { id: transferId, status: 'ON_HOLD' },
      data: { hold_reason: null },
    });
    return r.count === 1;
  }
}
