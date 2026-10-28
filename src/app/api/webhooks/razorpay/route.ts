import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/razorpay";
import { adminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";

type PaymentEntity = { id: string; order_id: string; amount: number; method?: string; error_description?: string };
type RefundEntity = { id: string; payment_id: string; receipt?: string | null };
type RazorpayEvent = {
  event: string;
  payload: { payment?: { entity: PaymentEntity }; refund?: { entity: RefundEntity } };
};

/**
 * Razorpay webhooks. Signature checked on the raw body. Each event is stored by its
 * x-razorpay-event-id; an event already processed is acknowledged and skipped, so
 * Razorpay's retries never double-apply anything. A handler error returns 500 so
 * Razorpay retries it later.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get("x-razorpay-signature") ?? "";
  if (!verifyWebhookSignature(raw, signature, env().RAZORPAY_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "bad_signature" }, { status: 400 });
  }

  let evt: RazorpayEvent;
  try {
    evt = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const db = adminClient();
  const eventId = req.headers.get("x-razorpay-event-id") ?? `sha256:${createHash("sha256").update(raw).digest("hex")}`;
  await db.from("webhook_events").upsert(
    { id: eventId, provider: "razorpay", event_type: evt.event, payload: evt },
    { onConflict: "id", ignoreDuplicates: true },
  );
  const { data: seen } = await db.from("webhook_events").select("processed_at").eq("id", eventId).single();
  if (seen?.processed_at) return NextResponse.json({ duplicate: true });

  try {
    await handle(db, evt);
    await db.from("webhook_events").update({ processed_at: new Date().toISOString(), error: null }).eq("id", eventId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.from("webhook_events").update({ error: msg.slice(0, 1000) }).eq("id", eventId);
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }
}

async function handle(db: ReturnType<typeof adminClient>, evt: RazorpayEvent) {
  const payment = evt.payload.payment?.entity;
  const refund = evt.payload.refund?.entity;

  switch (evt.event) {
    case "payment.captured":
    case "order.paid": {
      if (!payment?.order_id) return;
      const { error } = await db.rpc("confirm_payment", {
        p_order_id: payment.order_id,
        p_payment_id: payment.id,
        p_amount_paise: payment.amount,
        p_method: payment.method ?? null,
      });
      if (error && error.message !== "unknown_order") throw new Error(error.message); // unknown = not one of ours
      return;
    }
    case "payment.failed": {
      if (!payment?.order_id) return;
      const { error } = await db.rpc("payment_failed", { p_order_id: payment.order_id, p_reason: payment.error_description ?? "failed" });
      if (error) throw new Error(error.message);
      return;
    }
    case "refund.processed": {
      if (!refund) return;
      const { error } = await db.rpc("refund_processed", { p_provider_refund_id: refund.id, p_receipt: refund.receipt ?? null });
      if (error) throw new Error(error.message);
      return;
    }
    case "refund.failed": {
      if (!refund) return;
      let { data: row } = await db.from("refunds").select("id").eq("provider_refund_id", refund.id).maybeSingle();
      if (!row && refund.receipt) {
        ({ data: row } = await db.from("refunds").select("id").eq("idempotency_key", refund.receipt).maybeSingle());
      }
      if (row) await db.rpc("refund_error", { p_refund: row.id, p_error: "razorpay reported refund.failed" });
      return;
    }
    default:
      return; // other events are acknowledged and ignored
  }
}
