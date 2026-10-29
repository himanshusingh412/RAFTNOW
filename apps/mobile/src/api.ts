/**
 * RaftNow mobile API client. Talks to the real backend only — no mock data.
 *
 * Base URL: EXPO_PUBLIC_API_URL (inlined by Expo at build time), e.g.
 *   EXPO_PUBLIC_API_URL=http://192.168.1.20:4000/api/v1 npx expo start
 * A phone cannot reach "localhost" on your computer — use the LAN IP.
 * Only development builds default to localhost; a release build without it
 * fails every call with API_NOT_CONFIGURED instead of silently using localhost.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? (__DEV__ ? 'http://localhost:4000/api/v1' : '')).replace(/\/$/, '');

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: Record<string, unknown>) {
    super(message);
  }
}

/**
 * Session plumbing (set by App.tsx): where the bearer token comes from — a
 * fresh Firebase ID token, or the stored developer token — and what to do when
 * the API rejects it (sign out → login screen with "session expired").
 */
type TokenProvider = () => Promise<string | null>;
let tokenProvider: TokenProvider | null = null;
let onSessionRejected: (() => void) | null = null;
export function configureAuth(provider: TokenProvider | null, onRejected: (() => void) | null) {
  tokenProvider = provider;
  onSessionRejected = onRejected;
}

/** 401 codes meaning the sign-in token itself is invalid or expired (not "wrong role"). */
export const REJECTED_TOKEN_CODES = ['INVALID_FIREBASE_TOKEN', 'INVALID_DEV_TOKEN'];

export async function api<T>(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  if (!API_URL) throw new ApiError(0, 'API_NOT_CONFIGURED', 'This build has no API address: EXPO_PUBLIC_API_URL was not set when it was built.');
  const headers: Record<string, string> = { Accept: 'application/json' };
  const bearer = init.token ?? (tokenProvider ? await tokenProvider() : null);
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', `Cannot reach the RaftNow API at ${API_URL}`);
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const e = data?.error;
    // No RaftNow error envelope: a proxy or host answered, not the API itself.
    const err = e
      ? new ApiError(res.status, e.code ?? `HTTP_${res.status}`, e.message || 'Request failed', e.details)
      : new ApiError(res.status, `HTTP_${res.status}`, `The RaftNow API is not responding (HTTP ${res.status}). The server may be down or still starting.`);
    if (res.status === 401 && init.token === undefined && REJECTED_TOKEN_CODES.includes(err.code)) onSessionRejected?.();
    throw err;
  }
  return data as T;
}

export interface Health {
  integrations: { firebase_auth: 'configured' | 'dev_bypass_only' | 'not_configured' };
}

export interface CustomerBooking {
  id: string;
  display_code: string;
  status: string;
  mode: 'SHARED' | 'PRIVATE';
  seat_count: number;
  amount_paise: number;
  hold_expires_at: string;
  created_at: string;
  guests?: Array<{ name: string; age: number }>;
  refunds?: Array<{ id: string; amount_paise: number; status: string }>;
  slot?: {
    start_time: string;
    end_time?: string;
    trip: { title: string; meeting_point: string; vendor: { display_name: string }; stretch?: { name: string } };
  };
}

export interface Ticket {
  booking_id: string;
  display_code: string;
  qr_data_url: string;
  trip_title: string;
  vendor_name: string;
  stretch_name?: string;
  start_time: string;
  meeting_point: string;
  status: string;
  seat_count?: number;
  mode?: string;
  guests: Array<{ name: string; age: number }>;
}

export interface Stretch {
  id: string;
  name: string;
  distance_km: number;
  grade: string;
  duration_minutes: number;
  min_age: number;
  max_age: number | null;
  status: 'OPEN' | 'CLOSED';
  closure: { reason: string; until: string | null } | null;
  /** Next planned closure (e.g. monsoon) inside the booking window. */
  next_closure: { reason: string; from: string; until: string | null; river_wide: boolean } | null;
  from_price_paise: number | null;
  live_trip_count: number;
}

