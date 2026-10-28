import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import Razorpay from "razorpay";
import { env } from "@/lib/env";

let client: Razorpay | undefined;
function rzp() {
  const e = env();
  client ??= new Razorpay({ key_id: e.RAZORPAY_KEY_ID, key_secret: e.RAZORPAY_KEY_SECRET });
  return client;
}

function safeEqualHex(expected: string, given: string) {
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(given, "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/** Checkout's handler returns this signature: HMAC-SHA256(order_id|payment_id, key_secret). */
export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string, secret: string) {
  const expected = createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
  return safeEqualHex(expected, signature);
}

/** Webhooks: HMAC-SHA256 of the RAW body with the webhook secret, in X-Razorpay-Signature. */
export function verifyWebhookSignature(rawBody: string, signature: string, secret: string) {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqualHex(expected, signature);
}

export async function createOrder(amountPaise: number, bookingReference: string, bookingId: string) {
  const order = await rzp().orders.create({
    amount: amountPaise,
    currency: "INR",
    receipt: bookingReference,
    notes: { booking_id: bookingId },
  });
  return { id: order.id, amount: Number(order.amount) };
}

export async function fetchPayment(paymentId: string) {
  const p = await rzp().payments.fetch(paymentId);
  return { id: p.id, orderId: p.order_id, status: p.status, amount: Number(p.amount), method: p.method };
}

/**
 * Refund with our own idempotency: Razorpay has no idempotency header for refunds, so we
 * put our key in `receipt` and look for an existing refund with that receipt first.
 * A job retried after a crash therefore never refunds twice.
 */
export async function refundOnce(paymentId: string, amountPaise: number, receipt: string) {
  const existing = await rzp().payments.fetchMultipleRefund(paymentId, { count: 100 });
  const found = existing.items.find((r) => r.receipt === receipt && r.status !== "failed");
  const refund =
    found ??
    (await rzp().payments.refund(paymentId, {
      amount: amountPaise,
      speed: "normal",
      receipt,
      notes: { reason: receipt.split(":")[0] },
    }));
  return { id: refund.id, processed: refund.status === "processed" };
}
