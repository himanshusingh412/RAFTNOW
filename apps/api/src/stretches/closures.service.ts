import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BookingsService } from '../bookings/bookings.service';
import { ApiException, ConflictException, NotFoundException } from '../common/exceptions/api.exception';
import { closuresInForceWhere } from './closure-rules';
import { addDays, istDateOf, istDayRange, isIsoDate } from '../common/time/ist';

const MAX_SEASON_DAYS = 200;

export interface AdminActor {
  adminId: string;
  ip_address?: string;
  user_agent?: string;
}

/**
 * River / stretch emergency lockout.
 *
 * CLOSE: persists a Closure row (the database is the source of truth — the
 *        booking transaction checks it under the slot lock, so new bookings are
 *        blocked the moment the closure commits), writes an audit entry in the
 *        same transaction, then cancels + fully refunds every affected future
 *        booking (idempotent, resumable — see processClosure).
 * OPEN:  revokes the in-force closure(s); cancelled bookings stay cancelled.
 */
@Injectable()
export class ClosuresService {
  private readonly logger = new Logger(ClosuresService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly bookings: BookingsService,
  ) {}

  private async currentState(stretchId: string | null, now = new Date()) {
    const inForce = await this.prisma.closure.findMany({ where: closuresInForceWhere(now) });
    const own = inForce.filter((c) => c.stretch_id === stretchId);
    const riverWide = inForce.filter((c) => c.stretch_id === null);
    return { own, riverWide, closed: own.length > 0 || (stretchId !== null && riverWide.length > 0) };
  }

  async adminList() {
    const now = new Date();
    const [stretches, closures] = await Promise.all([
      this.prisma.stretch.findMany({ orderBy: { distance_km: 'asc' } }),
      this.prisma.closure.findMany({ where: closuresInForceWhere(now) }),
    ]);
    return {
      river_wide_closure: closures.find((c) => c.stretch_id === null) ?? null,
      stretches: stretches.map((s) => {
        const own = closures.find((c) => c.stretch_id === s.id) ?? null;
        const riverWide = closures.find((c) => c.stretch_id === null) ?? null;
        return {
          id: s.id,
          name: s.name,
          grade: s.grade,
          distance_km: Number(s.distance_km),
          duration_minutes: s.duration_minutes,
          put_in_point: s.put_in_point,
          take_out_point: s.take_out_point,
          min_age: s.min_age,
          max_age: s.max_age,
          active: s.active,
          status: own || riverWide ? 'CLOSED' : 'OPEN',
          closure: own ?? riverWide,
        };
      }),
    };
  }

  async history(stretchId?: string, limit = 50) {
    return this.prisma.closure.findMany({
      where: stretchId ? { stretch_id: stretchId } : {},
      orderBy: { created_at: 'desc' },
      take: Math.min(limit, 200),
    });
  }

