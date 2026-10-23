// Payment-related shared types (kept separate from booking for clarity)
export interface PaymentDto {
  id: string;
  booking_id: string;
  razorpay_order_id: string;
  razorpay_payment_id: string | null;
  amount_paise: number;
  status: string;
  created_at: string;
}

export interface WebhookEventDto {
  id: string;
  gateway: string;
  gateway_event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  processed_at: string | null;
  created_at: string;
}
