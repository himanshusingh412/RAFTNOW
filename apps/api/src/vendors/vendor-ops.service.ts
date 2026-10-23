import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { istDayRange } from '../common/time/ist';

/** Read models for the operator dashboard (bookings, manifests, payouts). */
@Injectable()
export class VendorOpsService {
  constructor(private readonly prisma: PrismaService) {}

  async bookings(vendorId: string, q: { date?: string; slot_id?: string; status?: string; limit?: number }) {
    const where: Prisma.BookingWhereInput = {
      slot: {
        trip: { vendor_id: vendorId },
        ...(q.slot_id ? { id: q.slot_id } : {}),
        ...(q.date ? { start_time: { gte: istDayRange(q.date).start, lt: istDayRange(q.date).end } } : {}),
      },
      ...(q.status ? { status: q.status as any } : { status: { notIn: ['EXPIRED'] } }),
    };
    const rows = await this.prisma.booking.findMany({
      where,
      include: {
        guests: { orderBy: { position: 'asc' }, select: { name: true, age: true, position: true } },
        slot: { select: { id: true, start_time: true, end_time: true, trip: { select: { id: true, title: true, stretch: { select: { name: true } } } } } },
      },
      orderBy: [{ slot: { start_time: 'asc' } }, { created_at: 'asc' }],
      take: q.limit ?? 200,
    });
    return rows.map((b) => ({
      id: b.id,
      booking_code: b.booking_code,
      display_code: `RF${b.booking_code}`,
      status: b.status,
      mode: b.mode,
      seat_count: b.seat_count,
      contact_name: b.contact_name,
      contact_phone: b.contact_phone,
      guests: b.guests,
      amount_paise: b.amount_paise,
      vendor_payout_paise: b.vendor_payout_paise,
      checked_in_at: b.checked_in_at?.toISOString() ?? null,
      cancelled_at: b.cancelled_at?.toISOString() ?? null,
      slot: {
        id: b.slot.id,
        start_time: b.slot.start_time.toISOString(),
        end_time: b.slot.end_time.toISOString(),
        trip_title: b.slot.trip.title,
        stretch_name: b.slot.trip.stretch.name,
      },
    }));
  }

  async summary(vendorId: string, date: string) {
    const { start, end } = istDayRange(date);
    const grouped = await this.prisma.booking.groupBy({
      by: ['status'],
      where: { slot: { trip: { vendor_id: vendorId }, start_time: { gte: start, lt: end } } },
      _sum: { seat_count: true },
      _count: { _all: true },
    });
    const by = Object.fromEntries(grouped.map((g) => [g.status, { bookings: g._count._all, passengers: g._sum.seat_count ?? 0 }]));
    const departures = await this.prisma.slot.count({ where: { trip: { vendor_id: vendorId }, start_time: { gte: start, lt: end } } });
    return { date, departures, by_status: by };
  }

  async payouts(vendorId: string) {
    const [transfers, totals] = await Promise.all([
      this.prisma.transfer.findMany({
        where: { vendor_id: vendorId },
        include: { booking: { select: { booking_code: true, status: true, slot: { select: { start_time: true } } } } },
        orderBy: { created_at: 'desc' },
        take: 200,
      }),
      this.prisma.transfer.groupBy({ by: ['status'], where: { vendor_id: vendorId }, _sum: { amount_paise: true }, _count: { _all: true } }),
    ]);
    return {
      totals: Object.fromEntries(totals.map((t) => [t.status, { count: t._count._all, amount_paise: t._sum.amount_paise ?? 0n }])),
      transfers: transfers.map((t) => ({
        id: t.id,
        booking_code: t.booking.booking_code,
        booking_status: t.booking.status,
        departure: t.booking.slot.start_time.toISOString(),
        amount_paise: t.amount_paise,
        status: t.status,
        hold_reason: t.hold_reason,
        release_at: t.release_at.toISOString(),
        released_at: t.released_at?.toISOString() ?? null,
        settled_at: t.settled_at?.toISOString() ?? null,
        razorpay_transfer_id: t.razorpay_transfer_id,
        utr: t.utr,
      })),
    };
  }

  notifications(vendorId: string) {
    return this.prisma.notification.findMany({
      where: { vendor_id: vendorId },
      orderBy: { created_at: 'desc' },
      take: 100,
      select: { id: true, event: true, channel: true, status: true, data: true, created_at: true, sent_at: true, error: true },
    });
  }
}
