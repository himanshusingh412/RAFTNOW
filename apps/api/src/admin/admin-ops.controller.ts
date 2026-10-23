import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, IsBoolean, ValidateIf } from 'class-validator';
import { AdminAuthGuard, AdminPrincipal } from './auth/admin-auth.guard';
import { RequirePermissions } from './permissions';
import { ClosuresService } from '../stretches/closures.service';
import { VendorsService } from '../vendors/vendors.service';
import { BookingsService } from '../bookings/bookings.service';
import { RefundsService } from '../refunds/refunds.service';
import { TransfersService } from '../transfers/transfers.service';
import { AuditService } from '../audit/audit.service';
import { AdminAuthService } from './auth/admin-auth.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { ApiException, NotFoundException, ConflictException } from '../common/exceptions/api.exception';
import { TripsService } from '../trips/trips.service';
import { StretchesService } from '../stretches/stretches.service';
import { addDays, istDayRange, istDateOf } from '../common/time/ist';
import { bookingsCsv, summarise, GroupBy } from './reports';
import { requestMeta } from '../common/http/request-meta';
import { OptionalNotesDto, ReasonDto, ReviewDocumentDto, SetCommissionDto } from '../vendors/dto/onboarding.dto';

type AReq = { admin: AdminPrincipal } & Record<string, any>;
const actor = (req: AReq) => ({ adminId: req.admin.id, ...requestMeta(req) });

class CloseDto {
  @IsString() @Length(5, 500) reason!: string;
  /** Optional automatic end; omit to keep closed until reopened. */
  @IsOptional() @IsISO8601({ strict: true }) ends_at?: string;
}
class OpenDto {
  @IsString() @Length(3, 500) reason!: string;
}
class AdminCancelDto {
  @IsString() @Length(5, 500) reason!: string;
  /** Optional partial refund in paise; default 100%. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) refund_paise?: number;
}
class HoldDto {
  @IsString() @Length(3, 300) reason!: string;
}
class StatusQuery {
  @IsOptional() @IsString() status?: string;
}
class AuditQuery {
  @IsOptional() @IsString() entity_type?: string;
  @IsOptional() @IsUUID() entity_id?: string;
  @IsOptional() @IsString() action?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
}
class BookingSearchQuery {
  @IsOptional() @Matches(/^(RF)?[A-Z2-9]{6}$/i) code?: string;
  @IsOptional() @IsUUID() id?: string;
}
class StretchDto {
  @IsString() @Length(3, 80) name!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 1 }, { message: 'distance_km must be a number with at most one decimal place' }) @Min(0.1) @Max(999.9) distance_km!: number;
  @IsString() @Length(1, 40) grade!: string;
  @Type(() => Number) @IsInt() @Min(15) @Max(720) duration_minutes!: number;
  @IsString() @Length(2, 120) put_in_point!: string;
  @IsString() @Length(2, 120) take_out_point!: string;
  @Type(() => Number) @IsInt() @Min(5) @Max(80) min_age!: number;
  /** null = no upper limit. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(5) @Max(100) max_age?: number | null;
  @IsOptional() @IsBoolean() active?: boolean;
}
class UpdateStretchDto {
  @IsOptional() @IsString() @Length(3, 80) name?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 1 }, { message: 'distance_km must be a number with at most one decimal place' }) @Min(0.1) @Max(999.9) distance_km?: number;
  @IsOptional() @IsString() @Length(1, 40) grade?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(15) @Max(720) duration_minutes?: number;
  @IsOptional() @IsString() @Length(2, 120) put_in_point?: string;
  @IsOptional() @IsString() @Length(2, 120) take_out_point?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(80) min_age?: number;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(5) @Max(100) max_age?: number | null;
  @IsOptional() @IsBoolean() active?: boolean;
}
class SeasonDto {
  /** Omit or null for the whole river. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() stretch_id?: string | null;
  /** First closed IST day, inclusive. */
  @Matches(/^\d{4}-\d{2}-\d{2}$/) starts_on!: string;
  /** Last closed IST day, inclusive. */
  @Matches(/^\d{4}-\d{2}-\d{2}$/) ends_on!: string;
  @IsString() @Length(5, 500) reason!: string;
}

