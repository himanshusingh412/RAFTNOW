import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { ApiException, NotFoundException } from '../common/exceptions/api.exception';
import { QrService } from '../common/qr/qr.service';
import { RazorpayGateway, GatewayError } from '../common/razorpay/razorpay.gateway';
import { WebhooksService } from '../webhooks/webhooks.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly qr: QrService,
    private readonly gateway: RazorpayGateway,
    private readonly webhooks: WebhooksService,
  ) {}

  private notConfigured() {
    return new ApiException('PAYMENTS_NOT_CONFIGURED', 'Online payments are not configured on this server', HttpStatus.SERVICE_UNAVAILABLE);
  }

  /**
   * Creates (or returns the existing) Razorpay order for a PENDING_PAYMENT hold.
   * A per-booking advisory lock prevents two concurrent calls from creating two
   * orders (which could lead to a double charge).
   */
  async createOrderForBooking(bookingId: string, userId: string) {
    if (!this.gateway.isConfigured()) throw this.notConfigured();

    return this.prisma.withTransaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'order:' + bookingId}))`;
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: { slot: { include: { trip: { select: { title: true } } } } },
      });
      if (!booking || booking.user_id !== userId) throw new NotFoundException('Booking');
      if (booking.status !== 'PENDING_PAYMENT') {
        throw new ApiException('BOOKING_NOT_PAYABLE', `Booking is ${booking.status}`, HttpStatus.CONFLICT);
      }
      if (booking.hold_expires_at < new Date()) {
        throw new ApiException('HOLD_EXPIRED', 'Your booking hold has expired. Please start again.', HttpStatus.GONE);
      }

      const existing = await tx.payment.findFirst({
        where: { booking_id: bookingId, status: { in: ['CREATED', 'AUTHORIZED'] } },
        orderBy: { created_at: 'desc' },
      });
      const view = (orderId: string, amount: bigint) => ({
        razorpay_order_id: orderId,
        razorpay_key_id: this.gateway.keyId,
        amount_paise: Number(amount),
        currency: 'INR',
        booking_id: bookingId,
        booking_code: booking.booking_code,
        hold_expires_at: booking.hold_expires_at.toISOString(),
      });
      if (existing) return view(existing.razorpay_order_id, existing.amount_paise);

      let order: any;
      try {
        order = await this.gateway.createOrder({
          amount: Number(booking.amount_paise),
          currency: 'INR',
          receipt: booking.booking_code,
          notes: { booking_id: bookingId, booking_code: booking.booking_code },
        });
      } catch (err) {
        if (err instanceof GatewayError && err.code === 'GATEWAY_NOT_CONFIGURED') throw this.notConfigured();
        throw new ApiException('PAYMENT_GATEWAY_ERROR', 'Could not start payment. Please try again.', HttpStatus.BAD_GATEWAY);
      }
      if (Number(order.amount) !== Number(booking.amount_paise)) {
        throw new ApiException('PAYMENT_GATEWAY_ERROR', 'Order amount mismatch', HttpStatus.BAD_GATEWAY);
      }
      await tx.payment.create({
        data: { booking_id: bookingId, razorpay_order_id: order.id, amount_paise: booking.amount_paise, currency: 'INR', status: 'CREATED' },
      });
      this.logger.log(`Razorpay order ${order.id} created for booking ${booking.booking_code}`);
      return view(order.id, booking.amount_paise);
    });
  }

  /**
   * Checkout callback. The signature proves the customer completed checkout,
   * but the booking is confirmed only from Razorpay's own record of the payment
   * (fetched server-side) — never from the client's claim.
   */
  async verifyCheckout(userId: string, dto: { booking_id: string; razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) {
    if (!this.webhooks.verifyPaymentSignature(dto.razorpay_order_id, dto.razorpay_payment_id, dto.razorpay_signature)) {
      throw new ApiException('PAYMENT_VERIFICATION_FAILED', 'Payment signature verification failed', HttpStatus.BAD_REQUEST);
    }
    const payment = await this.prisma.payment.findUnique({
      where: { razorpay_order_id: dto.razorpay_order_id },
      include: { booking: { select: { id: true, user_id: true } } },
    });
    if (!payment || payment.booking.id !== dto.booking_id || payment.booking.user_id !== userId) {
      throw new NotFoundException('Payment');
    }

    try {
      const rzp: any = await this.gateway.fetchPayment(dto.razorpay_payment_id);
      if (rzp?.order_id === dto.razorpay_order_id && rzp?.status === 'captured') {
        await this.webhooks.handleCapturedPayment(rzp);
      }
    } catch (err) {
      this.logger.warn(`Checkout verify: could not confirm payment ${dto.razorpay_payment_id} yet: ${(err as Error).message}`);
    }
    const booking = await this.prisma.booking.findUniqueOrThrow({ where: { id: dto.booking_id }, select: { status: true, booking_code: true } });
    return {
      verified: true,
      booking_id: dto.booking_id,
      booking_status: booking.status,
      booking_code: booking.booking_code,
      confirmed: booking.status === 'CONFIRMED',
    };
  }

  /**
   * Job: catches captures whose webhook never arrived. Looks at recent orders
   * still CREATED/AUTHORIZED and asks Razorpay for their payments.
   */
  async reconcileOpenOrders(limit = 25) {
    if (!this.gateway.isConfigured()) return { checked: 0, captured: 0, skipped: 'gateway_not_configured' };
    const since = new Date(Date.now() - 48 * 3600_000);
    const until = new Date(Date.now() - 2 * 60_000);
    const open = await this.prisma.payment.findMany({
      where: { status: { in: ['CREATED', 'AUTHORIZED'] }, created_at: { gte: since, lte: until } },
      orderBy: { created_at: 'asc' },
      take: limit,
    });
    let captured = 0;
    for (const p of open) {
      try {
        const res: any = await this.gateway.fetchOrderPayments(p.razorpay_order_id);
        const hit = (res?.items ?? []).find((i: any) => i?.status === 'captured');
        if (hit) {
          await this.webhooks.handleCapturedPayment(hit);
          captured++;
        }
      } catch (err) {
        this.logger.warn(`Reconcile order ${p.razorpay_order_id} failed: ${(err as Error).message}`);
      }
    }
    return { checked: open.length, captured };
  }

  /** Signed QR ticket for a confirmed booking (customer view). */
  async getBookingQr(bookingId: string, userId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        guests: { orderBy: { position: 'asc' } },
        slot: {
          include: {
            trip: { include: { vendor: { select: { display_name: true } }, stretch: { select: { name: true } } } },
          },
        },
      },
    });
    if (!booking || booking.user_id !== userId) throw new NotFoundException('Booking');
    if (!['CONFIRMED', 'CHECKED_IN'].includes(booking.status)) {
      throw new ApiException('TICKET_NOT_AVAILABLE', `No ticket: booking is ${booking.status}`, HttpStatus.CONFLICT, { status: booking.status });
    }
    if (!this.qr.isConfigured()) {
      throw new ApiException('QR_NOT_CONFIGURED', 'QR tickets are not configured on this server', HttpStatus.SERVICE_UNAVAILABLE);
    }

    const qrToken = this.qr.generateQrToken(booking.id, booking.booking_code);
    const qrDataUrl = await this.qr.generateQrCodeDataUrl(qrToken);
    return {
      booking_id: booking.id,
      booking_code: booking.booking_code,
      display_code: `RF${booking.booking_code}`,
      qr_token: qrToken,
      qr_data_url: qrDataUrl,
      trip_title: booking.slot.trip.title,
      vendor_name: booking.slot.trip.vendor.display_name,
      stretch_name: booking.slot.trip.stretch.name,
      start_time: booking.slot.start_time.toISOString(),
      end_time: booking.slot.end_time.toISOString(),
      meeting_point: booking.slot.trip.meeting_point,
      mode: booking.mode,
      seat_count: booking.seat_count,
      guests: booking.guests.map((g) => ({ name: g.name, age: g.age })),
      status: booking.status,
      checked_in_at: booking.checked_in_at?.toISOString() ?? null,
    };
  }
}
