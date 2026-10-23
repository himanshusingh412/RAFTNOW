/**
 * LOCAL DEVELOPMENT ONLY: marks a PENDING_PAYMENT booking as paid by feeding a
 * synthetic `payment.captured` through the real WebhooksService, exactly as the
 * integration tests do. Lets you test tickets, check-in and cancellation
 * without Razorpay keys. Refuses to run when APP_ENV=production.
 *
 *   DATABASE_URL_TEST=$DATABASE_URL npx ts-node --transpile-only scripts/dev-simulate-payment.ts <booking-id>
 */
import { createHarness } from '../src/__tests__/integration/harness';
import { WebhooksService } from '../src/webhooks/webhooks.service';

async function main() {
  if (process.env.APP_ENV === 'production') throw new Error('Refusing to simulate payments in production');
  const bookingId = process.argv[2];
  if (!bookingId) throw new Error('usage: dev-simulate-payment.ts <booking-id>');
  const h = await createHarness();
  const webhooks = new WebhooksService(h.prisma, h.bookings, h.refunds, h.notifications, h.audit);
  const b = await h.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  const tag = `dev_${Date.now()}`;
  await h.prisma.payment.create({ data: { booking_id: b.id, razorpay_order_id: `order_${tag}`, amount_paise: b.amount_paise, status: 'CREATED' } });
  await webhooks.handleCapturedPayment({ id: `pay_${tag}`, order_id: `order_${tag}`, amount: Number(b.amount_paise), currency: 'INR' });
  const after = await h.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  console.log(`RF${after.booking_code} → ${after.status}`);
  await h.prisma.$disconnect();
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