class DisputeDto {
  @IsString() @Length(5, 500) reason!: string;
}
class ResolveDisputeDto {
  @IsString() @Length(5, 500) note!: string;
}
class HideTripDto {
  @IsString() @Length(5, 500) reason!: string;
}
class ReportQuery {
  /** IST payment dates, inclusive. Defaults to the last 30 days. */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsOptional() @IsIn(['day', 'vendor']) group_by?: GroupBy;
}

const MAX_REPORT_DAYS = 366;

class CreateAdminDto {
  @IsEmail() email!: string;
  @IsIn(['SUPER_ADMIN', 'OPS', 'FINANCE']) role!: 'SUPER_ADMIN' | 'OPS' | 'FINANCE';
  @IsOptional() @IsString() @Length(2, 120) name?: string;
}
class UpdateAdminDto {
  @IsOptional() @IsIn(['SUPER_ADMIN', 'OPS', 'FINANCE']) role?: 'SUPER_ADMIN' | 'OPS' | 'FINANCE';
  @IsOptional() @IsBoolean() active?: boolean;
}

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin')
export class AdminOpsController {
  constructor(
    private readonly closures: ClosuresService,
    private readonly vendors: VendorsService,
    private readonly bookings: BookingsService,
    private readonly refunds: RefundsService,
    private readonly transfers: TransfersService,
    private readonly audit: AuditService,
    private readonly admins: AdminAuthService,
    private readonly prisma: PrismaService,
    private readonly trips: TripsService,
    private readonly stretchesSvc: StretchesService,
  ) {}

  /** Paid bookings (confirmed_at set) whose IST payment date is within [from, to]. */
  private async reportRows(q: ReportQuery) {
    const to = q.to ?? istDateOf(new Date());
    const from = q.from ?? addDays(to, -29);
    if (from > to) throw new ApiException('INVALID_RANGE', '"from" must be on or before "to"', HttpStatus.BAD_REQUEST);
    if (addDays(from, MAX_REPORT_DAYS) <= to) {
      throw new ApiException('RANGE_TOO_LONG', `Reports cover at most ${MAX_REPORT_DAYS} days`, HttpStatus.BAD_REQUEST);
    }
    const rows = await this.prisma.booking.findMany({
      where: { confirmed_at: { gte: istDayRange(from).start, lt: istDayRange(to).end } },
      orderBy: { confirmed_at: 'asc' },
      select: {
        booking_code: true, status: true, mode: true, seat_count: true, amount_paise: true, commission_bps: true,
        platform_commission_paise: true, vendor_payout_paise: true, confirmed_at: true,
        slot: { select: { start_time: true, trip: { select: { title: true, vendor: { select: { id: true, display_name: true } }, stretch: { select: { name: true } } } } } },
        refunds: { select: { amount_paise: true, status: true } },
        transfer: { select: { status: true, amount_paise: true, reversed_amount_paise: true } },
        payments: { select: { razorpay_payment_id: true, status: true } },
      },
    });
    return { from, to, rows: rows.map((r) => ({ ...r, confirmed_at: r.confirmed_at! })) };
  }

  // ── River closures ──────────────────────────────────────────────────────

  @Get('stretches')
  @RequirePermissions('closures:read')
  @ApiOperation({ summary: 'All stretches with live OPEN/CLOSED state' })
  stretches() {
    return this.closures.adminList();
  }

  @Post('stretches')
  @RequirePermissions('closures:write')
  @ApiOperation({ summary: 'Add a river stretch to the master list' })
  createStretch(@Body() dto: StretchDto, @Req() req: AReq) {
    return this.stretchesSvc.create(req.admin.id, { ...dto, max_age: dto.max_age ?? null, active: dto.active ?? true }, requestMeta(req));
  }

  @Patch('stretches/:id')
  @RequirePermissions('closures:write')
  @ApiOperation({ summary: 'Edit a stretch; active=false hides it and stops new bookings (sold bookings stand)' })
  updateStretch(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStretchDto, @Req() req: AReq) {
    return this.stretchesSvc.update(req.admin.id, id, dto, requestMeta(req));
  }

