-- ─────────────────────────────────────────────────────────────────────────────
-- RaftNow: Additional DB constraints and indexes
-- Applied by `prisma migrate deploy` immediately after the init migration
-- (previously named 00_constraints, which sorted BEFORE any table existed and
-- therefore failed on an empty database with: relation "slots" does not exist).
--
-- These constraints are the final backstop against application bugs.
-- Prisma schema handles structure; these handle business invariants.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Inventory sanity checks ─────────────────────────────────────────────────

ALTER TABLE slots ADD CONSTRAINT chk_seats_non_negative
  CHECK (seats_booked >= 0 AND seats_held >= 0 AND private_rafts_booked >= 0 AND private_rafts_held >= 0);

ALTER TABLE slots ADD CONSTRAINT chk_shared_seats_not_overbooked
  CHECK (seats_booked + seats_held <= total_seats);

ALTER TABLE slots ADD CONSTRAINT chk_private_rafts_not_overbooked
  CHECK (private_rafts_booked + private_rafts_held <= total_rafts);

ALTER TABLE slots ADD CONSTRAINT chk_total_seats_consistent
  CHECK (total_seats = total_rafts * raft_capacity);

-- Shared seats and private rafts draw from the SAME physical rafts. Without this,
-- a slot could sell every shared seat AND every private raft.
ALTER TABLE slots ADD CONSTRAINT chk_combined_capacity
  CHECK (seats_booked + seats_held + (private_rafts_booked + private_rafts_held) * raft_capacity <= total_seats);

-- ── Booking financial integrity ─────────────────────────────────────────────

ALTER TABLE bookings ADD CONSTRAINT chk_amount_positive
  CHECK (amount_paise > 0);

ALTER TABLE bookings ADD CONSTRAINT chk_commission_valid_bps
  CHECK (commission_bps >= 0 AND commission_bps <= 10000);

ALTER TABLE bookings ADD CONSTRAINT chk_payout_split_valid
  CHECK (platform_commission_paise + vendor_payout_paise = amount_paise);

ALTER TABLE bookings ADD CONSTRAINT chk_seat_count_positive
  CHECK (seat_count > 0 AND rafts_required > 0);

ALTER TABLE bookings ADD CONSTRAINT chk_hold_expires_after_created
  CHECK (hold_expires_at > created_at);

-- ── Payment integrity ───────────────────────────────────────────────────────

ALTER TABLE payments ADD CONSTRAINT chk_payment_amount_positive
  CHECK (amount_paise > 0);

-- ── Refund integrity ────────────────────────────────────────────────────────

ALTER TABLE refunds ADD CONSTRAINT chk_refund_amount_positive
  CHECK (amount_paise > 0);

-- ── Transfer integrity ──────────────────────────────────────────────────────

-- amount_paise may be reduced to 0 by a full refund (status then REVERSED)
ALTER TABLE transfers ADD CONSTRAINT chk_transfer_amount_non_negative
  CHECK (amount_paise >= 0);

ALTER TABLE transfers ADD CONSTRAINT chk_transfer_released_has_gateway_id
  CHECK (status NOT IN ('RELEASED', 'SETTLED') OR razorpay_transfer_id IS NOT NULL);

ALTER TABLE transfers ADD CONSTRAINT chk_transfer_release_after_created
  CHECK (release_at > created_at);

-- ── Closure validity ────────────────────────────────────────────────────────

ALTER TABLE closures ADD CONSTRAINT chk_closure_end_after_start
  CHECK (ends_at IS NULL OR ends_at > starts_at);

-- ── Vendor commission validity ──────────────────────────────────────────────

ALTER TABLE vendor_commissions ADD CONSTRAINT chk_commission_bps_range
  CHECK (commission_bps >= 0 AND commission_bps <= 5000); -- Max 50% platform cut

-- ── Performance indexes not in Prisma schema ────────────────────────────────

-- Full text search on trip titles and descriptions
CREATE INDEX IF NOT EXISTS idx_trips_title_search
  ON trips USING gin(to_tsvector('english', title || ' ' || description));

-- Vendor lookup by status for availability queries
CREATE INDEX IF NOT EXISTS idx_vendors_status
  ON vendors (status) WHERE status = 'LIVE';

-- Available slots for a given date range (high-frequency query)
CREATE INDEX IF NOT EXISTS idx_slots_availability
  ON slots (start_time, status, trip_id)
  WHERE status = 'OPEN';

-- Pending refunds for background job
CREATE INDEX IF NOT EXISTS idx_refunds_pending
  ON refunds (status, created_at)
  WHERE status = 'PENDING';

-- Transfers due for release
CREATE INDEX IF NOT EXISTS idx_transfers_due
  ON transfers (release_at, status)
  WHERE status = 'ON_HOLD';

-- ── Refund integrity ────────────────────────────────────────────────────────
-- A refund in PROCESSING/PROCESSED must carry the gateway ID or a submission timestamp.
ALTER TABLE refunds ADD CONSTRAINT chk_refund_processed_has_gateway_id
  CHECK (status <> 'PROCESSED' OR razorpay_refund_id IS NOT NULL);

-- ── Immutable audit trail ───────────────────────────────────────────────────
-- audit_logs and booking_events are append-only. Any UPDATE/DELETE is rejected by
-- the database itself, regardless of application bugs.
CREATE OR REPLACE FUNCTION raftnow_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% rejected)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION raftnow_reject_mutation();

CREATE TRIGGER trg_booking_events_append_only
  BEFORE UPDATE OR DELETE ON booking_events
  FOR EACH ROW EXECUTE FUNCTION raftnow_reject_mutation();
