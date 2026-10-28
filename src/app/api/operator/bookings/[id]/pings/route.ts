import { z } from "zod";
import { route, ok, unwrap, parseParams, parseJson, requireUser } from "@/lib/http";
import { uuid, ping } from "@/lib/validation";

const params = z.object({ id: uuid });

// GPS position from the guide's phone during the trip window.
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = parseParams(await ctx.params, params);
  const { supabase } = await requireUser();
  const { lat, lng } = await parseJson(req, ping);
  unwrap(await supabase.rpc("add_gps_ping", { p_booking: id, p_lat: lat, p_lng: lng }));
  return ok({ recorded: true }, 201);
});
