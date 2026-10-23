import { Global, Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JobsRunner } from './jobs.runner';
import { BookingsModule } from '../bookings/bookings.module';
import { TransfersModule } from '../transfers/transfers.module';
import { RefundsModule } from '../refunds/refunds.module';
import { SlotsModule } from '../slots/slots.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { PaymentsModule } from '../payments/payments.module';
import { StretchesModule } from '../stretches/stretches.module';
import { VendorsModule } from '../vendors/vendors.module';

@Global()
@Module({
  imports: [BookingsModule, TransfersModule, RefundsModule, SlotsModule, NotificationsModule, WebhooksModule, PaymentsModule, StretchesModule, VendorsModule],
  providers: [JobsService, JobsRunner],
  exports: [JobsService, JobsRunner],
})
export class JobsModule {}
