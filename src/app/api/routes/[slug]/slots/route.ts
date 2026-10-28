import { z } from "zod";
import { route, ok, unwrap, must, parseParams, HttpError } from "@/lib/http";
import { isoDate } from "@/lib/validation";
import { userClient } from "@/lib/supabase/server";

const params = z.object({ slug: z.string().regex(/^[a-z0-9-]{1,60}$/) });

// Open trip times for one IST calendar day: ?date=YYYY-MM-DD
export const GET = route(async (req: Request, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = parseParams(await ctx.params, params);
  const date = isoDate.safeParse(new URL(req.url).searchParams.get("date"));
  if (!date.success) throw new HttpError(422, "invalid_input", "date must be YYYY-MM-DD");

  // the IST day as a UTC range: 00:00 IST = previous day 18:30 UTC
  const start = new Date(`${date.data}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);

  const supabase = await userClient();
  const r = unwrap(await supabase.from("routes").select("id").eq("slug", slug).eq("is_active", true).maybeSingle());
  if (!r) throw new HttpError(404, "not_found", "Route not found.");

  const slots = must(
    await supabase
      .from("slots")
      .select("id, starts_at, capacity, seats_held, seats_booked, status")
      .eq("route_id", r.id)
      .gte("starts_at", start.toISOString())
      .lt("starts_at", end.toISOString())
      .gt("starts_at", new Date().toISOString())
      .order("starts_at"),
  );
  return ok(
    slots.map((s) => ({
      id: s.id,
      starts_at: s.starts_at,
      seats_left: s.status === "open" ? Math.max(0, s.capacity - s.seats_held - s.seats_booked) : 0,
      status: s.status,
    })),
  );
});
