import "server-only";
import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { userClient } from "@/lib/supabase/server";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

// Database functions raise short codes (see supabase/migrations/*_functions.sql).
// Each maps to an HTTP status and a message a person can read.
const DB_ERRORS: Record<string, [number, string]> = {
  not_signed_in: [401, "Please sign in first."],
  forbidden: [403, "You don't have access to that."],
  booking_not_found: [404, "Booking not found."],
  slot_not_found: [404, "That trip time doesn't exist."],
  operator_not_found: [404, "Operator not found."],
  slot_closed: [409, "That trip is closed. Pick another date or time."],
  not_enough_seats: [409, "Not enough seats left on that trip."],
  too_late_to_book: [409, "That trip starts too soon to book online."],
  too_late_to_reschedule: [409, "Free rescheduling has closed for this trip."],
  trip_already_started: [409, "This trip has already started."],
  booking_not_payable: [409, "This booking can't be paid for any more."],
  booking_not_cancellable: [409, "This booking can't be cancelled."],
  booking_not_reschedulable: [409, "This booking can't be rescheduled."],
  booking_not_active: [409, "This trip isn't active."],
  no_open_offer: [409, "There is no open offer for this trip."],
  has_upcoming_bookings: [409, "Cancel your upcoming trips before deleting your account."],
  outside_trip_window: [409, "Scans only work on the day of the trip."],
  checkpoint_out_of_order: [409, "Scan the checkpoints in order."],
  invalid_group_size: [422, "Group size isn't allowed for online booking."],
  invalid_participants: [422, "Participant details are missing."],
  participant_name_required: [422, "Every rafter needs a name."],
  participant_age_not_allowed: [422, "Someone in the group is outside this route's age limits."],
  health_declaration_required: [422, "Every rafter must confirm the health declaration."],
  consent_required: [422, "Every rafter must accept the safety consent."],
  addon_not_available: [422, "One of the extras isn't available on this route."],
  invalid_checklist: [422, "The verification checklist is incomplete."],
  invalid_date_range: [422, "That date range isn't valid."],
  zone_not_configured: [422, "This route has no checkpoint zones set up."],
  amount_mismatch: [400, "Payment amount doesn't match the booking."],
  unknown_order: [404, "Unknown payment order."],
};

export function dbError(err: { message?: string; hint?: string | null } | null): HttpError {
  const code = err?.message ?? "unknown";
  const known = DB_ERRORS[code];
  if (known) return new HttpError(known[0], code, err?.hint ? `${known[1]} (${err.hint})` : known[1]);
  console.error("database error", code); // no payloads in logs: they can hold personal data
  return new HttpError(500, "server_error", "Something went wrong. Please try again.");
}

/** Throws a mapped HttpError when a Supabase call failed, else returns its data (may be null). */
export function unwrap<T>(res: { data: T; error: { message: string; hint?: string | null } | null }): T {
  if (res.error) throw dbError(res.error);
  return res.data;
}

/** Like unwrap, but the data must be there (single rows, lists, RPC results). */
export function must<T>(res: { data: T; error: { message: string; hint?: string | null } | null }): NonNullable<T> {
  const data = unwrap(res);
  if (data === null || data === undefined) throw new HttpError(500, "server_error", "Something went wrong.");
  return data as NonNullable<T>;
}

export async function parseJson<T extends z.ZodTypeAny>(req: Request, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be JSON.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(422, "invalid_input", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return parsed.data;
}

export function parseParams<T extends z.ZodTypeAny>(value: unknown, schema: T): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpError(404, "not_found", "Not found.");
  return parsed.data;
}

/** Wraps a route handler: turns thrown HttpErrors into JSON responses. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      unstable_rethrow(e); // let Next.js's own control-flow errors through
      if (e instanceof HttpError) {
        return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
      }
      console.error("unhandled", e instanceof Error ? e.message : "unknown");
      return NextResponse.json({ error: "server_error", message: "Something went wrong." }, { status: 500 });
    }
  };
}

/** The signed-in user, verified with Supabase Auth (not just a cookie decode). */
export async function requireUser() {
  const supabase = await userClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new HttpError(401, "not_signed_in", "Please sign in first.");
  return { supabase, user: data.user };
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

export const ok = (data: unknown, status = 200) => NextResponse.json(data, { status });
