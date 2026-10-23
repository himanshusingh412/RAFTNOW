/**
 * Stretch master data and season calendar (A-05), and trip photos (V-04 / C-06),
 * against real PostgreSQL, real image processing (sharp) and a throwaway
 * local media directory.
 */
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import { createHarness, createFixture, createUsers, bookingDto, errorCode, Harness } from './harness';
import { WebhooksService } from '../../webhooks/webhooks.service';
import { SlotsService } from '../../slots/slots.service';
import { TripsService } from '../../trips/trips.service';
import { StretchesService } from '../../stretches/stretches.service';
import { StorageService } from '../../storage/storage.service';
import { addDays, istDateOf, istDayRange } from '../../common/time/ist';

jest.setTimeout(120_000);

const fail = (p: Promise<unknown>) => p.then(() => 'NO_ERROR', errorCode);

describe('Stretch master data', () => {
  let h: Harness;
  let stretches: StretchesService;
  const base = () => ({
    name: `Test stretch ${randomUUID().slice(0, 8)}`,
    distance_km: 12.5,
    grade: 'II-III',
    duration_minutes: 120,
    put_in_point: 'Put-in ghat',
    take_out_point: 'Take-out beach',
    min_age: 14,
    max_age: null,
    active: true,
  });

  beforeAll(async () => {
    h = await createHarness();
    stretches = new StretchesService(h.prisma, h.audit);
  });
  afterAll(async () => h?.prisma.$disconnect());

  it('creates, edits and rejects duplicate names and impossible values', async () => {
    const admin = (await createFixture(h.prisma, { rafts: 1, capacity: 8 })).admin;
    const input = base();
    const s = await stretches.create(admin.id, input);
    expect(s).toMatchObject({ name: input.name, distance_km: 12.5, active: true });
    expect(await fail(stretches.create(admin.id, { ...base(), name: input.name }))).toBe('STRETCH_NAME_TAKEN');
    expect(await fail(stretches.create(admin.id, { ...base(), max_age: 10 }))).toBe('INVALID_STRETCH');
    expect(await fail(stretches.create(admin.id, { ...base(), distance_km: 1.25 }))).toBe('INVALID_STRETCH');

    const edited = await stretches.update(admin.id, s.id, { grade: 'III', max_age: 60 });
    expect(edited).toMatchObject({ grade: 'III', max_age: 60, name: input.name });
    expect(await fail(stretches.update(admin.id, s.id, { min_age: 70 }))).toBe('INVALID_STRETCH'); // min would exceed max
    const log = await h.prisma.auditLog.findFirst({ where: { entity_id: s.id, action: 'STRETCH_UPDATED' } });
    expect(log).not.toBeNull();
  });

  it('deactivating hides the stretch and stops new bookings; sold bookings stand', async () => {
    const f = await createFixture(h.prisma, { rafts: 1, capacity: 8 });
    const [a, b] = await createUsers(h.prisma, 2, f.tag);
    const sold = await h.bookings.createBooking({ id: a.id }, bookingDto(f.slot.id, 1));
    const r = await stretches.update(f.admin.id, f.stretch.id, { active: false });
    expect(r).toMatchObject({ active: false, upcoming_bookings_still_valid: 1 });
    expect((await stretches.listPublic()).some((s) => s.id === f.stretch.id)).toBe(false);
    expect(await fail(h.bookings.createBooking({ id: b.id }, bookingDto(f.slot.id, 1)))).toBe('TRIP_NOT_LIVE');
    expect((await h.prisma.booking.findUniqueOrThrow({ where: { id: sold.id } })).status).toBe('PENDING_PAYMENT');
  });
});