  /**
   * Close a stretch (or the whole river when stretchId is null).
   * endsAt omitted → closed until explicitly reopened.
   */
  async close(actor: AdminActor, stretchId: string | null, reason: string, endsAt?: Date) {
    const now = new Date();
    if (!reason || reason.trim().length < 5) {
      throw new ApiException('REASON_REQUIRED', 'A closure reason (min 5 characters) is required', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    if (endsAt && endsAt <= now) {
      throw new ApiException('INVALID_END_TIME', 'ends_at must be in the future', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const closure = await this.prisma.withTransaction(async (tx) => {
      if (stretchId) {
        const stretch = await tx.stretch.findUnique({ where: { id: stretchId } });
        if (!stretch) throw new NotFoundException('Stretch');
        // Serialise concurrent close/open on the same stretch.
        await tx.$queryRaw`SELECT id FROM stretches WHERE id = ${stretchId}::uuid FOR UPDATE`;
      } else {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('raftnow:river_wide_closure'))`;
      }
      const inForce = await tx.closure.findFirst({
        where: { AND: [closuresInForceWhere(now), { stretch_id: stretchId }] },
      });
      if (inForce) {
        throw new ConflictException('ALREADY_CLOSED', 'This stretch already has an active closure', { closure_id: inForce.id });
      }
      const created = await tx.closure.create({
        data: {
          stretch_id: stretchId,
          starts_at: now,
          ends_at: endsAt ?? null,
          reason: reason.trim().slice(0, 500),
          created_by: actor.adminId,
        },
      });
      await this.audit.logInTx(tx, {
        actor_type: 'ADMIN',
        actor_id: actor.adminId,
        admin_id: actor.adminId,
        action: stretchId ? 'STRETCH_CLOSED' : 'RIVER_CLOSED',
        entity_type: stretchId ? 'Stretch' : 'Closure',
        entity_id: stretchId ?? created.id,
        data: {
          closure_id: created.id,
          previous_state: 'OPEN',
          new_state: 'CLOSED',
          reason: created.reason,
          starts_at: created.starts_at.toISOString(),
          ends_at: created.ends_at?.toISOString() ?? null,
        },
        ip_address: actor.ip_address,
        user_agent: actor.user_agent,
      });
      return created;
    });

    this.logger.warn(`Closure ${closure.id} created for ${stretchId ?? 'ENTIRE RIVER'} by admin ${actor.adminId}`);
    const processing = await this.processClosure(closure.id);
    return { closure, processing };
  }

  /** Reopen: revokes the stretch's own in-force closure(s). */
  async open(actor: AdminActor, stretchId: string | null, reason: string) {
    const now = new Date();
    if (!reason || reason.trim().length < 3) {
      throw new ApiException('REASON_REQUIRED', 'A reason is required to reopen', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    return this.prisma.withTransaction(async (tx) => {
      if (stretchId) {
        const stretch = await tx.stretch.findUnique({ where: { id: stretchId } });
        if (!stretch) throw new NotFoundException('Stretch');
        await tx.$queryRaw`SELECT id FROM stretches WHERE id = ${stretchId}::uuid FOR UPDATE`;
      } else {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('raftnow:river_wide_closure'))`;
      }
      const inForce = await tx.closure.findMany({ where: { AND: [closuresInForceWhere(now), { stretch_id: stretchId }] } });
      if (inForce.length === 0) {
        const riverWide = stretchId
          ? await tx.closure.findFirst({ where: { AND: [closuresInForceWhere(now), { stretch_id: null }] } })
          : null;
        throw new ConflictException(
          riverWide ? 'RIVER_WIDE_CLOSURE_ACTIVE' : 'NOT_CLOSED',
          riverWide ? 'The entire river is closed — reopen the river-wide closure instead' : 'This stretch is not closed',
        );
      }
      await tx.closure.updateMany({
        where: { id: { in: inForce.map((c) => c.id) }, revoked_at: null },
        data: { revoked_at: now, revoked_by: actor.adminId, revoke_reason: reason.trim().slice(0, 500) },
      });
      await this.audit.logInTx(tx, {
        actor_type: 'ADMIN',
        actor_id: actor.adminId,
        admin_id: actor.adminId,
        action: stretchId ? 'STRETCH_REOPENED' : 'RIVER_REOPENED',
        entity_type: stretchId ? 'Stretch' : 'Closure',
        entity_id: stretchId ?? inForce[0].id,
        data: {
          closure_ids: inForce.map((c) => c.id),
          previous_state: 'CLOSED',
          new_state: 'OPEN',
          reason: reason.trim(),
          reopened_at: now.toISOString(),
        },
        ip_address: actor.ip_address,
        user_agent: actor.user_agent,
      });
      return { reopened: inForce.map((c) => c.id), at: now.toISOString() };
    });
  }

  /**
   * Cancels and fully refunds every booking whose departure falls inside the
   * closure window. Idempotent and resumable: each booking is cancelled in its
   * own locked transaction (already-cancelled bookings are skipped, refunds are
   * keyed "cancel:<booking>"), so the durable job can safely re-run it.
   */
  async processClosure(closureId: string) {
    const closure = await this.prisma.closure.findUnique({ where: { id: closureId } });
    if (!closure) throw new NotFoundException('Closure');
    if (closure.revoked_at && closure.bookings_processed_at) {
      return { closure_id: closureId, cancelled: 0, failed: 0, skipped: true };
    }

    const now = new Date();
    const affected = await this.prisma.booking.findMany({
      where: {
        status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] },
        slot: {
          start_time: { gte: closure.starts_at > now ? closure.starts_at : now, ...(closure.ends_at ? { lt: closure.ends_at } : {}) },
          ...(closure.stretch_id ? { trip: { stretch_id: closure.stretch_id } } : {}),
        },
      },
      select: { id: true },
      orderBy: { created_at: 'asc' },
    });

    let cancelled = 0;
    let failed = 0;
    for (const b of affected) {
      try {
        const r = await this.bookings.cancelBooking({
          bookingId: b.id,
          kind: 'CLOSURE',
          actorId: closure.created_by,
          closureId,
          reason: `River closure: ${closure.reason}`,
        });
        if (!r.alreadyCancelled) cancelled++;
      } catch (err) {
        failed++;
        this.logger.error(`Closure ${closureId}: failed to cancel booking ${b.id}: ${(err as Error).message}`);
      }
    }

    if (failed === 0) {
      await this.prisma.closure.update({
        where: { id: closureId },
        data: { bookings_processed_at: new Date(), affected_bookings_count: (closure.affected_bookings_count ?? 0) + cancelled },
      });
    }
    this.logger.warn(`Closure ${closureId}: ${cancelled} bookings cancelled, ${failed} failures`);
    return { closure_id: closureId, affected: affected.length, cancelled, failed };
  }

  // ── Season calendar (A-05) ──────────────────────────────────────────────
  //
  // A season is a planned closure (kind SEASON) with whole IST days as bounds.
  // Because it is an ordinary closure row, everything that already honours
  // closures honours it: search marks departures CLOSED, the booking
  // transaction refuses them, and processClosure refunds anything already sold.

  /** Seasons that have not ended yet (plus the last 90 days), soonest first. */
  async listSeasons(now = new Date()) {
    const rows = await this.prisma.closure.findMany({
      where: { kind: 'SEASON', ends_at: { gt: new Date(now.getTime() - 90 * 86_400_000) } },
      include: { stretch: { select: { id: true, name: true } } },
      orderBy: { starts_at: 'asc' },
    });
    return rows.map((c) => this.seasonView(c, now));
  }

  /**
   * Schedules an off-season closure from the start of `startsOn` to the end of
   * `endsOn` (IST, inclusive). Seasons for the same scope may not overlap.
   */
  async scheduleSeason(actor: AdminActor, input: { stretchId: string | null; startsOn: string; endsOn: string; reason: string }) {
    const now = new Date();
    const today = istDateOf(now);
    if (!isIsoDate(input.startsOn) || !isIsoDate(input.endsOn)) {
      throw new ApiException('INVALID_DATE', 'Dates must be YYYY-MM-DD', HttpStatus.BAD_REQUEST);
    }
    if (input.startsOn < today) throw new ApiException('START_IN_PAST', 'A season cannot start in the past', HttpStatus.UNPROCESSABLE_ENTITY);
    if (input.endsOn < input.startsOn) throw new ApiException('INVALID_RANGE', 'The season must end on or after its first day', HttpStatus.UNPROCESSABLE_ENTITY);
    if (addDays(input.startsOn, MAX_SEASON_DAYS) <= input.endsOn) {
      throw new ApiException('RANGE_TOO_LONG', `A season can span at most ${MAX_SEASON_DAYS} days`, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const reason = input.reason.trim();
    if (reason.length < 5) throw new ApiException('REASON_REQUIRED', 'A reason (min 5 characters) is required', HttpStatus.UNPROCESSABLE_ENTITY);
    const startsAt = istDayRange(input.startsOn).start;
    const endsAt = istDayRange(input.endsOn).end;

    const season = await this.prisma.withTransaction(async (tx) => {
      if (input.stretchId) {
        const stretch = await tx.stretch.findUnique({ where: { id: input.stretchId } });
        if (!stretch) throw new NotFoundException('Stretch');
        await tx.$queryRaw`SELECT id FROM stretches WHERE id = ${input.stretchId}::uuid FOR UPDATE`;
      } else {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('raftnow:river_wide_closure'))`;
      }
      const overlap = await tx.closure.findFirst({
        where: { kind: 'SEASON', stretch_id: input.stretchId, revoked_at: null, starts_at: { lt: endsAt }, ends_at: { gt: startsAt } },
      });
      if (overlap) {
        throw new ConflictException('SEASON_OVERLAP', 'This overlaps another season for the same stretch', { closure_id: overlap.id });
      }
      const created = await tx.closure.create({
        data: { kind: 'SEASON', stretch_id: input.stretchId, starts_at: startsAt, ends_at: endsAt, reason: reason.slice(0, 500), created_by: actor.adminId },
        include: { stretch: { select: { id: true, name: true } } },
      });
      await this.audit.logInTx(tx, {
        actor_type: 'ADMIN',
        actor_id: actor.adminId,
        admin_id: actor.adminId,
        action: 'SEASON_SCHEDULED',
        entity_type: 'Closure',
        entity_id: created.id,
        data: { stretch_id: input.stretchId, starts_on: input.startsOn, ends_on: input.endsOn, reason },
        ip_address: actor.ip_address,
        user_agent: actor.user_agent,
      });
      return created;
    });
    const processing = await this.processClosure(season.id);
    return { season: this.seasonView(season, now), processing };
  }

  /** Cancels a season that has not started, or ends one early. Refunded bookings stay cancelled. */
  async cancelSeason(actor: AdminActor, closureId: string, reason: string) {
    const now = new Date();
    if (!reason || reason.trim().length < 3) throw new ApiException('REASON_REQUIRED', 'A reason is required', HttpStatus.UNPROCESSABLE_ENTITY);
    const updated = await this.prisma.withTransaction(async (tx) => {
      const c = await tx.closure.findUnique({ where: { id: closureId } });
      if (!c || c.kind !== 'SEASON') throw new NotFoundException('Season');
      if (c.revoked_at) throw new ConflictException('ALREADY_CANCELLED', 'This season is already cancelled');
      if (c.ends_at && c.ends_at <= now) throw new ConflictException('SEASON_ENDED', 'This season has already ended');
      const u = await tx.closure.update({
        where: { id: closureId },
        data: { revoked_at: now, revoked_by: actor.adminId, revoke_reason: reason.trim().slice(0, 500) },
        include: { stretch: { select: { id: true, name: true } } },
      });
      await this.audit.logInTx(tx, {
        actor_type: 'ADMIN',
        actor_id: actor.adminId,
        admin_id: actor.adminId,
        action: c.starts_at <= now ? 'SEASON_ENDED_EARLY' : 'SEASON_CANCELLED',
        entity_type: 'Closure',
        entity_id: c.id,
        data: { reason: reason.trim() },
        ip_address: actor.ip_address,
        user_agent: actor.user_agent,
      });
      return u;
    });
    return this.seasonView(updated, now);
  }

  private seasonView(
    c: { id: string; stretch_id: string | null; starts_at: Date; ends_at: Date | null; reason: string; revoked_at: Date | null; affected_bookings_count: number | null; stretch?: { id: string; name: string } | null },
    now: Date,
  ) {
    const state = c.revoked_at ? 'CANCELLED' : c.ends_at && c.ends_at <= now ? 'ENDED' : c.starts_at <= now ? 'IN_FORCE' : 'SCHEDULED';
    return {
      id: c.id,
      stretch: c.stretch ?? null,
      river_wide: c.stretch_id === null,
      // Inclusive IST day bounds, as entered.
      starts_on: istDateOf(c.starts_at),
      ends_on: c.ends_at ? istDateOf(new Date(c.ends_at.getTime() - 1)) : null,
      reason: c.reason,
      state,
      refunded_bookings: c.affected_bookings_count ?? 0,
    };
  }

  /** Job entry point: re-processes closures that have not completed processing. */
  async processUnfinishedClosures() {
    const pending = await this.prisma.closure.findMany({
      where: { bookings_processed_at: null, revoked_at: null },
      select: { id: true },
      take: 10,
    });
    const results = [];
    for (const c of pending) results.push(await this.processClosure(c.id));
    return results;
  }
}
