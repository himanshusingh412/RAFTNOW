import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { refundOnce } from "@/lib/razorpay";
import { sendEmail } from "@/lib/email";

type Refund = { id: string; payment_id: string; amount_paise: number; idempotency_key: string };
type Notification = { id: string; to_address: string; template: string; payload: Record<string, unknown> };

/**
 * One pass of every time-based job. Called each minute by /api/cron/tick.
 * Each claim leases its rows (next_attempt_at moves forward), so overlapping runs
 * never pick the same row, and a crashed run's rows are retried later with backoff.
 */
export async function runTick() {
  const db = adminClient();
  const result = { expired: 0, reminders: 0, refunds: 0, refundErrors: 0, emails: 0, emailErrors: 0 };

  const expired = await db.rpc("expire_holds");
  if (expired.error) throw new Error(`expire_holds: ${expired.error.message}`);
  result.expired = expired.data ?? 0;

  const reminders = await db.rpc("queue_reminders");
  if (reminders.error) throw new Error(`queue_reminders: ${reminders.error.message}`);
  result.reminders = reminders.data ?? 0;

  const refunds = await db.rpc("claim_refunds", { p_limit: 20 });
  if (refunds.error) throw new Error(`claim_refunds: ${refunds.error.message}`);
  for (const r of (refunds.data ?? []) as Refund[]) {
    try {
      const { data: pay, error } = await db.from("payments").select("provider_payment_id").eq("id", r.payment_id).single();
      if (error || !pay?.provider_payment_id) throw new Error("payment has no Razorpay id");
      const out = await refundOnce(pay.provider_payment_id, r.amount_paise, r.idempotency_key);
      await db.rpc("refund_submitted", { p_refund: r.id, p_provider_refund_id: out.id, p_processed: out.processed });
      result.refunds++;
    } catch (e) {
      await db.rpc("refund_error", { p_refund: r.id, p_error: e instanceof Error ? e.message : String(e) });
      result.refundErrors++;
    }
  }

  const notes = await db.rpc("claim_notifications", { p_limit: 50 });
  if (notes.error) throw new Error(`claim_notifications: ${notes.error.message}`);
  for (const n of (notes.data ?? []) as Notification[]) {
    try {
      await sendEmail(n.to_address, n.template, n.payload);
      await db.rpc("notification_result", { p_id: n.id, p_error: null });
      result.emails++;
    } catch (e) {
      await db.rpc("notification_result", { p_id: n.id, p_error: e instanceof Error ? e.message : String(e) });
      result.emailErrors++;
    }
  }

  // a blank ops_email silently drops every ops alert (no operator, dead refunds, incidents): fail the tick so it's noticed
  const ops = await db.rpc("setting_text", { p_key: "ops_email" });
  if (!ops.data) throw new Error("ops_email is not set: ops alerts are being dropped");

  return result;
}
