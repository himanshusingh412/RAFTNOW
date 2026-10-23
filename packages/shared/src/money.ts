// ─────────────────────────────────────────────────────────────────────────────
// Money utilities for RaftNow
//
// ALL monetary values are stored and calculated in integer paise (1 INR = 100 paise).
// NEVER use floating-point arithmetic for money.
// Percentages are basis points (1% = 100 bps, 12% = 1200 bps).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applies a percentage (in basis points) to an amount in paise.
 * Uses integer arithmetic — never floating point.
 *
 * @example
 * applyBps(100000n, 1000n) // 10% of ₹1000 = ₹100 = 10000 paise
 */
export function applyBps(amountPaise: bigint, bps: bigint): bigint {
  return (amountPaise * bps) / 10000n;
}

/**
 * Splits a booking amount into vendor share and platform share.
 * Uses deterministic integer arithmetic — rounding never creates or loses money.
 *
 * @param amountPaise Total booking amount in paise
 * @param commissionBps Platform commission in basis points (e.g. 1000 = 10%)
 * @returns { platformPaise, vendorPaise } — guaranteed to sum to amountPaise
 */
export function splitCommission(
  amountPaise: bigint,
  commissionBps: bigint,
): { platformPaise: bigint; vendorPaise: bigint } {
  const platformPaise = applyBps(amountPaise, commissionBps);
  const vendorPaise = amountPaise - platformPaise;
  return { platformPaise, vendorPaise };
}

/**
 * Calculates GST on the platform commission amount.
 * @param commissionPaise Platform commission in paise
 * @param gstBps GST rate in basis points (e.g. 1800 = 18%)
 */
export function calculateGstOnCommission(
  commissionPaise: bigint,
  gstBps: bigint,
): bigint {
  return applyBps(commissionPaise, gstBps);
}

/**
 * Calculates TCS (Tax Collected at Source) on the booking amount.
 * TCS applies to the total amount collected from the customer.
 * @param amountPaise Total booking amount in paise
 * @param tcsBps TCS rate in basis points (e.g. 100 = 1%)
 */
export function calculateTcs(amountPaise: bigint, tcsBps: bigint): bigint {
  return applyBps(amountPaise, tcsBps);
}

/**
 * Formats paise as a human-readable INR string for display.
 * @example formatInr(100000n) → "₹1,000"
 */
export function formatInr(paise: bigint): string {
  const rupees = Number(paise) / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(rupees);
}

/**
 * Converts a rupee amount (number) to paise (bigint).
 * Use ONLY for display inputs — never for financial calculations.
 */
export function rupeesToPaise(rupees: number): bigint {
  return BigInt(Math.round(rupees * 100));
}

/**
 * Converts paise to rupees (number).
 * Use ONLY for display — never pass this back into financial calculations.
 */
export function paiseToRupees(paise: bigint): number {
  return Number(paise) / 100;
}

/**
 * Calculates the cancellation refund amount based on the policy and time before departure.
 *
 * Policy (configurable — see CancellationPolicy):
 * - > 24h before departure: 100% refund
 * - 6-24h before departure: 50% refund
 * - < 6h before departure / no-show: 0% refund
 * - Vendor cancelled: 100% refund
 * - River closure: 100% refund
 */
export type CancellationTrigger =
  | 'CUSTOMER_MORE_THAN_24H'
  | 'CUSTOMER_6_TO_24H'
  | 'CUSTOMER_LESS_THAN_6H'
  | 'CUSTOMER_NO_SHOW'
  | 'VENDOR_CANCELLED'
  | 'RIVER_CLOSURE'
  | 'ADMIN_REFUND';

export interface CancellationPolicy {
  moreThan24hRefundBps: bigint;   // default: 10000 (100%)
  between6And24hRefundBps: bigint; // default: 5000  (50%)
  lessThan6hRefundBps: bigint;    // default: 0      (0%)
}

export const DEFAULT_CANCELLATION_POLICY: CancellationPolicy = {
  moreThan24hRefundBps: 10000n,
  between6And24hRefundBps: 5000n,
  lessThan6hRefundBps: 0n,
};

/**
 * Calculates refund amount in paise for a given trigger and policy.
 * All edge cases return deterministic values — no ambiguity.
 */
export function calculateRefundPaise(
  amountPaise: bigint,
  trigger: CancellationTrigger,
  hoursBeforeDeparture: number,
  policy: CancellationPolicy = DEFAULT_CANCELLATION_POLICY,
): { refundPaise: bigint; refundBps: bigint } {
  let refundBps: bigint;

  switch (trigger) {
    case 'VENDOR_CANCELLED':
    case 'RIVER_CLOSURE':
    case 'ADMIN_REFUND':
      refundBps = 10000n; // 100%
      break;
    case 'CUSTOMER_MORE_THAN_24H':
      refundBps = policy.moreThan24hRefundBps;
      break;
    case 'CUSTOMER_6_TO_24H':
      refundBps = policy.between6And24hRefundBps;
      break;
    case 'CUSTOMER_LESS_THAN_6H':
    case 'CUSTOMER_NO_SHOW':
      refundBps = policy.lessThan6hRefundBps;
      break;
    default:
      // TypeScript exhaustiveness check
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _: never = trigger;
      refundBps = 0n;
  }

  const refundPaise = applyBps(amountPaise, refundBps);
  return { refundPaise, refundBps };
}

/**
 * Determines the cancellation trigger based on time before departure.
 * Input: hoursBeforeDeparture (can be negative for past departures).
 */
export function getCancellationTrigger(
  hoursBeforeDeparture: number,
): CancellationTrigger {
  if (hoursBeforeDeparture > 24) return 'CUSTOMER_MORE_THAN_24H';
  if (hoursBeforeDeparture >= 6) return 'CUSTOMER_6_TO_24H';
  return 'CUSTOMER_LESS_THAN_6H';
}
