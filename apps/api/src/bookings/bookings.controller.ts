import { Controller, Post, Get, Delete, Body, Param, UseGuards, ParseUUIDPipe, HttpCode, HttpStatus, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { CustomerAuthGuard, VendorAuthGuard, CustomerPrincipal, VendorPrincipal } from '../auth/auth.guard';
import { requestMeta } from '../common/http/request-meta';
import { ApiException } from '../common/exceptions/api.exception';

class CheckInDto {
  /** The signed token encoded in the customer's QR ticket. */
  @IsOptional()
  @IsString()
  @Length(20, 2048)
  qr_token?: string;

  /** Fallback when the customer can't show the QR: the code on the ticket, e.g. RF7K2M9P. */
  @IsOptional()
  @IsString()
  @Length(6, 12)
  booking_code?: string;
}

@ApiTags('Bookings')
@ApiBearerAuth()
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  /** Creates a booking hold (PENDING_PAYMENT). Payment must follow before hold_expires_at. */
  @Post()
  @UseGuards(CustomerAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a booking hold (PENDING_PAYMENT)' })
  async create(@Body() dto: CreateBookingDto, @Req() req: { user: CustomerPrincipal }) {
    const booking = await this.bookings.createBooking({ id: req.user.id, phone: req.user.phone }, dto);
    return this.bookings.getCustomerBooking(booking.id, req.user.id);
  }

  /**
   * Vendor staff scan a customer's QR ticket, or type its booking code when the
   * QR can't be shown. Send exactly one of qr_token / booking_code. The QR
   * signature is verified server-side; the booking must belong to the scanning
   * vendor, be CONFIRMED and be within the check-in window. Duplicate scans
   * return 409 ALREADY_CHECKED_IN.
   */
  @Post('check-in')
  @UseGuards(VendorAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Check in a passenger by QR ticket or booking code (vendor staff)' })
  checkIn(@Body() dto: CheckInDto, @Req() req: { user: VendorPrincipal }) {
    if (!dto.qr_token === !dto.booking_code) {
      throw new ApiException('INVALID_CHECK_IN_REQUEST', 'Send either qr_token or booking_code', HttpStatus.BAD_REQUEST);
    }
    const ticket = dto.qr_token ? { qrToken: dto.qr_token } : { bookingCode: dto.booking_code! };
    return this.bookings.checkIn({ id: req.user.id, vendorId: req.user.vendorId }, ticket, requestMeta(req));
  }

  @Get()
  @UseGuards(CustomerAuthGuard)
  @ApiOperation({ summary: 'List my bookings' })
  findAll(@Req() req: { user: CustomerPrincipal }) {
    return this.bookings.listCustomerBookings(req.user.id);
  }

  @Get(':id')
  @UseGuards(CustomerAuthGuard)
  @ApiOperation({ summary: 'Get one of my bookings' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: CustomerPrincipal }) {
    return this.bookings.getCustomerBooking(id, req.user.id);
  }

  /** Customer-initiated cancellation with policy-based refund. */
  @Delete(':id')
  @UseGuards(CustomerAuthGuard)
  @ApiOperation({ summary: 'Cancel a booking (customer)' })
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: CustomerPrincipal }) {
    const r = await this.bookings.cancelBookingByCustomer(id, req.user.id);
    return { booking_id: r.booking.id, status: r.booking.status, refund_paise: r.refund_paise };
  }
}
