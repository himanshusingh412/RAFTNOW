import { z } from "zod";

export const uuid = z.string().uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");
const indianPhone = z.string().trim().regex(/^(?:\+?91)?[6-9]\d{9}$/, "enter a 10-digit Indian mobile number");

export const otpRequest = z.object({ email: z.string().trim().toLowerCase().email().max(254) });
export const otpVerify = otpRequest.extend({ code: z.string().regex(/^\d{6}$/, "6 digits") });
export const signOut = z.object({ scope: z.enum(["local", "global"]).default("local") });

export const participant = z.object({
  full_name: z.string().trim().min(1).max(100),
  age: z.number().int().min(0).max(120),
  phone: indianPhone.optional(),
  health_ok: z.literal(true, { message: "health declaration must be confirmed" }),
  health_notes: z.string().trim().max(500).optional(),
  consent: z.literal(true, { message: "safety consent must be accepted" }),
});

export const createBooking = z.object({
  slotId: uuid,
  participants: z.array(participant).min(1).max(50), // the database enforces the real maximum
  addons: z.array(z.object({ code: z.string().min(1).max(40) })).max(10).default([]),
  contactEmail: z.string().trim().toLowerCase().email().optional(),
  contactPhone: indianPhone.optional(),
});

export const verifyPayment = z.object({
  razorpay_order_id: z.string().startsWith("order_"),
  razorpay_payment_id: z.string().startsWith("pay_"),
  razorpay_signature: z.string().regex(/^[a-f0-9]{64}$/),
});

export const reschedule = z.object({ slotId: uuid });
export const respond = z.object({ accept: z.boolean() });

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
export const checkpoint = z.object({ seq: z.number().int().min(1).max(3), lat, lng });
export const ping = z.object({ lat, lng });
export const incident = z.object({
  bookingId: uuid,
  severity: z.enum(["low", "medium", "high", "critical"]),
  description: z.string().trim().min(5).max(4000),
});

export const generateSlots = z.object({
  routeId: uuid,
  from: isoDate,
  to: isoDate,
  times: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).min(1).max(12),
  capacity: z.number().int().min(0).max(1000).optional(),
});

export const closure = z.object({
  routeId: uuid.nullable().default(null),
  from: isoDate,
  to: isoDate,
  reason: z.enum(["monsoon", "weather", "government_order", "other"]),
  note: z.string().trim().max(500).optional(),
});

const check = z.boolean();
export const verification = z.object({
  season: z.string().regex(/^\d{4}-\d{2}$/),
  checks: z.object({
    gear: check, guides: check, briefing: check, kayaker: check, gps: check,
    incident_reporting: check, customer_service: check, permit: check,
  }),
  permitNumber: z.string().trim().min(1).max(100),
  permitExpiresOn: isoDate,
  notes: z.string().trim().max(2000).optional(),
});
