import { Global, Injectable, Logger, Module } from '@nestjs/common';
import Razorpay from 'razorpay';

/**
 * Error from a Razorpay call, classified for money-movement safety:
 *  - notCreated=true  → Razorpay answered with a 4xx: the operation was NOT
 *                       performed and may be retried / marked failed.
 *  - notCreated=false → network error, timeout or 5xx: the outcome is UNKNOWN.
 *                       Callers must reconcile with Razorpay before retrying,
 *                       otherwise money could move twice.
 */
export class GatewayError extends Error {
  constructor(
    message: string,
    readonly notCreated: boolean,
    readonly statusCode?: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export class GatewayNotConfiguredError extends GatewayError {
  constructor() {
    super('Razorpay credentials are not configured', true, undefined, 'GATEWAY_NOT_CONFIGURED');
  }
}

function classify(err: any): GatewayError {
  const statusCode: number | undefined = err?.statusCode ?? err?.status;
  const code: string | undefined = err?.error?.code;
  const description: string = err?.error?.description ?? err?.message ?? 'Razorpay request failed';
  const notCreated = typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500;
  return new GatewayError(description, notCreated, statusCode, code);
}

@Injectable()
export class RazorpayGateway {
  private readonly logger = new Logger(RazorpayGateway.name);
  private client: Razorpay | null = null;

  isConfigured(): boolean {
    const id = process.env.RAZORPAY_KEY_ID;
    const secret = process.env.RAZORPAY_KEY_SECRET;
    return !!id && !!secret && !/^rzp_(test|live)_x+$/i.test(id) && !/^your_|change-me/i.test(secret);
  }

  get keyId(): string | undefined {
    return process.env.RAZORPAY_KEY_ID;
  }

  private rzp(): Razorpay {
    if (!this.isConfigured()) throw new GatewayNotConfiguredError();
    if (!this.client) {
      this.client = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID as string,
        key_secret: process.env.RAZORPAY_KEY_SECRET as string,
      });
    }
    return this.client;
  }

  private async call<T>(op: string, fn: (r: any) => Promise<T>): Promise<T> {
    const r = this.rzp();
    try {
      return await fn(r);
    } catch (err) {
      const g = err instanceof GatewayError ? err : classify(err);
      // Never log request payloads (may contain bank details); status + code only.
      this.logger.warn(`Razorpay ${op} failed: status=${g.statusCode ?? 'n/a'} code=${g.code ?? 'n/a'} notCreated=${g.notCreated}`);
      throw g;
    }
  }

  // ── Orders & payments ────────────────────────────────────────────────────
  createOrder(params: { amount: number; currency: 'INR'; receipt: string; notes: Record<string, string> }) {
    return this.call('orders.create', (r) => r.orders.create(params));
  }
  fetchPayment(paymentId: string) {
    return this.call('payments.fetch', (r) => r.payments.fetch(paymentId));
  }
  fetchOrderPayments(orderId: string) {
    return this.call('orders.fetchPayments', (r) => r.orders.fetchPayments(orderId));
  }

  // ── Refunds ──────────────────────────────────────────────────────────────
  refundPayment(paymentId: string, params: { amount: number; speed: 'normal' | 'optimum'; receipt?: string; notes: Record<string, string> }) {
    return this.call('payments.refund', (r) => r.payments.refund(paymentId, params));
  }
  listPaymentRefunds(paymentId: string) {
    return this.call('payments.fetchMultipleRefund', (r) => r.payments.fetchMultipleRefund(paymentId, { count: 100 }));
  }
  fetchRefund(refundId: string) {
    return this.call('refunds.fetch', (r) => r.refunds.fetch(refundId));
  }

  // ── Route transfers ──────────────────────────────────────────────────────
  createTransfer(params: { account: string; amount: number; currency: 'INR'; notes: Record<string, string> }) {
    return this.call('transfers.create', (r) => r.transfers.create(params));
  }
  listTransfers(params: { from: number; to?: number; count?: number; skip?: number }) {
    return this.call('transfers.all', (r) => r.transfers.all(params));
  }
  fetchTransfer(transferId: string) {
    return this.call('transfers.fetch', (r) => r.transfers.fetch(transferId));
  }
  reverseTransfer(transferId: string, params: { amount: number; notes?: Record<string, string> }) {
    return this.call('transfers.reverse', (r) => r.transfers.reverse(transferId, params));
  }

  // ── Route linked accounts (v2 accounts API) ──────────────────────────────
  createLinkedAccount(params: Record<string, unknown>) {
    return this.call('accounts.create', (r) => r.accounts.create(params));
  }
  fetchLinkedAccount(accountId: string) {
    return this.call('accounts.fetch', (r) => r.accounts.fetch(accountId));
  }
  createStakeholder(accountId: string, params: Record<string, unknown>) {
    return this.call('stakeholders.create', (r) => r.stakeholders.create(accountId, params));
  }
  requestRouteProduct(accountId: string) {
    return this.call('products.requestProductConfiguration', (r) =>
      r.products.requestProductConfiguration(accountId, { product_name: 'route', tnc_accepted: true }),
    );
  }
  updateRouteProduct(accountId: string, productId: string, params: Record<string, unknown>) {
    return this.call('products.edit', (r) => r.products.edit(accountId, productId, params));
  }
  fetchRouteProduct(accountId: string, productId: string) {
    return this.call('products.fetch', (r) => r.products.fetch(accountId, productId));
  }
}

@Global()
@Module({
  providers: [RazorpayGateway],
  exports: [RazorpayGateway],
})
export class RazorpayModule {}