describe('Season calendar', () => {
  let h: Harness;
  let webhooks: WebhooksService;
  let slots: SlotsService;
  let stretches: StretchesService;

  beforeAll(async () => {
    h = await createHarness();
    webhooks = new WebhooksService(h.prisma, h.bookings, h.refunds, h.notifications, h.audit);
    slots = new SlotsService(h.prisma);
    stretches = new StretchesService(h.prisma, h.audit);
  });
  afterAll(async () => h?.prisma.$disconnect());

  it('a season blocks bookings inside it, refunds what was already sold, and shows on the stretch', async () => {
    const f = await createFixture(h.prisma, { rafts: 1, capacity: 8, startInHours: 72 });
    const [paidUser, lateUser] = await createUsers(h.prisma, 2, f.tag);
    const paid = await h.bookings.createBooking({ id: paidUser.id }, bookingDto(f.slot.id, 2));
    await h.prisma.payment.create({ data: { booking_id: paid.id, razorpay_order_id: `order_ss${f.tag}`, amount_paise: paid.amount_paise, status: 'CREATED' } });
    await webhooks.handleCapturedPayment({ id: `pay_ss${f.tag}`, order_id: `order_ss${f.tag}`, amount: Number(paid.amount_paise), currency: 'INR' });

    const day = istDateOf(f.slot.start_time);
    const r = await h.closures.scheduleSeason({ adminId: f.admin.id }, { stretchId: f.stretch.id, startsOn: day, endsOn: addDays(day, 5), reason: 'Monsoon 2027' });
    expect(r.season).toMatchObject({ state: 'SCHEDULED', starts_on: day, ends_on: addDays(day, 5), river_wide: false });
    expect(r.processing).toMatchObject({ cancelled: 1, failed: 0 });

    const after = await h.prisma.booking.findUniqueOrThrow({ where: { id: paid.id } });
    expect(after.status).toBe('CANCELLED_ADMIN');
    expect((await h.prisma.refund.findFirstOrThrow({ where: { booking_id: paid.id } })).amount_paise).toBe(paid.amount_paise);
    expect(await fail(h.bookings.createBooking({ id: lateUser.id }, bookingDto(f.slot.id, 1)))).toBe('STRETCH_CLOSED');

    const avail = await slots.listAvailability(f.stretch.id, day);
    expect(avail.slots.find((s) => s.id === f.slot.id)).toMatchObject({ bookable: false, closure_reason: 'Monsoon 2027' });
    const pub = (await stretches.listPublic()).find((s) => s.id === f.stretch.id)!;
    expect(pub.status).toBe('OPEN'); // not closed yet...
    expect(pub.next_closure).toMatchObject({ reason: 'Monsoon 2027' }); // ...but customers can see it coming
  });

  it('season days are whole IST days, inclusive', async () => {
    const f = await createFixture(h.prisma, { rafts: 1, capacity: 8 });
    const start = addDays(istDateOf(new Date()), 40);
    const { season } = await h.closures.scheduleSeason({ adminId: f.admin.id }, { stretchId: f.stretch.id, startsOn: start, endsOn: start, reason: 'One-day festival closure' });
    const row = await h.prisma.closure.findUniqueOrThrow({ where: { id: season.id } });
    expect(row.kind).toBe('SEASON');
    expect(row.starts_at).toEqual(istDayRange(start).start);
    expect(row.ends_at).toEqual(istDayRange(start).end);
  });

  it('rejects overlap, past starts and reversed ranges; cancel reopens without un-refunding', async () => {
    const f = await createFixture(h.prisma, { rafts: 1, capacity: 8 });
    const s0 = addDays(istDateOf(new Date()), 50);
    const actor = { adminId: f.admin.id };
    const { season } = await h.closures.scheduleSeason(actor, { stretchId: f.stretch.id, startsOn: s0, endsOn: addDays(s0, 10), reason: 'Monsoon block A' });
    expect(await fail(h.closures.scheduleSeason(actor, { stretchId: f.stretch.id, startsOn: addDays(s0, 10), endsOn: addDays(s0, 12), reason: 'Overlapping B' }))).toBe('SEASON_OVERLAP');
    // Touching end-to-start is fine (ends_at is exclusive).
    await h.closures.scheduleSeason(actor, { stretchId: f.stretch.id, startsOn: addDays(s0, 11), endsOn: addDays(s0, 12), reason: 'Adjacent C' });
    expect(await fail(h.closures.scheduleSeason(actor, { stretchId: f.stretch.id, startsOn: addDays(s0, -60), endsOn: s0, reason: 'In the past' }))).toBe('START_IN_PAST');
    expect(await fail(h.closures.scheduleSeason(actor, { stretchId: f.stretch.id, startsOn: addDays(s0, 30), endsOn: addDays(s0, 29), reason: 'Backwards' }))).toBe('INVALID_RANGE');

    const cancelled = await h.closures.cancelSeason(actor, season.id, 'Monsoon arrived late');
    expect(cancelled.state).toBe('CANCELLED');
    expect(await fail(h.closures.cancelSeason(actor, season.id, 'again'))).toBe('ALREADY_CANCELLED');
    // Emergency closures are not seasons.
    const { closure } = await h.closures.close(actor, f.stretch.id, 'Flash flood warning');
    expect(await fail(h.closures.cancelSeason(actor, closure.id, 'nope'))).toBe('SEASON_NOT_FOUND');
  });

  it('the database refuses an open-ended season', async () => {
    const f = await createFixture(h.prisma, { rafts: 1, capacity: 8 });
    await expect(
      h.prisma.closure.create({ data: { kind: 'SEASON', stretch_id: f.stretch.id, starts_at: new Date(), ends_at: null, reason: 'x', created_by: f.admin.id } }),
    ).rejects.toBeDefined();
  });
});

