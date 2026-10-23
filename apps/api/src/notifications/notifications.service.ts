import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, TxClient } from '../common/prisma/prisma.service';
import { renderNotification } from './templates';
import { Channel, NotificationDriver, PermanentDeliveryError, Recipient } from './drivers/types';
import { FcmPushDriver, SendGridEmailDriver, Fast2SmsDriver, WhatsAppUnavailableDriver } from './drivers/drivers';

export interface EnqueueInput {
  userId?: string | null;
  vendorId?: string | null;
  channel: Channel;
  event: string;
  data?: Record<string, unknown>;
  /** Same key => same notification (duplicate enqueue is a no-op). */
  idempotencyKey: string;
}

const MAX_ATTEMPTS = parseInt(process.env.NOTIFICATION_MAX_ATTEMPTS ?? '5', 10);
const LEASE_SECONDS = 120;

/**
 * Notifications use the transactional-outbox pattern:
 *  1. A row is written (ideally in the SAME transaction as the state change it
 *     announces), status PENDING. The row is the source of truth.
 *  2. The dispatcher job claims due rows with FOR UPDATE SKIP LOCKED (so two
 *     workers never send the same row), calls the provider, and records
 *     SENT / SKIPPED / retry-with-backoff / FAILED.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly drivers: Record<Channel, NotificationDriver>;

  constructor(private readonly prisma: PrismaService) {
    this.drivers = {
      PUSH: new FcmPushDriver(),
      EMAIL: new SendGridEmailDriver(),
      SMS: new Fast2SmsDriver(),
      WHATSAPP: new WhatsAppUnavailableDriver(),
    };
  }

  /** Overridable in tests. */
  setDriver(driver: NotificationDriver) {
    this.drivers[driver.channel] = driver;
  }

  providerStatus() {
    return Object.fromEntries(
      Object.values(this.drivers).map((d) => [d.channel, { provider: d.provider, configured: d.isConfigured() }]),
    );
  }

  // ── Enqueue (outbox writes) ──────────────────────────────────────────────

  async enqueueInTx(tx: TxClient, input: EnqueueInput): Promise<void> {
    await tx.notification.upsert({
      where: { idempotency_key: input.idempotencyKey },
      update: {},
      create: {
        user_id: input.userId ?? null,
        vendor_id: input.vendorId ?? null,
        channel: input.channel,
        event: input.event,
        template: `${input.event.toLowerCase()}_${input.vendorId && !input.userId ? 'vendor_' : ''}${input.channel.toLowerCase()}`,
        data: (input.data ?? {}) as Prisma.InputJsonValue,
        status: 'PENDING',
        next_attempt_at: new Date(),
        idempotency_key: input.idempotencyKey,
      },
    });
  }

  async enqueue(input: EnqueueInput): Promise<void> {
    try {
      await this.enqueueInTx(this.prisma, input);
    } catch (err) {
      this.logger.error(`Failed to enqueue ${input.event}/${input.channel}: ${(err as Error).message}`);
    }
  }

  /** Customer notification about a booking, on each customer channel. */
  async notifyCustomerInTx(
    tx: TxClient,
    booking: { id: string; user_id: string; booking_code: string },
    event: string,
    data: Record<string, unknown> = {},
    channels: Channel[] = ['PUSH', 'SMS'],
  ) {
    for (const channel of channels) {
      await this.enqueueInTx(tx, {
        userId: booking.user_id,
        channel,
        event,
        data: { booking_id: booking.id, booking_code: booking.booking_code, ...data },
        idempotencyKey: `${event}:${booking.id}:${channel}${data.dedupe ? `:${String(data.dedupe)}` : ''}`,
      });
    }
  }

  async notifyVendorInTx(
    tx: TxClient,
    vendorId: string,
    event: string,
    data: Record<string, unknown>,
    dedupe: string,
    channels: Channel[] = ['PUSH', 'EMAIL'],
  ) {
    for (const channel of channels) {
      await this.enqueueInTx(tx, {
        vendorId,
        channel,
        event,
        data,
        idempotencyKey: `${event}:vendor:${vendorId}:${dedupe}:${channel}`,
      });
    }
  }

  // ── Convenience wrappers used by webhook handlers ────────────────────────

  async sendBookingConfirmed(bookingId: string) {
    await this.prisma.$transaction(async (tx) => {
      const b = await tx.booking.findUnique({
        where: { id: bookingId },
        include: { slot: { include: { trip: { select: { vendor_id: true } } } } },
      });
      if (!b) return;
      await this.notifyCustomerInTx(tx, b, 'BOOKING_CONFIRMED');
      await this.notifyVendorInTx(
        tx,
        b.slot.trip.vendor_id,
        'NEW_BOOKING',
        {
          booking_id: b.id,
          booking_code: b.booking_code,
          seat_count: b.seat_count,
          start_time_ist: b.slot.start_time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
        },
        b.id,
        ['PUSH'],
      );
    });
  }

  async sendRefundProcessed(bookingId: string, amountPaise: bigint, refundId: string) {
    const b = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!b) return;
    await this.notifyCustomerInTx(this.prisma, b, 'REFUND_PROCESSED', {
      amount_paise: amountPaise.toString(),
      dedupe: refundId,
    });
  }

  async sendRefundFailed(bookingId: string, amountPaise: bigint, refundId: string) {
    this.logger.error(`URGENT: refund ${refundId} failed for booking ${bookingId} (${amountPaise} paise)`);
    const b = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!b) return;
    await this.notifyCustomerInTx(this.prisma, b, 'REFUND_FAILED', { dedupe: refundId }, ['PUSH']);
  }

  // ── Dispatcher ───────────────────────────────────────────────────────────

  /**
   * Claims and delivers due notifications. Safe to run concurrently from many
   * workers: rows are leased via FOR UPDATE SKIP LOCKED + next_attempt_at bump.
   */
  async dispatchDue(limit = 50): Promise<{ claimed: number; sent: number; skipped: number; failed: number; retry: number }> {
    const claimed = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE notifications
      SET next_attempt_at = NOW() + make_interval(secs => ${LEASE_SECONDS}), updated_at = NOW()
      WHERE id IN (
        SELECT id FROM notifications
        WHERE status = 'PENDING' AND next_attempt_at <= NOW()
        ORDER BY created_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `;

    const stats = { claimed: claimed.length, sent: 0, skipped: 0, failed: 0, retry: 0 };
    for (const { id } of claimed) {
      const outcome = await this.deliver(id);
      stats[outcome]++;
    }
    return stats;
  }

  private async resolveRecipient(n: { user_id: string | null; vendor_id: string | null }): Promise<Recipient> {
    if (n.user_id) {
      const u = await this.prisma.user.findUnique({
        where: { id: n.user_id },
        select: { phone: true, email: true, push_token: true },
      });
      return { phone: u?.phone, email: u?.email, pushToken: u?.push_token };
    }
    if (n.vendor_id) {
      const v = await this.prisma.vendor.findUnique({
        where: { id: n.vendor_id },
        select: { phone: true, email: true },
      });
      return { phone: v?.phone, email: v?.email, pushToken: null };
    }
    return {};
  }

  private async deliver(id: string): Promise<'sent' | 'skipped' | 'failed' | 'retry'> {
    const n = await this.prisma.notification.findUnique({ where: { id } });
    if (!n || n.status !== 'PENDING') return 'skipped';

    const driver = this.drivers[n.channel as Channel];
    const attempts = n.attempts + 1;

    if (!driver || !driver.isConfigured()) {
      await this.prisma.notification.update({
        where: { id },
        data: { status: 'SKIPPED', attempts, error: `PROVIDER_NOT_CONFIGURED:${n.channel}`, next_attempt_at: null },
      });
      return 'skipped';
    }

    try {
      const recipient = await this.resolveRecipient(n);
      const msg = renderNotification(n.event, (n.data ?? {}) as Record<string, unknown>);
      const stringData: Record<string, string> = {};
      for (const [k, v] of Object.entries((n.data ?? {}) as Record<string, unknown>)) {
        if (v !== null && v !== undefined && typeof v !== 'object') stringData[k] = String(v);
      }
      const result = await driver.send(recipient, { ...msg, data: stringData });

      if (result.status === 'SENT') {
        await this.prisma.notification.update({
          where: { id },
          data: {
            status: 'SENT',
            attempts,
            sent_at: new Date(),
            provider: result.provider,
            provider_message_id: result.providerMessageId ?? null,
            error: null,
            next_attempt_at: null,
          },
        });
        return 'sent';
      }
      await this.prisma.notification.update({
        where: { id },
        data: { status: 'SKIPPED', attempts, provider: driver.provider, error: result.reason, next_attempt_at: null },
      });
      return 'skipped';
    } catch (err) {
      const permanent = err instanceof PermanentDeliveryError;
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      if (permanent || attempts >= MAX_ATTEMPTS) {
        await this.prisma.notification.update({
          where: { id },
          data: { status: 'FAILED', attempts, failed_at: new Date(), error: message, provider: driver.provider, next_attempt_at: null },
        });
        this.logger.warn(`Notification ${id} (${n.event}/${n.channel}) failed permanently: ${message}`);
        return 'failed';
      }
      const backoffSeconds = Math.min(3600, 30 * 2 ** (attempts - 1));
      await this.prisma.notification.update({
        where: { id },
        data: {
          attempts,
          error: message,
          provider: driver.provider,
          next_attempt_at: new Date(Date.now() + backoffSeconds * 1000),
        },
      });
      return 'retry';
    }
  }
}
