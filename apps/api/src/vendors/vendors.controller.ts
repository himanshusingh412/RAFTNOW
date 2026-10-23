import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { FirebaseUserGuard, VendorAuthGuard, VendorRoles, VendorPrincipal, FirebasePrincipal } from '../auth/auth.guard';
import { VendorsService } from './vendors.service';
import { VendorOpsService } from './vendor-ops.service';
import { BookingsService } from '../bookings/bookings.service';
import { TripsService } from '../trips/trips.service';
import { StartOnboardingDto, UpdateOnboardingDto, UploadDocumentDto, ReasonDto } from './dto/onboarding.dto';
import { BlockSlotDto, CreateTripDto, SlotTemplateDto, UpdateSlotTemplateDto, UpdateTripDto, VendorBookingsQueryDto, VendorSlotsQueryDto } from '../trips/dto/trip.dto';
import { requestMeta } from '../common/http/request-meta';
import { MAX_DOCUMENT_BYTES, MAX_IMAGE_UPLOAD_BYTES } from '../storage/storage.service';
import { istDateOf } from '../common/time/ist';

class DateQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
}

class PhotoUploadDto {
  @IsOptional() @IsString() @Length(0, 140) caption?: string;
}
class PhotoOrderDto {
  @IsArray() @ArrayMaxSize(8) @IsUUID('all', { each: true }) photo_ids!: string[];
}

type VReq = { user: VendorPrincipal };

@ApiTags('Vendor')
@ApiBearerAuth()
@Controller('vendor')
export class VendorsController {
  constructor(
    private readonly vendors: VendorsService,
    private readonly ops: VendorOpsService,
    private readonly bookings: BookingsService,
    private readonly trips: TripsService,
  ) {}

  // ── Onboarding ──────────────────────────────────────────────────────────

  @Post('onboarding')
  @UseGuards(FirebaseUserGuard)
  @ApiOperation({ summary: 'Register a rafting company (caller becomes OWNER). Status: DRAFT' })
  start(@Body() dto: StartOnboardingDto, @Req() req: { firebaseUser: FirebasePrincipal }) {
    return this.vendors.startOnboarding(req.firebaseUser, dto, requestMeta(req));
  }

  @Get('me')
  @UseGuards(VendorAuthGuard)
  @ApiOperation({ summary: 'My company profile (sensitive fields masked)' })
  me(@Req() req: VReq) {
    return this.vendors.getMine(req.user);
  }

  @Patch('onboarding')
  @UseGuards(VendorAuthGuard)
  @VendorRoles('OWNER')
  @ApiOperation({ summary: 'Update business, licence, PAN, GSTIN and bank details' })
  update(@Body() dto: UpdateOnboardingDto, @Req() req: VReq) {
    return this.vendors.updateOnboarding(req.user, dto, requestMeta(req));
  }

  @Post('onboarding/submit')
  @UseGuards(VendorAuthGuard)
  @VendorRoles('OWNER')
  @ApiOperation({ summary: 'Submit for KYC review (DRAFT → UNDER_REVIEW)' })
  submit(@Req() req: VReq) {
    return this.vendors.submitForReview(req.user, requestMeta(req));
  }

