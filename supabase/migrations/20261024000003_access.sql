-- Rafting marketplace: who can read what.
-- Reads: row level security on every table. Writes: only through the functions in
-- 20261024000002_functions.sql. Clients never insert/update/delete tables directly.

-- ---------------------------------------------------------------------------
-- RLS on, everywhere
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- profile owners may edit their name and phone, nothing else (not role)
grant update (full_name, phone) on public.profiles to authenticated;

-- operators read the bookings offered to them; the booker's contact details stay out of the API
-- (emails read them inside functions). A new bookings column must be added here to be readable.
revoke select on public.bookings from authenticated;
grant select (id, reference, user_id, route_id, slot_id, group_size, status, hold_expires_at, seats_state, addons,
  subtotal_paise, addons_paise, platform_fee_paise, gst_paise, total_paise, currency, channel, operator_id,
  assignment_status, cancelled_at, cancel_reason, rescheduled_from_slot_id, reminder_sent_at, created_at, updated_at)
  on public.bookings to authenticated;

-- ---------------------------------------------------------------------------
-- public catalogue
-- ---------------------------------------------------------------------------
create policy "catalogue is public" on public.routes for select to anon, authenticated
  using (is_active or (select public.is_admin()));
create policy "catalogue is public" on public.rapids for select to anon, authenticated using (true);
create policy "catalogue is public" on public.route_rapids for select to anon, authenticated using (true);
create policy "catalogue is public" on public.addons for select to anon, authenticated
  using (is_active or (select public.is_admin()));
create policy "catalogue is public" on public.route_zones for select to anon, authenticated using (true);
create policy "catalogue is public" on public.closures for select to anon, authenticated using (true);
create policy "catalogue is public" on public.slots for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- people
-- ---------------------------------------------------------------------------
create policy "own profile" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy "own profile edit" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "members and admins" on public.operators for select to authenticated
  using (public.is_operator_member(id) or (select public.is_admin()));
create policy "own memberships" on public.operator_members for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "members and admins" on public.operator_routes for select to authenticated
  using (public.is_operator_member(operator_id) or (select public.is_admin()));
create policy "members and admins" on public.guides for select to authenticated
  using (public.is_operator_member(operator_id) or (select public.is_admin()));
create policy "members and admins" on public.verifications for select to authenticated
  using (public.is_operator_member(operator_id) or (select public.is_admin()));
create policy "members and admins" on public.assignments for select to authenticated
  using (public.is_operator_member(operator_id) or (select public.is_admin()));
create policy "members and admins" on public.incidents for select to authenticated
  using (public.is_operator_member(operator_id) or (select public.is_admin()));

-- ---------------------------------------------------------------------------
-- bookings: the rafter, the operator it is assigned to, admins
-- ---------------------------------------------------------------------------
create policy "booking parties" on public.bookings for select to authenticated
  using (user_id = (select auth.uid()) or public.is_operator_member(operator_id) or (select public.is_admin()));

-- operators see names only once they have accepted the trip
create policy "booking parties" on public.participants for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and (
    b.user_id = (select auth.uid())
    or (b.assignment_status = 'accepted' and public.is_operator_member(b.operator_id))
    or (select public.is_admin()))));

create policy "booking parties" on public.checkpoints for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and (
    b.user_id = (select auth.uid()) or public.is_operator_member(b.operator_id) or (select public.is_admin()))));
create policy "booking parties" on public.gps_pings for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and (
    b.user_id = (select auth.uid()) or public.is_operator_member(b.operator_id) or (select public.is_admin()))));
create policy "link owner" on public.tracking_links for select to authenticated
  using (created_by = (select auth.uid()) or (select public.is_admin()));

-- money: the payer and admins (operators get no payment details)
create policy "payer and admins" on public.payments for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and b.user_id = (select auth.uid()))
         or (select public.is_admin()));
create policy "payer and admins" on public.refunds for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and b.user_id = (select auth.uid()))
         or (select public.is_admin()));

-- ---------------------------------------------------------------------------
-- internal tables: admins read, service role writes
-- ---------------------------------------------------------------------------
create policy "admins" on public.settings for select to authenticated using ((select public.is_admin()));
create policy "admins" on public.webhook_events for select to authenticated using ((select public.is_admin()));
create policy "admins" on public.notifications for select to authenticated using ((select public.is_admin()));
-- rate_limits: no policy at all, service role only

-- ---------------------------------------------------------------------------
-- functions: nobody by default, then exactly who needs each one
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

-- used inside RLS policies, so the querying role must be able to call them
grant execute on function public.is_admin(), public.is_operator_member(uuid) to anon, authenticated;

grant execute on function public.get_tracking(text) to anon, authenticated;

-- pure helpers, safe for anyone
grant execute on function public.ist_date(timestamptz), public.season_for(date),
  public.distance_m(float8, float8, float8, float8) to anon, authenticated;

grant execute on function
  public.create_booking(uuid, jsonb, jsonb, text, text),
  public.cancel_booking(uuid),
  public.reschedule_booking(uuid, uuid),
  public.refund_quote(uuid),
  public.create_tracking_link(uuid),
  public.scrub_my_data(),
  public.operator_respond(uuid, boolean),
  public.record_checkpoint(uuid, int, float8, float8),
  public.add_gps_ping(uuid, float8, float8),
  public.report_incident(uuid, text, text),
  public.generate_slots(uuid, date, date, time[], int),   -- admin check inside
  public.close_river(uuid, date, date, text, text),       -- admin check inside
  public.verify_operator(uuid, text, jsonb, text, date, text) -- admin check inside
to authenticated;

-- keep it that way for functions added later
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
