import { Module } from '@nestjs/common';
import { AdminAuthController } from './auth/admin-auth.controller';
import { AdminAuthService } from './auth/admin-auth.service';
import { AdminAuthGuard } from './auth/admin-auth.guard';
import { AdminOpsController } from './admin-ops.controller';
import { StretchesModule } from '../stretches/stretches.module';
import { VendorsModule } from '../vendors/vendors.module';
import { BookingsModule } from '../bookings/bookings.module';
import { RefundsModule } from '../refunds/refunds.module';
import { TransfersModule } from '../transfers/transfers.module';
import { AuditModule } from '../audit/audit.module';
import { TripsModule } from '../trips/trips.module';

@Module({
  imports: [StretchesModule, VendorsModule, BookingsModule, RefundsModule, TransfersModule, AuditModule, TripsModule],
  controllers: [AdminAuthController, AdminOpsController],
  providers: [AdminAuthService, AdminAuthGuard],
  exports: [AdminAuthService],
})
export class AdminModule {}
