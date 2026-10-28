-- Rafting marketplace: tables.
-- Money is integer paise. Times are timestamptz (UTC); "a day" means an Asia/Kolkata day.

-- gen_random_uuid() is built in (Postgres 13+); no extensions needed.

-- ---------------------------------------------------------------------------
-- settings: every number ops may want to tune lives here, nowhere else
-- ---------------------------------------------------------------------------
create table public.settings (
  key text primary key,
  value jsonb not null,
  description text not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- people
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  role text not null default 'rafter' check (role in ('rafter', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.operators (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  contact_phone text,
  contact_email text,
  permit_number text,
  permit_expires_on date,
  status text not null default 'pending' check (status in ('pending', 'verified', 'suspended')),
  rotation_last_assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.operator_members (
  operator_id uuid not null references public.operators(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (operator_id, user_id)
);
create index on public.operator_members (user_id);

create table public.guides (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  full_name text not null,
  swiftwater_cert_expires_on date,
  river_experience_years int check (river_experience_years >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.guides (operator_id);

-- ---------------------------------------------------------------------------
-- catalogue
-- ---------------------------------------------------------------------------
create table public.routes (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  put_in text not null,
  take_out text not null,
  category text not null check (category in ('family', 'moderate', 'expert')),
  distance_km_min numeric(5,1) not null check (distance_km_min > 0),
  distance_km_max numeric(5,1) not null,
  water_minutes_min int not null check (water_minutes_min > 0),
  water_minutes_max int not null,
  grade text not null,
  min_age int not null check (min_age between 0 and 99),
  max_age int check (max_age is null or max_age >= min_age),
  price_paise int not null check (price_paise > 0),          -- per person, incl. GST + platform fee
  platform_fee_paise int not null default 0 check (platform_fee_paise >= 0),
  gst_rate_bps int not null check (gst_rate_bps between 0 and 5000), -- 1800 = 18%
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (distance_km_max >= distance_km_min),
  check (water_minutes_max >= water_minutes_min),
  check (platform_fee_paise < price_paise)
);
create index on public.routes (category) where is_active;

create table public.rapids (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,          -- one spelling, everywhere
  grade text not null,
  description text
);

create table public.route_rapids (
  route_id uuid not null references public.routes(id) on delete cascade,
  rapid_id uuid not null references public.rapids(id) on delete restrict,
  position int not null check (position > 0),
  primary key (route_id, rapid_id),
  unique (route_id, position)
);
create index on public.route_rapids (rapid_id);

create table public.addons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  price_paise int not null check (price_paise >= 0),   -- incl. GST
  per text not null check (per in ('person', 'booking')),
  route_id uuid references public.routes(id) on delete cascade, -- null = all routes
  is_active boolean not null default true
);
create index on public.addons (route_id);

-- checkpoint geofences: seq 1 put-in, 2 mid-river, 3 take-out
create table public.route_zones (
  route_id uuid not null references public.routes(id) on delete cascade,
  seq int not null check (seq between 1 and 3),
  label text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  radius_m int not null default 300 check (radius_m > 0),
  primary key (route_id, seq)
);

create table public.operator_routes (
  operator_id uuid not null references public.operators(id) on delete cascade,
  route_id uuid not null references public.routes(id) on delete cascade,
  seats_per_slot int not null check (seats_per_slot > 0),
  primary key (operator_id, route_id)
);
create index on public.operator_routes (route_id);

create table public.verifications (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  season text not null check (season ~ '^\d{4}-\d{2}$'),   -- e.g. 2026-27
  checks jsonb not null,               -- 8 named booleans, see verify_operator()
  permit_number text not null,
  permit_expires_on date not null,
  result text not null check (result in ('pass', 'fail')),
  notes text,
  checked_by uuid references auth.users(id) on delete set null,
  checked_at timestamptz not null default now()
);
create index on public.verifications (operator_id, season);

-- ---------------------------------------------------------------------------
-- inventory
-- ---------------------------------------------------------------------------
create table public.slots (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.routes(id) on delete cascade,
  starts_at timestamptz not null,
  capacity int not null check (capacity >= 0),
  seats_held int not null default 0 check (seats_held >= 0),
  seats_booked int not null default 0 check (seats_booked >= 0),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  unique (route_id, starts_at),
  constraint no_overbooking check (seats_held + seats_booked <= capacity)
);
create index on public.slots (starts_at);

create table public.closures (
  id uuid primary key default gen_random_uuid(),
  route_id uuid references public.routes(id) on delete cascade,   -- null = whole river
  starts_on date not null,
  ends_on date not null,
  reason text not null check (reason in ('monsoon', 'weather', 'government_order', 'other')),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index on public.closures (starts_on, ends_on);

-- ---------------------------------------------------------------------------
-- bookings
-- ---------------------------------------------------------------------------
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('BK-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  user_id uuid references auth.users(id) on delete set null,   -- kept (anonymised) for tax records
  route_id uuid not null references public.routes(id) on delete restrict,
  slot_id uuid not null references public.slots(id) on delete restrict,
  group_size int not null check (group_size > 0),
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'confirmed', 'cancelled', 'completed', 'no_show', 'expired')),
  hold_expires_at timestamptz,
  seats_state text not null default 'held' check (seats_state in ('held', 'booked', 'released')),
  addons jsonb not null default '[]',      -- snapshot: [{code,name,price_paise,per,qty}]
  subtotal_paise int not null check (subtotal_paise >= 0),
  addons_paise int not null default 0 check (addons_paise >= 0),
  platform_fee_paise int not null default 0 check (platform_fee_paise >= 0),
  gst_paise int not null default 0 check (gst_paise >= 0),
  total_paise int not null check (total_paise > 0),
  currency text not null default 'INR' check (currency = 'INR'),
  channel text not null default 'web' check (channel in ('web', 'whatsapp', 'walk_in')),
  operator_id uuid references public.operators(id) on delete set null,
  assignment_status text not null default 'unassigned'
    check (assignment_status in ('unassigned', 'offered', 'accepted', 'no_operator')),
  contact_email text,
  contact_phone text,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason in ('customer', 'platform_closure', 'admin', 'payment_late')),
  rescheduled_from_slot_id uuid references public.slots(id) on delete set null,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (total_paise = subtotal_paise + addons_paise)
);
create index on public.bookings (user_id, created_at desc);
create index on public.bookings (slot_id);
create index on public.bookings (operator_id, slot_id);
create index on public.bookings (status, hold_expires_at) where status = 'pending_payment';

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  full_name text not null,
  age int not null check (age between 0 and 120),
  phone text,
  health_ok boolean not null,            -- declared no disqualifying condition
  health_notes text,
  consent_at timestamptz not null,
  id_checked_at timestamptz
);
create index on public.participants (booking_id);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  operator_id uuid not null references public.operators(id) on delete cascade,
  status text not null default 'offered' check (status in ('offered', 'accepted', 'declined', 'withdrawn')),
  offered_at timestamptz not null default now(),
  responded_at timestamptz,
  responded_by uuid references auth.users(id) on delete set null
);
create index on public.assignments (booking_id);
create index on public.assignments (operator_id, status);

-- ---------------------------------------------------------------------------
-- money
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  provider text not null default 'razorpay' check (provider = 'razorpay'),
  provider_order_id text not null unique,
  provider_payment_id text unique,
  amount_paise int not null check (amount_paise > 0),
  amount_refunded_paise int not null default 0 check (amount_refunded_paise >= 0),
  status text not null default 'created'
    check (status in ('created', 'captured', 'failed', 'refunded', 'partially_refunded')),
  method text,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (amount_refunded_paise <= amount_paise)
);
create index on public.payments (booking_id);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  booking_id uuid not null references public.bookings(id) on delete restrict,
  amount_paise int not null check (amount_paise > 0),
  reason text not null check (reason in ('customer_full', 'customer_partial', 'platform_closure', 'payment_late', 'admin')),
  idempotency_key text not null unique,
  provider_refund_id text unique,
  status text not null default 'pending' check (status in ('pending', 'submitted', 'processed', 'failed', 'dead')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.refunds (status, next_attempt_at) where status in ('pending', 'failed');
create index on public.refunds (booking_id);

create table public.webhook_events (
  id text primary key,                  -- x-razorpay-event-id
  provider text not null,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

-- ---------------------------------------------------------------------------
-- trip day
-- ---------------------------------------------------------------------------
create table public.checkpoints (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  seq int not null check (seq between 1 and 3),
  lat double precision not null,
  lng double precision not null,
  distance_m int not null,
  in_zone boolean not null,
  scanned_by uuid references auth.users(id) on delete set null,
  scanned_at timestamptz not null default now(),
  unique (booking_id, seq)
);

create table public.gps_pings (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  recorded_at timestamptz not null default now()
);
create index on public.gps_pings (booking_id, recorded_at desc);

create table public.tracking_links (
  token text primary key,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.tracking_links (booking_id);

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id) on delete set null,
  operator_id uuid not null references public.operators(id) on delete cascade,
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  description text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  reported_by uuid references auth.users(id) on delete set null,
  followed_up_at timestamptz,
  resolution text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index on public.incidents (operator_id, status);
create index on public.incidents (booking_id);

-- ---------------------------------------------------------------------------
-- plumbing
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  channel text not null default 'email' check (channel in ('email')),
  to_address text not null,
  template text not null,
  payload jsonb not null default '{}',
  dedupe_key text unique,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'dead')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index on public.notifications (status, next_attempt_at) where status in ('pending', 'failed');

create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);

-- updated_at trigger
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['settings','profiles','operators','routes','bookings','payments','refunds'] loop
    execute format('create trigger touch_%1$s before update on public.%1$I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;
