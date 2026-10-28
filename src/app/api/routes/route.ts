import { route, ok, unwrap } from "@/lib/http";
import { userClient } from "@/lib/supabase/server";

const FIELDS =
  "id, slug, name, put_in, take_out, category, distance_km_min, distance_km_max, water_minutes_min, water_minutes_max, grade, min_age, max_age, price_paise";

// Public list of active routes, optionally filtered: ?category=family|moderate|expert
export const GET = route(async (req: Request) => {
  const category = new URL(req.url).searchParams.get("category");
  const supabase = await userClient();
  let q = supabase.from("routes").select(`${FIELDS}, route_rapids(count)`).eq("is_active", true).order("price_paise");
  if (category && ["family", "moderate", "expert"].includes(category)) q = q.eq("category", category);
  return ok(unwrap(await q));
});
