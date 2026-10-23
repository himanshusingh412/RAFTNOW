/**
 * Real-PostgreSQL test harness. Wires the ACTUAL services (no mocks for the
 * database or the booking logic). Requires a migrated database:
 *
 *   DATABASE_URL_TEST=postgresql://raftnow:raftnow_dev@localhost:5434/raftnow_test \
 *     npx prisma migrate deploy        # from apps/api
 *   DATABASE_URL_TEST=... npm run test:integration --workspace=apps/api
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { RazorpayGateway } from '../../common/razorpay/razorpay.gateway';
import { TransfersService } from '../../transfers/transfers.service';
import { RefundsService } from '../../refunds/refunds.service';
import { QrService } from '../../common/qr/qr.service';
import { BookingsService } from '../../bookings/bookings.service';
import { ClosuresService } from '../../stretches/closures.service';

export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'Integration tests need a real, migrated PostgreSQL database. Set DATABASE_URL_TEST ' +
        '(e.g. postgresql://raftnow:raftnow_dev@localhost:5434/raftnow_test) and run `npx prisma migrate deploy` against it.',
    );
  }
  return url;
}

export async function createHarness() {
  process.env.DATABASE_URL = testDatabaseUrl();
  process.env.QR_SIGNING_SECRET ??= 'integration-test-qr-secret-0123456789abcdef';
  const prisma = new PrismaService();
  await prisma.$connect();
  const audit = new AuditService(prisma);
  const notifications = new NotificationsService(prisma);
  const gateway = new RazorpayGateway();
  const transfers = new TransfersService(prisma, audit, gateway);
  const refunds = new RefundsService(prisma, transfers, audit, gateway);
  const qr = new QrService();
  const bookings = new BookingsService(prisma, audit, notifications, refunds, transfers, qr);
  const closures = new ClosuresService(prisma, audit, bookings);
  return { prisma, audit, notifications, gateway, transfers, refunds, qr, bookings, closures };
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;

/** Creates an isolated stretch → LIVE vendor → LIVE trip → one future slot. */
export async function createFixture(
  prisma: PrismaService,
  opts: { rafts: number; capacity: number; privatePricePaise?: bigint | null; startInHours?: number },
) {
  const tag = randomUUID().slice(0, 8);
  const admin = await prisma.admin.create({
    data: { email: `it-${tag}@raftnow.test`, password_hash: 'x', role: 'SUPER_ADMIN' },
  });
  const stretch = await prisma.stretch.create({
    data: { name: `IT stretch ${tag}`, distance_km: 10, grade: 'III', duration_minutes: 90, put_in_point: 'A', take_out_point: 'B', min_age: 12 },
  });
  const vendor = await prisma.vendor.create({
    data: {
      legal_name: `IT vendor ${tag}`, display_name: `IT ${tag}`, owner_name: 'Owner', phone: '+919700000000', email: `v-${tag}@raftnow.test`,
      address: 'addr', status: 'LIVE', licence_number: `L-${tag}`, licence_expiry: new Date(Date.now() + 365 * 86_400_000), licence_verified: true,
    },
  });
  const trip = await prisma.trip.create({
    data: {
      vendor_id: vendor.id, stretch_id: stretch.id, title: `IT trip ${tag}`, description: 'integration test trip', duration_minutes: 90,
      meeting_point: 'Gate', raft_capacity: opts.capacity, per_seat_price_paise: 80_000n,
      private_raft_price_paise: opts.privatePricePaise === undefined ? 500_000n : opts.privatePricePaise, status: 'LIVE',
    },
  });
  const start = new Date(Date.now() + (opts.startInHours ?? 72) * 3_600_000);
  const slot = await prisma.slot.create({
    data: {
      trip_id: trip.id, start_time: start, end_time: new Date(start.getTime() + 90 * 60_000),
      total_rafts: opts.rafts, raft_capacity: opts.capacity, total_seats: opts.rafts * opts.capacity,
    },
  });
  await prisma.vendorCommission.create({
    data: { vendor_id: vendor.id, commission_bps: 1000, effective_from: new Date(Date.now() - 86_400_000), set_by_admin: admin.id },
  });
  return { tag, admin, stretch, vendor, trip, slot };
}

export async function createUsers(prisma: PrismaService, n: number, tag: string) {
  const base = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
  const users = [];
  for (let i = 0; i < n; i++) {
    users.push(
      await prisma.user.create({
        data: { firebase_uid: `it_${tag}_${i}`, phone: `+91${base}${String(i).padStart(2, '0')}` },
      }),
    );
  }
  return users;
}

export function bookingDto(slotId: string, seats: number, mode: 'SHARED' | 'PRIVATE' = 'SHARED', key = randomUUID()) {
  return {
    slot_id: slotId,
    mode,
    seat_count: seats,
    guests: Array.from({ length: seats }, (_, i) => ({ name: `Guest ${i + 1}`, age: 25 })),
    safety_declaration_version: 'v1.0',
    idempotency_key: key,
  };
}

export function errorCode(reason: unknown): string {
  const r = reason as { getResponse?: () => any; code?: string; message?: string };
  return r?.getResponse?.()?.error?.code ?? r?.code ?? r?.message ?? 'UNKNOWN';
}
