-- Rafting marketplace: business logic.
-- Every seat and money change happens in one of these functions, in one transaction.
-- Errors are raised with a short machine code as the message (e.g. 'not_enough_seats');
-- src/lib/http.ts maps them to HTTP responses.

-- ---------------------------------------------------------------------------
-- small helpers
-- ---------------------------------------------------------------------------
-- a missing or null setting raises, so no rule is ever silently switched off
create or replace function public.setting_int(p_key text) returns int
language plpgsql stable security definer set search_path = '' as $$
declare v int;
begin
  select (value #>> '{}')::int into v from public.settings where key = p_key;
  if v is null then raise exception 'missing_setting' using hint = p_key; end if;
  return v;
end $$;

create or replace function public.setting_text(p_key text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  select value #>> '{}' into v from public.settings where key = p_key;
  if v is null then raise exception 'missing_setting' using hint = p_key; end if;
  return v;
end $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;

-- true for the service role (server-side jobs, webhooks) and for direct database
-- sessions with no role switch at all (migrations, seed, psql). Never true for anon/authenticated.
-- Reads the session's database role, which security definer functions don't change, not token claims.
create or replace function public.is_service() returns boolean
language sql stable set search_path = '' as $$
  select current_setting('role') in ('service_role', 'none')
$$;

create or replace function public.is_operator_member(p_operator uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_operator is not null and exists (
    select 1 from public.operator_members where operator_id = p_operator and user_id = auth.uid())
$$;

-- IST calendar day of a timestamp
create or replace function public.ist_date(p_ts timestamptz) returns date
language sql immutable set search_path = '' as $$
  select (p_ts at time zone 'Asia/Kolkata')::date
$$;

-- rafting season label for a date: 15 Sep - 30 Jun, e.g. '2026-27'
create or replace function public.season_for(p_day date) returns text
language sql immutable set search_path = '' as $$
  select case when extract(month from p_day) >= 7
    then to_char(p_day, 'YYYY') || '-' || to_char(p_day + interval '1 year', 'YY')
    else to_char(p_day - interval '1 year', 'YYYY') || '-' || to_char(p_day, 'YY') end
$$;

create or replace function public.is_closed(p_route uuid, p_day date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.closures c
    where (c.route_id is null or c.route_id = p_route) and p_day between c.starts_on and c.ends_on)
$$;

-- great-circle distance in metres
create or replace function public.distance_m(lat1 float8, lng1 float8, lat2 float8, lng2 float8) returns int
language sql immutable set search_path = '' as $$
  select round(2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))))::int
$$;

