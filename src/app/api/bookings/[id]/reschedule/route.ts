import { z } from "zod";
import { route, ok, must, parseParams, parseJson, requireUser } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { uuid, reschedule } from "@/lib/validation";

const params = z.object({ id: uuid });

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = parseParams(await ctx.params, params);
  const { supabase, user } = await requireUser();
  await rateLimit("cancel", user.id);
  const { slotId } = await parseJson(req, reschedule);
  const b = must(await supabase.rpc("reschedule_booking", { p_booking: id, p_new_slot: slotId }).single<{ id: string; slot_id: string; status: string }>());
  return ok({ id: b.id, slotId: b.slot_id, status: b.status });
});
