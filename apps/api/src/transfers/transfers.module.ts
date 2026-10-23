import { Module } from '@nestjs/common';
import { TransfersService } from './transfers.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  providers: [TransfersService],
  exports: [TransfersService],
})
export class TransfersModule {}
