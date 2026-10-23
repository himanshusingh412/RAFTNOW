import {
  applyBps,
  splitCommission,
  calculateRefundPaise,
  getCancellationTrigger,
  DEFAULT_CANCELLATION_POLICY,
  formatInr,
  rupeesToPaise,
  paiseToRupees,
} from '@raftnow/shared';

// ─────────────────────────────────────────────────────────────────────────────
// MONEY UTILITIES — Unit Tests
//
// These tests cover every row of the cancellation/refund policy.
// All monetary values use bigint (paise). No floating point.
// ─────────────────────────────────────────────────────────────────────────────

describe('applyBps', () => {
  it('calculates 10% of 100000 paise (₹1000)', () => {
    expect(applyBps(100000n, 1000n)).toBe(10000n);
  });

  it('calculates 18% of 100000 paise', () => {
    expect(applyBps(100000n, 1800n)).toBe(18000n);
  });

  it('calculates 0% correctly', () => {
    expect(applyBps(100000n, 0n)).toBe(0n);
  });

  it('calculates 100% correctly', () => {
    expect(applyBps(100000n, 10000n)).toBe(100000n);
  });

  it('uses integer arithmetic — no fractional paise', () => {
    // 15% of 100001 paise = 15000.15 → floor to 15000
    expect(applyBps(100001n, 1500n)).toBe(15000n);
  });

  it('handles large amounts (₹1 lakh booking)', () => {
    const amount = 10000000n; // 1 lakh rupees in paise
    const commission = applyBps(amount, 1200n); // 12%
    expect(commission).toBe(1200000n);
  });
});

describe('splitCommission', () => {
  it('splits correctly for 10% commission', () => {
    const { platformPaise, vendorPaise } = splitCommission(100000n, 1000n);
    expect(platformPaise).toBe(10000n);
    expect(vendorPaise).toBe(90000n);
    // Sums must equal original amount
    expect(platformPaise + vendorPaise).toBe(100000n);
  });

  it('sums always equal original amount — no money created or lost', () => {
    // Test many amounts to verify rounding invariant
    const amounts = [100001n, 99999n, 150050n, 200000n, 37500n];
    const bpsValues = [1000n, 1200n, 750n, 1500n];

    for (const amount of amounts) {
      for (const bps of bpsValues) {
        const { platformPaise, vendorPaise } = splitCommission(amount, bps);
        expect(platformPaise + vendorPaise).toBe(amount);
      }
    }
  });

  it('handles 0% commission — vendor gets everything', () => {
    const { platformPaise, vendorPaise } = splitCommission(100000n, 0n);
    expect(platformPaise).toBe(0n);
    expect(vendorPaise).toBe(100000n);
  });

  it('handles 100% commission — platform gets everything', () => {
    const { platformPaise, vendorPaise } = splitCommission(100000n, 10000n);
    expect(platformPaise).toBe(100000n);
    expect(vendorPaise).toBe(0n);
  });
});

describe('getCancellationTrigger', () => {
  it('returns CUSTOMER_MORE_THAN_24H for > 24 hours', () => {
    expect(getCancellationTrigger(25)).toBe('CUSTOMER_MORE_THAN_24H');
    expect(getCancellationTrigger(48)).toBe('CUSTOMER_MORE_THAN_24H');
    expect(getCancellationTrigger(24.001)).toBe('CUSTOMER_MORE_THAN_24H');
  });

  it('returns CUSTOMER_6_TO_24H for 6-24 hours', () => {
    expect(getCancellationTrigger(24)).toBe('CUSTOMER_6_TO_24H');
    expect(getCancellationTrigger(12)).toBe('CUSTOMER_6_TO_24H');
    expect(getCancellationTrigger(6)).toBe('CUSTOMER_6_TO_24H');
    expect(getCancellationTrigger(6.001)).toBe('CUSTOMER_6_TO_24H');
  });

  it('returns CUSTOMER_LESS_THAN_6H for < 6 hours', () => {
    expect(getCancellationTrigger(5.999)).toBe('CUSTOMER_LESS_THAN_6H');
    expect(getCancellationTrigger(1)).toBe('CUSTOMER_LESS_THAN_6H');
    expect(getCancellationTrigger(0)).toBe('CUSTOMER_LESS_THAN_6H');
    expect(getCancellationTrigger(-1)).toBe('CUSTOMER_LESS_THAN_6H');
  });
});

