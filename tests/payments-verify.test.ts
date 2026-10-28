import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

const SECRET = "key_secret_test";
vi.mock("@/lib/env", () => ({ env: () => ({ RAZORPAY_KEY_SECRET: SECRET }) }));

// The signed-in user's client. Row level security shows the payment row only to its payer.
let mine: { booking_id: string } | null = null;
vi.mock("@/lib/supabase/server", () => ({
  userClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user_1" } }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mine, error: null }) }) }) }),
  }),
}));

// What Razorpay says about the payment, and what confirm_payment answers.
const captured = { id: "pay_1", orderId: "order_1", status: "captured", amount: 139900, method: "upi" };
let payment = { ...captured };
let outcome = "confirmed";
const calls: { fn: string; args: unknown }[] = [];
vi.mock("@/lib/supabase/admin", () => ({
  adminClient: () => ({
    rpc: async (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return { data: outcome, error: null };
    },
  }),
}));
vi.mock("@/lib/razorpay", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/razorpay")>()),
  fetchPayment: async () => payment,
}));

const { POST } = await import("@/app/api/payments/verify/route");

function verify(overrides: Record<string, string> = {}) {
  const body = {
    razorpay_order_id: "order_1",
    razorpay_payment_id: "pay_1",
    razorpay_signature: createHmac("sha256", SECRET).update("order_1|pay_1").digest("hex"),
    ...overrides,
  };
  return POST(new Request("http://x/api/payments/verify", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  mine = { booking_id: "b1" };
  payment = { ...captured };
  outcome = "confirmed";
  calls.length = 0;
});

describe("POST /api/payments/verify", () => {
  it("refuses a bad Checkout signature", async () => {
    expect((await verify({ razorpay_signature: "0".repeat(64) })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("refuses an order that isn't the user's", async () => {
    mine = null;
    expect((await verify()).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("refuses a payment Razorpay files under a different order", async () => {
    payment = { ...captured, orderId: "order_other" };
    expect((await verify()).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("does not confirm a payment that is only authorized yet", async () => {
    payment = { ...captured, status: "authorized" };
    const res = await verify();
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ bookingId: "b1", status: "processing" });
    expect(calls).toHaveLength(0);
  });

  it("refuses a payment that didn't go through", async () => {
    payment = { ...captured, status: "failed" };
    expect((await verify()).status).toBe(402);
    expect(calls).toHaveLength(0);
  });

  it("confirms with the amount Razorpay reports", async () => {
    const res = await verify();
    expect(await res.json()).toEqual({ bookingId: "b1", status: "confirmed" });
    expect(calls).toEqual([
      { fn: "confirm_payment", args: { p_order_id: "order_1", p_payment_id: "pay_1", p_amount_paise: 139900, p_method: "upi" } },
    ]);
  });

  it("tells the browser about a refund when the booking couldn't stand", async () => {
    outcome = "refund_queued";
    expect(await (await verify()).json()).toEqual({ bookingId: "b1", status: "refund_queued" });
  });
});
