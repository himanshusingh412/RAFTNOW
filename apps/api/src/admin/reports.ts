/**
 * Reporting (PRD A-11): GMV, commission, refunds and vendor payouts by day or
 * vendor, plus a per-booking CSV for the accountant. Pure functions over rows
 * the controller loads, so the arithmetic is unit-tested without a database.
 *
 * A booking counts once it was paid (confirmed_at set), on its IST payment
 * date. Amounts are what actually moved, not the booking-time snapshot: a
 * partial refund shrinks the vendor transfer (TransfersService), so payouts
 * come from the transfer and commission earned is what is left over. Money
 * stays integer paise until the CSV renders rupees, which is done by string
 * formatting so no float rounding can creep in.
 */
import { istDateOf } from '../common/time/ist';

export interface ReportBookingRow {
  booking_code: string;
  status: string;
  mode: string;
  seat_count: number;
  amount_paise: bigint;
  commission_bps: number;
  platform_commission_paise: bigint;
  vendor_payout_paise: bigint;
  confirmed_at: Date;
  slot: { start_time: Date; trip: { title: string; vendor: { id: string; display_name: string }; stretch: { name: string } } };
  refunds: Array<{ amount_paise: bigint; status: string }>;
  transfer: { status: string; amount_paise: bigint; reversed_amount_paise: bigint | null } | null;
  payments: Array<{ razorpay_payment_id: string | null; status: string }>;
}

export type GroupBy = 'day' | 'vendor';

export interface SummaryRow {
  key: string;
  label: string;
  bookings: number;
  gmv_paise: bigint;
  commission_paise: bigint;
  vendor_payout_paise: bigint;
  /** Refunds that are processed or still in flight; FAILED refunds are excluded. */
  refunds_paise: bigint;
}

/**
 * The vendor's share as it stands now: the transfer amount (already reduced for
 * refunds while on hold) minus any gateway reversal after release. Falls back
 * to the booking snapshot if no transfer row exists yet.
 */
export function vendorPayoutPaise(b: Pick<ReportBookingRow, 'transfer' | 'vendor_payout_paise'>): bigint {
  if (!b.transfer) return b.vendor_payout_paise;
  const net = b.transfer.amount_paise - (b.transfer.reversed_amount_paise ?? 0n);
  return net > 0n ? net : 0n;
}

/** Platform's keep: what the customer paid, less refunds, less the vendor's share. */
export function commissionEarnedPaise(b: Pick<ReportBookingRow, 'amount_paise' | 'refunds' | 'transfer' | 'vendor_payout_paise'>): bigint {
  return b.amount_paise - refundedPaise(b) - vendorPayoutPaise(b);
}

/** Refund money that left (or is leaving) the platform for this booking. */
export function refundedPaise(b: Pick<ReportBookingRow, 'refunds'>): bigint {
  return b.refunds.filter((r) => r.status !== 'FAILED').reduce((sum, r) => sum + r.amount_paise, 0n);
}

export function summarise(rows: ReportBookingRow[], groupBy: GroupBy): { rows: SummaryRow[]; totals: Omit<SummaryRow, 'key' | 'label'> } {
  const map = new Map<string, SummaryRow>();
  for (const b of rows) {
    const key = groupBy === 'day' ? istDateOf(b.confirmed_at) : b.slot.trip.vendor.id;
    const label = groupBy === 'day' ? key : b.slot.trip.vendor.display_name;
    const row = map.get(key) ?? { key, label, bookings: 0, gmv_paise: 0n, commission_paise: 0n, vendor_payout_paise: 0n, refunds_paise: 0n };
    row.bookings += 1;
    row.gmv_paise += b.amount_paise;
    row.commission_paise += commissionEarnedPaise(b);
    row.vendor_payout_paise += vendorPayoutPaise(b);
    row.refunds_paise += refundedPaise(b);
    map.set(key, row);
  }
  const out = [...map.values()].sort((a, b) => (groupBy === 'day' ? a.key.localeCompare(b.key) : Number(b.gmv_paise - a.gmv_paise)));
  const totals = out.reduce(
    (t, r) => ({
      bookings: t.bookings + r.bookings,
      gmv_paise: t.gmv_paise + r.gmv_paise,
      commission_paise: t.commission_paise + r.commission_paise,
      vendor_payout_paise: t.vendor_payout_paise + r.vendor_payout_paise,
      refunds_paise: t.refunds_paise + r.refunds_paise,
    }),
    { bookings: 0, gmv_paise: 0n, commission_paise: 0n, vendor_payout_paise: 0n, refunds_paise: 0n },
  );
  return { rows: out, totals };
}

/** 123456n → "1234.56"; -5n → "-0.05". Exact: no floating point. */
export function rupees(paise: bigint): string {
  const neg = paise < 0n;
  const abs = neg ? -paise : paise;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

/**
 * RFC 4180 quoting, plus a guard against spreadsheet formula injection: a cell
 * that starts with = + - @ (or a tab/CR) is prefixed with ' so Excel and
 * Sheets show it as text. Numbers we generate are passed as raw strings.
 */
export function csvCell(value: string | number | null | undefined, opts: { numeric?: boolean } = {}): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (!opts.numeric && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const IST_DATETIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** "2026-10-23 07:00" in IST — sortable, and unambiguous for an accountant. */
export function istStamp(d: Date): string {
  const p = Object.fromEntries(IST_DATETIME.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}

export const BOOKINGS_CSV_HEADER = [
  'paid_at_ist',
  'booking_code',
  'status',
  'vendor',
  'stretch',
  'trip',
  'departure_ist',
  'mode',
  'seats',
  'amount_inr',
  'commission_pct',
  'refunded_inr',
  'vendor_payout_inr',
  'commission_earned_inr',
  'payout_status',
  'razorpay_payment_id',
];

export function bookingsCsv(rows: ReportBookingRow[]): string {
  const lines = [BOOKINGS_CSV_HEADER.join(',')];
  for (const b of rows) {
    const refunded = refundedPaise(b);
    const payment = b.payments.find((p) => p.status === 'CAPTURED') ?? b.payments[0];
    lines.push(
      [
        csvCell(istStamp(b.confirmed_at)),
        csvCell(`RF${b.booking_code}`),
        csvCell(b.status),
        csvCell(b.slot.trip.vendor.display_name),
        csvCell(b.slot.trip.stretch.name),
        csvCell(b.slot.trip.title),
        csvCell(istStamp(b.slot.start_time)),
        csvCell(b.mode),
        csvCell(b.seat_count, { numeric: true }),
        csvCell(rupees(b.amount_paise), { numeric: true }),
        csvCell((b.commission_bps / 100).toFixed(2), { numeric: true }),
        csvCell(rupees(refunded), { numeric: true }),
        csvCell(rupees(vendorPayoutPaise(b)), { numeric: true }),
        csvCell(rupees(commissionEarnedPaise(b)), { numeric: true }),
        csvCell(b.transfer?.status ?? ''),
        csvCell(payment?.razorpay_payment_id ?? ''),
      ].join(','),
    );
  }
  // CRLF per RFC 4180; the BOM makes Excel open UTF-8 (₹, →) correctly.
  return '﻿' + lines.join('\r\n') + '\r\n';
}
