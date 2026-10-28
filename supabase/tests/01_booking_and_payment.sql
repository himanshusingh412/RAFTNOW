-- Booking, payment, idempotency and pricing.
\set rafter  '00000000-0000-4000-8000-000000000002'
\set rafter2 '00000000-0000-4000-8000-000000000003'
\set opsa    '00000000-0000-4000-8000-000000000004'
\set opsb    '00000000-0000-4000-8000-000000000005'

-- the public can read the catalogue but cannot book
select test.as_anon();
select test.ok((select count(*) from public.routes) = 4, 'anon reads routes');
select test.ok((select count(*) from public.slots) > 0, 'anon reads slots');
select test.ok((select count(*) from public.bookings) = 0, 'anon sees no bookings');
select test.fails($$select public.create_booking(test.slot('shivpuri', 5, 8), test.people(array[20]))$$,
  'permission denied', 'anon cannot book');
select test.logout();

-- a rafter books two people on Shivpuri with the photographer add-on
select test.login(:'rafter');
select test.fails($$select public.create_booking(test.slot('shivpuri', 5, 8), test.people(array[20, 10]))$$,
  'participant_age_not_allowed', 'under-age participant rejected');
select test.fails($$select public.create_booking(test.slot('shivpuri', 5, 8),
  '[{"full_name":"A","age":30,"health_ok":false,"consent":true}]')$$,
  'health_declaration_required', 'health declaration required');
select test.fails($$select public.create_booking(test.slot('shivpuri', 5, 8), test.people(array[30]), '[{"code":"nope"}]')$$,
  'addon_not_available', 'unknown add-on rejected');

create temp table b1 as
  select * from public.create_booking(test.slot('shivpuri', 5, 8), test.people(array[20, 30]), '[{"code":"photos"}]');
select test.ok((select total_paise from b1) = 2 * 139900 + 79900, 'total = 2 x route price + per-booking add-on');
select test.ok((select gst_paise from b1) = round((2 * 139900 + 79900) * 1800 / 11800.0), 'GST share derived from the rate');
select test.ok((select platform_fee_paise from b1) = 2 * 12900, 'platform fee per person');
select test.ok((select seats_held from public.slots where id = (select slot_id from b1)) = 2, 'two seats held');
select test.ok((select count(*) from public.participants where booking_id = (select id from b1)) = 2, 'rafter sees own participants');
select test.fails($$update public.bookings set total_paise = 1$$, 'permission denied', 'rafter cannot edit a booking directly');
select test.fails($$insert into public.payments (booking_id, provider_order_id, amount_paise) select id, 'x', 1 from b1$$,
  'permission denied', 'rafter cannot insert a payment');
select test.fails($$update public.profiles set role = 'admin'$$, 'permission denied', 'rafter cannot make themselves admin');
update public.profiles set full_name = 'Ravi R' where id = :'rafter';
select test.ok((select full_name from public.profiles where id = :'rafter') = 'Ravi R', 'rafter edits own name');
select test.fails($$select public.attach_order((select id from b1), 'order_x')$$, 'permission denied', 'rafter cannot attach orders');
select test.fails($$select public.confirm_payment('order_x', 'pay_x', 1)$$, 'permission denied', 'rafter cannot confirm payments');
select test.logout();

-- the second user sees nothing of it
select test.login(:'rafter2');
select test.ok((select count(*) from public.bookings) = 0, 'second user: no bookings');
select test.ok((select count(*) from public.participants) = 0, 'second user: no participants');
select test.ok((select count(*) from public.payments) = 0, 'second user: no payments');
select test.fails($$select public.cancel_booking((select id from b1))$$, 'booking_not_found', 'second user cannot cancel it');
select test.logout();

-- server (service role) attaches the order; payment confirmed twice (verify route + webhook)
select public.attach_order((select id from b1), 'order_test_1');
select test.fails($$select public.confirm_payment('order_test_1', 'pay_1', 100)$$, 'amount_mismatch', 'wrong amount refused');
select test.ok(public.confirm_payment('order_test_1', 'pay_1', (select total_paise from b1), 'upi') = 'confirmed', 'payment confirms booking');
select test.ok(public.confirm_payment('order_test_1', 'pay_1', (select total_paise from b1), 'upi') = 'already_confirmed', 'second confirm is a no-op');
select test.ok((select status from public.bookings where id = (select id from b1)) = 'confirmed', 'booking confirmed');
select test.ok((select seats_held = 0 and seats_booked = 2 from public.slots where id = (select slot_id from b1)), 'seats moved held -> booked');
select test.ok((select count(*) from public.notifications where dedupe_key = 'confirmed:' || (select id from b1)) = 1,
  'one confirmation email queued');