describe('calculateRefundPaise — cancellation policy', () => {
  const amount = 200000n; // ₹2000 booking

  // ── Customer cancellations ─────────────────────────────────────────────────

  it('gives 100% refund when cancelled more than 24h before', () => {
    const { refundPaise, refundBps } = calculateRefundPaise(
      amount,
      'CUSTOMER_MORE_THAN_24H',
      25,
    );
    expect(refundPaise).toBe(200000n);
    expect(refundBps).toBe(10000n);
  });

  it('gives 50% refund when cancelled 6-24h before', () => {
    const { refundPaise, refundBps } = calculateRefundPaise(
      amount,
      'CUSTOMER_6_TO_24H',
      12,
    );
    expect(refundPaise).toBe(100000n);
    expect(refundBps).toBe(5000n);
  });

  it('gives 0% refund when cancelled less than 6h before', () => {
    const { refundPaise, refundBps } = calculateRefundPaise(
      amount,
      'CUSTOMER_LESS_THAN_6H',
      3,
    );
    expect(refundPaise).toBe(0n);
    expect(refundBps).toBe(0n);
  });

  it('gives 0% refund for no-show', () => {
    const { refundPaise } = calculateRefundPaise(amount, 'CUSTOMER_NO_SHOW', -2);
    expect(refundPaise).toBe(0n);
  });

  // ── Vendor/admin/system cancellations ─────────────────────────────────────

  it('gives 100% refund for vendor cancellation', () => {
    const { refundPaise } = calculateRefundPaise(amount, 'VENDOR_CANCELLED', 5);
    expect(refundPaise).toBe(200000n);
  });

  it('gives 100% refund for river closure', () => {
    const { refundPaise } = calculateRefundPaise(amount, 'RIVER_CLOSURE', 1);
    expect(refundPaise).toBe(200000n);
  });

  it('gives 100% refund for admin refund', () => {
    const { refundPaise } = calculateRefundPaise(amount, 'ADMIN_REFUND', 0);
    expect(refundPaise).toBe(200000n);
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  it('refund never exceeds the booking amount', () => {
    const { refundPaise } = calculateRefundPaise(amount, 'VENDOR_CANCELLED', 5);
    expect(refundPaise).toBeLessThanOrEqual(amount);
  });

  it('uses custom policy when provided', () => {
    const customPolicy = {
      moreThan24hRefundBps: 10000n, // 100%
      between6And24hRefundBps: 7500n, // 75%
      lessThan6hRefundBps: 2500n,  // 25%
    };

    const { refundPaise } = calculateRefundPaise(
      amount,
      'CUSTOMER_6_TO_24H',
      12,
      customPolicy,
    );
    expect(refundPaise).toBe(150000n); // 75% of ₹2000
  });

  it('50% refund is exact for odd amounts', () => {
    const oddAmount = 150001n; // ₹1500.01
    const { refundPaise } = calculateRefundPaise(
      oddAmount,
      'CUSTOMER_6_TO_24H',
      12,
    );
    // 50% = 75000.5 paise → floor = 75000
    expect(refundPaise).toBe(75000n);
  });
});

describe('formatInr', () => {
  it('formats ₹1000', () => {
    expect(formatInr(100000n)).toBe('₹1,000');
  });

  it('formats ₹1 lakh', () => {
    expect(formatInr(10000000n)).toBe('₹1,00,000');
  });

  it('formats zero', () => {
    expect(formatInr(0n)).toBe('₹0');
  });
});

describe('rupeesToPaise / paiseToRupees', () => {
  it('converts 1000 rupees to 100000 paise', () => {
    expect(rupeesToPaise(1000)).toBe(100000n);
  });

  it('handles decimal rupees correctly', () => {
    expect(rupeesToPaise(1000.5)).toBe(100050n);
  });

  it('converts paise back to rupees', () => {
    expect(paiseToRupees(100000n)).toBe(1000);
  });

  it('roundtrip is stable for whole rupee amounts', () => {
    const original = 2500;
    const paise = rupeesToPaise(original);
    const back = paiseToRupees(paise);
    expect(back).toBe(original);
  });
});
