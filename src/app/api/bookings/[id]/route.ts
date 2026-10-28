import { z } from "zod";
import { route, ok, unwrap, parseParams, requireUser, HttpError } from "@/lib/http";
import { uuid } from "@/lib/validation";

const params = z.object({ id: uuid });

// One booking. Row level security decides who sees it: the booker, its operator, admins.
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = parseParams(await ctx.params, params);
  const { supabase } = await requireUser();
  const b = unwrap(
    await supabase
      .from("bookings")
      .select(
        "id, reference, status, group_size, addons, subtotal_paise, addons_paise, gst_paise, total_paise, assignment_status, hold_expires_at, cancelled_at, cancel_reason, created_at, routes(name, slug, put_in, take_out), slots(starts_at), participants(full_name, age), payments(status, method, amount_paise, amount_refunded_paise), refunds(amount_paise, status, reason)",
      )
      .eq("id", id)
      .maybeSingle(),
  );
  if (!b) throw new HttpError(404, "booking_not_found", "Booking not found.");
  return ok(b);
});
