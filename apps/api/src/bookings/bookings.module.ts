import { Module } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RefundsModule } from '../refunds/refunds.module';
import { TransfersModule } from '../transfers/transfers.module';

@Module({
  imports: [AuditModule, NotificationsModule, RefundsModule, TransfersModule],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
