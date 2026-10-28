import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
// The official SDK's own checkers, used as an independent reference for ours
import { validatePaymentVerification, validateWebhookSignature } from "razorpay/dist/utils/razorpay-utils";
import { verifyCheckoutSignature, verifyWebhookSignature } from "@/lib/razorpay";

const secret = "test_secret_123";

describe("checkout signature", () => {
  const order = "order_ABC123";
  const pay = "pay_XYZ789";
  const good = createHmac("sha256", secret).update(`${order}|${pay}`).digest("hex");

  it("agrees with the Razorpay SDK on a valid signature", () => {
    expect(validatePaymentVerification({ order_id: order, payment_id: pay }, good, secret)).toBe(true);
    expect(verifyCheckoutSignature(order, pay, good, secret)).toBe(true);
  });

  it("rejects a tampered payment id, a wrong secret and junk", () => {
    expect(verifyCheckoutSignature(order, "pay_OTHER", good, secret)).toBe(false);
    expect(verifyCheckoutSignature(order, pay, good, "other_secret")).toBe(false);
    expect(verifyCheckoutSignature(order, pay, "", secret)).toBe(false);
    expect(verifyCheckoutSignature(order, pay, "zz-not-hex", secret)).toBe(false);
    expect(verifyCheckoutSignature(order, pay, good.slice(0, 40), secret)).toBe(false);
  });
});

describe("webhook signature", () => {
  const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_1", amount: 139900 } } } });
  const sig = createHmac("sha256", secret).update(body).digest("hex");

  it("agrees with the Razorpay SDK", () => {
    expect(validateWebhookSignature(body, sig, secret)).toBe(true);
    expect(verifyWebhookSignature(body, sig, secret)).toBe(true);
  });

  it("fails if a single byte of the raw body changes (e.g. re-serialised JSON)", () => {
    const reformatted = JSON.stringify(JSON.parse(body), null, 2);
    expect(validateWebhookSignature(reformatted, sig, secret)).toBe(false);
    expect(verifyWebhookSignature(reformatted, sig, secret)).toBe(false);
    expect(verifyWebhookSignature(body.replace("139900", "1"), sig, secret)).toBe(false);
  });
});
