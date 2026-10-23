import { Module } from '@nestjs/common';
import { TripsService } from './trips.service';
import { TripsController } from './trips.controller';
import { SlotsModule } from '../slots/slots.module';
import { AuditModule } from '../audit/audit.module';

/** Trips: public detail at /trips/:id; vendor management routes live under /vendor/* (VendorsController). */
@Module({
  imports: [SlotsModule, AuditModule],
  controllers: [TripsController],
  providers: [TripsService],
  exports: [TripsService],
})
export class TripsModule {}
