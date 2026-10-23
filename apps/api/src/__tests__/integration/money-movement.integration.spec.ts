/**
 * Money-movement safety against real PostgreSQL with a scripted fake Razorpay
 * gateway: refunds and payouts must never be issued twice, whatever the
 * gateway does (success, 4xx, timeout) and however often the jobs run.
 */
import { createHarness, createFixture, createUsers, bookingDto, Harness } from './harness';
import { GatewayError, RazorpayGateway } from '../../common/razorpay/razorpay.gateway';
import { TransfersService } from '../../transfers/transfers.service';
import { RefundsService } from '../../refunds/refunds.service';
import { WebhooksService } from '../../webhooks/webhooks.service';

jest.setTimeout(120_000);

const RUN = Math.random().toString(36).slice(2, 8);
let seq = 0;

class FakeGateway extends RazorpayGateway {
  refundCalls: any[] = [];
  transferCalls: any[] = [];
  refundBehaviour: 'ok' | 'timeout' | '4xx' = 'ok';
  transferBehaviour: 'ok' | 'timeout' | '4xx' = 'ok';
  gatewayRefunds: any[] = [];
  gatewayTransfers: any[] = [];
  isConfigured() { return true; }
  async refundPayment(paymentId: string, params: any) {
    this.refundCalls.push({ paymentId, params });
    if (this.refundBehaviour === '4xx') throw new GatewayError('bad request', true, 400, 'BAD_REQUEST_ERROR');
    const r = { id: `rfnd_${RUN}_${++seq}`, status: 'pending', notes: params.notes, created_at: Math.floor(Date.now() / 1000) };
    this.gatewayRefunds.push(r);
    if (this.refundBehaviour === 'timeout') throw new GatewayError('socket hang up', false);
    return r as any;
  }
  async listPaymentRefunds() { return { items: this.gatewayRefunds } as any; }
  async fetchRefund(id: string) { return (this.gatewayRefunds.find((r) => r.id === id) ?? { id, status: 'pending' }) as any; }
  async createTransfer(params: any) {
    await new Promise((r) => setTimeout(r, 20));
    this.transferCalls.push(params);
    if (this.transferBehaviour === '4xx') throw new GatewayError('account not activated', true, 400, 'BAD_REQUEST_ERROR');
    const t = { id: `trf_${RUN}_${++seq}`, notes: params.notes, created_at: Math.floor(Date.now() / 1000) };
    this.gatewayTransfers.push(t);
    if (this.transferBehaviour === 'timeout') throw new GatewayError('timeout', false);
    return t as any;
  }
  async listTransfers() { return { items: this.gatewayTransfers } as any; }
  async fetchTransfer(id: string) { return { id, amount_reversed: 0 } as any; }
}

