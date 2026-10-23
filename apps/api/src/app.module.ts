import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { PrismaModule } from './common/prisma/prisma.module';
import { RazorpayModule } from './common/razorpay/razorpay.gateway';
import { QrModule } from './common/qr/qr.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { VendorsModule } from './vendors/vendors.module';
import { StretchesModule } from './stretches/stretches.module';
import { TripsModule } from './trips/trips.module';
import { SlotsModule } from './slots/slots.module';
import { BookingsModule } from './bookings/bookings.module';
import { PaymentsModule } from './payments/payments.module';
import { TransfersModule } from './transfers/transfers.module';
import { RefundsModule } from './refunds/refunds.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AdminModule } from './admin/admin.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { JobsModule } from './jobs/jobs.module';
import { AuditModule } from './audit/audit.module';
import { HealthModule } from './health/health.module';
import { StorageModule } from './storage/storage.module';
import { RootController } from './root.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'] }),

    // Rate limiting — applied globally by ThrottlerGuard below; tighter limits
    // are set per-route on auth and booking endpoints. Webhooks skip it.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: parseInt(process.env.RATE_LIMIT_PER_MINUTE ?? '120', 10) }]),

    // Infrastructure
    PrismaModule,
    RazorpayModule,
    QrModule,
    StorageModule,
    AuditModule,
    NotificationsModule,
    HealthModule,
    AuthModule,

    // Domain
    UsersModule,
    VendorsModule,
    StretchesModule,
    TripsModule,
    SlotsModule,
    BookingsModule,
    PaymentsModule,
    TransfersModule,
    RefundsModule,
    AdminModule,
    WebhooksModule,

    // Durable background jobs (pg-boss)
    JobsModule,
  ],
  controllers: [RootController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
