import { describe, expect, it } from "vitest";
import { renderEmail, rupees, istTime } from "@/lib/email";
import { createBooking, participant } from "@/lib/validation";
import { dbError } from "@/lib/http";

const payload = {
  reference: "BK-1A2B3C4D", route: "Shivpuri", put_in: "Shivpuri", starts_at: "2026-11-02T02:30:00Z",
  group_size: 2, total_paise: 279800, refund_paise: 139900, support_phone: "+91 00000 00000",
  reschedule_free_hours: 24, refund_full_hours: 48, refund_late_percent: 50,
};

describe("emails", () => {
  it("formats rupees and IST times", () => {
    expect(rupees(139900)).toBe("₹1,399.00");
    expect(istTime("2026-11-02T02:30:00Z")).toContain("8:00");
  });

  it("confirmation states the policy from settings, not hard-coded numbers", () => {
    const { subject, text } = renderEmail("booking_confirmed", { ...payload, refund_late_percent: 40 });
    expect(subject).toContain("BK-1A2B3C4D");
    expect(text).toContain("40%");
    expect(text).toContain("₹2,798.00");
    expect(text).toContain("+91 00000 00000");
  });

  it("every template the database queues renders", () => {
    for (const t of [
      "booking_confirmed", "booking_cancelled", "booking_rescheduled", "closure_cancelled", "payment_refunded_seats_gone",
      "refund_processed", "trip_reminder", "operator_offer", "ops_no_operator", "ops_incident", "ops_refund_dead",
      "ops_checkpoint_out_of_zone",
    ]) {
      const { subject, text } = renderEmail(t, { ...payload, reason: "weather", seq: 2, distance_m: 900, severity: "high", error: "x" });
      expect(subject.length).toBeGreaterThan(5);
      expect(text).not.toContain("undefined");
    }
  });

  it("unknown template throws (the job retries, then marks it dead)", () => {
    expect(() => renderEmail("nope", payload)).toThrow();
  });
});

describe("input validation", () => {
  const person = { full_name: "Asha", age: 30, health_ok: true, consent: true };

  it("requires the health declaration and consent to be true", () => {
    expect(participant.safeParse(person).success).toBe(true);
    expect(participant.safeParse({ ...person, health_ok: false }).success).toBe(false);
    expect(participant.safeParse({ ...person, consent: false }).success).toBe(false);
  });

  it("accepts Indian mobile numbers only", () => {
    expect(participant.safeParse({ ...person, phone: "9876543210" }).success).toBe(true);
    expect(participant.safeParse({ ...person, phone: "+919876543210" }).success).toBe(true);
    expect(participant.safeParse({ ...person, phone: "12345" }).success).toBe(false);
  });

  it("ignores any price the client sends", () => {
    const parsed = createBooking.parse({
      slotId: "6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f", participants: [person], total_paise: 1,
    } as unknown);
    expect("total_paise" in parsed).toBe(false);
  });
});

describe("database error mapping", () => {
  it("maps known codes to statuses and readable text", () => {
    expect(dbError({ message: "not_enough_seats" }).status).toBe(409);
    expect(dbError({ message: "participant_age_not_allowed", hint: "Shivpuri is for ages 14-65" }).message).toContain("14-65");
  });
  it("hides unknown database errors", () => {
    const e = dbError({ message: 'duplicate key value violates unique constraint "x"' });
    expect(e.status).toBe(500);
    expect(e.message).not.toContain("constraint");
  });
});