describe('Trip photos', () => {
  let h: Harness;
  let trips: TripsService;
  let dir: string;
  const prevDriver = process.env.STORAGE_DRIVER;
  const prevDir = process.env.STORAGE_PUBLIC_DIR;

  const jpeg = (w: number, h: number, withGps = false) => {
    const img = sharp({ create: { width: w, height: h, channels: 3, background: { r: 20, g: 120, b: 160 } } }).jpeg();
    return (withGps ? img.withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '30/1 7/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '78/1 19/1 0/1' } }) : img).toBuffer();
  };

  beforeAll(async () => {
    h = await createHarness();
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'raftnow-media-'));
    process.env.STORAGE_DRIVER = 'local';
    process.env.STORAGE_PUBLIC_DIR = dir;
    trips = new TripsService(h.prisma, h.audit, new SlotsService(h.prisma), new StorageService());
  });
  afterAll(async () => {
    process.env.STORAGE_DRIVER = prevDriver;
    process.env.STORAGE_PUBLIC_DIR = prevDir;
    await fs.rm(dir, { recursive: true, force: true });
    await h?.prisma.$disconnect();
  });

  const owner = (vendorId: string) => ({ id: randomUUID(), vendorId, vendorStatus: 'LIVE' }) as any;
  const keyOf = (url: string) => url.replace(/^.*\/api\/v1\/storage\/media\//, '');

  it('stores a resized JPEG without EXIF/GPS and serves it on the public trip page', async () => {
    const f = await createFixture(h.prisma, { rafts: 1, capacity: 8 });
    const raw = await jpeg(4000, 3000, true);
    expect((await sharp(raw).metadata()).exif).toBeDefined();

    const p = await trips.addPhoto(owner(f.vendor.id), f.trip.id, { buffer: raw }, '  Rapid "Roller Coaster"  ');
    expect(p.caption).toBe('Rapid "Roller Coaster"');
    expect(p.url).toMatch(/\/api\/v1\/storage\/media\/trip-photos\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/);
    const stored = await fs.readFile(path.join(dir, keyOf(p.url)));
    const meta = await sharp(stored).metadata();
    expect([meta.format, meta.width, meta.height, meta.exif]).toEqual(['jpeg', 1600, 1200, undefined]);

    const pub = await trips.getPublicTrip(f.trip.id);
    expect(pub.photos).toEqual([p]);
  });

  it('rejects non-images, tiny images and a 9th photo', async () => {
    const f = await createFixture(h.prisma, { rafts: 1, capacity: 8 });
    const o = owner(f.vendor.id);
    expect(await fail(trips.addPhoto(o, f.trip.id, { buffer: Buffer.from('%PDF-1.7 not an image') }))).toBe('UNSUPPORTED_FILE_TYPE');
    expect(await fail(trips.addPhoto(o, f.trip.id, { buffer: await jpeg(300, 300) }))).toBe('IMAGE_TOO_SMALL');
    const img = await jpeg(800, 600);
    // Parallel uploads must not get past the limit of 8.
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => trips.addPhoto(o, f.trip.id, { buffer: img })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(8);
    expect(results.filter((r) => r.status === 'rejected').map((r) => errorCode((r as PromiseRejectedResult).reason))).toEqual(['TOO_MANY_PHOTOS', 'TOO_MANY_PHOTOS']);
    expect(await h.prisma.tripPhoto.count({ where: { trip_id: f.trip.id } })).toBe(8);
    // Rejected uploads leave no files behind.
    expect((await fs.readdir(path.join(dir, 'trip-photos', f.trip.id))).length).toBe(8);
  });

  it('reorders (first = cover), validates the list, deletes the file, and is owner-only', async () => {
    const f = await createFixture(h.prisma, { rafts: 1, capacity: 8 });
    const other = await createFixture(h.prisma, { rafts: 1, capacity: 8 });
    const o = owner(f.vendor.id);
    const img = await jpeg(800, 600);
    const a = await trips.addPhoto(o, f.trip.id, { buffer: img });
    const b = await trips.addPhoto(o, f.trip.id, { buffer: img });
    const c = await trips.addPhoto(o, f.trip.id, { buffer: img });

    const ordered = await trips.reorderPhotos(o, f.trip.id, [c.id, a.id, b.id]);
    expect(ordered.map((p) => p.id)).toEqual([c.id, a.id, b.id]);
    expect((await trips.getPublicTrip(f.trip.id)).photos[0].id).toBe(c.id);
    expect(await fail(trips.reorderPhotos(o, f.trip.id, [c.id, a.id]))).toBe('INVALID_ORDER');
    expect(await fail(trips.reorderPhotos(o, f.trip.id, [c.id, a.id, a.id]))).toBe('INVALID_ORDER');

    expect(await fail(trips.addPhoto(owner(other.vendor.id), f.trip.id, { buffer: img }))).toBe('TRIP_NOT_FOUND');
    expect(await fail(trips.deletePhoto(owner(other.vendor.id), f.trip.id, a.id))).toBe('TRIP_NOT_FOUND');

    await trips.deletePhoto(o, f.trip.id, a.id);
    await expect(fs.access(path.join(dir, keyOf(a.url)))).rejects.toBeDefined();
    expect((await trips.getPublicTrip(f.trip.id)).photos.map((p) => p.id)).toEqual([c.id, b.id]);
  });

  it('serves only well-formed public keys', async () => {
    const storage = new StorageService();
    for (const bad of ['../../etc/passwd', 'trip-photos/x/../../secret.jpg', `vendors/${randomUUID()}/documents/${randomUUID()}.pdf`]) {
      expect(await fail(storage.readPublicLocal(bad))).toBe('NOT_FOUND');
    }
  });
});
