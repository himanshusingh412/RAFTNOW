import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../common/prisma/prisma.service';
import { RazorpayGateway } from '../common/razorpay/razorpay.gateway';
import { FirebaseAuthService } from '../auth/firebase-auth.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import { QrService } from '../common/qr/qr.service';
import { JobsRunner } from '../jobs/jobs.runner';

@ApiTags('Health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: RazorpayGateway,
    private readonly firebase: FirebaseAuthService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    private readonly qr: QrService,
    private readonly jobs: JobsRunner,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Liveness + dependency/configuration status (no secrets)' })
  async check() {
    let database = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'error';
    }
    return {
      status: database === 'ok' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      version: process.env.APP_VERSION ?? '0.0.1',
      environment: process.env.APP_ENV ?? 'development',
      services: { database },
      // "configured" only means credentials are present — not that the provider was exercised.
      integrations: {
        razorpay: this.gateway.isConfigured() ? 'configured' : 'not_configured',
        firebase_auth: this.firebase.isConfigured ? 'configured' : this.firebase.devBypassEnabled ? 'dev_bypass_only' : 'not_configured',
        qr_signing: this.qr.isConfigured() ? 'configured' : 'not_configured',
        document_storage: this.storage.driver,
        notifications: this.notifications.providerStatus(),
      },
      jobs: this.jobs.status(),
    };
  }
}
