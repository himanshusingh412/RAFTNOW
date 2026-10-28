-- Local development seed. Fake operators and fake people only; nothing here is real.
-- Prices and the GST rate are placeholders: set real ones with your accountant before launch.
-- Checkpoint coordinates are rough; replace them with a GPS survey of each put-in and take-out.

-- test users (sign in locally with email OTP; codes appear in Supabase's local mail viewer)
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@example.com',   now(), '{"full_name":"Asha Admin"}'),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rafter@example.com',  now(), '{"full_name":"Ravi Rafter"}'),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rafter2@example.com', now(), '{"full_name":"Meera Second"}'),
  ('00000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ops-a@example.com',   now(), '{"full_name":"Kiran Ganga Ops"}'),
  ('00000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ops-b@example.com',   now(), '{"full_name":"Dev Bluewater Ops"}');
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-000000000001';

update public.settings set value = '"ops@example.com"' where key = 'ops_email';
update public.settings set value = '"+91 00000 00000"' where key = 'support_phone';

-- routes (one row per stretch: the single source of truth for its facts)
insert into public.routes (id, slug, name, put_in, take_out, category, distance_km_min, distance_km_max,
  water_minutes_min, water_minutes_max, grade, min_age, max_age, price_paise, platform_fee_paise, gst_rate_bps) values
  ('10000000-0000-4000-8000-000000000001', 'brahmpuri',    'Brahmpuri',         'Brahmpuri',    'Rishikesh', 'family',    7,  9,  75, 120, 'II-III',          12, 65, 99900,  9900, 1800),
  ('10000000-0000-4000-8000-000000000002', 'shivpuri',     'Shivpuri',          'Shivpuri',     'Rishikesh', 'moderate', 14, 16, 120, 180, 'III (one IV)',    14, 65, 139900, 12900, 1800),
  ('10000000-0000-4000-8000-000000000003', 'marine-drive', 'Marine Drive',      'Marine Drive', 'Rishikesh', 'moderate', 24, 26, 180, 240, 'III-IV',          16, 60, 209900, 17900, 1800),
  ('10000000-0000-4000-8000-000000000004', 'kaudiyala',    'Kaudiyala',         'Kaudiyala',    'Rishikesh', 'expert',   35, 36, 300, 360, 'III-IV',          18, 55, 349900, 24900, 1800);

insert into public.rapids (id, name, grade) values
  ('20000000-0000-4000-8000-000000000001', 'Roller Coaster', 'III+'),
  ('20000000-0000-4000-8000-000000000002', 'Golf Course', 'III+'),
  ('20000000-0000-4000-8000-000000000003', 'Club House', 'II'),
  ('20000000-0000-4000-8000-000000000004', 'Three Blind Mice', 'III'),
  ('20000000-0000-4000-8000-000000000005', 'Crossfire', 'III'),
  ('20000000-0000-4000-8000-000000000006', 'Wall', 'IV'),
  ('20000000-0000-4000-8000-000000000007', 'Initiation', 'II');

insert into public.route_rapids (route_id, rapid_id, position) values
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000007', 1),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 1),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 2),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003', 3),
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000004', 1),
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000005', 2),
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 3),
  ('10000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000006', 1),
  ('10000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000004', 2);

insert into public.addons (code, name, price_paise, per) values
  ('photos',     'Trip photographer (all photos)', 79900, 'booking'),
  ('pickup',     'Hotel pickup in Rishikesh',      29900, 'person'),
  ('cliff_jump', 'Cliff jump stop',                19900, 'person');

-- approximate zones: 1 put-in, 2 mid-river, 3 take-out
insert into public.route_zones (route_id, seq, label, lat, lng, radius_m)
select r.id, z.seq, z.label, z.lat, z.lng, 400
from public.routes r
join (values
  ('shivpuri', 1, 'Put-in',     30.1340, 78.3880),
  ('shivpuri', 2, 'Beach stop', 30.1210, 78.3420),
  ('shivpuri', 3, 'Take-out',   30.1270, 78.3200),
  ('brahmpuri', 1, 'Put-in',    30.1180, 78.3390),
  ('brahmpuri', 2, 'Midway',    30.1230, 78.3290),
  ('brahmpuri', 3, 'Take-out',  30.1270, 78.3200)
) as z(slug, seq, label, lat, lng) on z.slug = r.slug;

-- two fake operators, both verified for this season
insert into public.operators (id, name, slug, contact_email, permit_number, permit_expires_on, status) values
  ('30000000-0000-4000-8000-000000000001', 'Ganga Test Rafting', 'ganga-test',  'ops-a@example.com', 'TEST-PERMIT-001', current_date + 300, 'pending'),
  ('30000000-0000-4000-8000-000000000002', 'Bluewater Test Co',  'bluewater-test', 'ops-b@example.com', 'TEST-PERMIT-002', current_date + 300, 'pending');
insert into public.operator_members (operator_id, user_id, role) values
  ('30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000004', 'owner'),
  ('30000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000005', 'owner');
insert into public.operator_routes (operator_id, route_id, seats_per_slot)
select o.id, r.id, 16 from public.operators o cross join public.routes r;
insert into public.guides (operator_id, full_name, swiftwater_cert_expires_on, river_experience_years) values
  ('30000000-0000-4000-8000-000000000001', 'Test Guide One', current_date + 400, 6),
  ('30000000-0000-4000-8000-000000000002', 'Test Guide Two', current_date + 400, 9);

select public.verify_operator(o.id, public.season_for(current_date),
  '{"gear":true,"guides":true,"briefing":true,"kayaker":true,"gps":true,"incident_reporting":true,"customer_service":true,"permit":true}',
  o.permit_number, o.permit_expires_on, 'seed')
from public.operators o;

-- monsoon closure for next year, then 30 days of slots at 08:00, 11:00, 14:00 IST
insert into public.closures (route_id, starts_on, ends_on, reason, note)
values (null, make_date(extract(year from current_date)::int + 1, 7, 1),
              make_date(extract(year from current_date)::int + 1, 9, 15), 'monsoon', 'State order: river closed');

select public.generate_slots(r.id, current_date, current_date + 30, array['08:00','11:00','14:00']::time[])
from public.routes r;
