// Booking and payment shared types
export interface PaymentOrderDto {
  razorpay_order_id: string;
  razorpay_key_id: string;
  amount_paise: number;
  currency: string;
  booking_id: string;
  hold_expires_at: string;
}

export interface PaymentVerifyDto {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface RefundDto {
  id: string;
  booking_id: string;
  amount_paise: number;
  reason: string;
  status: string;
  created_at: string;
}

export interface TransferDto {
  id: string;
  booking_id: string;
  vendor_id: string;
  amount_paise: number;
  status: string;
  razorpay_transfer_id: string | null;
  release_at: string | null;
  settled_at: string | null;
  utr: string | null;
}

export interface CancelQuoteDto {
  booking_id: string;
  amount_paise: number;
  refund_paise: number;
  refund_bps: number;
  trigger: string;
  hours_before_departure: number;
}
