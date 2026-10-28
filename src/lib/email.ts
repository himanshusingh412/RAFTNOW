import "server-only";
import { Resend } from "resend";
import { env } from "@/lib/env";

// Transactional emails. Copy written fresh for this app; replica-brand rewrites it in the brand voice.

type Payload = {
  reference?: string;
  route?: string;
  put_in?: string;
  starts_at?: string;
  group_size?: number;
  total_paise?: number;
  refund_paise?: number;
  support_phone?: string;
  reason?: string;
  seq?: number;
  distance_m?: number;
  severity?: string;
  error?: string;
  reschedule_free_hours?: number;
  refund_full_hours?: number;
  refund_late_percent?: number;
};

const APP = "Rafting App"; // placeholder name until /replica-brand

export const rupees = (paise = 0) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(paise / 100);

export const istTime = (iso?: string) =>
  iso
    ? new Intl.DateTimeFormat("en-IN", { dateStyle: "full", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(iso))
    : "";

function trip(p: Payload) {
  return `${p.route} rafting, ${istTime(p.starts_at)} IST, ${p.group_size} ${p.group_size === 1 ? "person" : "people"}`;
}

const templates: Record<string, (p: Payload) => { subject: string; text: string }> = {
  booking_confirmed: (p) => ({
    subject: `Booked: ${p.route} on ${istTime(p.starts_at)} (${p.reference})`,
    text: [
      `You're on the river. Booking ${p.reference} is confirmed.`,
      trip(p),
      `Paid: ${rupees(p.total_paise)} (includes GST).`,
      `Report at the ${p.put_in} put-in 30 minutes early. Bring quick-dry clothes, sandals with a heel strap, and a photo ID for each rafter.`,
      `Free reschedule until ${p.reschedule_free_hours} hours before. Cancel ${p.refund_full_hours}+ hours before for a full refund, later for ${p.refund_late_percent}%.`,
      p.support_phone ? `On-call help on trip day: ${p.support_phone}` : "",
    ].filter(Boolean).join("\n\n"),
  }),
  booking_cancelled: (p) => ({
    subject: `Cancelled: ${p.reference}`,
    text: `Booking ${p.reference} (${trip(p)}) is cancelled.\n\n${
      p.refund_paise ? `Refund: ${rupees(p.refund_paise)}, back to your original payment method in 5-7 working days.` : "No refund is due on this booking."
    }`,
  }),
  booking_rescheduled: (p) => ({
    subject: `New time for ${p.reference}`,
    text: `Done. Booking ${p.reference} is now: ${trip(p)}.`,
  }),
  closure_cancelled: (p) => ({
    subject: `River closed: ${p.reference} cancelled with a full refund`,
    text: `The river is closed on your trip date (${p.reason?.replace("_", " ")}), so booking ${p.reference} (${trip(p)}) is cancelled.\n\nYou get a full refund of ${rupees(p.total_paise)}. Want another date instead? Book again any time.`,
  }),
  payment_refunded_seats_gone: (p) => ({
    subject: `Your payment for ${p.reference} is being refunded`,
    text: `Your payment arrived after the seat hold ran out and the trip filled up, so booking ${p.reference} could not be confirmed. The full amount, ${rupees(p.total_paise)}, is being refunded.`,
  }),
  refund_processed: (p) => ({
    subject: `Refund sent: ${rupees(p.refund_paise)} for ${p.reference}`,
    text: `We've sent your refund of ${rupees(p.refund_paise)}. Banks usually show it within 5-7 working days.`,
  }),
  trip_reminder: (p) => ({
    subject: `Tomorrow: ${p.route} rafting`,
    text: `See you on the river. ${trip(p)}.\n\nReport at the ${p.put_in} put-in 30 minutes early with a photo ID for each rafter.${
      p.support_phone ? `\n\nOn-call help: ${p.support_phone}` : ""
    }`,
  }),
  operator_offer: (p) => ({
    subject: `New trip offer: ${p.route}, ${istTime(p.starts_at)}`,
    text: `You have a new trip offer: ${trip(p)} (${p.reference}). Accept or decline it in your operator dashboard.`,
  }),
  ops_no_operator: (p) => ({ subject: `[ops] No operator for ${p.reference}`, text: `No eligible operator for ${trip(p)}. Assign one by hand.` }),
  ops_incident: (p) => ({ subject: `[ops] ${p.severity} incident on ${p.reference}`, text: `Incident logged on ${trip(p)}. Follow up now.` }),
  ops_refund_dead: (p) => ({ subject: `[ops] Refund failed 5 times: ${p.reference}`, text: `Refund for ${p.reference} keeps failing: ${p.error}. Refund it by hand in the Razorpay dashboard.` }),
  ops_checkpoint_out_of_zone: (p) => ({
    subject: `[ops] Checkpoint ${p.seq} out of zone on ${p.reference}`,
    text: `Scan ${p.seq} for ${trip(p)} was ${p.distance_m} m from its zone. Check on the raft.`,
  }),
};

export function renderEmail(template: string, payload: Payload) {
  const t = templates[template];
  if (!t) throw new Error(`unknown email template ${template}`);
  const { subject, text } = t(payload);
  return { subject: `${subject}`, text: `${text}\n\n— ${APP}` };
}

let resend: Resend | undefined;
export async function sendEmail(to: string, template: string, payload: Payload) {
  const { subject, text } = renderEmail(template, payload);
  resend ??= new Resend(env().RESEND_API_KEY);
  const { error } = await resend.emails.send({ from: env().EMAIL_FROM, to, subject, text });
  if (error) throw new Error(`${error.name}: ${error.message}`);
}