create or replace function public.enqueue_notification(p_to text, p_template text, p_payload jsonb, p_dedupe text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (to_address, template, payload, dedupe_key)
  select p_to, p_template, p_payload, p_dedupe where p_to is not null and p_to <> ''
  on conflict (dedupe_key) do nothing
$$;

-- payload for booking emails: no participant details, just what the email needs
create or replace function public.booking_email_payload(p_booking uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'reference', b.reference, 'route', r.name, 'put_in', r.put_in,
    'starts_at', s.starts_at, 'group_size', b.group_size, 'total_paise', b.total_paise,
    'support_phone', public.setting_text('support_phone'),
    'reschedule_free_hours', public.setting_int('reschedule_free_hours'),
    'refund_full_hours', public.setting_int('refund_full_hours'),
    'refund_late_percent', public.setting_int('refund_late_percent'))
  from public.bookings b join public.routes r on r.id = b.route_id join public.slots s on s.id = b.slot_id
  where b.id = p_booking
$$;

create or replace function public.booking_email(p_booking uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(b.contact_email, p.email)
  from public.bookings b left join public.profiles p on p.id = b.user_id where b.id = p_booking
$$;

-- new auth user -> profile
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- fixed-window rate limit; returns true if this hit is allowed
create or replace function public.hit_rate_limit(p_key text, p_window_seconds int, p_max int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_start timestamptz; v_hits int;
begin
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits (key, window_start, hits) values (p_key, v_start, 1)
  on conflict (key, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;
  return v_hits <= p_max;
end $$;

-- ---------------------------------------------------------------------------
-- booking: hold seats (rafter)
-- p_participants: [{full_name, age, phone?, health_ok, health_notes?, consent}]
-- p_addons:       [{code}]
-- ---------------------------------------------------------------------------
create or replace function public.create_booking(
  p_slot uuid, p_participants jsonb, p_addons jsonb default '[]',
  p_contact_email text default null, p_contact_phone text default null)
returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_slot public.slots;
  v_route public.routes;
  v_n int;
  v_p jsonb;
  v_a jsonb;
  v_addon public.addons;
  v_addons jsonb := '[]';
  v_addons_paise int := 0;
  v_qty int;
  v_subtotal int;
  v_total int;
  v_booking public.bookings;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if jsonb_typeof(p_participants) <> 'array' then raise exception 'invalid_participants'; end if;
  v_n := jsonb_array_length(p_participants);
  if v_n < 1 or v_n > public.setting_int('max_group_size') then
    raise exception 'invalid_group_size' using hint = 'max ' || public.setting_int('max_group_size');
  end if;

  select * into v_slot from public.slots where id = p_slot;
  if not found then raise exception 'slot_not_found'; end if;
  select * into v_route from public.routes where id = v_slot.route_id;
  if not v_route.is_active or v_slot.status <> 'open'
     or public.is_closed(v_route.id, public.ist_date(v_slot.starts_at)) then
    raise exception 'slot_closed';
  end if;
  if v_slot.starts_at < now() + make_interval(mins => public.setting_int('booking_cutoff_minutes')) then
    raise exception 'too_late_to_book';
  end if;

  for v_p in select * from jsonb_array_elements(p_participants) loop
    if coalesce(btrim(v_p ->> 'full_name'), '') = '' then raise exception 'participant_name_required'; end if;
    if (v_p ->> 'age') is null or (v_p ->> 'age')::int < v_route.min_age
       or (v_p ->> 'age')::int > coalesce(v_route.max_age, 120) then
      raise exception 'participant_age_not_allowed'
        using hint = v_route.name || ' is for ages ' || v_route.min_age || coalesce('-' || v_route.max_age, '+');
    end if;
    if coalesce((v_p ->> 'health_ok')::boolean, false) is not true then
      raise exception 'health_declaration_required';
    end if;
    if coalesce((v_p ->> 'consent')::boolean, false) is not true then raise exception 'consent_required'; end if;
  end loop;

  for v_a in select * from jsonb_array_elements(coalesce(p_addons, '[]')) loop
    select * into v_addon from public.addons
      where code = v_a ->> 'code' and is_active and (route_id is null or route_id = v_route.id);
    if not found then raise exception 'addon_not_available' using hint = v_a ->> 'code'; end if;
    v_qty := case v_addon.per when 'person' then v_n else 1 end;
    v_addons_paise := v_addons_paise + v_addon.price_paise * v_qty;
    v_addons := v_addons || jsonb_build_object('code', v_addon.code, 'name', v_addon.name,
      'price_paise', v_addon.price_paise, 'per', v_addon.per, 'qty', v_qty);
  end loop;

  -- the seat grab: one conditional update, so two buyers can never both get the last seats
  update public.slots set seats_held = seats_held + v_n
   where id = p_slot and status = 'open' and capacity - seats_held - seats_booked >= v_n;
  if not found then raise exception 'not_enough_seats'; end if;

  v_subtotal := v_route.price_paise * v_n;
  v_total := v_subtotal + v_addons_paise;

  insert into public.bookings (user_id, route_id, slot_id, group_size, hold_expires_at, addons,
    subtotal_paise, addons_paise, platform_fee_paise, gst_paise, total_paise, contact_email, contact_phone)
  values (v_uid, v_route.id, p_slot, v_n, now() + make_interval(mins => public.setting_int('hold_minutes')),
    v_addons, v_subtotal, v_addons_paise, v_route.platform_fee_paise * v_n,
    round(v_total::numeric * v_route.gst_rate_bps / (10000 + v_route.gst_rate_bps))::int,
    v_total,
    coalesce(nullif(p_contact_email, ''), (select email from public.profiles where id = v_uid)),
    coalesce(nullif(p_contact_phone, ''), (select phone from public.profiles where id = v_uid)))
  returning * into v_booking;

  insert into public.participants (booking_id, full_name, age, phone, health_ok, health_notes, consent_at)
  select v_booking.id, btrim(p ->> 'full_name'), (p ->> 'age')::int, nullif(p ->> 'phone', ''),
         true, nullif(p ->> 'health_notes', ''), now()
  from jsonb_array_elements(p_participants) p;

  return v_booking;
end $$;

-- server records the Razorpay order it created for a booking (service role)
create or replace function public.attach_order(p_booking uuid, p_order_id text) returns public.payments
language plpgsql security definer set search_path = '' as $$
declare v_b public.bookings; v_pay public.payments;
begin
  select * into v_b from public.bookings where id = p_booking;
  if not found then raise exception 'booking_not_found'; end if;
  if v_b.status <> 'pending_payment' then raise exception 'booking_not_payable'; end if;
  insert into public.payments (booking_id, provider_order_id, amount_paise)
  values (p_booking, p_order_id, v_b.total_paise) returning * into v_pay;
  return v_pay;
end $$;

-- ---------------------------------------------------------------------------
-- fair rotation: offer a confirmed booking to the next eligible operator
-- eligible = verified, permit valid on trip day, passed this season's check,
-- runs this route, has seats left in this slot, has not declined this booking.
-- least recently assigned goes first.
-- ---------------------------------------------------------------------------
create or replace function public.assign_operator(p_booking uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_b public.bookings; v_s public.slots; v_day date; v_op uuid;
begin
  select * into v_b from public.bookings where id = p_booking for update;
  select * into v_s from public.slots where id = v_b.slot_id;
  v_day := public.ist_date(v_s.starts_at);

  select o.id into v_op
  from public.operators o
  join public.operator_routes r on r.operator_id = o.id and r.route_id = v_b.route_id
  where o.status = 'verified'
    and o.permit_expires_on >= v_day
    and exists (select 1 from public.verifications v where v.operator_id = o.id
                and v.season = public.season_for(v_day) and v.result = 'pass')
    and not exists (select 1 from public.assignments a where a.booking_id = v_b.id
                    and a.operator_id = o.id and a.status = 'declined')
    and r.seats_per_slot - coalesce((
          select sum(b2.group_size) from public.bookings b2
          where b2.operator_id = o.id and b2.slot_id = v_b.slot_id and b2.id <> v_b.id
            and b2.status = 'confirmed' and b2.assignment_status in ('offered', 'accepted')), 0)
        >= v_b.group_size
  order by o.rotation_last_assigned_at asc nulls first, o.id
  limit 1
  for update of o; -- wait for a parallel assignment; skipping would leave this booking without an operator

  if v_op is null then
    update public.bookings set operator_id = null, assignment_status = 'no_operator' where id = v_b.id;
    perform public.enqueue_notification(public.setting_text('ops_email'), 'ops_no_operator',
      public.booking_email_payload(v_b.id), 'no_operator:' || v_b.id || ':' || now());
    return null;
  end if;

  update public.bookings set operator_id = v_op, assignment_status = 'offered' where id = v_b.id;
  insert into public.assignments (booking_id, operator_id) values (v_b.id, v_op);
  update public.operators set rotation_last_assigned_at = clock_timestamp() where id = v_op;
  perform public.enqueue_notification((select contact_email from public.operators where id = v_op),
    'operator_offer', public.booking_email_payload(v_b.id), 'offer:' || v_b.id || ':' || v_op);
  return v_op;
end $$;

-- ---------------------------------------------------------------------------
-- payment confirmed (service role: verify route or webhook). Safe to call twice.
-- returns: 'confirmed' | 'already_confirmed' | 'refund_queued'
-- ---------------------------------------------------------------------------
create or replace function public.confirm_payment(
  p_order_id text, p_payment_id text, p_amount_paise int, p_method text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare v_pay public.payments; v_b public.bookings; v_ok boolean := false;
begin
  select * into v_pay from public.payments where provider_order_id = p_order_id for update;
  if not found then raise exception 'unknown_order'; end if;
  if v_pay.status in ('captured', 'refunded', 'partially_refunded') then
    -- seen before: report what happened then (a booking that couldn't stand was refunded)
    return case when (select status from public.bookings where id = v_pay.booking_id) in ('confirmed', 'completed')
                then 'already_confirmed' else 'refund_queued' end;
  end if;
  if p_amount_paise <> v_pay.amount_paise then raise exception 'amount_mismatch'; end if;

  update public.payments set status = 'captured', provider_payment_id = p_payment_id,
    method = p_method, failure_reason = null where id = v_pay.id;

  select * into v_b from public.bookings where id = v_pay.booking_id for update;

  if v_b.status in ('confirmed', 'completed') then
    -- the booking was already paid by another order (double checkout): refund this one, keep the booking
    insert into public.refunds (payment_id, booking_id, amount_paise, reason, idempotency_key)
    values (v_pay.id, v_b.id, v_pay.amount_paise, 'admin', 'duplicate:' || v_pay.id)
    on conflict (idempotency_key) do nothing;
    return 'refund_queued';
  end if;

  if v_b.status = 'pending_payment' and v_b.seats_state = 'held' then
    update public.slots set seats_held = seats_held - v_b.group_size, seats_booked = seats_booked + v_b.group_size
     where id = v_b.slot_id;
    v_ok := true;
  elsif v_b.status = 'expired' then
    -- paid after the hold ran out: take the seats again if they are still free
    update public.slots set seats_booked = seats_booked + v_b.group_size
     where id = v_b.slot_id and status = 'open' and starts_at > now()
       and capacity - seats_held - seats_booked >= v_b.group_size;
    v_ok := found;
  end if;

  if v_ok then
    update public.bookings set status = 'confirmed', seats_state = 'booked', hold_expires_at = null
     where id = v_b.id;
    perform public.enqueue_notification(public.booking_email(v_b.id), 'booking_confirmed',
      public.booking_email_payload(v_b.id), 'confirmed:' || v_b.id);
    perform public.assign_operator(v_b.id);
    return 'confirmed';
  end if;

  -- paid, but the booking cannot stand (seats gone, or it was cancelled): full refund
  update public.bookings set status = 'cancelled', cancel_reason = coalesce(cancel_reason, 'payment_late'),
    cancelled_at = coalesce(cancelled_at, now()), seats_state = 'released' where id = v_b.id;
  insert into public.refunds (payment_id, booking_id, amount_paise, reason, idempotency_key)
  values (v_pay.id, v_b.id, v_pay.amount_paise,
          case when v_b.cancel_reason = 'platform_closure' then 'platform_closure' else 'payment_late' end, 'late:' || v_pay.id)
  on conflict (idempotency_key) do nothing;
  -- a closure cancelled it: say so (with the closure's reason), not "the trip filled up"
  perform public.enqueue_notification(public.booking_email(v_b.id),
    case when v_b.cancel_reason = 'platform_closure' then 'closure_cancelled' else 'payment_refunded_seats_gone' end,
    public.booking_email_payload(v_b.id) || jsonb_build_object('reason', (select c.reason from public.closures c
      join public.slots s on s.id = v_b.slot_id
      where (c.route_id is null or c.route_id = v_b.route_id) and public.ist_date(s.starts_at) between c.starts_on and c.ends_on
      order by c.created_at desc limit 1)),
    'late:' || v_b.id);
  return 'refund_queued';
end $$;

create or replace function public.payment_failed(p_order_id text, p_reason text) returns void
language sql security definer set search_path = '' as $$
  update public.payments set status = 'failed', failure_reason = left(p_reason, 500)
  where provider_order_id = p_order_id and status in ('created', 'failed')
$$;

-- ---------------------------------------------------------------------------
-- holds that were never paid give their seats back (cron)
-- ---------------------------------------------------------------------------
create or replace function public.expire_holds() returns int
language plpgsql security definer set search_path = '' as $$
declare v_b record; v_n int := 0;
begin
  for v_b in select id, slot_id, group_size from public.bookings
             where status = 'pending_payment' and seats_state = 'held' and hold_expires_at < now()
             for update skip locked loop
    update public.slots set seats_held = seats_held - v_b.group_size where id = v_b.slot_id;
    update public.bookings set status = 'expired', seats_state = 'released' where id = v_b.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- refund policy: the only place it is written down
-- ---------------------------------------------------------------------------
create or replace function public.refund_quote(p_booking uuid)
returns table (percent int, amount_paise int, hours_before numeric, rule text)
language plpgsql stable security definer set search_path = '' as $$
declare v_b public.bookings; v_start timestamptz; v_paid int;
begin
  select * into v_b from public.bookings where id = p_booking;
  if not found or (v_b.user_id is distinct from auth.uid() and not public.is_admin()) then
    raise exception 'booking_not_found';
  end if;
  if v_b.status <> 'confirmed' then raise exception 'booking_not_cancellable'; end if;

  select starts_at into v_start from public.slots where id = v_b.slot_id;
  select coalesce(sum(p.amount_paise - p.amount_refunded_paise), 0) into v_paid
    from public.payments p where p.booking_id = v_b.id and p.status in ('captured', 'partially_refunded')
      and not exists (select 1 from public.refunds r where r.payment_id = p.id); -- skip a duplicate already being refunded
  hours_before := round(extract(epoch from (v_start - now())) / 3600.0, 2);

  if hours_before >= public.setting_int('refund_full_hours') then
    percent := 100; rule := 'full';
  elsif hours_before > 0 then
    percent := public.setting_int('refund_late_percent'); rule := 'late';
  else
    percent := 0; rule := 'started';
  end if;
  amount_paise := floor(v_paid * percent / 100.0)::int;
  return next;
end $$;

-- ---------------------------------------------------------------------------
-- rafter cancels
-- ---------------------------------------------------------------------------
create or replace function public.cancel_booking(p_booking uuid)
returns table (refund_paise int, rule text)
language plpgsql security definer set search_path = '' as $$
declare v_b public.bookings; v_q record; v_pay public.payments;
begin
  select * into v_b from public.bookings where id = p_booking for update;
  if not found or v_b.user_id is distinct from auth.uid() then raise exception 'booking_not_found'; end if;

  if v_b.status = 'pending_payment' then
    update public.slots set seats_held = seats_held - v_b.group_size where id = v_b.slot_id;
    update public.bookings set status = 'cancelled', cancel_reason = 'customer', cancelled_at = now(),
      seats_state = 'released' where id = v_b.id;
    refund_paise := 0; rule := 'unpaid'; return next; return;
  end if;

  select * into v_q from public.refund_quote(p_booking);
  if v_q.rule = 'started' then raise exception 'trip_already_started'; end if;

  update public.slots set seats_booked = seats_booked - v_b.group_size where id = v_b.slot_id;
  update public.bookings set status = 'cancelled', cancel_reason = 'customer', cancelled_at = now(),
    seats_state = 'released' where id = v_b.id;
  update public.assignments set status = 'withdrawn' where booking_id = v_b.id and status in ('offered', 'accepted');

  if v_q.amount_paise > 0 then
    select * into v_pay from public.payments where booking_id = v_b.id and status = 'captured'
      and not exists (select 1 from public.refunds r where r.payment_id = payments.id)
      order by created_at limit 1;
    insert into public.refunds (payment_id, booking_id, amount_paise, reason, idempotency_key)
    values (v_pay.id, v_b.id, v_q.amount_paise,
            case when v_q.percent = 100 then 'customer_full' else 'customer_partial' end,
            'cancel:' || v_b.id);
  end if;
  perform public.enqueue_notification(public.booking_email(v_b.id), 'booking_cancelled',
    public.booking_email_payload(v_b.id) || jsonb_build_object('refund_paise', v_q.amount_paise),
    'cancelled:' || v_b.id);
  refund_paise := v_q.amount_paise; rule := v_q.rule; return next;
end $$;

-- ---------------------------------------------------------------------------
-- rafter reschedules to another slot on the same route
-- ---------------------------------------------------------------------------
create or replace function public.reschedule_booking(p_booking uuid, p_new_slot uuid) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare v_b public.bookings; v_old public.slots; v_new public.slots;
begin
  select * into v_b from public.bookings where id = p_booking for update;
  if not found or v_b.user_id is distinct from auth.uid() then raise exception 'booking_not_found'; end if;
  if v_b.status <> 'confirmed' then raise exception 'booking_not_reschedulable'; end if;
  select * into v_old from public.slots where id = v_b.slot_id;
  if v_old.starts_at - now() < make_interval(hours => public.setting_int('reschedule_free_hours')) then
    raise exception 'too_late_to_reschedule';
  end if;
  select * into v_new from public.slots where id = p_new_slot;
  if not found or v_new.route_id <> v_b.route_id or v_new.id = v_old.id then raise exception 'slot_not_found'; end if;
  if v_new.status <> 'open' or public.is_closed(v_new.route_id, public.ist_date(v_new.starts_at)) then
    raise exception 'slot_closed';
  end if;
  if v_new.starts_at < now() + make_interval(mins => public.setting_int('booking_cutoff_minutes')) then
    raise exception 'too_late_to_book';
  end if;

  update public.slots set seats_booked = seats_booked + v_b.group_size
   where id = v_new.id and capacity - seats_held - seats_booked >= v_b.group_size;
  if not found then raise exception 'not_enough_seats'; end if;
  update public.slots set seats_booked = seats_booked - v_b.group_size where id = v_old.id;

  update public.assignments set status = 'withdrawn' where booking_id = v_b.id and status in ('offered', 'accepted');
  update public.bookings set slot_id = v_new.id, rescheduled_from_slot_id = v_old.id, reminder_sent_at = null,
    operator_id = null, assignment_status = 'unassigned' where id = v_b.id;
  perform public.assign_operator(v_b.id);
  perform public.enqueue_notification(public.booking_email(v_b.id), 'booking_rescheduled',
    public.booking_email_payload(v_b.id), 'rescheduled:' || v_b.id || ':' || v_new.id);
  select * into v_b from public.bookings where id = p_booking;
  return v_b;
end $$;

-- ---------------------------------------------------------------------------
-- operator accepts or declines an offer
-- ---------------------------------------------------------------------------
create or replace function public.operator_respond(p_booking uuid, p_accept boolean) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare v_b public.bookings;
begin
  select * into v_b from public.bookings where id = p_booking for update;
  if not found or not public.is_operator_member(v_b.operator_id) then raise exception 'booking_not_found'; end if;
  if v_b.assignment_status <> 'offered' or v_b.status <> 'confirmed' then raise exception 'no_open_offer'; end if;

  update public.assignments set status = case when p_accept then 'accepted' else 'declined' end,
    responded_at = now(), responded_by = auth.uid()
   where booking_id = v_b.id and operator_id = v_b.operator_id and status = 'offered';

  if p_accept then
    update public.bookings set assignment_status = 'accepted' where id = v_b.id;
  else
    perform public.assign_operator(v_b.id);
  end if;
  select * into v_b from public.bookings where id = p_booking;
  return v_b;
end $$;

-- ---------------------------------------------------------------------------
-- admin: slots, closures, verification
-- ---------------------------------------------------------------------------
create or replace function public.generate_slots(
  p_route uuid, p_from date, p_to date, p_times time[], p_capacity int default null) returns int
language plpgsql security definer set search_path = '' as $$
declare v_cap int; v_n int;
begin
  if not public.is_admin() and not public.is_service() then raise exception 'forbidden'; end if;
  if p_to < p_from or p_to - p_from > 370 then raise exception 'invalid_date_range'; end if;
  v_cap := coalesce(p_capacity, (select coalesce(sum(r.seats_per_slot), 0) from public.operator_routes r
                    join public.operators o on o.id = r.operator_id
                    where r.route_id = p_route and o.status = 'verified'));
  if v_cap = 0 and p_capacity is null then raise exception 'no_verified_operators'; end if;
  insert into public.slots (route_id, starts_at, capacity)
  select p_route, (d::date + t) at time zone 'Asia/Kolkata', v_cap
  from generate_series(p_from, p_to, interval '1 day') d, unnest(p_times) t
  where not public.is_closed(p_route, d::date)
  on conflict (route_id, starts_at) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- close a route (or the whole river when p_route is null): cancels and fully refunds affected trips
create or replace function public.close_river(
  p_route uuid, p_from date, p_to date, p_reason text, p_note text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare v_b record; v_n int := 0; v_closure uuid;
begin
  if not public.is_admin() and not public.is_service() then raise exception 'forbidden'; end if;
  insert into public.closures (route_id, starts_on, ends_on, reason, note, created_by)
  values (p_route, p_from, p_to, p_reason, p_note, auth.uid()) returning id into v_closure;

  update public.slots set status = 'closed'
   where (p_route is null or route_id = p_route) and public.ist_date(starts_at) between p_from and p_to;

  for v_b in select b.*, p.id as payment_id, p.amount_paise - p.amount_refunded_paise as net_paid
             from public.bookings b join public.slots s on s.id = b.slot_id
             left join public.payments p on p.booking_id = b.id and p.status = 'captured'
               and not exists (select 1 from public.refunds r where r.payment_id = p.id) -- one row per booking
             where (p_route is null or b.route_id = p_route)
               and public.ist_date(s.starts_at) between p_from and p_to
               and b.status in ('confirmed', 'pending_payment')
             for update of b loop
    update public.slots set
      seats_booked = seats_booked - case when v_b.seats_state = 'booked' then v_b.group_size else 0 end,
      seats_held   = seats_held   - case when v_b.seats_state = 'held'   then v_b.group_size else 0 end
     where id = v_b.slot_id;
    update public.bookings set status = 'cancelled', cancel_reason = 'platform_closure', cancelled_at = now(),
      seats_state = 'released' where id = v_b.id;
    update public.assignments set status = 'withdrawn' where booking_id = v_b.id and status in ('offered', 'accepted');
    if v_b.payment_id is not null and v_b.net_paid > 0 then
      insert into public.refunds (payment_id, booking_id, amount_paise, reason, idempotency_key)
      values (v_b.payment_id, v_b.id, v_b.net_paid, 'platform_closure', 'closure:' || v_b.id)
      on conflict (idempotency_key) do nothing;
    end if;
    if v_b.status = 'confirmed' then
      perform public.enqueue_notification(public.booking_email(v_b.id), 'closure_cancelled',
        public.booking_email_payload(v_b.id) || jsonb_build_object('reason', p_reason), 'closure:' || v_b.id);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.verify_operator(
  p_operator uuid, p_season text, p_checks jsonb, p_permit_number text, p_permit_expires_on date,
  p_notes text default null) returns public.verifications
language plpgsql security definer set search_path = '' as $$
declare
  v_keys text[] := array['gear', 'guides', 'briefing', 'kayaker', 'gps', 'incident_reporting',
                         'customer_service', 'permit'];
  v_k text; v_pass boolean := true; v_row public.verifications;
begin
  if not public.is_admin() and not public.is_service() then raise exception 'forbidden'; end if;
  foreach v_k in array v_keys loop
    if jsonb_typeof(p_checks -> v_k) is distinct from 'boolean' then
      raise exception 'invalid_checklist' using hint = 'missing ' || v_k;
    end if;
    v_pass := v_pass and (p_checks ->> v_k)::boolean;
  end loop;
  v_pass := v_pass and p_permit_expires_on >= current_date;

  insert into public.verifications (operator_id, season, checks, permit_number, permit_expires_on, result, notes, checked_by)
  values (p_operator, p_season, p_checks, p_permit_number, p_permit_expires_on,
          case when v_pass then 'pass' else 'fail' end, p_notes, auth.uid())
  returning * into v_row;

  update public.operators set status = case when v_pass then 'verified' else 'suspended' end,
    permit_number = p_permit_number, permit_expires_on = p_permit_expires_on where id = p_operator;
  if not found then raise exception 'operator_not_found'; end if;
  return v_row;
end $$;

-- ---------------------------------------------------------------------------
-- trip day (operator staff)
-- ---------------------------------------------------------------------------
create or replace function public.assert_trip_window(p_booking uuid) returns public.bookings
language plpgsql stable security definer set search_path = '' as $$
declare v_b public.bookings; v_start timestamptz;
begin
  select * into v_b from public.bookings where id = p_booking;
  if not found or not public.is_operator_member(v_b.operator_id) then raise exception 'booking_not_found'; end if;
  if v_b.status not in ('confirmed', 'completed') or v_b.assignment_status <> 'accepted' then
    raise exception 'booking_not_active';
  end if;
  select starts_at into v_start from public.slots where id = v_b.slot_id;
  if now() not between v_start - interval '3 hours' and v_start + interval '12 hours' then
    raise exception 'outside_trip_window';
  end if;
  return v_b;
end $$;

create or replace function public.record_checkpoint(p_booking uuid, p_seq int, p_lat float8, p_lng float8)
returns public.checkpoints
language plpgsql security definer set search_path = '' as $$
declare v_b public.bookings; v_z public.route_zones; v_d int; v_row public.checkpoints; v_done int;
begin
  v_b := public.assert_trip_window(p_booking);
  select count(*) into v_done from public.checkpoints where booking_id = p_booking;
  if p_seq <> v_done + 1 then raise exception 'checkpoint_out_of_order' using hint = 'next is ' || (v_done + 1); end if;
  select * into v_z from public.route_zones where route_id = v_b.route_id and seq = p_seq;
  if not found then raise exception 'zone_not_configured'; end if;
  v_d := public.distance_m(p_lat, p_lng, v_z.lat, v_z.lng);
  insert into public.checkpoints (booking_id, seq, lat, lng, distance_m, in_zone, scanned_by)
  values (p_booking, p_seq, p_lat, p_lng, v_d, v_d <= v_z.radius_m, auth.uid()) returning * into v_row;
  insert into public.gps_pings (booking_id, lat, lng) values (p_booking, p_lat, p_lng);
  if p_seq = 3 then update public.bookings set status = 'completed' where id = p_booking; end if;
  if not v_row.in_zone then
    perform public.enqueue_notification(public.setting_text('ops_email'), 'ops_checkpoint_out_of_zone',
      public.booking_email_payload(p_booking) || jsonb_build_object('seq', p_seq, 'distance_m', v_d),
      'zone:' || v_row.id);
  end if;
  return v_row;
end $$;

create or replace function public.add_gps_ping(p_booking uuid, p_lat float8, p_lng float8) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_trip_window(p_booking);
  insert into public.gps_pings (booking_id, lat, lng) values (p_booking, p_lat, p_lng);
end $$;

create or replace function public.report_incident(p_booking uuid, p_severity text, p_description text)
returns public.incidents
language plpgsql security definer set search_path = '' as $$
declare v_b public.bookings; v_row public.incidents;
begin
  select * into v_b from public.bookings where id = p_booking;
  if not found or not public.is_operator_member(v_b.operator_id) then raise exception 'booking_not_found'; end if;
  insert into public.incidents (booking_id, operator_id, severity, description, reported_by)
  values (v_b.id, v_b.operator_id, p_severity, p_description, auth.uid()) returning * into v_row;
  if p_severity in ('high', 'critical') then
    perform public.enqueue_notification(public.setting_text('ops_email'), 'ops_incident',
      public.booking_email_payload(v_b.id) || jsonb_build_object('severity', p_severity), 'incident:' || v_row.id);
  end if;
  return v_row;
end $$;

-- ---------------------------------------------------------------------------
-- family tracking link (owner creates, anyone with the token reads)
-- ---------------------------------------------------------------------------
create or replace function public.create_tracking_link(p_booking uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_b public.bookings; v_token text; v_start timestamptz;
begin
  select * into v_b from public.bookings where id = p_booking;
  if not found or v_b.user_id is distinct from auth.uid() then raise exception 'booking_not_found'; end if;
  if v_b.status <> 'confirmed' then raise exception 'booking_not_active'; end if;
  select starts_at into v_start from public.slots where id = v_b.slot_id;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.tracking_links (token, booking_id, created_by, expires_at)
  values (v_token, v_b.id, auth.uid(), v_start + interval '12 hours');
  return v_token;
end $$;

-- deliberately returns no names, phones or prices
create or replace function public.get_tracking(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'route', r.name, 'starts_at', s.starts_at, 'status', b.status,
    'last_ping', (select jsonb_build_object('lat', g.lat, 'lng', g.lng, 'at', g.recorded_at)
                  from public.gps_pings g where g.booking_id = b.id order by g.recorded_at desc limit 1),
    'checkpoints', coalesce((select jsonb_agg(jsonb_build_object('seq', c.seq, 'label', z.label,
                    'at', c.scanned_at, 'in_zone', c.in_zone) order by c.seq)
                  from public.checkpoints c
                  join public.route_zones z on z.route_id = b.route_id and z.seq = c.seq
                  where c.booking_id = b.id), '[]'))
  from public.tracking_links t
  join public.bookings b on b.id = t.booking_id
  join public.routes r on r.id = b.route_id
  join public.slots s on s.id = b.slot_id
  where t.token = p_token and t.revoked_at is null and t.expires_at > now()
$$;

-- ---------------------------------------------------------------------------
-- job runner helpers (service role)
-- claiming pushes next_attempt_at forward, which doubles as a lease
-- ---------------------------------------------------------------------------
create or replace function public.claim_refunds(p_limit int default 20) returns setof public.refunds
language sql security definer set search_path = '' as $$
  update public.refunds r set attempts = r.attempts + 1,
    next_attempt_at = now() + make_interval(mins => power(2, least(r.attempts, 6))::int)
  where r.id in (select id from public.refunds
                 -- also re-check a refund still 'submitted' after a day, in case Razorpay's webhook never came
                 where (status in ('pending', 'failed') or (status = 'submitted' and updated_at < now() - interval '1 day'))
                   and next_attempt_at <= now()
                 order by next_attempt_at limit p_limit for update skip locked)
  returning r.*
$$;

create or replace function public.refund_submitted(p_refund uuid, p_provider_refund_id text, p_processed boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.refunds;
begin
  update public.refunds set provider_refund_id = p_provider_refund_id, last_error = null,
    status = case when status = 'processed' then 'processed' else 'submitted' end
   where id = p_refund returning * into v_r;
  if p_processed then perform public.refund_processed(p_provider_refund_id, v_r.idempotency_key); end if;
end $$;

create or replace function public.refund_error(p_refund uuid, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_r public.refunds;
begin
  update public.refunds set last_error = left(p_error, 1000),
    status = case when attempts >= 5 then 'dead' else 'failed' end
   where id = p_refund returning * into v_r;
  if v_r.status = 'dead' then
    perform public.enqueue_notification(public.setting_text('ops_email'), 'ops_refund_dead',
      public.booking_email_payload(v_r.booking_id) || jsonb_build_object('error', left(p_error, 300)),
      'refund_dead:' || v_r.id);
  end if;
end $$;

-- Razorpay says the refund is done (webhook, or instant response). Counted once.
create or replace function public.refund_processed(p_provider_refund_id text, p_receipt text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_r public.refunds;
begin
  select * into v_r from public.refunds
   where provider_refund_id = p_provider_refund_id or (p_receipt is not null and idempotency_key = p_receipt)
   for update limit 1;
  if not found or v_r.status = 'processed' then return; end if;
  update public.refunds set status = 'processed', provider_refund_id = p_provider_refund_id where id = v_r.id;
  update public.payments set amount_refunded_paise = amount_refunded_paise + v_r.amount_paise,
    status = case when amount_refunded_paise + v_r.amount_paise >= amount_paise then 'refunded' else 'partially_refunded' end
   where id = v_r.payment_id;
  perform public.enqueue_notification(public.booking_email(v_r.booking_id), 'refund_processed',
    public.booking_email_payload(v_r.booking_id) || jsonb_build_object('refund_paise', v_r.amount_paise),
    'refunded:' || v_r.id);
end $$;

create or replace function public.claim_notifications(p_limit int default 50) returns setof public.notifications
language sql security definer set search_path = '' as $$
  update public.notifications n set attempts = n.attempts + 1,
    next_attempt_at = now() + make_interval(mins => power(2, least(n.attempts, 6))::int)
  where n.id in (select id from public.notifications
                 where status in ('pending', 'failed') and next_attempt_at <= now()
                 order by next_attempt_at limit p_limit for update skip locked)
  returning n.*
$$;

create or replace function public.notification_result(p_id uuid, p_error text) returns void
language sql security definer set search_path = '' as $$
  update public.notifications set
    status = case when p_error is null then 'sent' when attempts >= 5 then 'dead' else 'failed' end,
    sent_at = case when p_error is null then now() end,
    last_error = left(p_error, 1000)
  where id = p_id
$$;

create or replace function public.queue_reminders() returns int
language plpgsql security definer set search_path = '' as $$
declare v_b record; v_n int := 0;
begin
  for v_b in select b.id from public.bookings b join public.slots s on s.id = b.slot_id
             where b.status = 'confirmed' and b.reminder_sent_at is null
               and s.starts_at > now()
               and s.starts_at <= now() + make_interval(hours => public.setting_int('reminder_hours_before'))
             for update of b skip locked loop
    perform public.enqueue_notification(public.booking_email(v_b.id), 'trip_reminder',
      public.booking_email_payload(v_b.id), 'reminder:' || v_b.id);
    update public.bookings set reminder_sent_at = now() where id = v_b.id;
    v_n := v_n + 1;
  end loop;
  -- not a reminder: this per-minute job also prunes day-old rate-limit counters
  delete from public.rate_limits where window_start < now() - interval '1 day';
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- account deletion: scrub personal data, keep anonymised money records
-- ---------------------------------------------------------------------------
create or replace function public.scrub_my_data() returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if exists (select 1 from public.bookings b join public.slots s on s.id = b.slot_id
             where b.user_id = v_uid and b.status = 'confirmed' and s.starts_at > now()) then
    raise exception 'has_upcoming_bookings';
  end if;
  update public.participants set full_name = 'deleted', phone = null, health_notes = null
   where booking_id in (select id from public.bookings where user_id = v_uid);
  update public.bookings set contact_email = null, contact_phone = null where user_id = v_uid;
  delete from public.tracking_links where created_by = v_uid;
  delete from public.operator_members where user_id = v_uid;
end $$;
