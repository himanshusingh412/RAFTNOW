-- Cancellation policy, reschedule, closures, verification, trip day, job runner, deletion.
\set admin   '00000000-0000-4000-8000-000000000001'
\set rafter  '00000000-0000-4000-8000-000000000002'
\set rafter2 '00000000-0000-4000-8000-000000000003'
\set opsa    '00000000-0000-4000-8000-000000000004'
\set opsb    '00000000-0000-4000-8000-000000000005'

-- helper: book + pay as a user, returns booking id
create function test.book_paid(p_user uuid, p_slot uuid, p_ages int[]) returns uuid language plpgsql as $$
declare v_id uuid; v_total int;
begin
  perform test.login(p_user);
  select id, total_paise into v_id, v_total from public.create_booking(p_slot, test.people(p_ages));
  perform test.logout();
  perform public.attach_order(v_id, 'order_' || v_id);
  perform public.confirm_payment('order_' || v_id, 'pay_' || v_id, v_total);
  return v_id;
end $$;

-- ---------------- cancel 48h+ ahead -> full refund
create temp table c1 as select test.book_paid(:'rafter', test.slot('shivpuri', 12, 8), array[30, 31]) as id;
grant select on c1 to public;
select test.login(:'rafter');
select test.ok((select percent from public.refund_quote((select id from c1))) = 100, 'quote: 100% when 48h+ away');
select test.login(:'rafter2');
select test.fails($$select * from public.refund_quote((select id from c1))$$, 'booking_not_found', 'second user cannot quote it');
select test.logout();
select test.login(:'rafter');
select test.ok((select refund_paise from public.cancel_booking((select id from c1)))
               = (select total_paise from public.bookings where id = (select id from c1)), 'full refund on early cancel');
select test.logout();
select test.ok((select seats_booked from public.slots where id = test.slot('shivpuri', 12, 8)) = 0, 'cancelled seats released');
select test.ok((select status from public.refunds where idempotency_key = 'cancel:' || (select id from c1)) = 'pending', 'refund queued');
select test.ok((select count(*) from public.assignments where booking_id = (select id from c1) and status = 'withdrawn') = 1,
  'operator offer withdrawn');

-- ---------------- inside 48h -> 50%; inside 24h -> no reschedule; started -> no cancel
create temp table c2 as select test.book_paid(:'rafter', test.slot('shivpuri', 13, 8), array[30]) as id;
grant select on c2 to public;
update public.slots set starts_at = now() + interval '30 hours' where id = test.slot('shivpuri', 13, 8);
select test.login(:'rafter');
select test.ok((select percent || '/' || rule from public.refund_quote((select id from c2))) = '50/late', 'quote: 50% inside 48h');
select test.logout();
update public.slots set starts_at = now() + interval '20 hours'
  where id = (select slot_id from public.bookings where id = (select id from c2));
select test.login(:'rafter');
select test.fails($$select public.reschedule_booking((select id from c2), test.slot('shivpuri', 14, 8))$$,
  'too_late_to_reschedule', 'no free reschedule inside 24h');
select test.logout();
update public.slots set starts_at = now() - interval '1 hour'
  where id = (select slot_id from public.bookings where id = (select id from c2));
select test.login(:'rafter');
select test.ok((select percent from public.refund_quote((select id from c2))) = 0, 'quote: 0% once started');
select test.fails($$select public.cancel_booking((select id from c2))$$, 'trip_already_started', 'cannot cancel a started trip');
select test.logout();

-- ---------------- reschedule 24h+ ahead moves seats and re-runs rotation
create temp table c3 as select test.book_paid(:'rafter', test.slot('brahmpuri', 15, 8), array[30, 31]) as id;
grant select on c3 to public;
select test.login(:'rafter');
select test.fails($$select public.reschedule_booking((select id from c3), test.slot('shivpuri', 16, 8))$$,
  'slot_not_found', 'cannot reschedule onto another route');
