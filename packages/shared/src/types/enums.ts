// ─────────────────────────────────────────────────────────────────────────────
// All enum constants used across RaftNow apps.
// Must stay in sync with the Prisma schema enums.
// ─────────────────────────────────────────────────────────────────────────────

// ── Vendor ───────────────────────────────────────────────────────────────────

export const VendorStatus = {
  DRAFT: 'DRAFT',
  UNDER_REVIEW: 'UNDER_REVIEW',
  LIVE: 'LIVE',
  SUSPENDED: 'SUSPENDED',
} as const;
export type VendorStatus = (typeof VendorStatus)[keyof typeof VendorStatus];

export const VendorMemberRole = {
  OWNER: 'OWNER',
  MANAGER: 'MANAGER',
  GUIDE: 'GUIDE',
} as const;
export type VendorMemberRole = (typeof VendorMemberRole)[keyof typeof VendorMemberRole];

// ── Trip ─────────────────────────────────────────────────────────────────────

export const TripStatus = {
  DRAFT: 'DRAFT',
  LIVE: 'LIVE',
  HIDDEN: 'HIDDEN',
} as const;
export type TripStatus = (typeof TripStatus)[keyof typeof TripStatus];

// ── Slot ─────────────────────────────────────────────────────────────────────

export const SlotStatus = {
  OPEN: 'OPEN',
  BLOCKED: 'BLOCKED',
  CLOSED: 'CLOSED',
} as const;
export type SlotStatus = (typeof SlotStatus)[keyof typeof SlotStatus];

export const BookingMode = {
  SHARED: 'SHARED',
  PRIVATE: 'PRIVATE',
} as const;
export type BookingMode = (typeof BookingMode)[keyof typeof BookingMode];

// ── Booking ───────────────────────────────────────────────────────────────────

export const BookingStatus = {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  EXPIRED: 'EXPIRED',
  CONFIRMED: 'CONFIRMED',
  CHECKED_IN: 'CHECKED_IN',
  COMPLETED: 'COMPLETED',
  NO_SHOW: 'NO_SHOW',
  CANCELLED_CUSTOMER: 'CANCELLED_CUSTOMER',
  CANCELLED_VENDOR: 'CANCELLED_VENDOR',
  CANCELLED_ADMIN: 'CANCELLED_ADMIN',
  DISPUTED: 'DISPUTED',
} as const;
export type BookingStatus = (typeof BookingStatus)[keyof typeof BookingStatus];

// States that count against slot inventory
export const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING_PAYMENT,
  BookingStatus.CONFIRMED,
  BookingStatus.CHECKED_IN,
];

// Terminal states — no further transitions
export const TERMINAL_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.EXPIRED,
  BookingStatus.COMPLETED,
  BookingStatus.NO_SHOW,
  BookingStatus.CANCELLED_CUSTOMER,
  BookingStatus.CANCELLED_VENDOR,
  BookingStatus.CANCELLED_ADMIN,
];

// States eligible for vendor payout
export const PAYOUT_ELIGIBLE_STATUSES: BookingStatus[] = [
  BookingStatus.COMPLETED,
  BookingStatus.NO_SHOW,
];

// ── Payment ───────────────────────────────────────────────────────────────────

export const PaymentStatus = {
  CREATED: 'CREATED',
  AUTHORIZED: 'AUTHORIZED',
  CAPTURED: 'CAPTURED',
  FAILED: 'FAILED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

// ── Transfer (vendor payout) ──────────────────────────────────────────────────

export const TransferStatus = {
  CREATED: 'CREATED',
  ON_HOLD: 'ON_HOLD',
  RELEASED: 'RELEASED',
  SETTLED: 'SETTLED',
  REVERSED: 'REVERSED',
  FAILED: 'FAILED',
} as const;
export type TransferStatus = (typeof TransferStatus)[keyof typeof TransferStatus];

// ── Refund ────────────────────────────────────────────────────────────────────

export const RefundStatus = {
  PENDING: 'PENDING',
  PROCESSED: 'PROCESSED',
  FAILED: 'FAILED',
} as const;
export type RefundStatus = (typeof RefundStatus)[keyof typeof RefundStatus];

export const RefundReason = {
  CUSTOMER_CANCELLED: 'CUSTOMER_CANCELLED',
  VENDOR_CANCELLED: 'VENDOR_CANCELLED',
  ADMIN_CANCELLED: 'ADMIN_CANCELLED',
  RIVER_CLOSURE: 'RIVER_CLOSURE',
  LATE_PAYMENT_NO_SEATS: 'LATE_PAYMENT_NO_SEATS',
  HOLD_EXPIRED_AFTER_CAPTURE: 'HOLD_EXPIRED_AFTER_CAPTURE',
} as const;
export type RefundReason = (typeof RefundReason)[keyof typeof RefundReason];

// ── Admin roles ────────────────────────────────────────────────────────────────

export const AdminRole = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  OPS: 'OPS',
} as const;
export type AdminRole = (typeof AdminRole)[keyof typeof AdminRole];

// ── Notification ───────────────────────────────────────────────────────────────

export const NotificationChannel = {
  PUSH: 'PUSH',
  SMS: 'SMS',
  EMAIL: 'EMAIL',
  WHATSAPP: 'WHATSAPP',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const NotificationEvent = {
  BOOKING_CONFIRMED: 'BOOKING_CONFIRMED',
  BOOKING_CANCELLED: 'BOOKING_CANCELLED',
  REFUND_PROCESSED: 'REFUND_PROCESSED',
  REFUND_FAILED: 'REFUND_FAILED',
  DAY_BEFORE_REMINDER: 'DAY_BEFORE_REMINDER',
  VENDOR_NEW_BOOKING: 'VENDOR_NEW_BOOKING',
  VENDOR_CANCELLATION: 'VENDOR_CANCELLATION',
  VENDOR_NEXT_DAY_MANIFEST: 'VENDOR_NEXT_DAY_MANIFEST',
  RIVER_CLOSURE: 'RIVER_CLOSURE',
  PAYOUT_RELEASED: 'PAYOUT_RELEASED',
  PAYOUT_FAILED: 'PAYOUT_FAILED',
  LICENCE_EXPIRY_WARNING: 'LICENCE_EXPIRY_WARNING',
  VENDOR_APPROVED: 'VENDOR_APPROVED',
  VENDOR_REJECTED: 'VENDOR_REJECTED',
  VENDOR_SUSPENDED: 'VENDOR_SUSPENDED',
} as const;
export type NotificationEvent = (typeof NotificationEvent)[keyof typeof NotificationEvent];
