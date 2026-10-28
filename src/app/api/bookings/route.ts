import { route, parseJson, ok, requireUser, unwrap, must, HttpError } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { createBooking } from "@/lib/validation";
import { adminClient } from "@/lib/supabase/admin";
import { createOrder } from "@/lib/razorpay";
import { env } from "@/lib/env";

// My bookings, newest first.
export const GET = route(async () => {
  const { supabase, user } = await requireUser();
  const rows = unwrap(
    await supabase
      .from("bookings")
      .select("id, reference, status, group_size, total_paise, created_at, routes(name, slug), slots(starts_at)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
  );
  return ok(rows);
});

/**
 * Hold seats and open a Razorpay order. The price is computed in the database from the
 * route row, never taken from the client. The browser then opens Razorpay Checkout with
 * the returned order id, and posts the result to /api/payments/verify.
 */
export const POST = route(async (req: Request) => {
  const { supabase, user } = await requireUser();
  await rateLimit("booking", user.id);
  const input = await parseJson(req, createBooking);

  const booking = must(
    await supabase
      .rpc("create_booking", {
        p_slot: input.slotId,
        p_participants: input.participants,
        p_addons: input.addons,
        p_contact_email: input.contactEmail ?? null,
        p_contact_phone: input.contactPhone ?? null,
      })
      .single<{ id: string; reference: string; total_paise: number; gst_paise: number; hold_expires_at: string }>(),
  );

  const admin = adminClient();
  try {
    const order = await createOrder(booking.total_paise, booking.reference, booking.id);
    unwrap(await admin.rpc("attach_order", { p_booking: booking.id, p_order_id: order.id }));
    return ok(
      {
        bookingId: booking.id,
        reference: booking.reference,
        totalPaise: booking.total_paise,
        gstPaise: booking.gst_paise,
        holdExpiresAt: booking.hold_expires_at,
        razorpay: { keyId: env().RAZORPAY_KEY_ID, orderId: order.id, amount: order.amount, currency: "INR" },
      },
      201,
    );
  } catch (e) {
    // could not open an order: give the seats back straight away rather than waiting for the hold to lapse
    await supabase.rpc("cancel_booking", { p_booking: booking.id });
    if (e instanceof HttpError) throw e;
    console.error("razorpay order failed", e instanceof Error ? e.message : "unknown");
    throw new HttpError(503, "payment_provider_unavailable", "Payments are unavailable right now. Please try again.");
  }
});
