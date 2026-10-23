import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { ApiException, NotFoundException } from '../common/exceptions/api.exception';
import { availablePrivateRafts, availableSharedSeats } from '../bookings/inventory';
import { publicMediaUrl } from '../storage/storage.service';
import { closureCovers, closuresOverlappingWhere } from '../stretches/closure-rules';
import { addDays, istDateOf, istDateTime, istDayRange, istWeekday, isIsoDate, IST_TZ } from '../common/time/ist';

const slotInclude = {
  trip: {
    select: {
      id: true,
      title: true,
      meeting_point: true,
      duration_minutes: true,
      min_age: true,
      max_age: true,
      raft_capacity: true,
      per_seat_price_paise: true,
      private_raft_price_paise: true,
      stretch_id: true,
      vendor: { select: { id: true, display_name: true, licence_verified: true, licence_expiry: true, reliability_score: true } },
      stretch: { select: { id: true, name: true, min_age: true, max_age: true } },
      photos: { orderBy: { position: 'asc' }, take: 1, select: { s3_key: true } },
    },
  },
} satisfies Prisma.SlotInclude;

type SlotRow = Prisma.SlotGetPayload<{ include: typeof slotInclude }>;

export const AVAILABILITY_NOTE =
  'Availability is indicative. Seats are only guaranteed once a booking hold is created; the booking transaction is authoritative.';

