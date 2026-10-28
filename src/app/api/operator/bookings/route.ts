import { route, ok, must, requireUser, HttpError } from "@/lib/http";
import { isoDate } from "@/lib/validation";

// Trips offered to or accepted by my operator, for one IST day (?date=YYYY-MM-DD).
// RLS limits rows to operators I'm a member of; names appear only on accepted trips.
export const GET = route(async (req: Request) => {
  const { supabase, user } = await requireUser();
  const date = isoDate.safeParse(new URL(req.url).searchParams.get("date"));
  if (!date.success) throw new HttpError(422, "invalid_input", "date must be YYYY-MM-DD");

  const memberships = must(await supabase.from("operator_members").select("operator_id").eq("user_id", user.id));
  if (memberships.length === 0) throw new HttpError(403, "forbidden", "You're not part of an operator.");

  const start = new Date(`${date.data}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  const rows = must(
    await supabase
      .from("bookings")
      .select("id, reference, status, group_size, assignment_status, addons, routes(name), slots!inner(starts_at), participants(full_name, age, phone, health_notes), checkpoints(seq, scanned_at, in_zone)")
      .in("operator_id", memberships.map((m) => m.operator_id))
      .in("status", ["confirmed", "completed"])
      .gte("slots.starts_at", start.toISOString())
      .lt("slots.starts_at", end.toISOString()),
  );
  return ok(rows);
});
