import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: () => ({ RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "secret" }) }));

// A tiny fake of the Razorpay SDK: lists the refunds already on a payment and records new ones.
const existing: { id: string; receipt: string; status: string }[] = [];
const created: unknown[] = [];
vi.mock("razorpay", () => ({
  default: class {
    payments = {
      fetchMultipleRefund: async () => ({ items: existing }),
      refund: async (_paymentId: string, body: unknown) => {
        created.push(body);
        return { id: "rfnd_new", status: "processed" };
      },
    };
  },
}));

const { refundOnce } = await import("@/lib/razorpay");

beforeEach(() => {
  existing.length = 0;
  created.length = 0;
});

describe("refundOnce", () => {
  it("creates the refund with our idempotency key as the receipt", async () => {
    expect(await refundOnce("pay_1", 139900, "cancel:b1")).toEqual({ id: "rfnd_new", processed: true });
    expect(created).toEqual([{ amount: 139900, speed: "normal", receipt: "cancel:b1", notes: { reason: "cancel" } }]);
  });

  it("a retry after a crash finds the earlier refund instead of refunding twice", async () => {
    existing.push({ id: "rfnd_1", receipt: "cancel:b1", status: "pending" });
    expect(await refundOnce("pay_1", 139900, "cancel:b1")).toEqual({ id: "rfnd_1", processed: false });
    expect(created).toHaveLength(0);
  });

  it("tries again when Razorpay failed the earlier refund", async () => {
    existing.push({ id: "rfnd_1", receipt: "cancel:b1", status: "failed" });
    await refundOnce("pay_1", 139900, "cancel:b1");
    expect(created).toHaveLength(1);
  });
});
