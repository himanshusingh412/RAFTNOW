import { route, ok, unwrap, parseJson, requireUser } from "@/lib/http";
import { closure } from "@/lib/validation";

// Admin: close a route (or the whole river with routeId null). Affected trips are cancelled
// with full refunds and the rafters are emailed, all in one transaction.
export const POST = route(async (req: Request) => {
  const { supabase } = await requireUser();
  const b = await parseJson(req, closure);
  const n = unwrap(
    await supabase.rpc("close_river", { p_route: b.routeId, p_from: b.from, p_to: b.to, p_reason: b.reason, p_note: b.note ?? null }),
  );
  return ok({ cancelledBookings: n }, 201);
});
