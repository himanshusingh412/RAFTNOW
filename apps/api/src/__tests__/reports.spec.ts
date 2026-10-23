import { bookingsCsv, commissionEarnedPaise, csvCell, istStamp, refundedPaise, rupees, summarise, vendorPayoutPaise, ReportBookingRow, BOOKINGS_CSV_HEADER } from '../admin/reports';
import { normaliseBookingCode } from '../bookings/bookings.service';

function row(over: Partial<ReportBookingRow> & { vendor?: string; paid?: string } = {}): ReportBookingRow {
  const vendor = over.vendor ?? 'Ganga Rafters';
  return {
    booking_code: 'AB2CD3',
    status: 'CONFIRMED',
    mode: 'SHARED',
    seat_count: 4,
    amount_paise: 400_000n,
    commission_bps: 1200,
    platform_commission_paise: 48_000n,
    vendor_payout_paise: 352_000n,
    confirmed_at: new Date(over.paid ?? '2026-10-22T06:30:00Z'),
    slot: { start_time: new Date('2026-10-23T01:30:00Z'), trip: { title: 'Shivpuri run', vendor: { id: `v-${vendor}`, display_name: vendor }, stretch: { name: 'Shivpuri → Rishikesh' } } },
    refunds: [],
    transfer: { status: 'ON_HOLD', amount_paise: 352_000n, reversed_amount_paise: null },
    payments: [{ razorpay_payment_id: 'pay_123', status: 'CAPTURED' }],
    ...over,
  };
}

describe('rupees', () => {
  it.each([
    [0n, '0.00'],
    [5n, '0.05'],
    [100n, '1.00'],
    [343_360n, '3433.60'],
    [-5n, '-0.05'],
    [-150_050n, '-1500.50'],
  ])('%p paise → %s', (p, s) => expect(rupees(p)).toBe(s));
});

describe('csvCell', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
  });
  it('neutralises spreadsheet formulas in text cells', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+91 98765')).toBe("'+91 98765");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });
  it('leaves our own negative numbers alone', () => {
    expect(csvCell('-0.05', { numeric: true })).toBe('-0.05');
  });
  it('renders null as empty', () => expect(csvCell(null)).toBe(''));
});

describe('istStamp', () => {
  it('formats in IST, 24-hour', () => {
    expect(istStamp(new Date('2026-10-23T01:30:00Z'))).toBe('2026-10-23 07:00');
    expect(istStamp(new Date('2026-10-22T18:45:00Z'))).toBe('2026-10-23 00:15');
  });
});

describe('summarise', () => {
  const rows = [
    row({ paid: '2026-10-21T20:00:00Z' }), // 22 Oct IST (01:30)
    row({
      paid: '2026-10-22T10:00:00Z',
      vendor: 'Shiva Adventures',
      refunds: [{ amount_paise: 200_000n, status: 'PROCESSED' }, { amount_paise: 1n, status: 'FAILED' }],
      transfer: { status: 'ON_HOLD', amount_paise: 176_000n, reversed_amount_paise: null }, // 50% kept, 12% commission on it
    }),
    row({ paid: '2026-10-23T05:00:00Z' }),
  ];

  it('groups by IST payment day and totals exactly', () => {
    const s = summarise(rows, 'day');
    expect(s.rows.map((r) => [r.key, r.bookings])).toEqual([
      ['2026-10-22', 2],
      ['2026-10-23', 1],
    ]);
    expect(s.totals).toEqual({ bookings: 3, gmv_paise: 1_200_000n, commission_paise: 120_000n, vendor_payout_paise: 880_000n, refunds_paise: 200_000n });
  });

  it('groups by vendor, biggest GMV first, ignoring failed refunds', () => {
    const s = summarise(rows, 'vendor');
    expect(s.rows.map((r) => [r.label, r.bookings, r.refunds_paise])).toEqual([
      ['Ganga Rafters', 2, 0n],
      ['Shiva Adventures', 1, 200_000n],
    ]);
  });

  it('payout comes from the transfer, net of reversals, never negative', () => {
    expect(vendorPayoutPaise(row({ transfer: null }))).toBe(352_000n);
    expect(vendorPayoutPaise(row({ transfer: { status: 'RELEASED', amount_paise: 352_000n, reversed_amount_paise: 176_000n } }))).toBe(176_000n);
    expect(vendorPayoutPaise(row({ transfer: { status: 'REVERSED', amount_paise: 0n, reversed_amount_paise: null } }))).toBe(0n);
    // fully refunded → platform keeps nothing
    expect(commissionEarnedPaise(row({ refunds: [{ amount_paise: 400_000n, status: 'PROCESSED' }], transfer: { status: 'REVERSED', amount_paise: 0n, reversed_amount_paise: null } }))).toBe(0n);
  });

  it('refundedPaise excludes FAILED refunds', () => {
    expect(refundedPaise({ refunds: [{ amount_paise: 5n, status: 'PENDING' }, { amount_paise: 7n, status: 'FAILED' }] })).toBe(5n);
  });
});

describe('bookingsCsv', () => {
  it('has a BOM, a header and one CRLF line per booking with exact rupee amounts', () => {
    const csv = bookingsCsv([row({ refunds: [{ amount_paise: 200_000n, status: 'PENDING' }], transfer: { status: 'ON_HOLD', amount_paise: 176_000n, reversed_amount_paise: null } })]);
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe(BOOKINGS_CSV_HEADER.join(','));
    expect(lines[1]).toBe(
      '2026-10-22 12:00,RFAB2CD3,CONFIRMED,Ganga Rafters,Shivpuri → Rishikesh,Shivpuri run,2026-10-23 07:00,SHARED,4,4000.00,12.00,2000.00,1760.00,240.00,ON_HOLD,pay_123',
    );
    expect(lines[2]).toBe('');
  });

  it('a malicious vendor name cannot inject a formula', () => {
    const csv = bookingsCsv([row({ vendor: '=cmd|"/c calc"!A1' })]);
    expect(csv).toContain(`"'=cmd|""/c calc""!A1"`);
  });
});

describe('normaliseBookingCode', () => {
  it.each([
    ['RF7K2M9P', '7K2M9P'],
    ['rf 7k2m9p', '7K2M9P'],
    ['RF-7K2-M9P', '7K2M9P'],
    ['7k2m9p', '7K2M9P'],
    ['RFABCD', 'RFABCD'], // a 6-char code that happens to start with RF is kept
  ])('%s → %s', (input, out) => expect(normaliseBookingCode(input)).toBe(out));
});
