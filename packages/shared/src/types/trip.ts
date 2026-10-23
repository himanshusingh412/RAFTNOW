// Trip-related shared types
export interface TripDto {
  id: string;
  vendor_id: string;
  stretch_id: string;
  title: string;
  description: string;
  duration_minutes: number;
  inclusions: string[];
  exclusions: string[];
  meeting_point: string;
  meeting_lat: number | null;
  meeting_lng: number | null;
  photos: TripPhotoDto[];
  min_age: number;
  max_age: number | null;
  raft_capacity: number;
  per_seat_price_paise: number;
  private_raft_price_paise: number | null;
  status: string;
}

export interface TripPhotoDto {
  id: string;
  url: string;
  caption: string | null;
  position: number;
}

export interface SlotTemplateDto {
  id: string;
  trip_id: string;
  departure_time: string; // HH:MM
  days_of_week: number[]; // 0=Sun, 1=Mon, ..., 6=Sat
  rafts_count: number;
  active: boolean;
}
