import { Controller, Post, Get, Body, Param, UseGuards, ParseUUIDPipe, HttpCode, HttpStatus, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsUUID, Matches } from 'class-validator';
import { PaymentsService } from './payments.service';
import { CustomerAuthGuard, CustomerPrincipal } from '../auth/auth.guard';

class CreateOrderDto {
  @IsUUID()
  booking_id!: string;
}

class VerifyPaymentDto {
  @IsUUID()
  booking_id!: string;

  @Matches(/^order_[A-Za-z0-9]+$/)
  razorpay_order_id!: string;

  @Matches(/^pay_[A-Za-z0-9]+$/)
  razorpay_payment_id!: string;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  razorpay_signature!: string;
}

@ApiTags('Payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('order')
  @UseGuards(CustomerAuthGuard)
  @ApiOperation({ summary: 'Create (or reuse) the Razorpay order for a booking hold' })
  createOrder(@Body() dto: CreateOrderDto, @Req() req: { user: CustomerPrincipal }) {
    return this.payments.createOrderForBooking(dto.booking_id, req.user.id);
  }

  @Post('verify')
  @UseGuards(CustomerAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Checkout callback: verify signature and confirm from Razorpay server-side' })
  verify(@Body() dto: VerifyPaymentDto, @Req() req: { user: CustomerPrincipal }) {
    return this.payments.verifyCheckout(req.user.id, dto);
  }

  @Get('bookings/:bookingId/qr')
  @UseGuards(CustomerAuthGuard)
  @ApiOperation({ summary: 'Signed QR ticket for a confirmed booking' })
  getQr(@Param('bookingId', ParseUUIDPipe) bookingId: string, @Req() req: { user: CustomerPrincipal }) {
    return this.payments.getBookingQr(bookingId, req.user.id);
  }
}
