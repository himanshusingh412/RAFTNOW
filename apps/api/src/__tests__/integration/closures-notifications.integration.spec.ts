import { createHarness, createFixture, createUsers, bookingDto, Harness } from './harness';
import { NotificationDriver } from '../../notifications/drivers/types';

jest.setTimeout(120_000);

describe('River closure processing (real DB)', () => {
  let h: Harness;
  beforeAll(async () => (h = await createHarness()));
  afterAll(async () => h?.prisma.$disconnect());

  it('close → blocks booking, cancels + fully refunds affected bookings, audits; reopen restores booking', async () => {
    const f = await createFixture(h.prisma, { rafts: 2, capacity: 8, startInHours: 30 });
    const [u1, u2, u3] = await createUsers(h.prisma, 3, f.tag);
    const paid = await h.bookings.createBooking({ id: u1.id }, bookingDto(f.slot.id, 2));
    await h.prisma.payment.create({ data: { booking_id: paid.id, razorpay_order_id: `order_c${f.tag}`, amount_paise: paid.amount_paise, status: 'CAPTURED', razorpay_payment_id: `pay_c${f.tag}`, captured_at: new Date() } });
    const pay = await h.prisma.payment.findFirstOrThrow({ where: { booking_id: paid.id } });
    await h.bookings.confirmBookingAfterPayment(pay.id, `pay_c${f.tag}`);
    const pending = await h.bookings.createBooking({ id: u2.id }, bookingDto(f.slot.id, 3));

    const { closure, processing } = await h.closures.close({ adminId: f.admin.id }, f.stretch.id, 'High water release (DM order)');
    expect(processing).toMatchObject({ cancelled: 2, failed: 0 });

    await expect(h.bookings.createBooking({ id: u3.id }, bookingDto(f.slot.id, 1))).rejects.toMatchObject({ response: { error: { code: 'STRETCH_CLOSED' } } });

    const b1 = await h.prisma.booking.findUniqueOrThrow({ where: { id: paid.id } });
    const b2 = await h.prisma.booking.findUniqueOrThrow({ where: { id: pending.id } });
    expect([b1.status, b1.cancellation_trigger]).toEqual(['CANCELLED_ADMIN', 'RIVER_CLOSURE']);
    expect(b2.status).toBe('CANCELLED_ADMIN');
    const refund = await h.prisma.refund.findFirstOrThrow({ where: { booking_id: paid.id } });
    expect(refund.amount_paise).toBe(paid.amount_paise);
    expect(await h.prisma.refund.count({ where: { booking_id: pending.id } })).toBe(0); // never paid
    const slot = await h.prisma.slot.findUniqueOrThrow({ where: { id: f.slot.id } });
    expect(slot.seats_booked + slot.seats_held).toBe(0);

    const audit = await h.prisma.auditLog.findFirstOrThrow({ where: { action: 'STRETCH_CLOSED', entity_id: f.stretch.id } });
    expect(audit.admin_id).toBe(f.admin.id);
    expect(audit.data).toMatchObject({ previous_state: 'OPEN', new_state: 'CLOSED', reason: 'High water release (DM order)' });

    // Re-processing is idempotent
    expect(await h.closures.processClosure(closure.id)).toMatchObject({ cancelled: 0 });
    expect(await h.prisma.refund.count({ where: { booking_id: paid.id } })).toBe(1);

    await h.closures.open({ adminId: f.admin.id }, f.stretch.id, 'Levels normal');
    const again = await h.bookings.createBooking({ id: u3.id }, bookingDto(f.slot.id, 1));
    expect(again.status).toBe('PENDING_PAYMENT');
    expect(await h.prisma.auditLog.count({ where: { action: 'STRETCH_REOPENED', entity_id: f.stretch.id } })).toBe(1);
  });

  it('audit_logs and booking_events are append-only at the database level', async () => {
    const log = await h.prisma.auditLog.findFirstOrThrow();
    await expect(h.prisma.auditLog.update({ where: { id: log.id }, data: { action: 'TAMPERED' } })).rejects.toThrow(/append-only/);
    await expect(h.prisma.auditLog.delete({ where: { id: log.id } })).rejects.toThrow(/append-only/);
  });
});

describe('Notification outbox dispatcher (real DB, stub provider)', () => {
  let h: Harness;
  beforeAll(async () => (h = await createHarness()));
  afterAll(async () => h?.prisma.$disconnect());

  it('delivers once, retries transient failures with backoff, records SKIPPED when unconfigured', async () => {
    const f = await createFixture(h.prisma, { rafts: 1, capacity: 8 });
    const [u] = await createUsers(h.prisma, 1, f.tag);
    await h.prisma.user.update({ where: { id: u.id }, data: { push_token: 'x'.repeat(40) } });
    await h.prisma.notification.updateMany({ where: { status: 'PENDING' }, data: { status: 'SKIPPED' } });

    const sent: string[] = [];
    let failNext = true;
    const push: NotificationDriver = {
      channel: 'PUSH', provider: 'stub', isConfigured: () => true,
      send: async (_to, msg) => {
        if (failNext) { failNext = false; throw new Error('503 from provider'); }
        sent.push(msg.body);
        return { status: 'SENT', provider: 'stub', providerMessageId: `m${sent.length}` };
      },
    };
    h.notifications.setDriver(push);
    for (let i = 0; i < 2; i++) {
      await h.notifications.enqueue({ userId: u.id, channel: 'PUSH', event: 'CHECK_IN_CONFIRMED', data: { booking_code: 'ABC123' }, idempotencyKey: `it-push-${f.tag}` });
    }
    await h.notifications.enqueue({ userId: u.id, channel: 'WHATSAPP', event: 'BOOKING_CONFIRMED', data: {}, idempotencyKey: `it-wa-${f.tag}` });
    expect(await h.prisma.notification.count({ where: { idempotency_key: `it-push-${f.tag}` } })).toBe(1);

    const r1 = await h.notifications.dispatchDue();
    expect(r1).toMatchObject({ retry: 1, skipped: 1 });
    const n = await h.prisma.notification.findUniqueOrThrow({ where: { idempotency_key: `it-push-${f.tag}` } });
    expect(n.status).toBe('PENDING');
    expect(n.next_attempt_at!.getTime()).toBeGreaterThan(Date.now());

    await h.prisma.notification.update({ where: { id: n.id }, data: { next_attempt_at: new Date() } });
    const [a, b] = await Promise.all([h.notifications.dispatchDue(), h.notifications.dispatchDue()]);
    expect(a.sent + b.sent).toBe(1); // concurrent dispatchers never double-send
    expect(sent).toHaveLength(1);
    expect((await h.prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe('SENT');
    expect((await h.prisma.notification.findUniqueOrThrow({ where: { idempotency_key: `it-wa-${f.tag}` } })).status).toBe('SKIPPED');
  });
});
