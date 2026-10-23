import { Module } from '@nestjs/common';
import { RefundsService } from './refunds.service';
import { TransfersModule } from '../transfers/transfers.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TransfersModule, AuditModule],
  providers: [RefundsService],
  exports: [RefundsService],
})
export class RefundsModule {}
