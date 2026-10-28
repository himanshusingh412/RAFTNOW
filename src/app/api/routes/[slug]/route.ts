import { z } from "zod";
import { route, ok, unwrap, parseParams, HttpError } from "@/lib/http";
import { userClient } from "@/lib/supabase/server";

const slug = z.object({ slug: z.string().regex(/^[a-z0-9-]{1,60}$/) });

// One route with its rapids (in river order) and the extras on offer.
export const GET = route(async (_req: Request, ctx: { params: Promise<{ slug: string }> }) => {
  const p = parseParams(await ctx.params, slug);
  const supabase = await userClient();
  const r = unwrap(
    await supabase
      .from("routes")
      .select(
        "id, slug, name, put_in, take_out, category, distance_km_min, distance_km_max, water_minutes_min, water_minutes_max, grade, min_age, max_age, price_paise, route_rapids(position, rapids(name, grade, description))",
      )
      .eq("slug", p.slug)
      .eq("is_active", true)
      .maybeSingle(),
  );
  if (!r) throw new HttpError(404, "not_found", "Route not found.");
  const addons = unwrap(
    await supabase.from("addons").select("code, name, price_paise, per").eq("is_active", true).or(`route_id.is.null,route_id.eq.${r.id}`),
  );
  const rapids = [...(r.route_rapids ?? [])].sort((a, b) => a.position - b.position);
  return ok({ ...r, route_rapids: rapids, addons });
});
