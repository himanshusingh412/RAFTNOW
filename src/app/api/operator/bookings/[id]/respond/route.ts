import { z } from "zod";
import { route, ok, must, parseParams, parseJson, requireUser } from "@/lib/http";
import { uuid, respond } from "@/lib/validation";

const params = z.object({ id: uuid });

// Accept or decline a trip offer. Declining passes it to the next operator in rotation.
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = parseParams(await ctx.params, params);
  const { supabase } = await requireUser();
  const { accept } = await parseJson(req, respond);
  const b = must(await supabase.rpc("operator_respond", { p_booking: id, p_accept: accept }).single<{ id: string; assignment_status: string }>());
  return ok({ id: b.id, assignmentStatus: accept ? b.assignment_status : "declined" });
});