  // ── Season calendar ─────────────────────────────────────────────────────

  @Get('seasons')
  @RequirePermissions('closures:read')
  @ApiOperation({ summary: 'Planned off-season closures (scheduled, in force, and recent)' })
  seasons() {
    return this.closures.listSeasons();
  }

  @Post('seasons')
  @RequirePermissions('closures:write')
  @ApiOperation({ summary: 'Schedule an off-season closure (IST days, inclusive); bookings already sold inside it are refunded' })
  scheduleSeason(@Body() dto: SeasonDto, @Req() req: AReq) {
    return this.closures.scheduleSeason(actor(req), { stretchId: dto.stretch_id ?? null, startsOn: dto.starts_on, endsOn: dto.ends_on, reason: dto.reason });
  }

  @Post('seasons/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('closures:write')
  @ApiOperation({ summary: 'Cancel a scheduled season, or end one early' })
  cancelSeason(@Param('id', ParseUUIDPipe) id: string, @Body() dto: OpenDto, @Req() req: AReq) {
    return this.closures.cancelSeason(actor(req), id, dto.reason);
  }

  @Get('closures')
  @RequirePermissions('closures:read')
  closureHistory(@Query('stretch_id') stretchId?: string) {
    return this.closures.history(stretchId && /^[0-9a-f-]{36}$/i.test(stretchId) ? stretchId : undefined);
  }

  @Post('stretches/:id/close')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('closures:write')
  @ApiOperation({ summary: 'EMERGENCY: close a stretch — blocks bookings, cancels + refunds affected future bookings' })
  close(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseDto, @Req() req: AReq) {
    return this.closures.close(actor(req), id, dto.reason, dto.ends_at ? new Date(dto.ends_at) : undefined);
  }

  @Post('stretches/:id/open')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('closures:write')
  open(@Param('id', ParseUUIDPipe) id: string, @Body() dto: OpenDto, @Req() req: AReq) {
    return this.closures.open(actor(req), id, dto.reason);
  }

  @Post('river/close')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('closures:write')
  @ApiOperation({ summary: 'EMERGENCY: close the entire river (all stretches)' })
  closeRiver(@Body() dto: CloseDto, @Req() req: AReq) {
    return this.closures.close(actor(req), null, dto.reason, dto.ends_at ? new Date(dto.ends_at) : undefined);
  }

  @Post('river/open')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('closures:write')
  openRiver(@Body() dto: OpenDto, @Req() req: AReq) {
    return this.closures.open(actor(req), null, dto.reason);
  }

  @Post('closures/:id/process')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('closures:write')
  @ApiOperation({ summary: 'Re-run cancellation/refund processing for a closure (idempotent)' })
  reprocess(@Param('id', ParseUUIDPipe) id: string) {
    return this.closures.processClosure(id);
  }

  // ── Vendors & KYC ───────────────────────────────────────────────────────

  @Get('vendors')
  @RequirePermissions('vendors:read')
  listVendors(@Query() q: StatusQuery) {
    const s = q.status && ['DRAFT', 'UNDER_REVIEW', 'LIVE', 'SUSPENDED'].includes(q.status) ? q.status : undefined;
    return this.vendors.adminList(s);
  }

  @Get('vendors/:id')
  @RequirePermissions('vendors:read')
  getVendor(@Param('id', ParseUUIDPipe) id: string) {
    return this.vendors.adminGet(id);
  }

  @Get('vendors/:id/documents/:docId/url')
  @RequirePermissions('vendors:kyc_documents')
  @ApiOperation({ summary: '5-minute signed URL for a private KYC document (access is audited)' })
  documentUrl(@Param('id', ParseUUIDPipe) id: string, @Param('docId', ParseUUIDPipe) docId: string, @Req() req: AReq) {
    return this.vendors.documentUrl(id, docId, { type: 'ADMIN', id: req.admin.id, ...requestMeta(req) });
  }

  @Post('vendors/:id/documents/:docId/review')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('vendors:review')
  reviewDocument(@Param('id', ParseUUIDPipe) id: string, @Param('docId', ParseUUIDPipe) docId: string, @Body() dto: ReviewDocumentDto, @Req() req: AReq) {
    return this.vendors.reviewDocument(req.admin.id, id, docId, dto.decision, dto.reason, requestMeta(req));
  }

  @Post('vendors/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('vendors:review')
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: OptionalNotesDto, @Req() req: AReq) {
    return this.vendors.approve(req.admin.id, id, dto.notes, requestMeta(req));
  }

  @Post('vendors/:id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('vendors:review')
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @Req() req: AReq) {
    return this.vendors.reject(req.admin.id, id, dto.reason, requestMeta(req));
  }

  @Post('vendors/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('vendors:review')
  suspend(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @Req() req: AReq) {
    return this.vendors.suspend(req.admin.id, id, dto.reason, requestMeta(req));
  }

  @Post('vendors/:id/reinstate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('vendors:review')
  reinstate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @Req() req: AReq) {
    return this.vendors.reinstate(req.admin.id, id, dto.reason, requestMeta(req));
  }

  @Post('vendors/:id/commission')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('vendors:commission')
  commission(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetCommissionDto, @Req() req: AReq) {
    return this.vendors.setCommission(req.admin.id, id, dto.commission_bps, requestMeta(req));
  }

  @Post('vendors/:id/route/onboard')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('vendors:route')
  @ApiOperation({ summary: 'Create/continue the Razorpay Route linked account for an approved vendor' })
  onboardRoute(@Param('id', ParseUUIDPipe) id: string, @Req() req: AReq) {
    return this.vendors.onboardRouteAccount(req.admin.id, id, requestMeta(req));
  }

  @Post('vendors/:id/route/sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('vendors:route')
  syncRoute(@Param('id', ParseUUIDPipe) id: string) {
    return this.vendors.syncRouteStatus(id);
  }

  // ── Bookings ────────────────────────────────────────────────────────────

  @Get('bookings')
  @RequirePermissions('bookings:read')
  async findBooking(@Query() q: BookingSearchQuery) {
    const code = q.code?.toUpperCase().replace(/^RF/, '');
    if (!code && !q.id) {
      return this.prisma.booking.findMany({
        orderBy: { created_at: 'desc' },
        take: 50,
        select: { id: true, booking_code: true, status: true, amount_paise: true, seat_count: true, created_at: true, contact_name: true, slot: { select: { start_time: true, trip: { select: { title: true } } } } },
      });
    }
    const b = await this.prisma.booking.findFirst({
      where: q.id ? { id: q.id } : { booking_code: code },
      include: {
        guests: { orderBy: { position: 'asc' } },
        events: { orderBy: { created_at: 'asc' } },
        payments: true,
        refunds: true,
        transfer: true,
        slot: { include: { trip: { select: { title: true, vendor: { select: { id: true, display_name: true } }, stretch: { select: { name: true } } } } } },
      },
    });
    if (!b) throw new NotFoundException('Booking');
    const { idempotency_key, ...rest } = b;
    void idempotency_key;
    return [rest];
  }

  @Post('bookings/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('bookings:cancel')
  async cancelBooking(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminCancelDto, @Req() req: AReq) {
    const r = await this.bookings.cancelBooking({
      bookingId: id,
      kind: 'ADMIN',
      actorId: req.admin.id,
      reason: dto.reason,
      adminRefundPaise: dto.refund_paise !== undefined ? BigInt(dto.refund_paise) : undefined,
      ...requestMeta(req),
    });
    return { booking_id: r.booking.id, status: r.booking.status, refund: r.refund };
  }

  @Post('bookings/:id/dispute')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('bookings:cancel')
  @ApiOperation({ summary: 'Flag a paid booking as disputed; its vendor payout stays on hold until resolved' })
  dispute(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DisputeDto, @Req() req: AReq) {
    return this.bookings.flagDispute(req.admin.id, id, dto.reason, requestMeta(req));
  }

  @Post('bookings/:id/dispute/resolve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('bookings:cancel')
  @ApiOperation({ summary: 'Close a dispute with no refund; to refund instead, cancel the booking' })
  resolveDispute(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveDisputeDto, @Req() req: AReq) {
    return this.bookings.resolveDispute(req.admin.id, id, dto.note, requestMeta(req));
  }

  // ── Trips (A-10) ────────────────────────────────────────────────────────

  @Get('trips')
  @RequirePermissions('vendors:read')
  listTrips() {
    return this.trips.adminList();
  }

  @Post('trips/:id/hide')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('vendors:review')
  @ApiOperation({ summary: 'Take a trip off sale; existing bookings are unaffected and the vendor cannot republish it' })
  hideTrip(@Param('id', ParseUUIDPipe) id: string, @Body() dto: HideTripDto, @Req() req: AReq) {
    return this.trips.hideByAdmin(req.admin.id, id, dto.reason, requestMeta(req));
  }

  @Post('trips/:id/unhide')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('vendors:review')
  unhideTrip(@Param('id', ParseUUIDPipe) id: string, @Req() req: AReq) {
    return this.trips.unhideByAdmin(req.admin.id, id, requestMeta(req));
  }

  // ── Reports (A-11) ──────────────────────────────────────────────────────

  @Get('reports/summary')
  @RequirePermissions('finance:read')
  @ApiOperation({ summary: 'GMV, refunds, vendor payouts and commission earned (after refunds) by IST payment day or by vendor' })
  async reportSummary(@Query() q: ReportQuery) {
    const { from, to, rows } = await this.reportRows(q);
    const group_by = q.group_by ?? 'day';
    return { from, to, group_by, timezone: 'Asia/Kolkata', ...summarise(rows, group_by) };
  }

  @Get('reports/bookings.csv')
  @RequirePermissions('finance:read')
  @ApiOperation({ summary: 'One row per paid booking, amounts in rupees, for the accountant' })
  async reportCsv(@Query() q: ReportQuery, @Req() req: AReq, @Res({ passthrough: true }) res: Response) {
    const { from, to, rows } = await this.reportRows(q);
    await this.audit.log({
      actor_type: 'ADMIN', actor_id: req.admin.id, admin_id: req.admin.id, action: 'REPORT_EXPORTED', entity_type: 'Admin', entity_id: req.admin.id,
      data: { report: 'bookings.csv', from, to, rows: rows.length }, ...requestMeta(req),
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="raftnow-bookings-${from}-to-${to}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    return bookingsCsv(rows);
  }

  // ── Finance ─────────────────────────────────────────────────────────────

  @Get('finance/summary')
  @RequirePermissions('finance:read')
  @ApiOperation({ summary: 'Live money totals computed from the ledger tables (integer paise)' })
  async financeSummary() {
    const [captured, refunds, transfers, commission] = await Promise.all([
      this.prisma.payment.aggregate({ where: { status: 'CAPTURED' }, _sum: { amount_paise: true }, _count: { _all: true } }),
      this.prisma.refund.groupBy({ by: ['status'], _sum: { amount_paise: true }, _count: { _all: true } }),
      this.prisma.transfer.groupBy({ by: ['status'], _sum: { amount_paise: true }, _count: { _all: true } }),
      this.prisma.booking.aggregate({
        where: { status: { in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW'] } },
        _sum: { platform_commission_paise: true, amount_paise: true },
      }),
    ]);
    return {
      generated_at: new Date().toISOString(),
      captured_payments: { count: captured._count._all, amount_paise: captured._sum.amount_paise ?? 0n },
      active_bookings_value_paise: commission._sum.amount_paise ?? 0n,
      platform_commission_on_active_bookings_paise: commission._sum.platform_commission_paise ?? 0n,
      refunds_by_status: Object.fromEntries(refunds.map((r) => [r.status, { count: r._count._all, amount_paise: r._sum.amount_paise ?? 0n }])),
      vendor_transfers_by_status: Object.fromEntries(transfers.map((t) => [t.status, { count: t._count._all, amount_paise: t._sum.amount_paise ?? 0n }])),
    };
  }

  @Get('refunds')
  @RequirePermissions('finance:read')
  listRefunds(@Query() q: StatusQuery) {
    const s = q.status && ['PENDING', 'PROCESSING', 'PROCESSED', 'FAILED'].includes(q.status) ? (q.status as any) : undefined;
    return this.prisma.refund.findMany({
      where: s ? { status: s } : {},
      include: { booking: { select: { booking_code: true, contact_name: true } }, payment: { select: { razorpay_payment_id: true } } },
      orderBy: { created_at: 'desc' },
      take: 200,
    });
  }

  @Post('refunds/:id/retry')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('finance:write')
  async retryRefund(@Param('id', ParseUUIDPipe) id: string, @Req() req: AReq) {
    const ok = await this.refunds.retryFailed(id);
    if (!ok) throw new ConflictException('NOT_RETRYABLE', 'Only FAILED refunds that never reached Razorpay can be retried');
    await this.audit.log({ actor_type: 'ADMIN', actor_id: req.admin.id, admin_id: req.admin.id, action: 'REFUND_RETRY_REQUESTED', entity_type: 'Refund', entity_id: id, ...requestMeta(req) });
    return { requeued: true };
  }

  @Get('transfers')
  @RequirePermissions('finance:read')
  listTransfers(@Query() q: StatusQuery) {
    const s = q.status && ['ON_HOLD', 'PROCESSING', 'RELEASED', 'SETTLED', 'REVERSED', 'FAILED'].includes(q.status) ? (q.status as any) : undefined;
    return this.prisma.transfer.findMany({
      where: s ? { status: s } : {},
      include: { vendor: { select: { display_name: true } }, booking: { select: { booking_code: true, status: true } } },
      orderBy: { release_at: 'asc' },
      take: 200,
    });
  }

  @Post('transfers/:id/hold')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('finance:write')
  async hold(@Param('id', ParseUUIDPipe) id: string, @Body() dto: HoldDto, @Req() req: AReq) {
    if (!(await this.transfers.placeHold(id, dto.reason))) throw new ConflictException('NOT_ON_HOLD', 'Only ON_HOLD transfers can be held');
    await this.audit.log({ actor_type: 'ADMIN', actor_id: req.admin.id, admin_id: req.admin.id, action: 'TRANSFER_MANUAL_HOLD', entity_type: 'Transfer', entity_id: id, data: { reason: dto.reason }, ...requestMeta(req) });
    return { held: true };
  }

  @Post('transfers/:id/unhold')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('finance:write')
  async unhold(@Param('id', ParseUUIDPipe) id: string, @Req() req: AReq) {
    if (!(await this.transfers.liftHold(id))) throw new ConflictException('NOT_ON_HOLD', 'Only ON_HOLD transfers can be released from hold');
    await this.audit.log({ actor_type: 'ADMIN', actor_id: req.admin.id, admin_id: req.admin.id, action: 'TRANSFER_HOLD_LIFTED', entity_type: 'Transfer', entity_id: id, ...requestMeta(req) });
    return { held: false };
  }

  // ── Audit ───────────────────────────────────────────────────────────────

  @Get('audit-logs')
  @RequirePermissions('audit:read')
  auditLogs(@Query() q: AuditQuery) {
    return this.audit.search(q);
  }

  // ── Admin accounts ──────────────────────────────────────────────────────

  @Get('admins')
  @RequirePermissions('admins:manage')
  listAdmins() {
    return this.admins.list();
  }

  @Post('admins')
  @RequirePermissions('admins:manage')
  @ApiOperation({ summary: 'Create an admin. Returns a one-time temporary password; 2FA enrolment is forced at first login' })
  createAdmin(@Body() dto: CreateAdminDto, @Req() req: AReq) {
    return this.admins.create(req.admin.id, dto.email, dto.role, dto.name, requestMeta(req));
  }

  @Patch('admins/:id')
  @RequirePermissions('admins:manage')
  updateAdmin(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAdminDto, @Req() req: AReq) {
    return this.admins.update(req.admin.id, id, dto, requestMeta(req));
  }

  @Post('admins/:id/reset-2fa')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('admins:manage')
  resetTotp(@Param('id', ParseUUIDPipe) id: string, @Req() req: AReq) {
    return this.admins.resetTotp(req.admin.id, id, requestMeta(req));
  }
}
