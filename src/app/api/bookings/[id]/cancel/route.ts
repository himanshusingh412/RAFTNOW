import { z } from "zod";
import { route, ok, unwrap, parseParams, requireUser } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { uuid } from "@/lib/validation";

const params = z.object({ id: uuid });

// Cancel: seats released and the refund queued in one transaction; the cron job sends it to Razorpay.
export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = parseParams(await ctx.params, params);
  const { supabase, user } = await requireUser();
  await rateLimit("cancel", user.id);
  const r = unwrap(await supabase.rpc("cancel_booking", { p_booking: id }).single());
  return ok(r);
});
