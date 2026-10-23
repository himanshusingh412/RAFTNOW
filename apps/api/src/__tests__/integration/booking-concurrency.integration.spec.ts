/**
 * CONCURRENCY TESTS — real PostgreSQL, real BookingsService, real row locks.
 *
 * No mocks: every createBooking() call opens its own database transaction and
 * competes for the SELECT ... FOR UPDATE lock on the slot row, exactly as
 * concurrent HTTP requests would.
 */
import { createHarness, createFixture, createUsers, bookingDto, errorCode, Harness } from './harness';
import { countersAreValid } from '../../bookings/inventory';

jest.setTimeout(120_000);

describe('Booking concurrency (PostgreSQL row locking)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.prisma.$disconnect();
  });

  const slotRow = (id: string) => h.prisma.slot.findUniqueOrThrow({ where: { id } });

  it('50 concurrent 1-seat bookings against 8 seats → exactly 8 succeed, 42 fail with SLOT_FULL', async () => {
    const f = await createFixture(h.prisma, { rafts: 1, capacity: 8 });
    const users = await createUsers(h.prisma, 50, f.tag);

    const results = await Promise.allSettled(
      users.map((u) => h.bookings.createBooking({ id: u.id, phone: u.phone }, bookingDto(f.slot.id, 1))),
    );

    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    const failureCodes = failed.map((r) => errorCode(r.reason));

    expect(ok).toHaveLength(8);
    expect(failed).toHaveLength(42);
    // Every rejection must be a capacity rejection — not a timeout, deadlock or 500.
    expect(new Set(failureCodes)).toEqual(new Set(['SLOT_FULL']));

    // The database itself agrees: 8 holds, 8 seats held, invariants intact.
    const persisted = await h.prisma.booking.count({ where: { slot_id: f.slot.id, status: 'PENDING_PAYMENT' } });
    expect(persisted).toBe(8);
    const slot = await slotRow(f.slot.id);
    expect(slot.seats_held).toBe(8);
    expect(slot.seats_booked).toBe(0);
    expect(countersAreValid(slot)).toBe(true);
  });

  it('mixed concurrent PRIVATE raft and SHARED seat bookings never exceed physical rafts', async () => {
    // 2 rafts × 6 seats = 12 seats. Requests: 10 private rafts + 20 × 2-seat shared.
    const f = await createFixture(h.prisma, { rafts: 2, capacity: 6 });
    const users = await createUsers(h.prisma, 30, f.tag);
    const results = await Promise.allSettled(
      users.map((u, i) =>
        h.bookings.createBooking({ id: u.id, phone: u.phone }, i < 10 ? bookingDto(f.slot.id, 2, 'PRIVATE') : bookingDto(f.slot.id, 2, 'SHARED')),
      ),
    );
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(new Set(failed.map((r) => errorCode(r.reason))).size).toBeGreaterThan(0);
    for (const r of failed) expect(['SLOT_FULL', 'NO_PRIVATE_RAFT_AVAILABLE']).toContain(errorCode(r.reason));

    const slot = await slotRow(f.slot.id);
    const seatsUsed = slot.seats_held + slot.seats_booked + (slot.private_rafts_held + slot.private_rafts_booked) * slot.raft_capacity;
    expect(seatsUsed).toBeLessThanOrEqual(slot.total_seats);
    expect(slot.private_rafts_held + Math.ceil(slot.seats_held / slot.raft_capacity)).toBeLessThanOrEqual(slot.total_rafts);
    expect(countersAreValid(slot)).toBe(true);

    // Counters match the bookings table exactly.
    const holds = await h.prisma.booking.findMany({ where: { slot_id: f.slot.id, status: 'PENDING_PAYMENT' } });
    expect(holds.filter((b) => b.mode === 'SHARED').reduce((a, b) => a + b.seat_count, 0)).toBe(slot.seats_held);
    expect(holds.filter((b) => b.mode === 'PRIVATE').length).toBe(slot.private_rafts_held);
    // The slot must be fully used: nothing left that any request could have taken.
    expect(seatsUsed).toBe(slot.total_seats);
  });

  it('10 concurrent requests with the SAME idempotency key create exactly one booking', async () => {
    const f = await createFixture(h.prisma, { rafts: 3, capacity: 8 });
    const [u] = await createUsers(h.prisma, 1, f.tag);
    const dto = bookingDto(f.slot.id, 2);
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => h.bookings.createBooking({ id: u.id, phone: u.phone }, dto)));
    const ids = new Set(results.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<{ id: string }>).value.id));
    expect(ids.size).toBe(1);
    expect(await h.prisma.booking.count({ where: { idempotency_key: dto.idempotency_key } })).toBe(1);
    expect((await slotRow(f.slot.id)).seats_held).toBe(2);
  });

  it('a lapsed hold is released inside the booking transaction (no stale "full")', async () => {
    const f = await createFixture(h.prisma, { rafts: 1, capacity: 4 });
    const [a, b] = await createUsers(h.prisma, 2, f.tag);
    const first = await h.bookings.createBooking({ id: a.id }, bookingDto(f.slot.id, 4));
    // Force the hold into the past without running the expiry job.
    await h.prisma.$executeRaw`UPDATE bookings SET hold_expires_at = NOW() - interval '1 minute', created_at = NOW() - interval '20 minutes' WHERE id = ${first.id}::uuid`;
    const second = await h.bookings.createBooking({ id: b.id }, bookingDto(f.slot.id, 4));
    expect(second.status).toBe('PENDING_PAYMENT');
    expect((await h.prisma.booking.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('EXPIRED');
    const slot = await slotRow(f.slot.id);
    expect(slot.seats_held).toBe(4);
    expect(countersAreValid(slot)).toBe(true);
  });

  it('database CHECK constraints reject overbooking even if application logic is bypassed', async () => {
    const f = await createFixture(h.prisma, { rafts: 1, capacity: 8 });
    await expect(h.prisma.$executeRaw`UPDATE slots SET seats_held = 9 WHERE id = ${f.slot.id}::uuid`).rejects.toThrow(/chk_shared_seats_not_overbooked|chk_combined_capacity|check constraint/i);
    await expect(
      h.prisma.$executeRaw`UPDATE slots SET seats_held = 4, private_rafts_held = 1 WHERE id = ${f.slot.id}::uuid`,
    ).rejects.toThrow(/chk_combined_capacity|check constraint/i);
  });

  it('payment confirmation racing a customer cancellation leaves consistent inventory and exactly one full refund', async () => {
    const f = await createFixture(h.prisma, { rafts: 1, capacity: 8, startInHours: 72 });
    const [u] = await createUsers(h.prisma, 1, f.tag);
    const booking = await h.bookings.createBooking({ id: u.id }, bookingDto(f.slot.id, 3));
    const payment = await h.prisma.payment.create({
      data: { booking_id: booking.id, razorpay_order_id: `order_IT${f.tag}`, amount_paise: booking.amount_paise, status: 'CAPTURED', razorpay_payment_id: `pay_IT${f.tag}`, captured_at: new Date() },
    });

    await Promise.allSettled([
      h.bookings.confirmBookingAfterPayment(payment.id, `pay_IT${f.tag}`),
      h.bookings.cancelBooking({ bookingId: booking.id, kind: 'CUSTOMER', userId: u.id, actorId: u.id }),
    ]);

    const final = await h.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(final.status).toBe('CANCELLED_CUSTOMER');
    const slot = await slotRow(f.slot.id);
    expect(slot.seats_held + slot.seats_booked).toBe(0);
    const refunds = await h.prisma.refund.findMany({ where: { booking_id: booking.id } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0].amount_paise).toBe(booking.amount_paise); // > 24h before departure → 100%
  });
});
