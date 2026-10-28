import { z } from "zod";
import { route, ok, must, parseParams, parseJson, requireUser } from "@/lib/http";
import { uuid, checkpoint } from "@/lib/validation";

const params = z.object({ id: uuid });

// A QR checkpoint scan (1 put-in, 2 mid-river, 3 take-out) with the phone's GPS position.
// The database checks order, the trip-day window and the geofence; scan 3 completes the trip.
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = parseParams(await ctx.params, params);
  const { supabase } = await requireUser();
  const { seq, lat, lng } = await parseJson(req, checkpoint);
  const c = must(
    await supabase.rpc("record_checkpoint", { p_booking: id, p_seq: seq, p_lat: lat, p_lng: lng })
      .single<{ seq: number; in_zone: boolean; distance_m: number; scanned_at: string }>(),
  );
  return ok({ seq: c.seq, inZone: c.in_zone, distanceM: c.distance_m, scannedAt: c.scanned_at }, 201);
});
