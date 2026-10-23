/**
 * Check-in by typed booking code (V-08) and admin trip hide (A-10), against
 * real PostgreSQL through the real services.
 */
import { randomUUID } from 'crypto';
import { createHarness, createFixture, createUsers, bookingDto, errorCode, Harness } from './harness';
import { WebhooksService } from '../../webhooks/webhooks.service';
import { SlotsService } from '../../slots/slots.service';
import { TripsService } from '../../trips/trips.service';
import { StorageService } from '../../storage/storage.service';
import { istDateOf } from '../../common/time/ist';

jest.setTimeout(120_000);

describe('Check-in by booking code', () => {
  let h: Harness;
  let webhooks: WebhooksService;

  beforeAll(async () => {
    h = await createHarness();
    webhooks = new WebhooksService(h.prisma, h.bookings, h.refunds, h.notifications, h.audit);
  });
  afterAll(async () => h?.prisma.$disconnect());

  /** A paid booking departing in one hour, so the check-in window is open. */
  async function paidSoon() {
    const f = await createFixture(h.prisma, { rafts: 1, capacity: 8, startInHours: 1 });
    const [u] = await createUsers(h.prisma, 1, f.tag);
    const b = await h.bookings.createBooking({ id: u.id }, bookingDto(f.slot.id, 2));
    await h.prisma.payment.create({ data: { booking_id: b.id, razorpay_order_id: `order_ci${f.tag}`, amount_paise: b.amount_paise, status: 'CREATED' } });
    await webhooks.handleCapturedPayment({ id: `pay_ci${f.tag}`, order_id: `order_ci${f.tag}`, amount: Number(b.amount_paise), currency: 'INR' });
    return { f, b, member: { id: randomUUID(), vendorId: f.vendor.id } };
  }

  it('accepts the code as staff type it ("rf ab-c…", lowercase, spaces) and records the method', async () => {
    const { b, member } = await paidSoon();
    const typed = `rf ${b.booking_code.slice(0, 3).toLowerCase()}-${b.booking_code.slice(3).toLowerCase()}`;
    const r = await h.bookings.checkIn(member, { bookingCode: typed });
    expect(r.result).toBe('CHECKED_IN');
    expect(r.booking.display_code).toBe(`RF${b.booking_code}`);
    const ev = await h.prisma.bookingEvent.findFirstOrThrow({ where: { booking_id: b.id, event_type: 'BOOKING_CHECKED_IN' } });
    expect(ev.metadata).toMatchObject({ check_in_method: 'BOOKING_CODE' });
  });

  it('a second entry of the same code is ALREADY_CHECKED_IN', async () => {
    const { b, member } = await paidSoon();
    await h.bookings.checkIn(member, { bookingCode: b.booking_code });
    expect(errorCode(await h.bookings.checkIn(member, { bookingCode: b.booking_code }).catch((x) => x))).toBe('ALREADY_CHECKED_IN');
  });

  it("another company's code is reported as not found, never as a different company", async () => {
    const { b } = await paidSoon();
    const other = await createFixture(h.prisma, { rafts: 1, capacity: 8 });
    const e = await h.bookings.checkIn({ id: randomUUID(), vendorId: other.vendor.id }, { bookingCode: b.booking_code }).catch((x) => x);
    expect(errorCode(e)).toBe('BOOKING_NOT_FOUND');
    expect((await h.prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('CONFIRMED');
  });

  it('rejects malformed and unknown codes', async () => {
    const { member } = await paidSoon();
    expect(errorCode(await h.bookings.checkIn(member, { bookingCode: 'RF12' }).catch((x) => x))).toBe('INVALID_BOOKING_CODE');
    expect(errorCode(await h.bookings.checkIn(member, { bookingCode: 'O0O0O0' }).catch((x) => x))).toBe('INVALID_BOOKING_CODE'); // look-alikes are not in the alphabet
    expect(errorCode(await h.bookings.checkIn(member, { bookingCode: 'ZZZZZZ' }).catch((x) => x))).toBe('BOOKING_NOT_FOUND');
  });
});

describe('Admin trip hide', () => {
  let h: Harness;
  let slots: SlotsService;
  let trips: TripsService;

  beforeAll(async () => {
    h = await createHarness();
    slots = new SlotsService(h.prisma);
    trips = new TripsService(h.prisma, h.audit, slots, new StorageService());
  });
  afterAll(async () => h?.prisma.$disconnect());

  it('takes the trip off search, blocks the vendor from republishing, and unhide restores LIVE', async () => {
    const f = await createFixture(h.prisma, { rafts: 1, capacity: 8, startInHours: 30 });
    const date = istDateOf(f.slot.start_time);
    const visible = async () => (await slots.listAvailability(f.stretch.id, date)).slots.some((s) => s.trip_id === f.trip.id);
    const vendorMember = { id: randomUUID(), vendorId: f.vendor.id, vendorStatus: 'LIVE' } as any;
    expect(await visible()).toBe(true);

    const hidden = await trips.hideByAdmin(f.admin.id, f.trip.id, 'Licence under review');
    expect(hidden).toMatchObject({ status: 'HIDDEN', hidden_by_admin: true });
    expect(await visible()).toBe(false);
    await expect(trips.getPublicTrip(f.trip.id)).rejects.toBeDefined();
    expect(errorCode(await trips.update(vendorMember, f.trip.id, { status: 'LIVE' } as any).catch((x) => x))).toBe('TRIP_HIDDEN_BY_ADMIN');
    // Editing content (not status) is still allowed while hidden.
    await trips.update(vendorMember, f.trip.id, { description: 'Updated while hidden' } as any);
    expect(errorCode(await trips.hideByAdmin(f.admin.id, f.trip.id, 'twice over').catch((x) => x))).toBe('ALREADY_HIDDEN');

    const shown = await trips.unhideByAdmin(f.admin.id, f.trip.id);
    expect(shown).toMatchObject({ status: 'LIVE', hidden_by_admin: false });
    expect(await visible()).toBe(true);
  });

  it('the database refuses a LIVE trip that is marked hidden', async () => {
    const f = await createFixture(h.prisma, { rafts: 1, capacity: 8 });
    await expect(
      h.prisma.trip.update({ where: { id: f.trip.id }, data: { admin_hidden_at: new Date() } }),
    ).rejects.toBeDefined();
  });
});