describe('Refund & payout idempotency', () => {
  let h: Harness;
  let gw: FakeGateway;
  let refunds: RefundsService;
  let transfers: TransfersService;
  let webhooks: WebhooksService;

  beforeAll(async () => {
    h = await createHarness();
    gw = new FakeGateway();
    transfers = new TransfersService(h.prisma, h.audit, gw);
    refunds = new RefundsService(h.prisma, transfers, h.audit, gw);
    webhooks = new WebhooksService(h.prisma, h.bookings, refunds, h.notifications, h.audit);
  });
  afterAll(async () => h?.prisma.$disconnect());

  async function paidBooking(seats = 2, startInHours = 72) {
    const f = await createFixture(h.prisma, { rafts: 2, capacity: 8, startInHours });
    const [u] = await createUsers(h.prisma, 1, f.tag);
    const b = await h.bookings.createBooking({ id: u.id }, bookingDto(f.slot.id, seats));
    await h.prisma.payment.create({ data: { booking_id: b.id, razorpay_order_id: `order_${f.tag}`, amount_paise: b.amount_paise, status: 'CREATED' } });
    // Real capture path (same code the webhook runs)
    await webhooks.handleCapturedPayment({ id: `pay_${f.tag}`, order_id: `order_${f.tag}`, amount: Number(b.amount_paise), currency: 'INR' });
    return { f, u, b };
  }

  beforeEach(async () => {
    gw.refundCalls = []; gw.transferCalls = []; gw.gatewayRefunds = []; gw.gatewayTransfers = [];
    gw.refundBehaviour = 'ok'; gw.transferBehaviour = 'ok';
    // isolate: no PENDING refunds / due transfers from other tests
    await h.prisma.refund.updateMany({ where: { status: 'PENDING' }, data: { status: 'FAILED' } });
    await h.prisma.transfer.updateMany({ where: { status: 'ON_HOLD' }, data: { hold_reason: 'TEST_ISOLATION' } });
  });

  it('capture → CONFIRMED with an ON_HOLD transfer; duplicate capture is a no-op', async () => {
    const { b, f } = await paidBooking();
    const again = await webhooks.handleCapturedPayment({ id: `pay_${f.tag}`, order_id: `order_${f.tag}`, amount: Number(b.amount_paise) });
    expect(again.outcome).toBe('ALREADY_CONFIRMED');
    const t = await h.prisma.transfer.findUniqueOrThrow({ where: { booking_id: b.id } });
    expect(t.status).toBe('ON_HOLD');
    expect(t.amount_paise).toBe(b.vendor_payout_paise);
    expect(await h.prisma.transfer.count({ where: { booking_id: b.id } })).toBe(1);
  });

  it('a refund is submitted to Razorpay exactly once even if the job runs repeatedly before the webhook', async () => {
    const { b, u } = await paidBooking();
    await h.bookings.cancelBooking({ bookingId: b.id, kind: 'CUSTOMER', userId: u.id, actorId: u.id });
    await refunds.processPendingRefunds();
    await refunds.processPendingRefunds();
    await Promise.all([refunds.processPendingRefunds(), refunds.processPendingRefunds()]);
    expect(gw.refundCalls).toHaveLength(1);
    const r = await h.prisma.refund.findFirstOrThrow({ where: { booking_id: b.id } });
    expect(r.status).toBe('PROCESSING');
    expect(r.razorpay_refund_id).toBe(gw.gatewayRefunds[0].id);
    // webhook completes it; replayed webhook changes nothing
    await refunds.markFromWebhook({ id: gw.gatewayRefunds[0].id, notes: { refund_id: r.id } }, 'PROCESSED');
    expect((await refunds.markFromWebhook({ id: gw.gatewayRefunds[0].id }, 'PROCESSED'))?.changed).toBe(false);
    expect((await h.prisma.refund.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('PROCESSED');
    // Full refund (> 24h before departure) → vendor transfer fully reversed before release
    const t = await h.prisma.transfer.findUniqueOrThrow({ where: { booking_id: b.id } });
    expect(t.status).toBe('REVERSED');
    expect(t.amount_paise).toBe(0n);
  });

  it('unknown gateway outcome (timeout) is reconciled by notes.refund_id — never re-submitted', async () => {
    const { b, u } = await paidBooking();
    await h.bookings.cancelBooking({ bookingId: b.id, kind: 'CUSTOMER', userId: u.id, actorId: u.id });
    gw.refundBehaviour = 'timeout';
    await refunds.processPendingRefunds();
    const r = await h.prisma.refund.findFirstOrThrow({ where: { booking_id: b.id } });
    expect(r.status).toBe('PROCESSING');
    expect(r.razorpay_refund_id).toBeNull();
    gw.refundBehaviour = 'ok';
    await refunds.processPendingRefunds(); // must NOT pick up the ambiguous refund
    expect(gw.refundCalls).toHaveLength(1);
    await h.prisma.refund.update({ where: { id: r.id }, data: { last_attempt_at: new Date(Date.now() - 11 * 60_000) } });
    await refunds.reconcileRefunds();
    const after = await h.prisma.refund.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.razorpay_refund_id).toBe(gw.gatewayRefunds[0].id);
    expect(gw.refundCalls).toHaveLength(1);
  });

  it('a definitive 4xx puts the refund back to PENDING with backoff (retryable)', async () => {
    const { b, u } = await paidBooking();
    await h.bookings.cancelBooking({ bookingId: b.id, kind: 'CUSTOMER', userId: u.id, actorId: u.id });
    gw.refundBehaviour = '4xx';
    await refunds.processPendingRefunds();
    const r = await h.prisma.refund.findFirstOrThrow({ where: { booking_id: b.id } });
    expect(r.status).toBe('PENDING');
    expect(r.attempt_count).toBe(1);
    expect(r.failure_reason).toMatch(/BAD_REQUEST_ERROR/);
    await refunds.processPendingRefunds(); // inside backoff window → not retried yet
    expect(gw.refundCalls).toHaveLength(1);
  });

  it('refunds can never exceed the captured amount', async () => {
    const { b } = await paidBooking();
    const first = await h.prisma.$transaction((tx) =>
      refunds.queueRefundInTx(tx, { bookingId: b.id, amountPaise: b.amount_paise - 100n, reason: 'ADMIN', idempotencyKey: `t1:${b.id}`, initiatedByType: 'ADMIN' }),
    );
    const second = await h.prisma.$transaction((tx) =>
      refunds.queueRefundInTx(tx, { bookingId: b.id, amountPaise: b.amount_paise, reason: 'ADMIN', idempotencyKey: `t2:${b.id}`, initiatedByType: 'ADMIN' }),
    );
    expect(first!.amount_paise).toBe(b.amount_paise - 100n);
    expect(second!.amount_paise).toBe(100n); // capped to the remainder
    const third = await h.prisma.$transaction((tx) =>
      refunds.queueRefundInTx(tx, { bookingId: b.id, amountPaise: 1n, reason: 'ADMIN', idempotencyKey: `t3:${b.id}`, initiatedByType: 'ADMIN' }),
    );
    expect(third).toBeNull();
    // same idempotency key → same refund, no new row
    const again = await h.prisma.$transaction((tx) =>
      refunds.queueRefundInTx(tx, { bookingId: b.id, amountPaise: 5n, reason: 'ADMIN', idempotencyKey: `t1:${b.id}`, initiatedByType: 'ADMIN' }),
    );
    expect(again!.id).toBe(first!.id);
  });

  it('50% refund (6–24h) leaves the vendor the commission split of the retained half', async () => {
    const { b, u } = await paidBooking(2, 12);
    await h.bookings.cancelBooking({ bookingId: b.id, kind: 'CUSTOMER', userId: u.id, actorId: u.id });
    const r = await h.prisma.refund.findFirstOrThrow({ where: { booking_id: b.id } });
    expect(r.amount_paise).toBe(b.amount_paise / 2n);
    const t = await h.prisma.transfer.findUniqueOrThrow({ where: { booking_id: b.id } });
    const retained = b.amount_paise - r.amount_paise;
    expect(t.amount_paise).toBe(retained - (retained * 1000n) / 10000n);
    expect(t.status).toBe('ON_HOLD');
  });

  it('two concurrent release runs pay a due transfer exactly once', async () => {
    const { b } = await paidBooking();
    await h.prisma.vendor.update({
      where: { id: (await h.prisma.transfer.findUniqueOrThrow({ where: { booking_id: b.id } })).vendor_id },
      data: { razorpay_linked_account_id: 'acc_TEST', razorpay_kyc_status: 'activated' },
    });
    await h.prisma.$executeRaw`UPDATE transfers SET release_at = NOW() - interval '1 minute', created_at = NOW() - interval '2 days', hold_reason = NULL WHERE booking_id = ${b.id}::uuid`;
    await Promise.all([transfers.releaseDueTransfers(), transfers.releaseDueTransfers(), transfers.releaseDueTransfers()]);
    expect(gw.transferCalls).toHaveLength(1);
    const t = await h.prisma.transfer.findUniqueOrThrow({ where: { booking_id: b.id } });
    expect(t.status).toBe('RELEASED');
    expect(t.razorpay_transfer_id).toBe(gw.gatewayTransfers[0].id);
    await transfers.releaseDueTransfers();
    expect(gw.transferCalls).toHaveLength(1);
  });

  it('a disputed booking keeps its payout on hold until the dispute is resolved', async () => {
    const { f, b } = await paidBooking();
    await h.prisma.vendor.update({ where: { id: f.vendor.id }, data: { razorpay_linked_account_id: 'acc_TEST', razorpay_kyc_status: 'activated' } });
    await h.prisma.$executeRaw`UPDATE transfers SET release_at = NOW() - interval '1 minute', created_at = NOW() - interval '2 days', hold_reason = NULL WHERE booking_id = ${b.id}::uuid`;

    const flagged = await h.bookings.flagDispute(f.admin.id, b.id, 'Customer says the raft never left');
    expect(flagged).toMatchObject({ status: 'DISPUTED', previous_status: 'CONFIRMED', payout_held: true });
    await transfers.releaseDueTransfers();
    expect(gw.transferCalls).toHaveLength(0);
    expect((await h.prisma.transfer.findUniqueOrThrow({ where: { booking_id: b.id } })).status).toBe('ON_HOLD');
    await expect(h.bookings.flagDispute(f.admin.id, b.id, 'again please')).rejects.toBeDefined();

    const resolved = await h.bookings.resolveDispute(f.admin.id, b.id, 'Operator showed GPS log; trip ran');
    expect(resolved.status).toBe('CONFIRMED');
    await transfers.releaseDueTransfers();
    expect(gw.transferCalls).toHaveLength(1);
    const events = await h.prisma.bookingEvent.findMany({ where: { booking_id: b.id }, orderBy: { created_at: 'asc' }, select: { event_type: true } });
    expect(events.map((e) => e.event_type)).toEqual(expect.arrayContaining(['BOOKING_DISPUTED', 'BOOKING_DISPUTE_RESOLVED']));
  });

  it('only paid bookings can be disputed, and only disputed ones resolved', async () => {
    const f = await createFixture(h.prisma, { rafts: 1, capacity: 8 });
    const [u] = await createUsers(h.prisma, 1, f.tag);
    const held = await h.bookings.createBooking({ id: u.id }, bookingDto(f.slot.id, 1));
    await expect(h.bookings.flagDispute(f.admin.id, held.id, 'not paid yet')).rejects.toBeDefined();
    const { b } = await paidBooking();
    await expect(h.bookings.resolveDispute(f.admin.id, b.id, 'nothing to resolve')).rejects.toMatchObject({ response: { error: { code: 'NOT_DISPUTED' } } });
  });

  it('a transfer whose gateway outcome is unknown is reconciled, not paid twice', async () => {
    const { b } = await paidBooking();
    const tr = await h.prisma.transfer.findUniqueOrThrow({ where: { booking_id: b.id } });
    await h.prisma.vendor.update({ where: { id: tr.vendor_id }, data: { razorpay_linked_account_id: 'acc_TEST', razorpay_kyc_status: 'activated' } });
    await h.prisma.$executeRaw`UPDATE transfers SET release_at = NOW() - interval '1 minute', created_at = NOW() - interval '2 days', hold_reason = NULL WHERE id = ${tr.id}::uuid`;
    gw.transferBehaviour = 'timeout';
    await transfers.releaseDueTransfers();
    expect((await h.prisma.transfer.findUniqueOrThrow({ where: { id: tr.id } })).status).toBe('PROCESSING');
    gw.transferBehaviour = 'ok';
    await transfers.releaseDueTransfers(); // PROCESSING rows are never re-claimed
    expect(gw.transferCalls).toHaveLength(1);
    await h.prisma.transfer.update({ where: { id: tr.id }, data: { claimed_at: new Date(Date.now() - 11 * 60_000) } });
    await transfers.reconcileProcessingTransfers();
    const after = await h.prisma.transfer.findUniqueOrThrow({ where: { id: tr.id } });
    expect(after.status).toBe('RELEASED');
    expect(after.razorpay_transfer_id).toBe(gw.gatewayTransfers[0].id);
    expect(gw.transferCalls).toHaveLength(1);
  });

  it('vendor without an activated Route account: transfer stays ON_HOLD (NO_LINKED_ACCOUNT), no gateway call', async () => {
    const { b } = await paidBooking();
    await h.prisma.$executeRaw`UPDATE transfers SET release_at = NOW() - interval '1 minute', created_at = NOW() - interval '2 days', hold_reason = NULL WHERE booking_id = ${b.id}::uuid`;
    await transfers.releaseDueTransfers();
    const t = await h.prisma.transfer.findUniqueOrThrow({ where: { booking_id: b.id } });
    expect(t.status).toBe('ON_HOLD');
    expect(t.hold_reason).toBe('NO_LINKED_ACCOUNT');
    expect(gw.transferCalls).toHaveLength(0);
  });

  it('payment captured after the booking was cancelled is refunded in full (never kept)', async () => {
    const f = await createFixture(h.prisma, { rafts: 1, capacity: 8 });
    const [u] = await createUsers(h.prisma, 1, f.tag);
    const b = await h.bookings.createBooking({ id: u.id }, bookingDto(f.slot.id, 1));
    await h.prisma.payment.create({ data: { booking_id: b.id, razorpay_order_id: `order_late${f.tag}`, amount_paise: b.amount_paise, status: 'CREATED' } });
    await h.bookings.cancelBooking({ bookingId: b.id, kind: 'CUSTOMER', userId: u.id, actorId: u.id });
    const res = await webhooks.handleCapturedPayment({ id: `pay_late${f.tag}`, order_id: `order_late${f.tag}`, amount: Number(b.amount_paise) });
    expect(res.outcome).toBe('REFUND_QUEUED');
    const r = await h.prisma.refund.findFirstOrThrow({ where: { booking_id: b.id } });
    expect(r.amount_paise).toBe(b.amount_paise);
    expect(r.reason).toBe('PAYMENT_AFTER_CANCELLATION');
  });
});