select public.reschedule_booking((select id from c3), test.slot('brahmpuri', 16, 11));
select test.logout();
select test.ok((select slot_id from public.bookings where id = (select id from c3)) = test.slot('brahmpuri', 16, 11), 'booking moved');
select test.ok((select seats_booked from public.slots where id = test.slot('brahmpuri', 15, 8)) = 0, 'old slot freed');
select test.ok((select seats_booked from public.slots where id = test.slot('brahmpuri', 16, 11)) = 2, 'new slot taken');
select test.ok((select assignment_status from public.bookings where id = (select id from c3)) = 'offered', 'new operator offer made');

-- ---------------- closures: only admins; full refunds; slots closed
create temp table c4 as select test.book_paid(:'rafter2', test.slot('marine-drive', 18, 8), array[30]) as id;
grant select on c4 to public;
select test.login(:'rafter');
select test.fails($$select public.close_river(null, current_date + 18, current_date + 18, 'weather')$$, 'forbidden', 'rafter cannot close the river');
select test.logout();
select test.login(:'admin');
select test.ok(public.close_river(null, current_date + 18, current_date + 18, 'weather', 'test flood') >= 1, 'admin closes the river for a day');
select test.logout();
select test.ok((select status || '/' || cancel_reason from public.bookings where id = (select id from c4)) = 'cancelled/platform_closure',
  'booking cancelled by closure');
select test.ok((select amount_paise from public.refunds where idempotency_key = 'closure:' || (select id from c4))
               = (select total_paise from public.bookings where id = (select id from c4)), 'closure refund is full');
select test.ok((select count(*) from public.slots where public.ist_date(starts_at) = current_date + 18 and status = 'open') = 0,
  'all slots that day closed');
select test.login(:'rafter');
select test.fails($$select public.create_booking(test.slot('shivpuri', 18, 8), test.people(array[30]))$$, 'slot_closed', 'cannot book a closed day');
select test.logout();
select test.ok((select count(*) from public.notifications where template = 'closure_cancelled') >= 1, 'closure email queued');

-- ---------------- verification: bad checklist rejected; failing operator leaves the rotation
select test.login(:'admin');
select test.fails($$select public.verify_operator('30000000-0000-4000-8000-000000000001', '2026-27', '{"gear":true}', 'P', current_date + 10)$$,
  'invalid_checklist', 'checklist must have all 8 items');
select public.verify_operator('30000000-0000-4000-8000-000000000001', public.season_for(current_date),
  '{"gear":false,"guides":true,"briefing":true,"kayaker":true,"gps":true,"incident_reporting":true,"customer_service":true,"permit":true}',
  'TEST-PERMIT-001', current_date + 300, 'old life jackets');
select test.logout();
select test.ok((select status from public.operators where slug = 'ganga-test') = 'suspended', 'failed check suspends the operator');
create temp table c5 as select test.book_paid(:'rafter', test.slot('shivpuri', 19, 8), array[30]) as id;
grant select on c5 to public;
create temp table c6 as select test.book_paid(:'rafter2', test.slot('shivpuri', 19, 8), array[30]) as id;
grant select on c6 to public;
select test.ok((select bool_and(o.slug = 'bluewater-test') from public.bookings b join public.operators o on o.id = b.operator_id
                where b.id in ((select id from c5), (select id from c6))), 'suspended operator gets no new trips');
select test.login(:'opsb');
select public.operator_respond((select id from c5), true);
select test.logout();

-- ---------------- trip day: checkpoints in order, geofence, completion; tracking link
update public.slots set starts_at = now() + interval '1 hour'
  where id = (select slot_id from public.bookings where id = (select id from c5));
