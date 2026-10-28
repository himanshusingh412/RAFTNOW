import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

const SECRET = "whsec_test_123456";
vi.mock("@/lib/env", () => ({ env: () => ({ RAZORPAY_WEBHOOK_SECRET: SECRET }) }));

// A tiny fake of the service-role Supabase client: records RPC calls and stores webhook_events rows.
const calls: { fn: string; args: unknown }[] = [];
const events = new Map<string, { processed_at: string | null; error?: string | null }>();
const stored: object[] = [];
const refundRows = new Map<string, { id: string }>(); // refunds rows, found by the value the route filters on
let rpcError: string | null = null;

vi.mock("@/lib/supabase/admin", () => ({
  adminClient: () => ({
    rpc: async (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return { data: null, error: rpcError ? { message: rpcError } : null };
    },
    from: () => {
      let id = "";
      const api = {
        upsert: async (row: { id: string }) => {
          stored.push(row);
          if (!events.has(row.id)) events.set(row.id, { processed_at: null });
          return { error: null };
        },
        select: () => api,
        update: (patch: { processed_at?: string; error?: string | null }) => ({
          eq: async (_c: string, v: string) => {
            events.set(v, { ...events.get(v)!, ...patch });
            return { error: null };
          },
        }),
        eq: (_c: string, v: string) => ((id = v), api),
        single: async () => ({ data: events.get(id) ?? null, error: null }),
        maybeSingle: async () => ({ data: refundRows.get(id) ?? null, error: null }),
      };
      return api;
    },
  }),
}));

const { POST } = await import("@/app/api/webhooks/razorpay/route");

function request(body: object, opts: { sig?: string; id?: string } = {}) {
  const raw = JSON.stringify(body);
  const sig = opts.sig ?? createHmac("sha256", SECRET).update(raw).digest("hex");
  return new Request("http://x/api/webhooks/razorpay", {
    method: "POST",
    body: raw,
    headers: { "x-razorpay-signature": sig, ...(opts.id ? { "x-razorpay-event-id": opts.id } : {}) },
  });
}

const captured = {
  event: "payment.captured",
  payload: { payment: { entity: { id: "pay_1", order_id: "order_1", amount: 139900, method: "upi" } } },
};

beforeEach(() => {
  calls.length = 0;
  events.clear();
  stored.length = 0;
  refundRows.clear();
  rpcError = null;
});

describe("razorpay webhook", () => {
  it("rejects a bad signature without touching the database", async () => {
    const res = await POST(request(captured, { sig: "0".repeat(64) }));
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("confirms the payment with the amount from the event", async () => {
    const res = await POST(request(captured, { id: "evt_1" }));
    expect(res.status).toBe(200);
    expect(calls).toEqual([
      { fn: "confirm_payment", args: { p_order_id: "order_1", p_payment_id: "pay_1", p_amount_paise: 139900, p_method: "upi" } },
    ]);
    expect(events.get("evt_1")?.processed_at).toBeTruthy();
  });

  it("skips an event it already processed (Razorpay retries)", async () => {
    await POST(request(captured, { id: "evt_2" }));
    const again = await POST(request(captured, { id: "evt_2" }));
    expect(await again.json()).toEqual({ duplicate: true });
    expect(calls).toHaveLength(1);
  });

  it("returns 500 on a handler error so Razorpay retries, and retries are processed", async () => {
    rpcError = "connection reset";
    expect((await POST(request(captured, { id: "evt_3" }))).status).toBe(500);
    rpcError = null;
    expect((await POST(request(captured, { id: "evt_3" }))).status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it("ignores orders that aren't ours", async () => {
    rpcError = "unknown_order";
    expect((await POST(request(captured, { id: "evt_4" }))).status).toBe(200);
  });

  it("records processed refunds by Razorpay id and our receipt", async () => {
    await POST(request({ event: "refund.processed", payload: { refund: { entity: { id: "rfnd_1", payment_id: "pay_1", receipt: "cancel:abc" } } } }, { id: "evt_5" }));
    expect(calls).toEqual([{ fn: "refund_processed", args: { p_provider_refund_id: "rfnd_1", p_receipt: "cancel:abc" } }]);
  });

  it("stores no personal data from the event (account deletion never reaches webhook_events)", async () => {
    const entity = { ...captured.payload.payment.entity, email: "ravi@example.com", contact: "+919876543210" };
    await POST(request({ ...captured, payload: { payment: { entity } } }, { id: "evt_6" }));
    expect(JSON.stringify(stored)).not.toMatch(/ravi@example\.com|9876543210/);
    expect(JSON.stringify(stored)).toContain("pay_1");
  });

  it("puts a refund Razorpay reports failed back in the retry queue, found by our receipt", async () => {
    refundRows.set("cancel:abc", { id: "refund_row_1" });
    const failed = { event: "refund.failed", payload: { refund: { entity: { id: "rfnd_9", payment_id: "pay_1", receipt: "cancel:abc" } } } };
    expect((await POST(request(failed, { id: "evt_7" }))).status).toBe(200);
    expect(calls).toEqual([{ fn: "refund_error", args: { p_refund: "refund_row_1", p_error: "razorpay reported refund.failed" } }]);
  });
});
