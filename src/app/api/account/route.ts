import { route, ok, requireUser, unwrap, HttpError } from "@/lib/http";
import { adminClient } from "@/lib/supabase/admin";

// GET: my profile. DELETE: delete my account for real.
export const GET = route(async () => {
  const { supabase, user } = await requireUser();
  const profile = unwrap(await supabase.from("profiles").select("id, full_name, email, phone, role").eq("id", user.id).single());
  return ok(profile);
});

// Personal data on past bookings is scrubbed; the anonymised payment records stay because
// tax law requires them. Upcoming trips must be cancelled first (the database refuses otherwise).
export const DELETE = route(async () => {
  const { supabase, user } = await requireUser();
  unwrap(await supabase.rpc("scrub_my_data"));
  const { error } = await adminClient().auth.admin.deleteUser(user.id);
  if (error) throw new HttpError(500, "delete_failed", "Couldn't delete the account. Please contact support.");
  await supabase.auth.signOut({ scope: "global" });
  return ok({ deleted: true });
});