select test.login(:'opsa');
select test.fails($$select public.record_checkpoint((select id from c5), 1, 30.134, 78.388)$$, 'booking_not_found', 'other operator cannot scan');
select test.logout();
select test.login(:'opsb');
select test.fails($$select public.record_checkpoint((select id from c6), 1, 30.134, 78.388)$$, 'booking_not_active', 'cannot scan before accepting');
select test.fails($$select public.record_checkpoint((select id from c5), 2, 30.121, 78.342)$$, 'checkpoint_out_of_order', 'scans must be in order');
select test.ok((select in_zone from public.record_checkpoint((select id from c5), 1, 30.1341, 78.3881)), 'put-in scan inside zone');
select test.ok((select not in_zone from public.record_checkpoint((select id from c5), 2, 30.300, 78.500)), 'far-away scan flagged out of zone');
select public.add_gps_ping((select id from c5), 30.125, 78.330);
select public.record_checkpoint((select id from c5), 3, 30.1270, 78.3200);
select test.logout();
select test.ok((select status from public.bookings where id = (select id from c5)) = 'completed', 'third scan completes the trip');
select test.ok((select count(*) from public.notifications where template = 'ops_checkpoint_out_of_zone') = 1, 'ops alerted about the bad scan');

select test.login(:'rafter2');
select test.fails($$select public.create_tracking_link((select id from c5))$$, 'booking_not_found', 'only the booker can share tracking');
select test.logout();
create temp table c7 as select test.book_paid(:'rafter', test.slot('shivpuri', 20, 8), array[30]) as id;
grant select on c7 to public;
select test.login(:'rafter');
create temp table tok as select public.create_tracking_link((select id from c7)) as t;
grant select on tok to public;
select test.logout();
select test.as_anon();
select test.ok((public.get_tracking((select t from tok)) ->> 'route') = 'Shivpuri', 'anyone with the link sees the trip');
select test.ok(public.get_tracking((select t from tok)) ? 'last_ping' and not (public.get_tracking((select t from tok))::text like '%Test Person%'),
  'tracking shows no names');
select test.ok(public.get_tracking('not-a-token') is null, 'bad token shows nothing');
select test.ok((select count(*) from public.gps_pings) = 0, 'anon cannot read pings directly');
select test.logout();

-- ---------------- job runner: refunds counted once; notifications retried then dead
select test.ok((select count(*) from public.claim_refunds(100)) >= 3, 'refund jobs claimed');
select test.ok((select count(*) from public.claim_refunds(100)) = 0, 'claimed jobs are leased, not handed out twice');
select public.refund_submitted(id, 'rfnd_' || id, true) from public.refunds where idempotency_key = 'cancel:' || (select id from c1);
select public.refund_processed('rfnd_' || id, idempotency_key) from public.refunds where idempotency_key = 'cancel:' || (select id from c1);
select test.ok((select p.status || '/' || (p.amount_refunded_paise = p.amount_paise)
                from public.payments p where p.booking_id = (select id from c1)) = 'refunded/true', 'payment marked refunded once');

create temp table n1 as select id from public.notifications order by created_at limit 1;
grant select on n1 to public;
update public.notifications set attempts = 5 where id = (select id from n1);
select public.notification_result((select id from n1), 'smtp exploded');
select test.ok((select status from public.notifications where id = (select id from n1)) = 'dead', 'notification goes dead after 5 tries');

update public.slots set starts_at = now() + interval '10 hours'
  where id = (select slot_id from public.bookings where id = (select id from c7));
select test.ok(public.queue_reminders() >= 1, 'reminder queued for a trip 10h away');
select test.ok(public.queue_reminders() = 0, 'reminder not queued twice');

-- ---------------- rate limit
select test.ok(public.hit_rate_limit('otp:test', 60, 2) and public.hit_rate_limit('otp:test', 60, 2)
               and not public.hit_rate_limit('otp:test', 60, 2), 'third hit in the window is refused');

-- ---------------- account deletion
select test.login(:'rafter');
select test.fails($$select public.scrub_my_data()$$, 'has_upcoming_bookings', 'cannot delete account with upcoming trips');
select test.logout();
select test.login(:'rafter2');
select test.fails($$select public.scrub_my_data()$$, 'has_upcoming_bookings', 'rafter2 also has upcoming trips');
select test.logout();
update public.bookings set status = 'completed' where user_id = :'rafter2' and status = 'confirmed';
select test.login(:'rafter2');
select public.scrub_my_data();
select test.logout();
select test.ok((select count(*) from public.participants p join public.bookings b on b.id = p.booking_id
                where b.user_id = :'rafter2' and p.full_name <> 'deleted') = 0, 'names scrubbed');
