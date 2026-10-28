import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Service-role client. Bypasses row level security, so it is only used for work no
 * user does directly: webhooks, the cron job runner, attaching Razorpay orders,
 * deleting auth users. Never import this into anything that runs in the browser.
 */
export function adminClient() {
  const e = env();
  return createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
