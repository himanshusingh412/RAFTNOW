import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "c".repeat(32);
vi.mock("@/lib/env", () => ({ env: () => ({ CRON_SECRET: SECRET }) }));
const runTick = vi.fn(async () => ({ expired: 0 }));
vi.mock("@/lib/jobs", () => ({ runTick }));

const { GET } = await import("@/app/api/cron/tick/route");
const tick = (authorization?: string) =>
  GET(new Request("http://x/api/cron/tick", { headers: authorization ? { authorization } : {} }));

beforeEach(() => {
  runTick.mockClear();
});

describe("GET /api/cron/tick", () => {
  it("refuses a call without the right secret and runs nothing", async () => {
    expect((await tick()).status).toBe(401);
    expect((await tick(`Bearer ${"x".repeat(32)}`)).status).toBe(401);
    expect(runTick).not.toHaveBeenCalled();
  });

  it("runs the jobs for the bearer token Vercel Cron sends", async () => {
    expect((await tick(`Bearer ${SECRET}`)).status).toBe(200);
    expect(runTick).toHaveBeenCalledTimes(1);
  });
});
