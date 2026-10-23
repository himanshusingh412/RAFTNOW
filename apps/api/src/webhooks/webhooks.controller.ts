import { Controller, Post, Headers, Body, HttpCode, HttpStatus, Logger, RawBodyRequest, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { WebhooksService } from './webhooks.service';
import { UnauthorizedException } from '../common/exceptions/api.exception';

@ApiExcludeController() // internal endpoint — not in Swagger
@SkipThrottle()
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooks: WebhooksService) {}

  /**
   * POST /api/v1/webhooks/razorpay
   * 1. verify signature over the raw body  2. persist the event (idempotent)
   * 3. answer 200 fast  4. process asynchronously (durable job retries failures)
   */
  @Post('razorpay')
  @HttpCode(HttpStatus.OK)
  async handleRazorpay(
    @Req() req: RawBodyRequest<any>,
    @Headers('x-razorpay-signature') signature: string | undefined,
    @Headers('x-razorpay-event-id') eventIdHeader: string | undefined,
    @Body() payload: Record<string, unknown>,
  ) {
    const rawBody = req.rawBody;
    if (!rawBody || !signature) {
      this.logger.warn('Webhook rejected: missing raw body or signature');
      throw new UnauthorizedException('Missing signature');
    }
    if (!this.webhooks.verifyWebhookSignature(rawBody, signature)) {
      this.logger.warn('Webhook rejected: invalid signature');
      throw new UnauthorizedException('Invalid signature');
    }

    const eventType = String(payload?.event ?? 'unknown');
    const eventId = WebhooksService.eventIdFor(eventIdHeader, payload, rawBody);
    const stored = await this.webhooks.recordEvent(eventId, eventType, payload);
    this.logger.log(`Razorpay webhook ${eventType} (${eventId})${stored.duplicate ? ' [duplicate]' : ''}`);

    if (!stored.processed) {
      setImmediate(() => {
        this.webhooks.processStoredEvent(stored.id).catch((err) =>
          this.logger.error(`Async webhook processing error for ${eventId}: ${(err as Error).message}`),
        );
      });
    }
    return { received: true, duplicate: stored.duplicate };
  }
}