  @Post('documents')
  @UseGuards(VendorAuthGuard)
  @VendorRoles('OWNER', 'MANAGER')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 } }))
  @ApiOperation({ summary: 'Upload a KYC document (PDF/JPEG/PNG ≤ 10 MB) to private storage' })
  upload(@Body() dto: UploadDocumentDto, @UploadedFile() file: Express.Multer.File, @Req() req: VReq) {
    return this.vendors.uploadDocument(req.user, dto.type, file, requestMeta(req));
  }

  @Get('documents')
  @UseGuards(VendorAuthGuard)
  documents(@Req() req: VReq) {
    return this.vendors.listDocuments(req.user.vendorId);
  }

  @Get('documents/:id/url')
  @UseGuards(VendorAuthGuard)
  @VendorRoles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Time-limited (5 min) download URL for one of my documents' })
  documentUrl(@Param('id', ParseUUIDPipe) id: string, @Req() req: VReq) {
    return this.vendors.documentUrl(req.user.vendorId, id, { type: 'VENDOR', id: req.user.id, ...requestMeta(req) });
  }

  // ── Operations ──────────────────────────────────────────────────────────

  @Get('dashboard')
  @UseGuards(VendorAuthGuard)
  dashboard(@Query() q: Partial<DateQueryDto>, @Req() req: VReq) {
    return this.ops.summary(req.user.vendorId, q.date ?? istDateOf(new Date()));
  }

  @Get('bookings')
  @UseGuards(VendorAuthGuard)
  @ApiOperation({ summary: 'Bookings / passenger manifest (filter by IST date, slot, status)' })
  listBookings(@Query() q: VendorBookingsQueryDto, @Req() req: VReq) {
    return this.ops.bookings(req.user.vendorId, q);
  }

  @Post('bookings/:id/cancel')
  @UseGuards(VendorAuthGuard)
  @VendorRoles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Cancel a booking as the operator (100% customer refund)' })
  async cancelBooking(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @Req() req: VReq) {
    const r = await this.bookings.cancelBooking({
      bookingId: id,
      kind: 'VENDOR',
      vendorId: req.user.vendorId,
      actorId: req.user.id,
      reason: dto.reason,
      ...requestMeta(req),
    });
    return { booking_id: r.booking.id, status: r.booking.status, refund_paise: r.refund?.amount_paise ?? 0n };
  }

  @Post('bookings/:id/no-show')
  @UseGuards(VendorAuthGuard)
  @VendorRoles('OWNER', 'MANAGER')
  async noShow(@Param('id', ParseUUIDPipe) id: string, @Req() req: VReq) {
    const b = await this.bookings.markNoShow({ id: req.user.id, vendorId: req.user.vendorId }, id);
    return { booking_id: b.id, status: b.status };
  }

  @Get('payouts')
  @UseGuards(VendorAuthGuard)
  @VendorRoles('OWNER', 'MANAGER')
  payouts(@Req() req: VReq) {
    return this.ops.payouts(req.user.vendorId);
  }

  @Get('notifications')
  @UseGuards(VendorAuthGuard)
  notifications(@Req() req: VReq) {
    return this.ops.notifications(req.user.vendorId);
  }

  // ── Trips & departures ──────────────────────────────────────────────────

  @Get('trips')
  @UseGuards(VendorAuthGuard)
  listTrips(@Req() req: VReq) {
    return this.trips.list(req.user.vendorId);
  }

  @Post('trips')
  @UseGuards(VendorAuthGuard)
  @VendorRoles('OWNER', 'MANAGER')
  createTrip(@Body() dto: CreateTripDto, @Req() req: VReq) {
    return this.trips.create(req.user, dto);
  }

  @Patch('trips/:id')
  @UseGuards(VendorAuthGuard)
  @VendorRoles('OWNER', 'MANAGER')
  updateTrip(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTripDto, @Req() req: VReq) {
    return this.trips.update(req.user, id, dto);
  }

  @Post('trips/:id/photos')
  @UseGuards(VendorAuthGuard)
  @VendorRoles('OWNER', 'MANAGER')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_IMAGE_UPLOAD_BYTES, files: 1 } }))
  @ApiOperation({ summary: 'Add a trip photo (JPEG/PNG/WebP ≤ 15 MB, ≥ 400 px); stored as a ≤1600 px JPEG without EXIF. Max 8.' })
  addPhoto(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PhotoUploadDto, @UploadedFile() file: Express.Multer.File, @Req() req: VReq) {
    return this.trips.addPhoto(req.user, id, file, dto.caption);
  }

  @Delete('trips/:id/photos/:photoId')
  @UseGuards(VendorAuthGuard)
  @VendorRoles('OWNER', 'MANAGER')
  deletePhoto(@Param('id', ParseUUIDPipe) id: string, @Param('photoId', ParseUUIDPipe) photoId: string, @Req() req: VReq) {
    return this.trips.deletePhoto(req.user, id, photoId);
  }

  @Put('trips/:id/photos/order')
  @UseGuards(VendorAuthGuard)
  @VendorRoles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Reorder the gallery; the first photo is the cover' })
  reorderPhotos(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PhotoOrderDto, @Req() req: VReq) {
    return this.trips.reorderPhotos(req.user, id, dto.photo_ids);
  }

  @Post('trips/:id/departures')
  @UseGuards(VendorAuthGuard)
  @VendorRoles('OWNER', 'MANAGER')
  addDeparture(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SlotTemplateDto, @Req() req: VReq) {
    return this.trips.addTemplate(req.user, id, dto);
  }

  @Patch('departures/:id')
  @UseGuards(VendorAuthGuard)
  @VendorRoles('OWNER', 'MANAGER')
  updateDeparture(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSlotTemplateDto, @Req() req: VReq) {
    return this.trips.updateTemplate(req.user, id, dto);
  }

  @Get('slots')
  @UseGuards(VendorAuthGuard)
  @ApiOperation({ summary: 'My departures on an IST date with live capacity' })
  slots(@Query() q: VendorSlotsQueryDto, @Req() req: VReq) {
    return this.trips.listSlots(req.user.vendorId, q.date, q.trip_id);
  }

  @Post('slots/:id/block')
  @UseGuards(VendorAuthGuard)
  @VendorRoles('OWNER', 'MANAGER')
  block(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BlockSlotDto, @Req() req: VReq) {
    return this.trips.setSlotBlocked(req.user, id, true, dto.reason);
  }

  @Post('slots/:id/unblock')
  @UseGuards(VendorAuthGuard)
  @VendorRoles('OWNER', 'MANAGER')
  unblock(@Param('id', ParseUUIDPipe) id: string, @Req() req: VReq) {
    return this.trips.setSlotBlocked(req.user, id, false);
  }
}
