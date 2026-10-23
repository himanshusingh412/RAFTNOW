import { Module } from '@nestjs/common';
import { StretchesController } from './stretches.controller';
import { StretchesService } from './stretches.service';
import { ClosuresService } from './closures.service';
import { BookingsModule } from '../bookings/bookings.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [BookingsModule, AuditModule],
  controllers: [StretchesController],
  providers: [StretchesService, ClosuresService],
  exports: [StretchesService, ClosuresService],
})
export class StretchesModule {}
