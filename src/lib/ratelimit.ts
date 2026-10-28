import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { HttpError } from "@/lib/http";

// Fixed-window limits kept in Postgres, so they hold across serverless instances.
export const LIMITS = {
  otp: { windowSeconds: 600, max: 5 }, // per email and per IP
  booking: { windowSeconds: 600, max: 10 }, // per user
  cancel: { windowSeconds: 600, max: 10 }, // per user
  trackingLink: { windowSeconds: 3600, max: 10 },
} as const;

export async function rateLimit(kind: keyof typeof LIMITS, key: string) {
  const { windowSeconds, max } = LIMITS[kind];
  const { data, error } = await adminClient().rpc("hit_rate_limit", {
    p_key: `${kind}:${key}`,
    p_window_seconds: windowSeconds,
    p_max: max,
  });
  if (error) throw new HttpError(500, "server_error", "Something went wrong.");
  if (data === false) throw new HttpError(429, "rate_limited", "Too many attempts. Please wait a few minutes.");
}
