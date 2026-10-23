/**
 * Razorpay Standard Checkout through the native SDK (react-native-razorpay),
 * as TRD 5.2 specifies. The SDK is a native module: it exists only in a dev
 * client or store build made after it was installed (`npx expo run:ios`,
 * `eas build`). Expo Go and older builds don't have it, and we say so instead
 * of failing silently.
 *
 * The app never decides that a booking is paid. It passes Razorpay's signed
 * response to POST /payments/verify, and the webhook is the source of truth.
 */
import { NativeModules } from 'react-native';
import type { PaymentOrder } from './api';

export interface CheckoutSuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export class CheckoutError extends Error {
  constructor(readonly kind: 'UNAVAILABLE' | 'CANCELLED' | 'FAILED', message: string) {
    super(message);
  }
}

export const checkoutAvailable = () => !!NativeModules.RNRazorpayCheckout;

export async function openCheckout(order: PaymentOrder, prefill: { contact: string; name?: string }): Promise<CheckoutSuccess> {
  if (!checkoutAvailable()) {
    throw new CheckoutError(
      'UNAVAILABLE',
      'Payments need the RaftNow app build that includes Razorpay. Rebuild the dev client (npx expo run:ios / run:android) or install the latest app.',
    );
  }
  // Required lazily: the module creates a NativeEventEmitter at import time,
  // which throws on builds without the native side.
  const RazorpayCheckout = require('react-native-razorpay').default;
  try {
    return await RazorpayCheckout.open({
      key: order.razorpay_key_id,
      order_id: order.razorpay_order_id,
      amount: order.amount_paise,
      currency: order.currency,
      name: 'RaftNow',
      description: `Rafting booking ${order.booking_code}`,
      prefill: { contact: prefill.contact, name: prefill.name ?? '' },
      theme: { color: '#14b8a6' },
      timeout: Math.max(60, Math.floor((new Date(order.hold_expires_at).getTime() - Date.now()) / 1000)),
    });
  } catch (e: any) {
    // The SDK reports a closed sheet as code 0 / 2 ("Payment cancelled by user").
    const code = Number(e?.code);
    const description: string = e?.description ?? e?.error?.description ?? e?.message ?? 'Payment failed';
    if (code === 0 || code === 2 || /cancel/i.test(description)) throw new CheckoutError('CANCELLED', 'Payment cancelled. Your seats stay held until the timer runs out.');
    throw new CheckoutError('FAILED', description);
  }
}
