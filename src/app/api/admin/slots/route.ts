import { route, ok, unwrap, parseJson, requireUser } from "@/lib/http";
import { generateSlots } from "@/lib/validation";

// Admin: create trip times for a date range (closed days are skipped; existing slots kept).
export const POST = route(async (req: Request) => {
  const { supabase } = await requireUser();
  const b = await parseJson(req, generateSlots);
  const n = unwrap(
    await supabase.rpc("generate_slots", {
      p_route: b.routeId, p_from: b.from, p_to: b.to, p_times: b.times, p_capacity: b.capacity ?? null,
    }),
  );
  return ok({ created: n }, 201);
});
