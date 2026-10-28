import { z } from "zod";
import { route, ok, unwrap, parseParams, requireUser } from "@/lib/http";
import { uuid } from "@/lib/validation";

const params = z.object({ id: uuid });

// What cancelling right now would refund. Same function the cancel itself uses.
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = parseParams(await ctx.params, params);
  const { supabase } = await requireUser();
  const q = unwrap(await supabase.rpc("refund_quote", { p_booking: id }).single());
  return ok(q);
});
