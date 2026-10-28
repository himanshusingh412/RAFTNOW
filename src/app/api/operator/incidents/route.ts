import { route, ok, must, parseJson, requireUser } from "@/lib/http";
import { incident } from "@/lib/validation";

// Log an incident on one of my operator's trips. High and critical ones alert ops by email.
export const POST = route(async (req: Request) => {
  const { supabase } = await requireUser();
  const { bookingId, severity, description } = await parseJson(req, incident);
  const row = must(
    await supabase.rpc("report_incident", { p_booking: bookingId, p_severity: severity, p_description: description })
      .single<{ id: string; status: string }>(),
  );
  return ok({ id: row.id, status: row.status }, 201);
});
