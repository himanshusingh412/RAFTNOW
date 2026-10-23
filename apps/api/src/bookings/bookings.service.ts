import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  generateBookingCode,
  isValidBookingCode,
  splitCommission,
  calculateRefundPaise,
  getCancellationTrigger,
  CancellationTrigger,
} from '@raftnow/shared';
import { PrismaService, TxClient } from '../common/prisma/prisma.service';
import {
  ApiException,
  SlotFullException,
  NoPrivateRaftAvailableException,
  SlotNotOpenException,
  VendorNotLiveException,
  TripNotLiveException,
  GuestAgeViolationException,
  StretchClosedException,
  NotFoundException,
  InvalidBookingTransitionException,
  ForbiddenException,
  ConflictException,
} from '../common/exceptions/api.exception';
import { CreateBookingDto } from './dto/create-booking.dto';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RefundsService } from '../refunds/refunds.service';
import { TransfersService } from '../transfers/transfers.service';
import { QrService } from '../common/qr/qr.service';
import { availablePrivateRafts, availableSharedSeats, SlotCounters } from './inventory';
import { activeClosureWhere } from '../stretches/closure-rules';

/** Accepts what staff type: "rf 7k2m9p", "RF-7K2M9P", "7k2m9p" → "7K2M9P". */
export function normaliseBookingCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '').replace(/^RF(?=[A-Z0-9]{6}$)/, '');
}

/** Paid bookings an admin may flag; the same set a resolved dispute can return to. */
const DISPUTABLE = ['CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW'];

export type ActorType = 'CUSTOMER' | 'VENDOR' | 'ADMIN' | 'SYSTEM';

interface LockedSlot extends SlotCounters {
  id: string;
  trip_id: string;
  status: string;
  start_time: Date;
  end_time: Date;
}

interface LockedBooking {
  id: string;
  user_id: string;
  slot_id: string;
  booking_code: string;
  status: string;
  mode: 'SHARED' | 'PRIVATE';
  seat_count: number;
  amount_paise: bigint;
  hold_expires_at: Date;
}

export type CancellationKind = 'CUSTOMER' | 'VENDOR' | 'ADMIN' | 'CLOSURE';

export interface CancelBookingInput {
  bookingId: string;
  kind: CancellationKind;
  actorId?: string | null;
  /** CUSTOMER: must own the booking. */
  userId?: string;
  /** VENDOR: booking must belong to this vendor. */
  vendorId?: string;
  reason?: string;
  closureId?: string;
  /** ADMIN only: refund less than 100% (paise). */
  adminRefundPaise?: bigint;
  ip_address?: string;
  user_agent?: string;
}

