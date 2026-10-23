import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApiException, ConflictException, NotFoundException } from '../common/exceptions/api.exception';
import { SlotsService } from '../slots/slots.service';
import { StorageService } from '../storage/storage.service';
import { istDayRange, isIsoDate } from '../common/time/ist';
import { CreateTripDto, SlotTemplateDto, UpdateSlotTemplateDto, UpdateTripDto } from './dto/trip.dto';
import type { VendorPrincipal } from '../auth/auth.guard';

/** PRD C-06 / V-04: up to 8 photos per trip. */
export const MAX_TRIP_PHOTOS = 8;

/** Vendor-side management of trips, departure templates and slots. */
@Injectable()
export class TripsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly slots: SlotsService,
    private readonly storage: StorageService,
  ) {}

  private async ownTrip(vendorId: string, tripId: string) {
    const trip = await this.prisma.trip.findFirst({ where: { id: tripId, vendor_id: vendorId } });
    if (!trip) throw new NotFoundException('Trip');
    return trip;
  }

  /**
   * Public trip page: everything a customer needs before booking. Only LIVE
   * trips of LIVE operators are visible; anything else is a 404.
   */
  async getPublicTrip(id: string) {
    const t = await this.prisma.trip.findFirst({
      where: { id, status: 'LIVE', vendor: { status: 'LIVE' } },
      include: {
        stretch: true,
        vendor: { select: { id: true, display_name: true, description: true, phone: true, address: true, address_city: true, licence_verified: true, licence_number: true, licence_expiry: true } },
        photos: { orderBy: { position: 'asc' }, take: MAX_TRIP_PHOTOS, select: { id: true, caption: true, s3_key: true } },
      },
    });
    if (!t) throw new NotFoundException('Trip');
    return {
      id: t.id,
      title: t.title,
      description: t.description,
      duration_minutes: t.duration_minutes,
      inclusions: t.inclusions,
      exclusions: t.exclusions,
      meeting_point: t.meeting_point,
      meeting_lat: t.meeting_lat == null ? null : Number(t.meeting_lat),
      meeting_lng: t.meeting_lng == null ? null : Number(t.meeting_lng),
      min_age: t.min_age ?? t.stretch.min_age,
      max_age: t.max_age ?? t.stretch.max_age ?? null,
      raft_capacity: t.raft_capacity,
      per_seat_price_paise: t.per_seat_price_paise,
      private_raft_price_paise: t.private_raft_price_paise,
      photos: t.photos.map((p) => this.photoView(p)),
      stretch: {
        id: t.stretch.id,
        name: t.stretch.name,
        distance_km: Number(t.stretch.distance_km),
        grade: t.stretch.grade,
        put_in_point: t.stretch.put_in_point,
        take_out_point: t.stretch.take_out_point,
      },
      vendor: {
        id: t.vendor.id,
        display_name: t.vendor.display_name,
        description: t.vendor.description,
        phone: t.vendor.phone,
        address: [t.vendor.address, t.vendor.address_city].filter(Boolean).join(', '),
        licence_verified: t.vendor.licence_verified,
        licence_number: t.vendor.licence_verified ? t.vendor.licence_number : null,
        licence_expiry: t.vendor.licence_expiry?.toISOString() ?? null,
      },
      cancellation_policy: [
        { window: 'More than 24 hours before departure', refund_percent: 100 },
        { window: '6 to 24 hours before departure', refund_percent: 50 },
        { window: 'Less than 6 hours, or no-show', refund_percent: 0 },
        { window: 'Operator cancels or river is closed', refund_percent: 100 },
      ],
    };
  }

  // ── Admin hide (A-10) ───────────────────────────────────────────────────

  /** Takes a trip off sale. Existing bookings stay valid; only new sales stop. */
  async hideByAdmin(adminId: string, tripId: string, reason: string, meta: { ip_address?: string; user_agent?: string } = {}) {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip) throw new NotFoundException('Trip');
    if (trip.admin_hidden_at) throw new ConflictException('ALREADY_HIDDEN', 'This trip is already hidden by RaftNow');
    const updated = await this.prisma.trip.update({
      where: { id: tripId },
      data: { status: 'HIDDEN', admin_hidden_at: new Date(), admin_hidden_reason: reason, admin_hidden_prev_status: trip.status },
    });
    await this.audit.log({
      actor_type: 'ADMIN', actor_id: adminId, admin_id: adminId, action: 'TRIP_HIDDEN_BY_ADMIN', entity_type: 'Trip', entity_id: tripId,
      data: { previous_status: trip.status, reason }, ...meta,
    });
    return this.adminView(updated);
  }

  /** Restores the status the trip had before it was hidden. */
  async unhideByAdmin(adminId: string, tripId: string, meta: { ip_address?: string; user_agent?: string } = {}) {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip) throw new NotFoundException('Trip');
    if (!trip.admin_hidden_at) throw new ConflictException('NOT_HIDDEN', 'This trip is not hidden by RaftNow');
    const restore = trip.admin_hidden_prev_status ?? 'HIDDEN';
    const updated = await this.prisma.trip.update({
      where: { id: tripId },
      data: { status: restore, admin_hidden_at: null, admin_hidden_reason: null, admin_hidden_prev_status: null },
    });
    await this.audit.log({
      actor_type: 'ADMIN', actor_id: adminId, admin_id: adminId, action: 'TRIP_UNHIDDEN_BY_ADMIN', entity_type: 'Trip', entity_id: tripId,
      data: { restored_status: restore }, ...meta,
    });
    if (restore === 'LIVE') await this.slots.generateFromTemplates();
    return this.adminView(updated);
  }

  /** Every trip for the admin panel, newest first, with the operator. */
  adminList() {
    return this.prisma.trip
      .findMany({
        include: { vendor: { select: { id: true, display_name: true, status: true } }, stretch: { select: { name: true } } },
        orderBy: [{ admin_hidden_at: { sort: 'desc', nulls: 'last' } }, { created_at: 'desc' }],
        take: 500,
      })
      .then((rows) => rows.map((t) => ({ ...this.adminView(t), vendor: t.vendor, stretch_name: t.stretch.name })));
  }

  private adminView(t: { id: string; title: string; status: string; vendor_id: string; admin_hidden_at: Date | null; admin_hidden_reason: string | null; per_seat_price_paise: bigint }) {
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      vendor_id: t.vendor_id,
      per_seat_price_paise: t.per_seat_price_paise,
      hidden_by_admin: !!t.admin_hidden_at,
      admin_hidden_at: t.admin_hidden_at?.toISOString() ?? null,
      admin_hidden_reason: t.admin_hidden_reason,
    };
  }

  list(vendorId: string) {
    return this.prisma.trip.findMany({
      where: { vendor_id: vendorId },
      include: {
        stretch: { select: { id: true, name: true } },
        slot_templates: { orderBy: { departure_time: 'asc' } },
        photos: { orderBy: { position: 'asc' }, select: { id: true, caption: true, s3_key: true } },
      },
      orderBy: { created_at: 'desc' },
    }).then((rows) => rows.map(({ photos, ...t }) => ({ ...t, photos: photos.map((p) => this.photoView(p)) })));
  }

  // ── Photos (V-04) ──────────────────────────────────────────────────────

  private photoView(p: { id: string; caption: string | null; s3_key: string }) {
    return { id: p.id, caption: p.caption, url: this.storage.publicUrl(p.s3_key) };
  }

  /** Adds a photo at the end of the gallery (max MAX_TRIP_PHOTOS per trip). */
  async addPhoto(member: VendorPrincipal, tripId: string, file: { buffer: Buffer } | undefined, caption?: string) {
    if (!file) throw new ApiException('FILE_REQUIRED', 'Attach the photo as multipart field "file"', HttpStatus.BAD_REQUEST);
    await this.ownTrip(member.vendorId, tripId);
    // Cheap pre-check before the expensive image work; re-checked under the lock below.
    if ((await this.prisma.tripPhoto.count({ where: { trip_id: tripId } })) >= MAX_TRIP_PHOTOS) throw this.tooMany();
    const stored = await this.storage.putPublicImage(`trip-photos/${tripId}`, file.buffer);
    try {
      const photo = await this.prisma.withTransaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM trips WHERE id = ${tripId}::uuid FOR UPDATE`;
        const existing = await tx.tripPhoto.findMany({ where: { trip_id: tripId }, select: { position: true } });
        if (existing.length >= MAX_TRIP_PHOTOS) throw this.tooMany();
        const created = await tx.tripPhoto.create({
          data: {
            trip_id: tripId,
            s3_key: stored.key,
            caption: caption?.trim().slice(0, 140) || null,
            position: existing.reduce((m, p) => Math.max(m, p.position + 1), 0),
          },
        });
        await this.audit.logInTx(tx, {
          actor_type: 'VENDOR', actor_id: member.id, action: 'TRIP_PHOTO_ADDED', entity_type: 'Trip', entity_id: tripId,
          data: { photo_id: created.id, width: stored.width, height: stored.height, bytes: stored.size },
        });
        return created;
      });
      return this.photoView(photo);
    } catch (e) {
      await this.storage.deletePublicImage(stored.key);
      throw e;
    }
  }

  async deletePhoto(member: VendorPrincipal, tripId: string, photoId: string) {
    await this.ownTrip(member.vendorId, tripId);
    const photo = await this.prisma.tripPhoto.findFirst({ where: { id: photoId, trip_id: tripId } });
    if (!photo) throw new NotFoundException('Photo');
    await this.prisma.tripPhoto.delete({ where: { id: photo.id } });
    await this.audit.log({ actor_type: 'VENDOR', actor_id: member.id, action: 'TRIP_PHOTO_DELETED', entity_type: 'Trip', entity_id: tripId, data: { photo_id: photo.id } });
    await this.storage.deletePublicImage(photo.s3_key);
    return { deleted: true };
  }

  /** Sets the gallery order; the first photo is the cover. `photoIds` must list every photo exactly once. */
  async reorderPhotos(member: VendorPrincipal, tripId: string, photoIds: string[]) {
    await this.ownTrip(member.vendorId, tripId);
    return this.prisma.withTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM trips WHERE id = ${tripId}::uuid FOR UPDATE`;
      const current = await tx.tripPhoto.findMany({ where: { trip_id: tripId }, select: { id: true } });
      const ids = new Set(current.map((p) => p.id));
      if (photoIds.length !== ids.size || new Set(photoIds).size !== photoIds.length || !photoIds.every((id) => ids.has(id))) {
        throw new ApiException('INVALID_ORDER', 'List every photo of this trip exactly once', HttpStatus.UNPROCESSABLE_ENTITY);
      }
      for (const [position, id] of photoIds.entries()) {
        await tx.tripPhoto.update({ where: { id }, data: { position } });
      }
      const rows = await tx.tripPhoto.findMany({ where: { trip_id: tripId }, orderBy: { position: 'asc' } });
      return rows.map((p) => this.photoView(p));
    });
  }

  private tooMany() {
    return new ConflictException('TOO_MANY_PHOTOS', `A trip can have at most ${MAX_TRIP_PHOTOS} photos. Delete one first.`);
  }

  async create(member: VendorPrincipal, dto: CreateTripDto) {
    if (member.vendorStatus === 'SUSPENDED') throw new ConflictException('VENDOR_SUSPENDED', 'Suspended companies cannot create trips');
    const stretch = await this.prisma.stretch.findFirst({ where: { id: dto.stretch_id, active: true } });
    if (!stretch) throw new NotFoundException('Stretch');
    if (dto.max_age != null && dto.min_age != null && dto.max_age < dto.min_age) {
      throw new ApiException('INVALID_AGE_RANGE', 'max_age must be >= min_age', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const trip = await this.prisma.trip.create({
      data: {
        vendor_id: member.vendorId,
        stretch_id: dto.stretch_id,
        title: dto.title,
        description: dto.description,
        duration_minutes: dto.duration_minutes,
        inclusions: dto.inclusions ?? [],
        exclusions: dto.exclusions ?? [],
        meeting_point: dto.meeting_point,
        meeting_lat: dto.meeting_lat,
        meeting_lng: dto.meeting_lng,
        min_age: Math.max(dto.min_age ?? stretch.min_age, stretch.min_age),
        max_age: dto.max_age ?? null,
        raft_capacity: dto.raft_capacity,
        per_seat_price_paise: BigInt(dto.per_seat_price_paise),
        private_raft_price_paise: dto.private_raft_price_paise != null ? BigInt(dto.private_raft_price_paise) : null,
        status: 'DRAFT',
      },
    });
    await this.audit.log({ actor_type: 'VENDOR', actor_id: member.id, action: 'TRIP_CREATED', entity_type: 'Trip', entity_id: trip.id, data: { title: trip.title } });
    return trip;
  }

  async update(member: VendorPrincipal, tripId: string, dto: UpdateTripDto) {
    const trip = await this.ownTrip(member.vendorId, tripId);
    if (trip.admin_hidden_at && dto.status !== undefined && dto.status !== trip.status) {
      throw new ApiException(
        'TRIP_HIDDEN_BY_ADMIN',
        `RaftNow has taken this trip off sale${trip.admin_hidden_reason ? `: ${trip.admin_hidden_reason}` : ''}. Contact support to republish it.`,
        HttpStatus.CONFLICT,
      );
    }
    if (dto.status === 'LIVE') {
      const templates = await this.prisma.slotTemplate.count({ where: { trip_id: trip.id, active: true } });
      if (templates === 0) {
        throw new ApiException('NO_DEPARTURES', 'Add at least one departure time before publishing', HttpStatus.UNPROCESSABLE_ENTITY);
      }
    }
    // Prices are snapshotted on each booking, so changes only affect new bookings.
    const updated = await this.prisma.trip.update({
      where: { id: trip.id },
      data: {
        ...dto,
        per_seat_price_paise: dto.per_seat_price_paise != null ? BigInt(dto.per_seat_price_paise) : undefined,
        private_raft_price_paise:
          dto.private_raft_price_paise === undefined ? undefined : dto.private_raft_price_paise === null ? null : BigInt(dto.private_raft_price_paise),
      },
    });
    await this.audit.log({
      actor_type: 'VENDOR',
      actor_id: member.id,
      action: 'TRIP_UPDATED',
      entity_type: 'Trip',
      entity_id: trip.id,
      data: { fields: Object.keys(dto), previous_status: trip.status, new_status: updated.status },
    });
    if (updated.status === 'LIVE') await this.slots.generateFromTemplates();
    return updated;
  }

  async addTemplate(member: VendorPrincipal, tripId: string, dto: SlotTemplateDto) {
    const trip = await this.ownTrip(member.vendorId, tripId);
    const dup = await this.prisma.slotTemplate.findFirst({ where: { trip_id: trip.id, departure_time: dto.departure_time, active: true } });
    if (dup) throw new ConflictException('DUPLICATE_DEPARTURE', `A ${dto.departure_time} departure already exists`);
    const t = await this.prisma.slotTemplate.create({
      data: { trip_id: trip.id, departure_time: dto.departure_time, days_of_week: [...new Set(dto.days_of_week)].sort(), rafts_count: dto.rafts_count },
    });
    if (trip.status === 'LIVE') await this.slots.generateFromTemplates();
    return t;
  }

  async updateTemplate(member: VendorPrincipal, templateId: string, dto: UpdateSlotTemplateDto) {
    const t = await this.prisma.slotTemplate.findFirst({ where: { id: templateId, trip: { vendor_id: member.vendorId } } });
    if (!t) throw new NotFoundException('SlotTemplate');
    // Only affects slots generated from now on — existing slots keep their inventory.
    return this.prisma.slotTemplate.update({ where: { id: t.id }, data: dto });
  }

  async listSlots(vendorId: string, date: string, tripId?: string) {
    if (!isIsoDate(date)) throw new ApiException('INVALID_DATE', 'date must be YYYY-MM-DD', HttpStatus.BAD_REQUEST);
    const { start, end } = istDayRange(date);
    const rows = await this.prisma.slot.findMany({
      where: { start_time: { gte: start, lt: end }, trip: { vendor_id: vendorId, ...(tripId ? { id: tripId } : {}) } },
      include: {
        trip: { select: { id: true, title: true, stretch: { select: { name: true } } } },
        bookings: { where: { status: { in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'PENDING_PAYMENT'] } }, select: { status: true, seat_count: true, hold_expires_at: true } },
      },
      orderBy: { start_time: 'asc' },
    });
    const now = new Date();
    return rows.map((s) => {
      const confirmed = s.bookings.filter((b) => b.status !== 'PENDING_PAYMENT');
      return {
        id: s.id,
        trip: s.trip,
        start_time: s.start_time.toISOString(),
        end_time: s.end_time.toISOString(),
        status: s.status,
        blocked_reason: s.blocked_reason,
        total_rafts: s.total_rafts,
        raft_capacity: s.raft_capacity,
        total_seats: s.total_seats,
        seats_booked: s.seats_booked,
        seats_held_active: s.bookings.filter((b) => b.status === 'PENDING_PAYMENT' && b.hold_expires_at > now).reduce((a, b) => a + b.seat_count, 0),
        private_rafts_booked: s.private_rafts_booked,
        passengers: confirmed.reduce((a, b) => a + b.seat_count, 0),
        checked_in: s.bookings.filter((b) => b.status === 'CHECKED_IN').reduce((a, b) => a + b.seat_count, 0),
      };
    });
  }

  async setSlotBlocked(member: VendorPrincipal, slotId: string, blocked: boolean, reason?: string) {
    const slot = await this.prisma.slot.findFirst({ where: { id: slotId, trip: { vendor_id: member.vendorId } } });
    if (!slot) throw new NotFoundException('Slot');
    const updated = await this.prisma.slot.update({
      where: { id: slot.id },
      data: blocked ? { status: 'BLOCKED', blocked_reason: reason ?? 'Blocked by operator' } : { status: 'OPEN', blocked_reason: null },
    });
    await this.audit.log({
      actor_type: 'VENDOR',
      actor_id: member.id,
      action: blocked ? 'SLOT_BLOCKED' : 'SLOT_UNBLOCKED',
      entity_type: 'Slot',
      entity_id: slot.id,
      data: { previous_status: slot.status, new_status: updated.status, reason },
    });
    return updated;
  }
}
