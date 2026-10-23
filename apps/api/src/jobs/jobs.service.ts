import { Injectable, Logger } from '@nestjs/common';
import { BookingsService } from '../bookings/bookings.service';
import { TransfersService } from '../transfers/transfers.service';
import { RefundsService } from '../refunds/refunds.service';
import { SlotsService } from '../slots/slots.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { PaymentsService } from '../payments/payments.service';
import { ClosuresService } from '../stretches/closures.service';
import { VendorsService } from '../vendors/vendors.service';

export interface JobDefinition {
  name: string;
  /** 5-field cron, UTC. */
  cron: string;
  run: () => Promise<unknown>;
}

/**
 * Background job bodies. Every job is idempotent and retry-safe: state
 * transitions use conditional updates / row locks, and every money movement is
 * claimed in the database before Razorpay is called, so a job that runs twice
 * (retry, overlapping workers, crash mid-run) cannot move money twice.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly bookings: BookingsService,
    private readonly transfers: TransfersService,
    private readonly refunds: RefundsService,
    private readonly slots: SlotsService,
    private readonly notifications: NotificationsService,
    private readonly webhooks: WebhooksService,
    private readonly payments: PaymentsService,
    private readonly closures: ClosuresService,
    private readonly vendors: VendorsService,
  ) {}

  definitions(): JobDefinition[] {
    return [
      { name: 'holds.expire', cron: '* * * * *', run: () => this.bookings.expireStaleHolds() },
      { name: 'slots.generate', cron: '*/15 * * * *', run: () => this.slots.generateFromTemplates() },
      { name: 'notifications.dispatch', cron: '* * * * *', run: () => this.notifications.dispatchDue() },
      { name: 'webhooks.retry', cron: '*/2 * * * *', run: () => this.webhooks.retryUnprocessed() },
      { name: 'payments.reconcile', cron: '*/10 * * * *', run: () => this.payments.reconcileOpenOrders() },
      { name: 'refunds.process', cron: '*/2 * * * *', run: () => this.refunds.processPendingRefunds() },
      { name: 'refunds.reconcile', cron: '*/15 * * * *', run: () => this.refunds.reconcileRefunds() },
      { name: 'transfers.release', cron: '*/5 * * * *', run: () => this.transfers.releaseDueTransfers() },
      {
        name: 'transfers.reconcile',
        cron: '*/15 * * * *',
        run: async () => ({
          reconcile: await this.transfers.reconcileProcessingTransfers(),
          reversals: await this.transfers.executePendingReversals(),
        }),
      },
      { name: 'bookings.complete', cron: '*/10 * * * *', run: () => this.bookings.completeFinishedBookings() },
      { name: 'closures.process', cron: '*/5 * * * *', run: () => this.closures.processUnfinishedClosures() },
      // 00:30 UTC = 06:00 IST
      { name: 'vendors.licence-expiry', cron: '30 0 * * *', run: () => this.vendors.handleLicenceExpiry() },
    ];
  }

  async runByName(name: string) {
    const def = this.definitions().find((d) => d.name === name);
    if (!def) throw new Error(`Unknown job ${name}`);
    const started = Date.now();
    const result = await def.run();
    this.logger.debug(`Job ${name} finished in ${Date.now() - started}ms: ${JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
    return result;
  }
}
