import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/razorpay", () => ({ refundOnce: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));

// The service-role client: every job finds nothing to do, and ops_email is whatever the test sets.
let opsEmail: string | null = "ops@example.com";
const calls: string[] = [];
vi.mock("@/lib/supabase/admin", () => ({
  adminClient: () => ({
    rpc: async (fn: string) => {
      calls.push(fn);
      if (fn === "setting_text") return { data: opsEmail, error: null };
      return { data: fn.startsWith("claim_") ? [] : 0, error: null };
    },
  }),
}));

const { runTick } = await import("@/lib/jobs");

beforeEach(() => {
  opsEmail = "ops@example.com";
  calls.length = 0;
});

describe("runTick", () => {
  it("runs every job when ops alerts have somewhere to go", async () => {
    await expect(runTick()).resolves.toMatchObject({ expired: 0, refunds: 0, emails: 0 });
  });

  it("still runs the jobs, then fails loudly while ops_email is blank (ops alerts would be dropped)", async () => {
    opsEmail = "";
    await expect(runTick()).rejects.toThrow(/ops_email/);
    expect(calls).toEqual(expect.arrayContaining(["expire_holds", "queue_reminders", "claim_refunds", "claim_notifications"]));
  });
});
