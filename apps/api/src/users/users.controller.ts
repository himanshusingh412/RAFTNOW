import { Body, Controller, Delete, Get, HttpStatus, Param, ParseUUIDPipe, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Length } from 'class-validator';
import { calculateRefundPaise, getCancellationTrigger } from '@raftnow/shared';
import { CustomerAuthGuard, CustomerPrincipal } from '../auth/auth.guard';
import { PrismaService } from '../common/prisma/prisma.service';
import { ApiException, NotFoundException } from '../common/exceptions/api.exception';

class UpdateMeDto {
  @IsOptional() @IsString() @Length(2, 120) full_name?: string;
  @IsOptional() @IsEmail() email?: string;
  /** FCM registration token for push notifications. */
  @IsOptional() @IsString() @Length(20, 4096) push_token?: string;
}

/** Statuses a customer may cancel; must match CANCELLABLE.CUSTOMER in BookingsService. */
const CUSTOMER_CANCELLABLE = ['PENDING_PAYMENT', 'CONFIRMED'];

@ApiTags('Customer profile')
@ApiBearerAuth()
@Controller('me')
@UseGuards(CustomerAuthGuard)
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  private view(u: { id: string; phone: string; full_name: string | null; email: string | null; push_token: string | null; created_at: Date }) {
    return { id: u.id, phone: u.phone, full_name: u.full_name, email: u.email, push_enabled: !!u.push_token, created_at: u.created_at };
  }

  @Get()
  @ApiOperation({ summary: 'My customer profile (created on first sign-in)' })
  async me(@Req() req: { user: CustomerPrincipal }) {
    return this.view(await this.prisma.user.findUniqueOrThrow({ where: { id: req.user.id } }));
  }

  @Patch()
  async update(@Body() dto: UpdateMeDto, @Req() req: { user: CustomerPrincipal }) {
    const u = await this.prisma.user.update({
      where: { id: req.user.id },
      data: { ...dto, email: dto.email?.toLowerCase() },
    });
    return this.view(u);
  }

  /**
   * Refund the customer would get if they cancelled right now (PRD 8.4). This is
   * a preview only: DELETE /bookings/:id recalculates under the booking lock, so
   * the amount can change if the customer crosses a policy boundary meanwhile.
   */
  @Get('bookings/:id/cancel-quote')
  @ApiOperation({ summary: 'Refund preview if I cancel this booking now' })
  async cancelQuote(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: CustomerPrincipal }) {
    const b = await this.prisma.booking.findFirst({
      where: { id, user_id: req.user.id },
      select: { id: true, status: true, amount_paise: true, slot: { select: { start_time: true } } },
    });
    if (!b) throw new NotFoundException('Booking');
    const now = new Date();
    const hours = (b.slot.start_time.getTime() - now.getTime()) / 3_600_000;
    const base = { booking_id: b.id, amount_paise: b.amount_paise, quoted_at: now.toISOString(), departure: b.slot.start_time.toISOString() };
    if (!CUSTOMER_CANCELLABLE.includes(b.status)) {
      return { ...base, cancellable: false, reason: `Booking is ${b.status}`, refund_paise: 0n, refund_percent: 0, trigger: null };
    }
    if (hours <= 0) {
      return { ...base, cancellable: false, reason: 'This trip has already departed', refund_paise: 0n, refund_percent: 0, trigger: null };
    }
    if (b.status === 'PENDING_PAYMENT') {
      // Nothing was paid: cancelling just releases the held seats.
      return { ...base, cancellable: true, reason: null, refund_paise: 0n, refund_percent: 0, trigger: null, unpaid: true };
    }
    const trigger = getCancellationTrigger(hours);
    const { refundPaise, refundBps } = calculateRefundPaise(b.amount_paise, trigger, hours);
    return { ...base, cancellable: true, reason: null, refund_paise: refundPaise, refund_percent: Number(refundBps) / 100, trigger };
  }

  /**
   * Account deletion (DPDP Act; required by the App Store and Google Play).
   * Personal details are erased and the phone / Firebase identity are released
   * so the number can sign up again later. Bookings are kept for legal and tax
   * records (they hold their own contact snapshot). Refused while the customer
   * has an upcoming paid or held booking, which must be cancelled first.
   */
  @Delete()
  @ApiOperation({ summary: 'Delete my account' })
  async remove(@Req() req: { user: CustomerPrincipal }) {
    const active = await this.prisma.booking.count({
      where: { user_id: req.user.id, status: { in: ['PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'DISPUTED'] } },
    });
    if (active > 0) {
      throw new ApiException(
        'ACTIVE_BOOKINGS',
        `You have ${active} upcoming booking${active === 1 ? '' : 's'}. Cancel ${active === 1 ? 'it' : 'them'} before deleting your account.`,
        HttpStatus.CONFLICT,
      );
    }
    const now = new Date();
    await this.prisma.user.update({
      where: { id: req.user.id },
      data: {
        full_name: null,
        email: null,
        avatar_key: null,
        push_token: null,
        phone: `deleted:${req.user.id}`,
        firebase_uid: `deleted:${req.user.id}`,
        deleted_at: now,
      },
    });
    return { deleted: true, deleted_at: now.toISOString() };
  }
}