-- fair rotation: first offer goes to the least recently assigned operator
select test.ok((select o.slug from public.bookings b join public.operators o on o.id = b.operator_id
                where b.id = (select id from b1)) = 'ganga-test', 'offered to first operator in rotation');
select test.ok((select assignment_status from public.bookings where id = (select id from b1)) = 'offered', 'status offered');

-- operator A sees the trip but not names (not accepted yet); operator B sees nothing
select test.login(:'opsb');
select test.ok((select count(*) from public.bookings) = 0, 'other operator sees no booking');
select test.fails($$select public.operator_respond((select id from b1), true)$$, 'booking_not_found', 'other operator cannot accept');
select test.logout();
select test.login(:'opsa');
select test.ok((select count(*) from public.bookings) = 1, 'assigned operator sees the booking');
select test.ok((select count(*) from public.participants) = 0, 'assigned operator sees no names before accepting');
select test.ok((select count(*) from public.payments) = 0, 'operator sees no payment details');
select public.operator_respond((select id from b1), false);
select test.ok((select count(*) from public.bookings) = 0, 'after declining, operator A no longer sees it');
select test.logout();
select test.ok((select o.slug from public.bookings b join public.operators o on o.id = b.operator_id
                where b.id = (select id from b1)) = 'bluewater-test', 'decline passes it to the next operator');
select test.login(:'opsb');
select public.operator_respond((select id from b1), true);
select test.ok((select count(*) from public.participants) = 2, 'accepted operator now sees the names');
select test.logout();

-- next booking rotates to operator A again (least recently assigned)
select test.login(:'rafter2');
create temp table b2 as select * from public.create_booking(test.slot('shivpuri', 6, 8), test.people(array[25]));
select test.logout();
select public.attach_order((select id from b2), 'order_test_2');
select public.confirm_payment('order_test_2', 'pay_2', (select total_paise from b2));
select test.ok((select o.slug from public.bookings b join public.operators o on o.id = b.operator_id
                where b.id = (select id from b2)) = 'ganga-test', 'rotation alternates operators');

-- double checkout: two orders for one booking, both paid -> second is refunded, booking stays
select test.login(:'rafter');
create temp table b3 as select * from public.create_booking(test.slot('brahmpuri', 7, 11), test.people(array[30]));
select test.logout();
select public.attach_order((select id from b3), 'order_dup_a');
select public.attach_order((select id from b3), 'order_dup_b');
select public.confirm_payment('order_dup_a', 'pay_a', (select total_paise from b3));
select test.ok(public.confirm_payment('order_dup_b', 'pay_b', (select total_paise from b3)) = 'refund_queued', 'duplicate payment refunded');
select test.ok((select status from public.bookings where id = (select id from b3)) = 'confirmed', 'booking still confirmed');
select test.ok((select count(*) from public.refunds where idempotency_key like 'duplicate:%') = 1, 'one duplicate refund queued');

-- capacity: last seats cannot be sold twice
update public.slots set capacity = seats_booked + seats_held + 3 where id = test.slot('marine-drive', 8, 8);
select test.login(:'rafter');
select public.create_booking(test.slot('marine-drive', 8, 8), test.people(array[20, 21]));
select test.logout();
select test.login(:'rafter2');
select test.fails($$select public.create_booking(test.slot('marine-drive', 8, 8), test.people(array[22, 23]))$$,
  'not_enough_seats', 'cannot oversell the slot');
select test.logout();

-- unpaid hold expires and gives seats back; payment arriving later re-takes them if free
select test.login(:'rafter');
create temp table b4 as select * from public.create_booking(test.slot('brahmpuri', 9, 8), test.people(array[30, 31]));
select test.logout();
select public.attach_order((select id from b4), 'order_late');
update public.bookings set hold_expires_at = now() - interval '1 minute' where id = (select id from b4);
select test.ok(public.expire_holds() = 1, 'one hold expired');
select test.ok((select seats_held from public.slots where id = (select slot_id from b4)) = 0, 'held seats released');
select test.ok(public.confirm_payment('order_late', 'pay_late', (select total_paise from b4)) = 'confirmed', 'late payment re-takes free seats');

-- late payment when the seats are gone -> cancelled + full refund
select test.login(:'rafter');
create temp table b5 as select * from public.create_booking(test.slot('brahmpuri', 10, 8), test.people(array[30]));
select test.logout();
select public.attach_order((select id from b5), 'order_gone');
update public.bookings set hold_expires_at = now() - interval '1 minute' where id = (select id from b5);
select public.expire_holds();
update public.slots set capacity = seats_booked + seats_held where id = (select slot_id from b5);
select test.ok(public.confirm_payment('order_gone', 'pay_gone', (select total_paise from b5)) = 'refund_queued', 'seats gone: refund queued');
select test.ok((select status || '/' || cancel_reason from public.bookings where id = (select id from b5)) = 'cancelled/payment_late', 'booking cancelled as payment_late');