const CANCELLABLE: Record<CancellationKind, string[]> = {
  CUSTOMER: ['PENDING_PAYMENT', 'CONFIRMED'],
  VENDOR: ['PENDING_PAYMENT', 'CONFIRMED'],
  CLOSURE: ['PENDING_PAYMENT', 'CONFIRMED'],
  ADMIN: ['PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'DISPUTED'],
};

const holdTtlMinutes = () => parseInt(process.env.BOOKING_HOLD_TTL_MINUTES ?? '10', 10);
const checkInOpensHoursBefore = () => parseFloat(process.env.CHECKIN_OPENS_HOURS_BEFORE ?? '4');
const checkInGraceHoursAfterEnd = () => parseFloat(process.env.CHECKIN_GRACE_HOURS_AFTER_END ?? '2');
const vendorCancellationPenalty = () => parseInt(process.env.VENDOR_CANCELLATION_RELIABILITY_PENALTY ?? '5', 10);

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly refunds: RefundsService,
    private readonly transfers: TransfersService,
    private readonly qr: QrService,
  ) {}

  // ════════════════════════════════════════════════════════════════════════
  // Locking primitives — ALWAYS slot row first, then booking row.
  // A single global lock order prevents deadlocks between booking creation
  // (locks the slot, then expires stale holds on it) and payment confirmation /
  // cancellation / check-in (which touch one booking and its slot).
  // ════════════════════════════════════════════════════════════════════════

  private async lockSlot(tx: TxClient, slotId: string): Promise<LockedSlot | null> {
    const rows = await tx.$queryRaw<LockedSlot[]>`
      SELECT id, trip_id, status::text AS status, total_rafts, raft_capacity, total_seats,
             seats_booked, seats_held, private_rafts_booked, private_rafts_held,
             start_time, end_time
      FROM slots
      WHERE id = ${slotId}::uuid
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  private async lockBookingWithSlot(tx: TxClient, bookingId: string): Promise<{ booking: LockedBooking; slot: LockedSlot }> {
    const ref = await tx.booking.findUnique({ where: { id: bookingId }, select: { slot_id: true } });
    if (!ref) throw new NotFoundException('Booking');
    const slot = await this.lockSlot(tx, ref.slot_id);
    if (!slot) throw new NotFoundException('Slot');
    const rows = await tx.$queryRaw<LockedBooking[]>`
      SELECT id, user_id, slot_id, booking_code, status::text AS status, mode::text AS mode,
             seat_count, amount_paise, hold_expires_at
      FROM bookings
      WHERE id = ${bookingId}::uuid
      FOR UPDATE
    `;
    if (!rows[0]) throw new NotFoundException('Booking');
    return { booking: rows[0], slot };
  }

  /** Returns a booking's inventory to the slot. Caller holds the slot lock. */
  private async releaseInventory(tx: TxClient, b: Pick<LockedBooking, 'slot_id' | 'mode' | 'seat_count'>, from: 'held' | 'booked') {
    if (b.mode === 'SHARED') {
      if (from === 'held') {
        await tx.$executeRaw`UPDATE slots SET seats_held = GREATEST(0, seats_held - ${b.seat_count}), updated_at = NOW() WHERE id = ${b.slot_id}::uuid`;
      } else {
        await tx.$executeRaw`UPDATE slots SET seats_booked = GREATEST(0, seats_booked - ${b.seat_count}), updated_at = NOW() WHERE id = ${b.slot_id}::uuid`;
      }
    } else if (from === 'held') {
      await tx.$executeRaw`UPDATE slots SET private_rafts_held = GREATEST(0, private_rafts_held - 1), updated_at = NOW() WHERE id = ${b.slot_id}::uuid`;
    } else {
      await tx.$executeRaw`UPDATE slots SET private_rafts_booked = GREATEST(0, private_rafts_booked - 1), updated_at = NOW() WHERE id = ${b.slot_id}::uuid`;
    }
  }

  /**
   * Expires every lapsed PENDING_PAYMENT hold on a slot. Caller holds the slot
   * lock. Makes availability exact at booking time instead of depending on the
   * expiry job having run.
   */
  private async expireLapsedHoldsOnSlot(tx: TxClient, slotId: string): Promise<number> {
    const lapsed = await tx.$queryRaw<Array<Pick<LockedBooking, 'id' | 'slot_id' | 'mode' | 'seat_count'>>>`
      SELECT id, slot_id, mode::text AS mode, seat_count
      FROM bookings
      WHERE slot_id = ${slotId}::uuid AND status = 'PENDING_PAYMENT' AND hold_expires_at < NOW()
      FOR UPDATE
    `;
    for (const b of lapsed) {
      await this.releaseInventory(tx, b, 'held');
      await tx.booking.update({
        where: { id: b.id },
        data: {
          status: 'EXPIRED',
          events: {
            create: {
              event_type: 'BOOKING_EXPIRED',
              from_status: 'PENDING_PAYMENT',
              to_status: 'EXPIRED',
              actor_type: 'SYSTEM',
              metadata: { reason: 'HOLD_TTL_EXCEEDED', released_by: 'BOOKING_TIME_SWEEP' },
            },
          },
        },
      });
    }
    return lapsed.length;
  }

  // ════════════════════════════════════════════════════════════════════════
  // CREATE BOOKING (hold)
  //
  // READ COMMITTED transaction:
  //   lock slot FOR UPDATE → idempotency re-check → expire lapsed holds →
  //   validate slot/trip/vendor/closure/ages → check inventory →
  //   increment holds → insert PENDING_PAYMENT booking
  // The row lock serialises all writers of a slot; the CHECK constraints are
  // the final backstop.
  // ════════════════════════════════════════════════════════════════════════
  async createBooking(user: { id: string; phone?: string }, dto: CreateBookingDto) {
    return this.prisma.withLockingTransaction(async (tx) => {
      const lockedSlot = await this.lockSlot(tx, dto.slot_id);
      if (!lockedSlot) throw new NotFoundException('Slot');

      // Idempotency check AFTER the lock: a concurrent duplicate request that
      // committed while we waited is now visible (READ COMMITTED).
      const existing = await tx.booking.findUnique({
        where: { idempotency_key: dto.idempotency_key },
        include: { guests: { orderBy: { position: 'asc' } } },
      });
      if (existing) {
        if (existing.user_id !== user.id || existing.slot_id !== dto.slot_id) {
          throw new ConflictException('IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used for a different booking');
        }
        return existing;
      }

      if (lockedSlot.status !== 'OPEN') throw new SlotNotOpenException(lockedSlot.status);
      const now = new Date();
      if (lockedSlot.start_time <= now) throw new SlotNotOpenException('PAST');

      const trip = await tx.trip.findUnique({
        where: { id: lockedSlot.trip_id },
        include: {
          vendor: { select: { id: true, status: true, licence_expiry: true } },
          stretch: { select: { id: true, min_age: true, max_age: true, active: true } },
        },
      });
      if (!trip) throw new NotFoundException('Trip');
      if (trip.status !== 'LIVE' || !trip.stretch.active) throw new TripNotLiveException();
      if (trip.vendor.status !== 'LIVE') throw new VendorNotLiveException();
      if (!trip.vendor.licence_expiry || trip.vendor.licence_expiry < lockedSlot.start_time) {
        throw new VendorNotLiveException();
      }

      const closure = await tx.closure.findFirst({
        where: activeClosureWhere(trip.stretch_id, lockedSlot.start_time),
        select: { id: true },
      });
      if (closure) throw new StretchClosedException();

      // ── Guests ──────────────────────────────────────────────────────────
      if (dto.guests.length === 0) {
        throw new ApiException('GUESTS_REQUIRED', 'At least one guest is required', HttpStatus.UNPROCESSABLE_ENTITY);
      }
      if (dto.mode === 'SHARED' && dto.guests.length !== dto.seat_count) {
        throw new ApiException('GUEST_COUNT_MISMATCH', 'Guest count must equal seat count for shared bookings', HttpStatus.UNPROCESSABLE_ENTITY);
      }
      if (dto.mode === 'PRIVATE' && dto.guests.length > lockedSlot.raft_capacity) {
        throw new ApiException('TOO_MANY_GUESTS', `A private raft holds at most ${lockedSlot.raft_capacity} guests`, HttpStatus.UNPROCESSABLE_ENTITY);
      }
      const minAge = Math.max(trip.min_age, trip.stretch.min_age);
      const maxAge = trip.max_age ?? trip.stretch.max_age ?? null;
      for (const guest of dto.guests) {
        if (guest.age < minAge) throw new GuestAgeViolationException(guest.name, guest.age, minAge);
        if (maxAge !== null && guest.age > maxAge) throw new GuestAgeViolationException(guest.name, guest.age, maxAge);
      }

      // ── Inventory (exact: lapsed holds released first) ──────────────────
      const released = await this.expireLapsedHoldsOnSlot(tx, lockedSlot.id);
      const counters = released > 0 ? ((await this.lockSlot(tx, lockedSlot.id)) as LockedSlot) : lockedSlot;

      let seatsToHold = 0;
      let privateRaftsToHold = 0;
      let raftsRequired: number;
      let amountPaise: bigint;
      if (dto.mode === 'PRIVATE') {
        if (!trip.private_raft_price_paise) {
          throw new ApiException('PRIVATE_NOT_OFFERED', 'This trip does not offer private rafts', HttpStatus.UNPROCESSABLE_ENTITY);
        }
        if (availablePrivateRafts(counters) < 1) throw new NoPrivateRaftAvailableException();
        privateRaftsToHold = 1;
        raftsRequired = 1;
        amountPaise = trip.private_raft_price_paise;
      } else {
        const free = availableSharedSeats(counters);
        if (dto.seat_count > free) throw new SlotFullException(free);
        seatsToHold = dto.seat_count;
        raftsRequired = Math.ceil(dto.seat_count / counters.raft_capacity);
        amountPaise = trip.per_seat_price_paise * BigInt(dto.seat_count);
      }

      // ── Commission snapshot ─────────────────────────────────────────────
      const commissionConfig = await tx.vendorCommission.findFirst({
        where: {
          vendor_id: trip.vendor_id,
          effective_from: { lte: now },
          OR: [{ effective_to: null }, { effective_to: { gte: now } }],
        },
        orderBy: { effective_from: 'desc' },
      });
      const commissionBps = commissionConfig?.commission_bps ?? parseInt(process.env.DEFAULT_COMMISSION_BPS ?? '1000', 10);
      const { platformPaise, vendorPaise } = splitCommission(amountPaise, BigInt(commissionBps));

      await tx.$executeRaw`
        UPDATE slots
        SET seats_held = seats_held + ${seatsToHold},
            private_rafts_held = private_rafts_held + ${privateRaftsToHold},
            updated_at = NOW()
        WHERE id = ${dto.slot_id}::uuid
      `;

      const seatCount = dto.mode === 'SHARED' ? dto.seat_count : counters.raft_capacity;
      const holdExpiresAt = new Date(Date.now() + holdTtlMinutes() * 60_000);
      const booking = await tx.booking.create({
        data: {
          user_id: user.id,
          slot_id: dto.slot_id,
          booking_code: generateBookingCode(),
          mode: dto.mode,
          seat_count: seatCount,
          rafts_required: raftsRequired,
          per_seat_price_paise: trip.per_seat_price_paise,
          private_raft_price_paise: trip.private_raft_price_paise,
          amount_paise: amountPaise,
          commission_bps: commissionBps,
          platform_commission_paise: platformPaise,
          vendor_payout_paise: vendorPaise,
          status: 'PENDING_PAYMENT',
          hold_expires_at: holdExpiresAt,
          safety_declaration_version: dto.safety_declaration_version,
          safety_declaration_accepted_at: now,
          contact_name: dto.guests[0].name,
          contact_phone: dto.contact_phone ?? user.phone ?? '',
          idempotency_key: dto.idempotency_key,
          guests: {
            create: dto.guests.map((g, index) => ({ position: index, name: g.name, age: g.age })),
          },
          events: {
            create: {
              event_type: 'BOOKING_CREATED',
              from_status: null,
              to_status: 'PENDING_PAYMENT',
              actor_type: 'CUSTOMER',
              actor_id: user.id,
              metadata: {
                mode: dto.mode,
                seat_count: seatCount,
                amount_paise: amountPaise.toString(),
                commission_bps: commissionBps,
                hold_expires_at: holdExpiresAt.toISOString(),
              },
            },
          },
        },
        include: { guests: { orderBy: { position: 'asc' } } },
      });

      this.logger.log(`Booking ${booking.booking_code} held: slot=${dto.slot_id} mode=${dto.mode} seats=${seatCount}`);
      return booking;
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // PAYMENT CAPTURED → CONFIRM
  // Called by the webhook handler (authoritative) and by server-side payment
  // reconciliation. Idempotent per payment.
  // ════════════════════════════════════════════════════════════════════════
  async confirmBookingAfterPayment(paymentRowId: string, razorpayPaymentId: string): Promise<{
    outcome: 'CONFIRMED' | 'ALREADY_CONFIRMED' | 'REFUND_QUEUED';
    bookingId: string;
  }> {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentRowId } });
    if (!payment) throw new NotFoundException('Payment');

    return this.prisma.withLockingTransaction(async (tx) => {
      const { booking, slot } = await this.lockBookingWithSlot(tx, payment.booking_id);

      const lateRefund = async (reason: string) => {
        await this.refunds.queueRefundInTx(tx, {
          bookingId: booking.id,
          paymentId: payment.id,
          amountPaise: payment.amount_paise,
          reason,
          idempotencyKey: `late-capture:${payment.id}`,
          initiatedByType: 'SYSTEM',
        });
        await tx.bookingEvent.create({
          data: {
            booking_id: booking.id,
            event_type: 'PAYMENT_REFUND_QUEUED',
            from_status: booking.status,
            to_status: booking.status,
            actor_type: 'SYSTEM',
            metadata: { razorpay_payment_id: razorpayPaymentId, reason },
          },
        });
        return { outcome: 'REFUND_QUEUED' as const, bookingId: booking.id };
      };

      if (['CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'DISPUTED'].includes(booking.status)) {
        // Was THIS payment the one that confirmed it? Otherwise it is a duplicate charge.
        const otherCaptured = await tx.payment.count({
          where: { booking_id: booking.id, status: 'CAPTURED', id: { not: payment.id } },
        });
        if (otherCaptured > 0) return lateRefund('DUPLICATE_PAYMENT');
        return { outcome: 'ALREADY_CONFIRMED', bookingId: booking.id };
      }

      if (booking.status.startsWith('CANCELLED')) {
        return lateRefund('PAYMENT_AFTER_CANCELLATION');
      }

      let fromHeld: boolean;
      if (booking.status === 'PENDING_PAYMENT') {
        fromHeld = true; // seats are still counted in seats_held
      } else if (booking.status === 'EXPIRED') {
        // Hold already released — re-acquire if inventory and safety allow.
        fromHeld = false;
        const trip = await tx.trip.findUniqueOrThrow({ where: { id: slot.trip_id }, select: { stretch_id: true } });
        const closed = await tx.closure.findFirst({ where: activeClosureWhere(trip.stretch_id, slot.start_time) });
        const ok =
          slot.status === 'OPEN' &&
          slot.start_time > new Date() &&
          !closed &&
          (booking.mode === 'SHARED'
            ? availableSharedSeats(slot) >= booking.seat_count
            : availablePrivateRafts(slot) >= 1);
        if (!ok) return lateRefund('HOLD_EXPIRED_AFTER_CAPTURE');
      } else {
        throw new InvalidBookingTransitionException(booking.status, 'CONFIRMED');
      }

      if (booking.mode === 'SHARED') {
        await tx.$executeRaw`
          UPDATE slots
          SET seats_held = GREATEST(0, seats_held - ${fromHeld ? booking.seat_count : 0}),
              seats_booked = seats_booked + ${booking.seat_count},
              updated_at = NOW()
          WHERE id = ${booking.slot_id}::uuid
        `;
      } else {
        await tx.$executeRaw`
          UPDATE slots
          SET private_rafts_held = GREATEST(0, private_rafts_held - ${fromHeld ? 1 : 0}),
              private_rafts_booked = private_rafts_booked + 1,
              updated_at = NOW()
          WHERE id = ${booking.slot_id}::uuid
        `;
      }

      await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: 'CONFIRMED',
          confirmed_at: new Date(),
          events: {
            create: {
              event_type: 'BOOKING_CONFIRMED',
              from_status: booking.status,
              to_status: 'CONFIRMED',
              actor_type: 'SYSTEM',
              metadata: { razorpay_payment_id: razorpayPaymentId, late_payment_reacquired: !fromHeld },
            },
          },
        },
      });
      await this.transfers.createTransferOnHoldInTx(tx, booking.id);

      const full = await tx.booking.findUniqueOrThrow({
        where: { id: booking.id },
        include: { slot: { include: { trip: { select: { vendor_id: true } } } } },
      });
      await this.notifications.notifyCustomerInTx(tx, full, 'BOOKING_CONFIRMED');
      await this.notifications.notifyVendorInTx(
        tx,
        full.slot.trip.vendor_id,
        'NEW_BOOKING',
        {
          booking_id: full.id,
          booking_code: full.booking_code,
          seat_count: full.seat_count,
          start_time_ist: full.slot.start_time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
        },
        full.id,
        ['PUSH'],
      );

      this.logger.log(`Booking ${booking.booking_code} confirmed (payment ${razorpayPaymentId})`);
      return { outcome: 'CONFIRMED', bookingId: booking.id };
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // HOLD EXPIRY
  // ════════════════════════════════════════════════════════════════════════
  async expireBooking(bookingId: string) {
    return this.prisma.withLockingTransaction(async (tx) => {
      const { booking } = await this.lockBookingWithSlot(tx, bookingId);
      if (booking.status !== 'PENDING_PAYMENT') return null; // idempotent
      await this.releaseInventory(tx, booking, 'held');
      return tx.booking.update({
        where: { id: bookingId },
        data: {
          status: 'EXPIRED',
          events: {
            create: {
              event_type: 'BOOKING_EXPIRED',
              from_status: 'PENDING_PAYMENT',
              to_status: 'EXPIRED',
              actor_type: 'SYSTEM',
              metadata: { reason: 'HOLD_TTL_EXCEEDED' },
            },
          },
        },
      });
    });
  }

  /** Job entry point. Each booking is expired in its own short transaction. */
  async expireStaleHolds(limit = 200) {
    const stale = await this.prisma.booking.findMany({
      where: { status: 'PENDING_PAYMENT', hold_expires_at: { lt: new Date() } },
      select: { id: true },
      take: limit,
    });
    let expired = 0;
    for (const b of stale) {
      try {
        if (await this.expireBooking(b.id)) expired++;
      } catch (err) {
        this.logger.error(`Failed to expire booking ${b.id}: ${(err as Error).message}`);
      }
    }
    return { examined: stale.length, expired };
  }

  // ════════════════════════════════════════════════════════════════════════
  // CANCELLATION (customer / vendor / admin / river closure)
  // ════════════════════════════════════════════════════════════════════════
  async cancelBooking(input: CancelBookingInput) {
    return this.prisma.withLockingTransaction(async (tx) => {
      const { booking, slot } = await this.lockBookingWithSlot(tx, input.bookingId);

      if (input.kind === 'CUSTOMER' && booking.user_id !== input.userId) {
        throw new NotFoundException('Booking'); // do not reveal other customers' bookings
      }
      const trip = await tx.trip.findUniqueOrThrow({ where: { id: slot.trip_id }, select: { vendor_id: true } });
      if (input.kind === 'VENDOR' && trip.vendor_id !== input.vendorId) {
        throw new ForbiddenException('This booking does not belong to your company');
      }

      const targetStatus =
        input.kind === 'CUSTOMER' ? 'CANCELLED_CUSTOMER' : input.kind === 'VENDOR' ? 'CANCELLED_VENDOR' : 'CANCELLED_ADMIN';

      if (booking.status.startsWith('CANCELLED') && input.kind === 'CLOSURE') {
        return { booking: await tx.booking.findUniqueOrThrow({ where: { id: booking.id } }), refund: null, alreadyCancelled: true };
      }
      if (!CANCELLABLE[input.kind].includes(booking.status)) {
        throw new InvalidBookingTransitionException(booking.status, targetStatus);
      }

      const now = new Date();
      const hoursBeforeDeparture = (slot.start_time.getTime() - now.getTime()) / 3_600_000;
      if (input.kind === 'CUSTOMER' && hoursBeforeDeparture <= 0) {
        throw new ApiException('DEPARTED', 'This trip has already departed and can no longer be cancelled', HttpStatus.UNPROCESSABLE_ENTITY);
      }

      let trigger: CancellationTrigger;
      switch (input.kind) {
        case 'CUSTOMER':
          trigger = getCancellationTrigger(hoursBeforeDeparture);
          break;
        case 'VENDOR':
          trigger = 'VENDOR_CANCELLED';
          break;
        case 'CLOSURE':
          trigger = 'RIVER_CLOSURE';
          break;
        default:
          trigger = 'ADMIN_REFUND';
      }

      const wasPaid = booking.status !== 'PENDING_PAYMENT';
      let refundPaise = wasPaid ? calculateRefundPaise(booking.amount_paise, trigger, hoursBeforeDeparture).refundPaise : 0n;
      if (input.kind === 'ADMIN' && input.adminRefundPaise !== undefined && wasPaid) {
        if (input.adminRefundPaise < 0n || input.adminRefundPaise > booking.amount_paise) {
          throw new ApiException('INVALID_REFUND_AMOUNT', 'Refund must be between 0 and the booking amount', HttpStatus.UNPROCESSABLE_ENTITY);
        }
        refundPaise = input.adminRefundPaise;
      }

      await this.releaseInventory(tx, booking, wasPaid ? 'booked' : 'held');

      const reasonText =
        input.reason ??
        (input.kind === 'CLOSURE' ? 'River stretch closed' : input.kind === 'CUSTOMER' ? 'Customer cancelled' : 'Cancelled');
      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: targetStatus,
          cancelled_at: now,
          cancellation_reason: reasonText.slice(0, 500),
          cancellation_trigger: trigger,
          cancelled_by: input.actorId ?? null,
          events: {
            create: {
              event_type: `BOOKING_${targetStatus}`,
              from_status: booking.status,
              to_status: targetStatus,
              actor_type: input.kind === 'CLOSURE' ? 'ADMIN' : input.kind,
              actor_id: input.actorId ?? null,
              metadata: {
                trigger,
                hours_before_departure: Math.round(hoursBeforeDeparture * 100) / 100,
                refund_paise: refundPaise.toString(),
                ...(input.closureId ? { closure_id: input.closureId } : {}),
              },
            },
          },
        },
      });

      const refund =
        refundPaise > 0n
          ? await this.refunds.queueRefundInTx(tx, {
              bookingId: booking.id,
              amountPaise: refundPaise,
              reason: trigger,
              idempotencyKey: `cancel:${booking.id}`,
              initiatedByType: input.kind === 'CLOSURE' ? 'ADMIN' : input.kind,
              initiatedById: input.actorId ?? null,
            })
          : null;
      if (wasPaid && !refund) {
        // No refund owed (e.g. < 6h customer cancellation): vendor share is unchanged.
        await this.transfers.applyRefundToTransferInTx(tx, booking.id);
      }

      if (input.kind === 'VENDOR') {
        await tx.$executeRaw`UPDATE vendors SET reliability_score = GREATEST(0, reliability_score - ${vendorCancellationPenalty()}), updated_at = NOW() WHERE id = ${trip.vendor_id}::uuid`;
      }

      if (input.kind === 'ADMIN' || input.kind === 'CLOSURE' || input.kind === 'VENDOR') {
        await this.audit.logInTx(tx, {
          actor_type: input.kind === 'VENDOR' ? 'VENDOR' : 'ADMIN',
          actor_id: input.actorId ?? undefined,
          admin_id: input.kind === 'VENDOR' ? undefined : input.actorId ?? undefined,
          action: input.kind === 'CLOSURE' ? 'BOOKING_CANCELLED_RIVER_CLOSURE' : `BOOKING_CANCELLED_${input.kind}`,
          entity_type: 'Booking',
          entity_id: booking.id,
          data: {
            previous_status: booking.status,
            new_status: targetStatus,
            refund_paise: refundPaise.toString(),
            reason: reasonText,
            closure_id: input.closureId,
          },
          ip_address: input.ip_address,
          user_agent: input.user_agent,
        });
      }

      await this.notifications.notifyCustomerInTx(tx, booking, 'BOOKING_CANCELLED', {
        reason: trigger,
        refund_paise: (refund?.amount_paise ?? 0n).toString(),
      });
      if (wasPaid && input.kind !== 'VENDOR') {
        await this.notifications.notifyVendorInTx(
          tx,
          trip.vendor_id,
          'BOOKING_CANCELLED_VENDOR',
          { booking_id: booking.id, booking_code: booking.booking_code, reason: trigger },
          booking.id,
          ['PUSH'],
        );
      }

      return { booking: updated, refund, alreadyCancelled: false };
    });
  }

  /** Backwards-compatible wrapper used by the customer controller. */
  async cancelBookingByCustomer(bookingId: string, userId: string) {
    const r = await this.cancelBooking({ bookingId, kind: 'CUSTOMER', userId, actorId: userId });
    return { booking: r.booking, refund_paise: r.refund?.amount_paise ?? 0n };
  }

  // ════════════════════════════════════════════════════════════════════════
  // CHECK-IN (vendor scans the customer's signed QR, or types the booking code)
  // ════════════════════════════════════════════════════════════════════════
  /**
   * A typed code is the fallback when the customer's phone is dead (V-08). The
   * QR is cryptographically signed; a code is not, so a code that belongs to
   * another company is reported as "not found" rather than "wrong company",
   * so codes cannot be used to probe other operators' bookings.
   */
  async checkIn(
    member: { id: string; vendorId: string },
    ticket: { qrToken: string } | { bookingCode: string },
    meta: { ip_address?: string; user_agent?: string } = {},
  ) {
    const byCode = 'bookingCode' in ticket;
    let bookingId: string;
    let expectedCode: string;
    if (byCode) {
      expectedCode = normaliseBookingCode(ticket.bookingCode);
      if (!isValidBookingCode(expectedCode)) {
        throw new ApiException('INVALID_BOOKING_CODE', 'Booking codes are 6 letters and digits, e.g. RF7K2M9P', HttpStatus.BAD_REQUEST);
      }
      const found = await this.prisma.booking.findUnique({ where: { booking_code: expectedCode }, select: { id: true } });
      if (!found) throw new ApiException('BOOKING_NOT_FOUND', 'No booking with this code', HttpStatus.NOT_FOUND);
      bookingId = found.id;
    } else {
      let payload: { bid: string; bcd: string };
      try {
        payload = this.qr.verifyQrToken(ticket.qrToken);
      } catch {
        throw new ApiException('INVALID_QR', 'This QR code is not a valid RaftNow ticket', HttpStatus.BAD_REQUEST);
      }
      if (!/^[0-9a-f-]{36}$/i.test(payload.bid)) {
        throw new ApiException('INVALID_QR', 'This QR code is not a valid RaftNow ticket', HttpStatus.BAD_REQUEST);
      }
      bookingId = payload.bid;
      expectedCode = payload.bcd;
    }

    return this.prisma.withLockingTransaction(async (tx) => {
      const { booking, slot } = await this.lockBookingWithSlot(tx, bookingId);
      if (booking.booking_code !== expectedCode) {
        throw new ApiException('INVALID_QR', 'This QR code is not a valid RaftNow ticket', HttpStatus.BAD_REQUEST);
      }
      const trip = await tx.trip.findUniqueOrThrow({
        where: { id: slot.trip_id },
        select: { vendor_id: true, title: true, stretch: { select: { name: true } } },
      });
      if (trip.vendor_id !== member.vendorId) {
        if (byCode) throw new ApiException('BOOKING_NOT_FOUND', 'No booking with this code', HttpStatus.NOT_FOUND);
        throw new ApiException('WRONG_VENDOR', 'This ticket is for a different rafting company', HttpStatus.FORBIDDEN);
      }
      if (booking.status === 'CHECKED_IN') {
        const current = await tx.booking.findUniqueOrThrow({ where: { id: booking.id }, select: { checked_in_at: true } });
        throw new ApiException('ALREADY_CHECKED_IN', 'This ticket has already been checked in', HttpStatus.CONFLICT, {
          checked_in_at: current.checked_in_at?.toISOString(),
        });
      }
      if (booking.status !== 'CONFIRMED') {
        throw new ApiException('NOT_ELIGIBLE_FOR_CHECK_IN', `Booking is ${booking.status.toLowerCase().replace(/_/g, ' ')}`, HttpStatus.CONFLICT, {
          status: booking.status,
        });
      }
      const now = Date.now();
      const opensAt = slot.start_time.getTime() - checkInOpensHoursBefore() * 3_600_000;
      const closesAt = slot.end_time.getTime() + checkInGraceHoursAfterEnd() * 3_600_000;
      if (now < opensAt) {
        throw new ApiException('CHECK_IN_NOT_OPEN', 'Check-in opens closer to departure time', HttpStatus.CONFLICT, {
          opens_at: new Date(opensAt).toISOString(),
        });
      }
      if (now > closesAt) {
        throw new ApiException('CHECK_IN_CLOSED', 'Check-in for this departure has closed', HttpStatus.CONFLICT);
      }

      const checkedInAt = new Date();
      // Conditional update: even without the lock, only one CONFIRMED→CHECKED_IN can win.
      const res = await tx.booking.updateMany({
        where: { id: booking.id, status: 'CONFIRMED' },
        data: { status: 'CHECKED_IN', checked_in_at: checkedInAt, checked_in_by: member.id },
      });
      if (res.count !== 1) {
        throw new ApiException('ALREADY_CHECKED_IN', 'This ticket has already been checked in', HttpStatus.CONFLICT);
      }
      await tx.bookingEvent.create({
        data: {
          booking_id: booking.id,
          event_type: 'BOOKING_CHECKED_IN',
          from_status: 'CONFIRMED',
          to_status: 'CHECKED_IN',
          actor_type: 'VENDOR',
          actor_id: member.id,
          metadata: { check_in_method: byCode ? 'BOOKING_CODE' : 'QR_SCAN' },
        },
      });
      await this.audit.logInTx(tx, {
        actor_type: 'VENDOR',
        actor_id: member.id,
        action: 'BOOKING_CHECKED_IN',
        entity_type: 'Booking',
        entity_id: booking.id,
        data: { vendor_id: member.vendorId, booking_code: booking.booking_code, method: byCode ? 'BOOKING_CODE' : 'QR_SCAN' },
        ...meta,
      });
      await this.notifications.notifyCustomerInTx(tx, booking, 'CHECK_IN_CONFIRMED', {}, ['PUSH']);

      const guests = await tx.bookingGuest.findMany({
        where: { booking_id: booking.id },
        orderBy: { position: 'asc' },
        select: { name: true, age: true },
      });
      return {
        result: 'CHECKED_IN' as const,
        checked_in_at: checkedInAt.toISOString(),
        booking: {
          id: booking.id,
          booking_code: booking.booking_code,
          display_code: `RF${booking.booking_code}`,
          mode: booking.mode,
          seat_count: booking.seat_count,
          guests,
          trip_title: trip.title,
          stretch_name: trip.stretch.name,
          start_time: slot.start_time.toISOString(),
        },
      };
    });
  }

  /** Vendor marks a confirmed customer who never arrived (after departure). */
  async markNoShow(member: { id: string; vendorId: string }, bookingId: string) {
    return this.prisma.withLockingTransaction(async (tx) => {
      const { booking, slot } = await this.lockBookingWithSlot(tx, bookingId);
      const trip = await tx.trip.findUniqueOrThrow({ where: { id: slot.trip_id }, select: { vendor_id: true } });
      if (trip.vendor_id !== member.vendorId) throw new ForbiddenException('This booking does not belong to your company');
      if (booking.status !== 'CONFIRMED') throw new InvalidBookingTransitionException(booking.status, 'NO_SHOW');
      if (slot.start_time.getTime() > Date.now()) {
        throw new ApiException('NOT_DEPARTED', 'No-show can only be recorded after departure time', HttpStatus.CONFLICT);
      }
      return tx.booking.update({
        where: { id: bookingId },
        data: {
          status: 'NO_SHOW',
          events: {
            create: {
              event_type: 'BOOKING_NO_SHOW',
              from_status: 'CONFIRMED',
              to_status: 'NO_SHOW',
              actor_type: 'VENDOR',
              actor_id: member.id,
            },
          },
        },
      });
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // DISPUTES (admin, A-08)
  // ════════════════════════════════════════════════════════════════════════
  /**
   * Flags a paid booking as DISPUTED. The payout job only releases bookings in
   * PAYOUT_ELIGIBLE statuses, so the vendor's on-hold transfer stays held until
   * the dispute is resolved. A transfer that was already released is reported
   * back so ops know the money has left the hold.
   */
  async flagDispute(adminId: string, bookingId: string, reason: string, meta: { ip_address?: string; user_agent?: string } = {}) {
    return this.prisma.withLockingTransaction(async (tx) => {
      const { booking } = await this.lockBookingWithSlot(tx, bookingId);
      if (!DISPUTABLE.includes(booking.status)) throw new InvalidBookingTransitionException(booking.status, 'DISPUTED');
      const now = new Date();
      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: 'DISPUTED',
          disputed_at: now,
          dispute_reason: reason.slice(0, 500),
          events: {
            create: {
              event_type: 'BOOKING_DISPUTED',
              from_status: booking.status,
              to_status: 'DISPUTED',
              actor_type: 'ADMIN',
              actor_id: adminId,
              metadata: { reason },
            },
          },
        },
      });
      const transfer = await tx.transfer.findUnique({ where: { booking_id: booking.id }, select: { status: true } });
      await this.audit.logInTx(tx, {
        actor_type: 'ADMIN',
        actor_id: adminId,
        admin_id: adminId,
        action: 'BOOKING_DISPUTED',
        entity_type: 'Booking',
        entity_id: booking.id,
        data: { previous_status: booking.status, reason, transfer_status: transfer?.status ?? null },
        ...meta,
      });
      return {
        booking_id: updated.id,
        status: updated.status,
        previous_status: booking.status,
        payout_held: !transfer || transfer.status === 'ON_HOLD',
        transfer_status: transfer?.status ?? null,
      };
    });
  }

  /**
   * Closes a dispute without money movement: the booking returns to the status
   * it had when flagged, and the normal completion / payout jobs take over. To
   * refund instead, cancel the disputed booking (admin cancel accepts DISPUTED).
   */
  async resolveDispute(adminId: string, bookingId: string, note: string, meta: { ip_address?: string; user_agent?: string } = {}) {
    return this.prisma.withLockingTransaction(async (tx) => {
      const { booking } = await this.lockBookingWithSlot(tx, bookingId);
      if (booking.status !== 'DISPUTED') {
        throw new ApiException('NOT_DISPUTED', `Booking is ${booking.status}, not DISPUTED`, HttpStatus.CONFLICT);
      }
      const flagged = await tx.bookingEvent.findFirst({
        where: { booking_id: booking.id, to_status: 'DISPUTED' },
        orderBy: { created_at: 'desc' },
        select: { from_status: true },
      });
      const restore = flagged?.from_status && DISPUTABLE.includes(flagged.from_status) ? flagged.from_status : 'COMPLETED';
      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: restore as Prisma.BookingUpdateInput['status'],
          events: {
            create: {
              event_type: 'BOOKING_DISPUTE_RESOLVED',
              from_status: 'DISPUTED',
              to_status: restore,
              actor_type: 'ADMIN',
              actor_id: adminId,
              metadata: { note },
            },
          },
        },
      });
      await this.audit.logInTx(tx, {
        actor_type: 'ADMIN',
        actor_id: adminId,
        admin_id: adminId,
        action: 'BOOKING_DISPUTE_RESOLVED',
        entity_type: 'Booking',
        entity_id: booking.id,
        data: { restored_status: restore, note },
        ...meta,
      });
      return { booking_id: updated.id, status: updated.status };
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // AUTO-COMPLETION
  // ════════════════════════════════════════════════════════════════════════
  async completeBooking(bookingId: string) {
    return this.prisma.withTransaction(async (tx) => {
      const current = await tx.booking.findUnique({ where: { id: bookingId }, select: { status: true } });
      if (!current || !['CONFIRMED', 'CHECKED_IN'].includes(current.status)) return null;
      const res = await tx.booking.updateMany({
        where: { id: bookingId, status: current.status },
        data: { status: 'COMPLETED', completed_at: new Date() },
      });
      if (res.count !== 1) return null; // raced with another transition
      await tx.bookingEvent.create({
        data: {
          booking_id: bookingId,
          event_type: 'BOOKING_COMPLETED',
          from_status: current.status,
          to_status: 'COMPLETED',
          actor_type: 'SYSTEM',
          metadata: { auto_completed: true },
        },
      });
      return bookingId;
    });
  }

  async completeFinishedBookings(limit = 200) {
    const hours = parseInt(process.env.AUTO_COMPLETE_AFTER_HOURS ?? '2', 10);
    const cutoff = new Date(Date.now() - hours * 3_600_000);
    const eligible = await this.prisma.booking.findMany({
      where: { status: { in: ['CONFIRMED', 'CHECKED_IN'] }, slot: { end_time: { lt: cutoff } } },
      select: { id: true },
      take: limit,
    });
    let completed = 0;
    for (const b of eligible) {
      try {
        if (await this.completeBooking(b.id)) completed++;
      } catch (err) {
        this.logger.error(`Auto-complete ${b.id} failed: ${(err as Error).message}`);
      }
    }
    return { examined: eligible.length, completed };
  }

  // ════════════════════════════════════════════════════════════════════════
  // Customer reads
  // ════════════════════════════════════════════════════════════════════════
  private customerInclude = {
    guests: { orderBy: { position: 'asc' as const } },
    slot: {
      include: {
        trip: {
          select: {
            id: true,
            title: true,
            meeting_point: true,
            vendor: { select: { display_name: true } },
            stretch: { select: { id: true, name: true } },
          },
        },
      },
    },
    refunds: { select: { id: true, amount_paise: true, status: true, created_at: true, processed_at: true } },
  } satisfies Prisma.BookingInclude;

  async getCustomerBooking(id: string, userId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id }, include: this.customerInclude });
    if (!booking || booking.user_id !== userId) throw new NotFoundException('Booking');
    return this.toCustomerView(booking);
  }

  async listCustomerBookings(userId: string) {
    const rows = await this.prisma.booking.findMany({
      where: { user_id: userId },
      include: this.customerInclude,
      orderBy: { created_at: 'desc' },
      take: 50,
    });
    return rows.map((b) => this.toCustomerView(b));
  }

  private toCustomerView(b: Prisma.BookingGetPayload<{ include: BookingsService['customerInclude'] }>) {
    const { idempotency_key, platform_commission_paise, vendor_payout_paise, commission_bps, ...rest } = b;
    void idempotency_key; void platform_commission_paise; void vendor_payout_paise; void commission_bps;
    return { ...rest, display_code: `RF${b.booking_code}` };
  }
}
