/**
 * Notification copy. Kept deliberately small and free of sensitive data:
 * no amounts beyond refund totals, no OTPs, no tokens.
 */
export interface RenderedMessage {
  title: string;
  body: string;
}

type Data = Record<string, unknown>;

const s = (v: unknown, fallback = '') => (v === undefined || v === null ? fallback : String(v));
const inr = (paise: unknown) => {
  const n = Number(paise);
  return Number.isFinite(n) ? `₹${(n / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '';
};

const TEMPLATES: Record<string, (d: Data) => RenderedMessage> = {
  BOOKING_CONFIRMED: (d) => ({
    title: 'Booking confirmed',
    body: `Your rafting booking RF${s(d.booking_code)} is confirmed. Show your QR ticket at the meeting point.`,
  }),
  NEW_BOOKING: (d) => ({
    title: 'New booking',
    body: `New booking RF${s(d.booking_code)} (${s(d.seat_count)} pax) for ${s(d.start_time_ist)}.`,
  }),
  BOOKING_CANCELLED: (d) => ({
    title: 'Booking cancelled',
    body:
      d.reason === 'RIVER_CLOSURE'
        ? `Your booking RF${s(d.booking_code)} was cancelled because the river stretch has been closed for safety. A full refund has been initiated.`
        : `Your booking RF${s(d.booking_code)} was cancelled.${Number(d.refund_paise) > 0 ? ` Refund of ${inr(d.refund_paise)} initiated.` : ''}`,
  }),
  BOOKING_CANCELLED_VENDOR: (d) => ({
    title: 'Booking cancelled',
    body: `Booking RF${s(d.booking_code)} was cancelled (${s(d.reason, 'cancelled')}).`,
  }),
  REFUND_PROCESSED: (d) => ({
    title: 'Refund processed',
    body: `Your refund of ${inr(d.amount_paise)} for booking RF${s(d.booking_code)} has been processed.`,
  }),
  REFUND_FAILED: (d) => ({
    title: 'Refund issue',
    body: `We could not process the refund for booking RF${s(d.booking_code)}. Our team has been alerted.`,
  }),
  CHECK_IN_CONFIRMED: (d) => ({
    title: 'Checked in',
    body: `You're checked in for booking RF${s(d.booking_code)}. Have a great trip!`,
  }),
  HOLD_EXPIRY_REMINDER: (d) => ({
    title: 'Complete your payment',
    body: `Your seat hold for RF${s(d.booking_code)} expires soon.`,
  }),
  VENDOR_STATUS_CHANGED: (d) => ({
    title: 'Account status update',
    body: `Your RaftNow operator account is now ${s(d.status)}.${d.reason ? ` Reason: ${s(d.reason)}` : ''}`,
  }),
  LICENCE_EXPIRING: (d) => ({
    title: 'Licence expiring',
    body: `Your rafting licence expires on ${s(d.expiry_date)}. Upload a renewed licence to avoid suspension.`,
  }),
  LICENCE_EXPIRED: () => ({
    title: 'Licence expired',
    body: 'Your rafting licence has expired. New bookings are paused until a renewed licence is verified.',
  }),
};

export function renderNotification(event: string, data: Data): RenderedMessage {
  const t = TEMPLATES[event];
  return t ? t(data) : { title: 'RaftNow', body: event.replace(/_/g, ' ').toLowerCase() };
}

export function hasTemplate(event: string): boolean {
  return event in TEMPLATES;
}
