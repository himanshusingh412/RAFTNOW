-- Ops-tunable numbers. Change them with an UPDATE (or the admin screen later), never in code.
insert into public.settings (key, value, description) values
  ('hold_minutes',            '15',  'Minutes seats stay held while the rafter pays'),
  ('booking_cutoff_minutes',  '120', 'No new bookings for a slot this close to its start'),
  ('max_group_size',          '16',  'Largest group one online booking can take; bigger groups go to a group enquiry'),
  ('reschedule_free_hours',   '24',  'Free reschedule allowed until this many hours before the start'),
  ('refund_full_hours',       '48',  'Cancel at least this many hours before: full refund'),
  ('refund_late_percent',     '50',  'Cancel later than that, before the start: this percent back'),
  ('reminder_hours_before',   '18',  'Send the trip reminder this many hours before the start'),
  ('ops_email',               '""',  'Where ops alerts go (no operator, incidents, dead refunds). Set this.'),
  ('support_phone',           '""',  'On-call number printed on confirmations. Set this.')
on conflict (key) do nothing;