select test.ok((select count(*) from public.payments p join public.bookings b on b.id = p.booking_id
                where b.user_id = :'rafter2') > 0, 'money records kept');

-- ---------------- rotation under concurrency: a payment confirmed while another holds the operator row
-- Bluewater is the only verified operator now. This session holds its row, as a parallel
-- confirmation would, while a second connection (dblink) confirms another booking.
create extension if not exists dblink schema test;
select test.login(:'rafter');
create temp table r1 as select * from public.create_booking(test.slot('shivpuri', 21, 8), test.people(array[30]));
grant select on r1 to public;
select test.logout();
select public.attach_order((select id from r1), 'order_race');
select test.dblink_connect('other', format('host=%s port=%s dbname=%s user=%s',
  current_setting('unix_socket_directories'), current_setting('port'), current_database(), current_user));
begin;
select 1 from public.operators where slug = 'bluewater-test' for update;
select test.dblink_send_query('other',
  format('select public.confirm_payment(%L, %L, %s)', 'order_race', 'pay_race', (select total_paise from r1)));
select pg_sleep(0.5);
commit;
select * from test.dblink_get_result('other') as t(outcome text);
select test.dblink_disconnect('other');
select test.ok((select assignment_status from public.bookings where id = (select id from r1)) = 'offered',
  'a busy operator row is waited for, not skipped');

-- ---------------- slot generation: no silent zero-seat slots
update public.operators set status = 'suspended' where slug = 'bluewater-test';
select test.fails($$select public.generate_slots('10000000-0000-4000-8000-000000000001', current_date + 40, current_date + 40, array['08:00']::time[])$$,
  'no_verified_operators', 'no slots without a verified operator or a capacity');
update public.operators set status = 'verified' where slug = 'bluewater-test';

-- The blocks below each run in a transaction that is rolled back, so they leave no state behind.

-- ---------------- payment that lands after a closure cancelled the unpaid booking
begin;
select test.login(:'rafter');
create temp table pc as select * from public.create_booking(test.slot('marine-drive', 25, 8), test.people(array[30]));
grant select on pc to public;
select test.logout();
select public.attach_order((select id from pc), 'order_closed');
select public.close_river('10000000-0000-4000-8000-000000000003', current_date + 25, current_date + 25, 'weather');
select test.ok(public.confirm_payment('order_closed', 'pay_closed', (select total_paise from pc)) = 'refund_queued',
  'payment after a closure is refunded');
select test.ok((select status || '/' || cancel_reason || '/' || seats_state from public.bookings where id = (select id from pc))
               = 'cancelled/platform_closure/released', 'the booking stays cancelled by the closure');
select test.ok((select sum(amount_paise) from public.refunds where booking_id = (select id from pc)) = (select total_paise from pc),
  'the refund is the full amount');
select test.ok((select seats_held + seats_booked from public.slots where id = (select slot_id from pc)) = 0,
  'no seat is re-taken on the closed trip');
rollback;

-- ---------------- a refund Razorpay keeps refusing: retried later each time, then dead, and ops told
begin;
create temp table rd as select test.book_paid(:'rafter', test.slot('brahmpuri', 24, 8), array[30]) as id;
grant select on rd to public;
select test.login(:'rafter');
select public.cancel_booking((select id from rd));
select test.logout();
create temp table rr as select id from public.refunds where booking_id = (select id from rd);
do $$ begin
  for i in 1..4 loop
    update public.refunds set next_attempt_at = now() where id = (select id from rr);
    perform public.claim_refunds(100);
    perform public.refund_error((select id from rr), 'razorpay timeout');
  end loop;
end $$;
select test.ok((select status = 'failed' and attempts = 4 and next_attempt_at > now() from public.refunds where id = (select id from rr)),
  'a failing refund is retried later, not dropped');
update public.refunds set next_attempt_at = now() where id = (select id from rr);
select public.claim_refunds(100);
select public.refund_error((select id from rr), 'razorpay timeout');
select test.ok((select status from public.refunds where id = (select id from rr)) = 'dead', 'after 5 tries the refund is dead');
select test.ok((select count(*) from public.notifications where dedupe_key = 'refund_dead:' || (select id from rr)) = 1,
  'ops are emailed to refund it by hand');