@Injectable()
export class SlotsService {
  private readonly logger = new Logger(SlotsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Public availability for one stretch (or every active stretch when
   * stretchId is omitted) on one IST calendar date.
   * Held seats are computed from UNEXPIRED holds only, so a lapsed hold that the
   * expiry job has not yet swept does not hide seats from customers.
   */
  async listAvailability(stretchId: string | undefined, date: string) {
    if (!isIsoDate(date)) {
      throw new ApiException('INVALID_DATE', 'date must be YYYY-MM-DD', HttpStatus.BAD_REQUEST);
    }
    const today = istDateOf(new Date());
    const maxDate = addDays(today, parseInt(process.env.BOOKING_WINDOW_DAYS ?? '60', 10));
    if (date < today || date > maxDate) {
      throw new ApiException('DATE_OUT_OF_RANGE', `date must be between ${today} and ${maxDate}`, HttpStatus.BAD_REQUEST);
    }

    if (stretchId) {
      const stretch = await this.prisma.stretch.findFirst({ where: { id: stretchId, active: true } });
      if (!stretch) throw new NotFoundException('Stretch');
    }

    const now = new Date();
    const { start, end } = istDayRange(date);
    const rows = await this.prisma.slot.findMany({
      where: {
        status: 'OPEN',
        start_time: { gte: start > now ? start : now, lt: end },
        trip: {
          ...(stretchId ? { stretch_id: stretchId } : { stretch: { active: true } }),
          status: 'LIVE',
          vendor: { status: 'LIVE' },
        },
      },
      include: slotInclude,
      orderBy: [{ start_time: 'asc' }],
    });

    const closures = (await this.prisma.closure.findMany({ where: closuresOverlappingWhere(start, end) })).filter(
      (c) => c.stretch_id === null || !stretchId || c.stretch_id === stretchId,
    );
    const holds = await this.activeHolds(rows.map((r) => r.id), now);

    return {
      stretch_id: stretchId ?? null,
      date,
      timezone: IST_TZ,
      generated_at: now.toISOString(),
      authoritative: false,
      note: AVAILABILITY_NOTE,
      slots: rows
        .filter((r) => r.trip.vendor.licence_expiry && r.trip.vendor.licence_expiry >= r.start_time)
        .map((r) => this.toView(r, holds.get(r.id), closures)),
    };
  }

  async getSlot(id: string) {
    const r = await this.prisma.slot.findUnique({ where: { id }, include: slotInclude });
    if (!r) throw new NotFoundException('Slot');
    const now = new Date();
    const closures = (await this.prisma.closure.findMany({ where: closuresOverlappingWhere(r.start_time, r.end_time) })).filter(
      (c) => c.stretch_id === null || c.stretch_id === r.trip.stretch_id,
    );
    const holds = await this.activeHolds([r.id], now);
    return { ...this.toView(r, holds.get(r.id), closures), authoritative: false, note: AVAILABILITY_NOTE };
  }

  private async activeHolds(slotIds: string[], now: Date) {
    const map = new Map<string, { seats: number; rafts: number }>();
    if (slotIds.length === 0) return map;
    const grouped = await this.prisma.booking.groupBy({
      by: ['slot_id', 'mode'],
      where: { slot_id: { in: slotIds }, status: 'PENDING_PAYMENT', hold_expires_at: { gt: now } },
      _sum: { seat_count: true },
      _count: { _all: true },
    });
    for (const g of grouped) {
      const cur = map.get(g.slot_id) ?? { seats: 0, rafts: 0 };
      if (g.mode === 'SHARED') cur.seats += g._sum.seat_count ?? 0;
      else cur.rafts += g._count._all;
      map.set(g.slot_id, cur);
    }
    return map;
  }

  private toView(
    r: SlotRow,
    holds: { seats: number; rafts: number } | undefined,
    closures: Array<{ id: string; stretch_id: string | null; starts_at: Date; ends_at: Date | null; revoked_at: Date | null; reason: string }>,
  ) {
    const counters = {
      total_rafts: r.total_rafts,
      raft_capacity: r.raft_capacity,
      total_seats: r.total_seats,
      seats_booked: r.seats_booked,
      seats_held: Math.min(r.seats_held, holds?.seats ?? 0),
      private_rafts_booked: r.private_rafts_booked,
      private_rafts_held: Math.min(r.private_rafts_held, holds?.rafts ?? 0),
    };
    const closure = closures.find((c) => closureCovers(c, r.trip.stretch_id, r.start_time)) ?? null;
    const shared = availableSharedSeats(counters);
    const priv = r.trip.private_raft_price_paise ? availablePrivateRafts(counters) : 0;
    return {
      id: r.id,
      trip_id: r.trip_id,
      start_time: r.start_time.toISOString(),
      end_time: r.end_time.toISOString(),
      status: closure ? 'CLOSED' : r.status,
      bookable: !closure && r.status === 'OPEN' && (shared > 0 || priv > 0),
      closure_reason: closure?.reason ?? null,
      total_seats: r.total_seats,
      raft_capacity: r.raft_capacity,
      available_shared_seats: closure ? 0 : shared,
      available_private_rafts: closure ? 0 : priv,
      per_seat_price_paise: Number(r.trip.per_seat_price_paise),
      private_raft_price_paise: r.trip.private_raft_price_paise != null ? Number(r.trip.private_raft_price_paise) : null,
      min_age: Math.max(r.trip.min_age, r.trip.stretch.min_age),
      max_age: r.trip.max_age ?? r.trip.stretch.max_age ?? null,
      trip: {
        id: r.trip.id,
        title: r.trip.title,
        meeting_point: r.trip.meeting_point,
        duration_minutes: r.trip.duration_minutes,
        cover_photo_url: r.trip.photos[0] ? publicMediaUrl(r.trip.photos[0].s3_key) : null,
        stretch: { id: r.trip.stretch.id, name: r.trip.stretch.name },
        vendor: {
          id: r.trip.vendor.id,
          display_name: r.trip.vendor.display_name,
          licence_verified: r.trip.vendor.licence_verified,
        },
      },
    };
  }

  // ── Slot generation from vendor templates ────────────────────────────────

  /**
   * Materialises bookable slots from active slot templates for the next N days
   * (IST). Idempotent: (trip_id, start_time) is UNIQUE and inserts skip
   * duplicates, so re-running never duplicates or resets inventory.
   */
  async generateFromTemplates(daysAhead = parseInt(process.env.SLOT_GENERATION_DAYS ?? '14', 10)) {
    const templates = await this.prisma.slotTemplate.findMany({
      where: { active: true, trip: { status: 'LIVE', vendor: { status: { in: ['LIVE', 'UNDER_REVIEW', 'DRAFT'] } } } },
      include: { trip: { select: { id: true, duration_minutes: true, raft_capacity: true } } },
    });
    const now = new Date();
    const today = istDateOf(now);
    const data: Prisma.SlotCreateManyInput[] = [];
    for (const t of templates) {
      for (let d = 0; d < daysAhead; d++) {
        const date = addDays(today, d);
        if (t.days_of_week.length > 0 && !t.days_of_week.includes(istWeekday(date))) continue;
        let start: Date;
        try {
          start = istDateTime(date, t.departure_time);
        } catch {
          this.logger.warn(`Template ${t.id} has invalid departure_time "${t.departure_time}"`);
          break;
        }
        if (start <= now) continue;
        data.push({
          trip_id: t.trip.id,
          start_time: start,
          end_time: new Date(start.getTime() + t.trip.duration_minutes * 60_000),
          total_rafts: t.rafts_count,
          raft_capacity: t.trip.raft_capacity,
          total_seats: t.rafts_count * t.trip.raft_capacity,
          generated_from: t.id,
        });
      }
    }
    if (data.length === 0) return { templates: templates.length, created: 0 };
    const res = await this.prisma.slot.createMany({ data, skipDuplicates: true });
    if (res.count > 0) this.logger.log(`Generated ${res.count} slots from ${templates.length} templates`);
    return { templates: templates.length, created: res.count };
  }
}
