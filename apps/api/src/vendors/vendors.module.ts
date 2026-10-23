import { Module } from '@nestjs/common';
import { VendorsController } from './vendors.controller';
import { VendorsService } from './vendors.service';
import { VendorOpsService } from './vendor-ops.service';
import { BookingsModule } from '../bookings/bookings.module';
import { TripsModule } from '../trips/trips.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [BookingsModule, TripsModule, AuditModule, NotificationsModule],
  controllers: [VendorsController],
  providers: [VendorsService, VendorOpsService],
  exports: [VendorsService, VendorOpsService],
})
export class VendorsModule {}