rollback;

-- ---------------- family tracking links stop working once expired or revoked
begin;
select test.as_anon();
select test.ok(public.get_tracking((select t from tok)) is not null, 'the tracking link works while valid');
select test.logout();
update public.tracking_links set expires_at = now() - interval '1 minute' where token = (select t from tok);
select test.as_anon();
select test.ok(public.get_tracking((select t from tok)) is null, 'an expired tracking link shows nothing');
select test.logout();
rollback;
begin;
update public.tracking_links set revoked_at = now() where token = (select t from tok);
select test.as_anon();
select test.ok(public.get_tracking((select t from tok)) is null, 'a revoked tracking link shows nothing');
select test.logout();
select test.login(:'rafter');
select test.fails($$select public.create_tracking_link((select id from c1))$$, 'booking_not_active', 'no tracking link for a cancelled booking');
select test.logout();
rollback;

-- ---------------- operator permits: an expired one fails the check; one that ends before the trip gets no offer
begin;
select test.login(:'admin');
select public.verify_operator('30000000-0000-4000-8000-000000000002', public.season_for(current_date),
  '{"gear":true,"guides":true,"briefing":true,"kayaker":true,"gps":true,"incident_reporting":true,"customer_service":true,"permit":true}',
  'TEST-PERMIT-002', current_date - 1);
select test.logout();
select test.ok((select o.status || '/' || v.result from public.operators o join public.verifications v on v.operator_id = o.id
                where o.slug = 'bluewater-test' order by v.checked_at desc limit 1) = 'suspended/fail',
  'an expired permit fails the check even with all 8 items ticked');
rollback;
begin;
update public.operators set permit_expires_on = current_date + 5 where slug = 'bluewater-test';
create temp table pe as select test.book_paid(:'rafter', test.slot('shivpuri', 27, 8), array[30]) as id;
select test.ok((select assignment_status from public.bookings where id = (select id from pe)) = 'no_operator',
  'no offer to an operator whose permit ends before the trip day');
rollback;

-- ---------------- reschedule refuses a closed day or a full trip, and then nothing moves
begin;
create temp table rs as select test.book_paid(:'rafter', test.slot('shivpuri', 25, 8), array[30, 31]) as id;
grant select on rs to public;
update public.slots set capacity = seats_booked + seats_held where id = test.slot('shivpuri', 26, 8);
select test.login(:'rafter');
select test.fails($$select public.reschedule_booking((select id from rs), test.slot('shivpuri', 18, 8))$$, 'slot_closed',
  'cannot reschedule onto a closed day');
select test.fails($$select public.reschedule_booking((select id from rs), test.slot('shivpuri', 26, 8))$$, 'not_enough_seats',
  'cannot reschedule onto a full trip');
select test.logout();
select test.ok((select slot_id from public.bookings where id = (select id from rs)) = test.slot('shivpuri', 25, 8)
               and (select seats_booked from public.slots where id = test.slot('shivpuri', 25, 8)) = 2,
  'a refused reschedule leaves the booking and its seats where they were');
rollback;

-- ---------------- incidents: only the trip's operator reports them; high and critical ones alert ops
begin;
select test.login(:'opsa');
select test.fails($$select public.report_incident((select id from c5), 'high', 'Raft flipped at the Wall')$$, 'booking_not_found',
  'another operator cannot report on the trip');
select test.logout();
select test.login(:'opsb');
select public.report_incident((select id from c5), 'low', 'Paddle lost at the take-out');
select public.report_incident((select id from c5), 'critical', 'Guest pulled from the water, conscious');
select test.logout();
select test.ok((select count(*) from public.incidents where booking_id = (select id from c5)) = 2, 'the trip''s operator reports incidents');
select test.ok((select count(*) from public.notifications n join public.incidents i on n.dedupe_key = 'incident:' || i.id
                where i.booking_id = (select id from c5)) = 1, 'only the high or critical incident alerts ops');
rollback;
