// Common shared types used across apps
import { z } from 'zod';

// ── Error response shape ───────────────────────────────────────────────────────
export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

// ── Pagination ─────────────────────────────────────────────────────────────────
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
}

// ── IST timezone utilities ─────────────────────────────────────────────────────
/** All DB timestamps are UTC. This helper formats for display in IST. */
export const IST_OFFSET_HOURS = 5.5;
export const IST_TZ = 'Asia/Kolkata';

// ── Indian phone number validation ─────────────────────────────────────────────
export const INDIAN_PHONE_REGEX = /^\+91[6-9]\d{9}$/;

export const IndianPhoneSchema = z
  .string()
  .regex(INDIAN_PHONE_REGEX, 'Must be a valid Indian mobile number (+91XXXXXXXXXX)');

// ── Stretch (river segment) ────────────────────────────────────────────────────
export interface StretchDto {
  id: string;
  name: string;
  distance_km: number;
  grade: string;
  duration_minutes: number;
  put_in_point: string;
  take_out_point: string;
  min_age: number;
  active: boolean;
}

// ── Trip (public view) ────────────────────────────────────────────────────────
export interface TripSummaryDto {
  id: string;
  title: string;
  stretch: StretchDto;
  vendor_id: string;
  vendor_name: string;
  vendor_status: string;
  duration_minutes: number;
  raft_capacity: number;
  min_age: number;
  max_age: number | null;
  per_seat_price_paise: number;
  private_raft_price_paise: number | null;
  cover_photo_url: string | null;
  licence_verified: boolean;
}

// ── Slot (public availability view) ───────────────────────────────────────────
export interface SlotAvailabilityDto {
  id: string;
  trip_id: string;
  start_time: string; // ISO 8601 UTC
  end_time: string;   // ISO 8601 UTC
  status: string;
  seats_available: number;
  private_rafts_available: number;
  total_rafts: number;
  raft_capacity: number;
}

// ── Booking (customer view) ────────────────────────────────────────────────────
export interface BookingGuestDto {
  name: string;
  age: number;
}

export interface BookingDto {
  id: string;
  booking_code: string;
  display_code: string;
  slot_id: string;
  trip_title: string;
  vendor_name: string;
  stretch_name: string;
  start_time: string;
  end_time: string;
  meeting_point: string;
  meeting_lat: number | null;
  meeting_lng: number | null;
  mode: string; // SHARED | PRIVATE
  seat_count: number;
  guests: BookingGuestDto[];
  amount_paise: number;
  status: string;
  hold_expires_at: string | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  qr_token: string | null;
  created_at: string;
}

// ── Zod schemas for request validation ────────────────────────────────────────

export const CreateBookingSchema = z.object({
  slot_id: z.string().uuid(),
  mode: z.enum(['SHARED', 'PRIVATE']),
  seat_count: z.number().int().min(1).max(50),
  guests: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        age: z.number().int().min(0).max(120),
      }),
    )
    .min(1),
  safety_declaration_version: z.string().min(1),
  idempotency_key: z.string().uuid(),
});

export type CreateBookingInput = z.infer<typeof CreateBookingSchema>;

export const SearchTripsSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  stretch_id: z.string().uuid().optional(),
  guest_count: z.number().int().min(1).max(50).optional(),
  mode: z.enum(['SHARED', 'PRIVATE']).optional(),
  sort: z.enum(['price_asc', 'price_desc', 'rating']).optional().default('price_asc'),
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(50).optional().default(20),
});

export type SearchTripsInput = z.infer<typeof SearchTripsSchema>;
