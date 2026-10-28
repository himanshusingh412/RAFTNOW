import { z } from "zod";
import { route, ok, must, parseParams, parseJson, requireUser } from "@/lib/http";
import { uuid, verification } from "@/lib/validation";

const params = z.object({ id: uuid });

// Admin: record the seasonal 8-point check. Pass = verified (in rotation); fail = suspended.
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = parseParams(await ctx.params, params);
  const { supabase } = await requireUser();
  const b = await parseJson(req, verification);
  const v = must(
    await supabase.rpc("verify_operator", {
      p_operator: id, p_season: b.season, p_checks: b.checks, p_permit_number: b.permitNumber,
      p_permit_expires_on: b.permitExpiresOn, p_notes: b.notes ?? null,
    }).single<{ id: string; result: string }>(),
  );
  return ok({ id: v.id, result: v.result }, 201);
});
