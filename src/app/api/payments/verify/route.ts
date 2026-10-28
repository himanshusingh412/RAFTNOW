import { route, parseJson, ok, requireUser, unwrap, HttpError } from "@/lib/http";
import { verifyPayment } from "@/lib/validation";
import { verifyCheckoutSignature, fetchPayment } from "@/lib/razorpay";
import { adminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";

/**
 * The browser posts Razorpay Checkout's success payload here. We check the signature,
 * then ask Razorpay itself for the payment (status and amount) instead of trusting the
 * browser. The webhook confirms the same payment too; whichever arrives first wins and
 * the other is a no-op.
 */
export const POST = route(async (req: Request) => {
  const { supabase } = await requireUser();
  const body = await parseJson(req, verifyPayment);

  if (!verifyCheckoutSignature(body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature, env().RAZORPAY_KEY_SECRET)) {
    throw new HttpError(400, "bad_signature", "Payment could not be verified.");
  }

  // RLS: only the payer can see this payment row
  const mine = unwrap(
    await supabase.from("payments").select("booking_id").eq("provider_order_id", body.razorpay_order_id).maybeSingle(),
  );
  if (!mine) throw new HttpError(404, "booking_not_found", "Booking not found.");

  const p = await fetchPayment(body.razorpay_payment_id);
  if (p.orderId !== body.razorpay_order_id) throw new HttpError(400, "bad_signature", "Payment could not be verified.");
  if (p.status === "authorized") return ok({ bookingId: mine.booking_id, status: "processing" }, 202);
  if (p.status !== "captured") throw new HttpError(402, "payment_not_captured", "The payment didn't go through.");

  const outcome = unwrap(
    await adminClient().rpc("confirm_payment", {
      p_order_id: body.razorpay_order_id,
      p_payment_id: p.id,
      p_amount_paise: p.amount,
      p_method: p.method ?? null,
    }),
  ) as string;
  return ok({ bookingId: mine.booking_id, status: outcome === "refund_queued" ? "refund_queued" : "confirmed" });
});