export interface SlotView {
  id: string;
  trip_id: string;
  start_time: string;
  end_time: string;
  status: string;
  bookable: boolean;
  closure_reason: string | null;
  raft_capacity: number;
  available_shared_seats: number;
  available_private_rafts: number;
  per_seat_price_paise: number;
  private_raft_price_paise: number | null;
  min_age: number;
  max_age: number | null;
  trip: {
    id: string;
    title: string;
    meeting_point: string;
    duration_minutes: number;
    cover_photo_url: string | null;
    stretch: { id: string; name: string };
    vendor: { id: string; display_name: string; licence_verified: boolean };
  };
}

export interface Availability {
  date: string;
  note: string;
  slots: SlotView[];
}

export interface TripDetail {
  id: string;
  title: string;
  description: string;
  duration_minutes: number;
  inclusions: string[];
  exclusions: string[];
  meeting_point: string;
  meeting_lat: number | null;
  meeting_lng: number | null;
  min_age: number;
  max_age: number | null;
  raft_capacity: number;
  per_seat_price_paise: number;
  private_raft_price_paise: number | null;
  photos: Array<{ id: string; url: string; caption: string | null }>;
  stretch: { id: string; name: string; distance_km: number; grade: string; put_in_point: string; take_out_point: string };
  vendor: {
    id: string;
    display_name: string;
    description: string | null;
    phone: string;
    address: string;
    licence_verified: boolean;
    licence_number: string | null;
  };
  cancellation_policy: Array<{ window: string; refund_percent: number }>;
}

export interface PaymentOrder {
  razorpay_order_id: string;
  razorpay_key_id: string;
  amount_paise: number;
  currency: string;
  booking_code: string;
  hold_expires_at: string;
}

export interface CancelQuote {
  cancellable: boolean;
  reason: string | null;
  amount_paise: number;
  refund_paise: number;
  refund_percent: number;
  unpaid?: boolean;
}

export interface CheckInResult {
  result: 'CHECKED_IN';
  checked_in_at: string;
  booking: { display_code: string; seat_count: number; guests: Array<{ name: string }>; trip_title: string; start_time: string };
}

export interface ManifestRow {
  id: string;
  display_code: string;
  status: string;
  seat_count: number;
  contact_name: string;
  slot: { start_time: string; trip_title: string };
}

/** Photo URLs may be API-relative ("/api/v1/storage/media/…") in development; make them absolute. */
export function mediaUrl(url: string): string {
  return url.startsWith('/') ? `${API_URL.replace(/\/api\/v1$/, '')}${url}` : url;
}

/** "1 Jul" style date for an instant, in IST. */
export const istDay = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });

export const inr = (paise: number | null | undefined) => (paise == null ? '—' : `₹${(paise / 100).toLocaleString('en-IN')}`);
export const istTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
export const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
export const duration = (minutes: number) => (minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}` : `${minutes}m`);

/** YYYY-MM-DD plus n days (calendar arithmetic in UTC, so no DST/timezone drift). */
export function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Random v4 UUID for Idempotency keys (Hermes has no crypto.randomUUID). Uniqueness, not secrecy, is what matters. */
export function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const statusLabel = (status: string) =>
  ({
    PENDING_PAYMENT: 'Awaiting payment',
    CONFIRMED: 'Confirmed',
    CHECKED_IN: 'Checked in',
    COMPLETED: 'Completed',
    NO_SHOW: 'No-show',
    CANCELLED_CUSTOMER: 'Cancelled',
    CANCELLED_VENDOR: 'Cancelled by operator',
    CANCELLED_ADMIN: 'Cancelled by RaftNow',
    DISPUTED: 'Under review',
    EXPIRED: 'Expired',
  })[status] ?? status.replace(/_/g, ' ').toLowerCase();
