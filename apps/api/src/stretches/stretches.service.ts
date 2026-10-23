import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApiException, ConflictException, NotFoundException } from '../common/exceptions/api.exception';
import { closuresInForceWhere } from './closure-rules';

/** Master data an admin may set on a stretch (A-05). */
export interface StretchInput {
  name: string;
  distance_km: number;
  grade: string;
  duration_minutes: number;
  put_in_point: string;
  take_out_point: string;
  min_age: number;
  max_age: number | null;
  active: boolean;
}

type Meta = { ip_address?: string; user_agent?: string };

export interface PublicStretch {
  id: string;
  name: string;
  distance_km: number;
  grade: string;
  duration_minutes: number;
  put_in_point: string;
  take_out_point: string;
  min_age: number;
  max_age: number | null;
  status: 'OPEN' | 'CLOSED';
  closure: { reason: string; since: string; until: string | null; river_wide: boolean } | null;
  /** The next planned closure inside the booking window, so customers see it before picking a date. */
  next_closure: { reason: string; from: string; until: string | null; river_wide: boolean } | null;
  from_price_paise: number | null;
  live_trip_count: number;
}

@Injectable()
export class StretchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Admin master data (A-05) ────────────────────────────────────────────

  async create(adminId: string, input: StretchInput, meta: Meta = {}) {
    this.validate(input);
    try {
      const s = await this.prisma.stretch.create({ data: { ...input, name: input.name.trim() } });
      await this.audit.log({
        actor_type: 'ADMIN', actor_id: adminId, admin_id: adminId, action: 'STRETCH_CREATED', entity_type: 'Stretch', entity_id: s.id,
        data: { ...input, distance_km: String(input.distance_km) }, ...meta,
      });
      return this.adminView(s);
    } catch (e) {
      throw this.uniqueName(e);
    }
  }

  /**
   * Edits master data. Deactivating hides the stretch from search and the
   * booking engine refuses new bookings on it; bookings already sold stand.
   */
  async update(adminId: string, id: string, patch: Partial<StretchInput>, meta: Meta = {}) {
    const before = await this.prisma.stretch.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Stretch');
    const merged: StretchInput = {
      name: patch.name ?? before.name,
      distance_km: patch.distance_km ?? Number(before.distance_km),
      grade: patch.grade ?? before.grade,
      duration_minutes: patch.duration_minutes ?? before.duration_minutes,
      put_in_point: patch.put_in_point ?? before.put_in_point,
      take_out_point: patch.take_out_point ?? before.take_out_point,
      min_age: patch.min_age ?? before.min_age,
      max_age: patch.max_age === undefined ? before.max_age : patch.max_age,
      active: patch.active ?? before.active,
    };
    this.validate(merged);
    try {
      const s = await this.prisma.stretch.update({ where: { id }, data: { ...merged, name: merged.name.trim() } });
      const changed = Object.keys(patch).filter((k) => String((patch as any)[k]) !== String((before as any)[k]));
      await this.audit.log({
        actor_type: 'ADMIN', actor_id: adminId, admin_id: adminId,
        action: patch.active === false && before.active ? 'STRETCH_DEACTIVATED' : patch.active === true && !before.active ? 'STRETCH_ACTIVATED' : 'STRETCH_UPDATED',
        entity_type: 'Stretch', entity_id: id,
        data: { changed, before: Object.fromEntries(changed.map((k) => [k, String((before as any)[k])])) }, ...meta,
      });
      const affected = s.active
        ? null
        : await this.prisma.booking.count({ where: { status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] }, slot: { start_time: { gt: new Date() }, trip: { stretch_id: id } } } });
      return { ...this.adminView(s), ...(affected !== null ? { upcoming_bookings_still_valid: affected } : {}) };
    } catch (e) {
      throw this.uniqueName(e);
    }
  }

  private validate(i: StretchInput) {
    const fail = (msg: string) => new ApiException('INVALID_STRETCH', msg, HttpStatus.UNPROCESSABLE_ENTITY);
    if (i.name.trim().length < 3) throw fail('Name must be at least 3 characters');
    if (!(i.distance_km > 0 && i.distance_km < 1000) || Math.round(i.distance_km * 10) !== i.distance_km * 10) {
      throw fail('Distance must be between 0.1 and 999.9 km, to one decimal');
    }
    if (i.min_age < 5 || i.min_age > 80) throw fail('Minimum age must be between 5 and 80');
    if (i.max_age !== null && (i.max_age < i.min_age || i.max_age > 100)) throw fail('Maximum age must be between the minimum age and 100');
    if (i.duration_minutes < 15 || i.duration_minutes > 720) throw fail('Duration must be between 15 minutes and 12 hours');
  }

  private uniqueName(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new ConflictException('STRETCH_NAME_TAKEN', 'A stretch with this name already exists');
    }
    return e;
  }

  private adminView(s: { id: string; name: string; distance_km: Prisma.Decimal; grade: string; duration_minutes: number; put_in_point: string; take_out_point: string; min_age: number; max_age: number | null; active: boolean }) {
    return {
      id: s.id,
      name: s.name,
      distance_km: Number(s.distance_km),
      grade: s.grade,
      duration_minutes: s.duration_minutes,
      put_in_point: s.put_in_point,
      take_out_point: s.take_out_point,
      min_age: s.min_age,
      max_age: s.max_age,
      active: s.active,
    };
  }

  /** Customer-facing list: active stretches only, with live closure state. */
  async listPublic(): Promise<PublicStretch[]> {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + parseInt(process.env.BOOKING_WINDOW_DAYS ?? '60', 10) * 86_400_000);
    const [stretches, closures, upcoming, prices] = await Promise.all([
      this.prisma.stretch.findMany({ where: { active: true }, orderBy: { distance_km: 'asc' } }),
      this.prisma.closure.findMany({ where: closuresInForceWhere(now), orderBy: { starts_at: 'desc' } }),
      this.prisma.closure.findMany({ where: { revoked_at: null, starts_at: { gt: now, lt: windowEnd } }, orderBy: { starts_at: 'asc' } }),
      this.prisma.trip.groupBy({
        by: ['stretch_id'],
        where: { status: 'LIVE', vendor: { status: 'LIVE' } },
        _min: { per_seat_price_paise: true },
        _count: { _all: true },
      }),
    ]);
    const priceBy = new Map(prices.map((p) => [p.stretch_id, p]));

    return stretches.map((s) => {
      const closure = closures.find((c) => c.stretch_id === s.id) ?? closures.find((c) => c.stretch_id === null) ?? null;
      const p = priceBy.get(s.id);
      const next = upcoming.find((c) => c.stretch_id === s.id || c.stretch_id === null) ?? null;
      return {
        id: s.id,
        name: s.name,
        distance_km: Number(s.distance_km),
        grade: s.grade,
        duration_minutes: s.duration_minutes,
        put_in_point: s.put_in_point,
        take_out_point: s.take_out_point,
        min_age: s.min_age,
        max_age: s.max_age,
        status: closure ? 'CLOSED' : 'OPEN',
        closure: closure
          ? {
              reason: closure.reason,
              since: closure.starts_at.toISOString(),
              until: closure.ends_at?.toISOString() ?? null,
              river_wide: closure.stretch_id === null,
            }
          : null,
        next_closure: next
          ? { reason: next.reason, from: next.starts_at.toISOString(), until: next.ends_at?.toISOString() ?? null, river_wide: next.stretch_id === null }
          : null,
        from_price_paise: p?._min.per_seat_price_paise != null ? Number(p._min.per_seat_price_paise) : null,
        live_trip_count: p?._count._all ?? 0,
      };
    });
  }

  async getPublic(id: string): Promise<PublicStretch> {
    const all = await this.listPublic();
    const found = all.find((s) => s.id === id);
    if (!found) throw new NotFoundException('Stretch');
    return found;
  }
}
