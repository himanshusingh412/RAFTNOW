#!/usr/bin/env node
/**
 * RaftNow runtime smoke test — exercises the REAL running API over HTTP.
 *
 *   node scripts/smoke-test.mjs                       # API at http://localhost:4000
 *   API_URL=http://localhost/api/v1 node scripts/smoke-test.mjs   # through the web Nginx proxy
 *
 * Requires a seeded database and AUTH_DEV_BYPASS=true on a NON-production API
 * (developer tokens stand in for Firebase phone OTP).
 * Payment capture, webhooks, refunds and payouts are covered by the PostgreSQL
 * integration tests (apps/api/src/__tests__/integration), not by this script.
 *
 * Exits non-zero on the first failed check. Creates real rows (bookings etc.)
 * in the target database — do not point it at production.
 */
import { randomUUID } from 'node:crypto';

const API = (process.env.API_URL ?? 'http://localhost:4000/api/v1').replace(/\/$/, '');
const customer = `dev:smoke-${Date.now().toString(36)}:+9198${String(Date.now()).slice(-8)}`;
const vendor = 'dev:vendor-owner:+919876543210';
let passed = 0;

async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: res.status, json };
}

function check(name, cond, detail) {
  if (!cond) {
    console.error(`✗ ${name}${detail ? `\n  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
    process.exit(1);
  }
  passed++;
  console.log(`✓ ${name}`);
}

const istDate = (offsetDays) => new Date(Date.now() + 5.5 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);

const health = await call('GET', '/health');
check('health ok + database ok', health.status === 200 && health.json?.services?.database === 'ok', health);
check('dev auth bypass enabled (non-production)', health.json.integrations.firebase_auth === 'dev_bypass_only', health.json.integrations);

const stretches = await call('GET', '/stretches');
check('GET /stretches returns active stretches from PostgreSQL', stretches.status === 200 && Array.isArray(stretches.json) && stretches.json.length > 0, stretches);
const stretch = stretches.json.find((s) => s.live_trip_count > 0 && s.status === 'OPEN');
check('at least one OPEN stretch with a LIVE trip (seed loaded)', !!stretch, stretches.json.map((s) => [s.name, s.status, s.live_trip_count]));

let slots;
for (const d of [1, 2, 3]) {
  slots = await call('GET', `/slots?stretch_id=${stretch.id}&date=${istDate(d)}`);
  if (slots.json?.slots?.some((s) => s.bookable)) break;
}
check('GET /slots returns bookable departures', slots.status === 200 && slots.json.slots.some((s) => s.bookable), slots.json);
check('availability marked non-authoritative', slots.json.authoritative === false);
const slot = slots.json.slots.find((s) => s.bookable && s.available_shared_seats >= 2);

check('invalid slot query rejected (400)', (await call('GET', `/slots?stretch_id=nope&date=x`)).status === 400);
check('booking without auth rejected (401)', (await call('POST', '/bookings', { body: {} })).status === 401);

const key = randomUUID();
const dto = { slot_id: slot.id, mode: 'SHARED', seat_count: 2, guests: [{ name: 'Smoke One', age: 30 }, { name: 'Smoke Two', age: 31 }], safety_declaration_version: 'v1.0', idempotency_key: key };
const hold = await call('POST', '/bookings', { token: customer, body: dto });
check('POST /bookings creates a PENDING_PAYMENT hold', hold.status === 201 && hold.json.status === 'PENDING_PAYMENT', hold);
const replay = await call('POST', '/bookings', { token: customer, body: dto });
check('same idempotency key returns the same booking', replay.json?.id === hold.json.id, replay);
const after = await call('GET', `/slots/${slot.id}`);
check('availability reflects the hold', after.json.available_shared_seats === slot.available_shared_seats - 2, { before: slot.available_shared_seats, after: after.json.available_shared_seats });
const under = await call('POST', '/bookings', { token: customer, body: { ...dto, idempotency_key: randomUUID(), seat_count: 1, guests: [{ name: 'Kid', age: 5 }] } });
check('under-age guest rejected', under.json?.error?.code === 'GUEST_AGE_VIOLATION', under);
check('another customer cannot read the booking', (await call('GET', `/bookings/${hold.json.id}`, { token: `dev:other-${Date.now()}:+9197${String(Date.now()).slice(-8)}` })).status === 404);

const order = await call('POST', '/payments/order', { token: customer, body: { booking_id: hold.json.id } });
check('payment order: created, or honest PAYMENTS_NOT_CONFIGURED', order.status === 201 || order.json?.error?.code === 'PAYMENTS_NOT_CONFIGURED', order);

const scan = await call('POST', '/bookings/check-in', { token: vendor, body: { qr_token: 'x'.repeat(40) } });
check('check-in with a forged QR is rejected', scan.json?.error?.code === 'INVALID_QR', scan);
check('customer token cannot use the vendor check-in API', (await call('POST', '/bookings/check-in', { token: customer, body: { qr_token: 'x'.repeat(40) } })).status === 401);

const adminBad = await call('POST', '/admin/auth/login', { body: { email: 'no-such-admin@raftnow.test', password: 'definitely-wrong' } });
check('admin login with wrong password rejected', adminBad.status === 401, adminBad);
check('admin API requires a session', (await call('GET', '/admin/stretches')).status === 401);

const webhookUnsigned = await call('POST', '/webhooks/razorpay', { body: { event: 'payment.captured' } });
check('unsigned webhook rejected', webhookUnsigned.status === 401, webhookUnsigned);

const cancel = await call('DELETE', `/bookings/${hold.json.id}`, { token: customer });
check('customer cancels an unpaid hold (no refund owed)', cancel.status === 200 && cancel.json.status === 'CANCELLED_CUSTOMER' && Number(cancel.json.refund_paise) === 0, cancel);
const released = await call('GET', `/slots/${slot.id}`);
check('cancellation released the seats', released.json.available_shared_seats === slot.available_shared_seats, released.json);

console.log(`\n${passed} checks passed against ${API}`);
