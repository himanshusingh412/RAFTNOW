/**
 * RaftNow API client — every call goes to the real backend. There is NO mock
 * or fallback data: if the API is down or a feature is not configured, the
 * caller receives an ApiError and the UI must show it.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '/api/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

type TokenSource = () => Promise<string | null> | string | null;

export async function request<T>(
  path: string,
  opts: { method?: string; body?: unknown; token?: TokenSource; form?: FormData; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = opts.token ? await opts.token() : null;
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body, signal: opts.signal });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the RaftNow API. Check that the server is running.');
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
    if (!e) throw new ApiError(res.status, `HTTP_${res.status}`, `The RaftNow API is not responding (HTTP ${res.status}). The server may be down or still starting.`);
    const fieldMsg = Array.isArray(e.details?.fields) ? `: ${e.details.fields.join('; ')}` : '';
    throw new ApiError(res.status, e.code ?? `HTTP_${res.status}`, (e.message || 'Request failed') + fieldMsg, e.details);
  }
  return data as T;
}

export const inr = (paise: number | null | undefined) =>
  paise == null ? '—' : `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const istTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });

export const istDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function todayIst(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

// ── Public types (mirror the API responses) ────────────────────────────────

export interface Stretch {
  id: string;
  name: string;
  distance_km: number;
  grade: string;
  duration_minutes: number;
  put_in_point: string;
  take_out_point: string;
  min_age: number;
  max_age: number | null;
  status: 'OPEN' | 'CLOSED';
  closure: { reason: string; since: string; until: string | null; river_wide: boolean } | null;
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
  total_seats: number;
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
    stretch: { id: string; name: string };
    vendor: { id: string; display_name: string; licence_verified: boolean };
  };
}

export interface AvailabilityResponse {
  stretch_id: string;
  date: string;
  generated_at: string;
  authoritative: false;
  note: string;
  slots: SlotView[];
}

export interface Booking {
  id: string;
  booking_code: string;
  display_code: string;
  status: string;
  mode: 'SHARED' | 'PRIVATE';
  seat_count: number;
  amount_paise: number;
  hold_expires_at: string;
  created_at: string;
  cancelled_at: string | null;
  checked_in_at: string | null;
  guests: Array<{ name: string; age: number }>;
  refunds?: Array<{ id: string; amount_paise: number; status: string }>;
  slot?: { start_time: string; end_time: string; trip: { title: string; meeting_point: string; vendor: { display_name: string }; stretch: { name: string } } };
}

export interface TicketPass {
  booking_id: string;
  booking_code: string;
  display_code: string;
  qr_token: string;
  qr_data_url: string;
  trip_title: string;
  vendor_name: string;
  stretch_name: string;
  start_time: string;
  end_time: string;
  meeting_point: string;
  mode: string;
  seat_count: number;
  guests: Array<{ name: string; age: number }>;
  status: string;
  checked_in_at: string | null;
}

export interface HealthInfo {
  status: string;
  integrations: {
    razorpay: string;
    firebase_auth: 'configured' | 'dev_bypass_only' | 'not_configured';
    qr_signing: string;
    document_storage: string;
  };
}

// ── Public endpoints ───────────────────────────────────────────────────────

export const publicApi = {
  health: () => request<HealthInfo>('/health'),
  stretches: () => request<Stretch[]>('/stretches'),
  slots: (stretchId: string, date: string) =>
    request<AvailabilityResponse>(`/slots?stretch_id=${encodeURIComponent(stretchId)}&date=${encodeURIComponent(date)}`),
  slot: (id: string) => request<SlotView>(`/slots/${id}`),
};
