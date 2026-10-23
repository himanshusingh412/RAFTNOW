-- Admin hide for trips (PRD A-10). Additive and nullable: safe on a live table.
ALTER TABLE "trips" ADD COLUMN "admin_hidden_at" TIMESTAMPTZ;
ALTER TABLE "trips" ADD COLUMN "admin_hidden_reason" TEXT;
ALTER TABLE "trips" ADD COLUMN "admin_hidden_prev_status" "TripStatus";

-- A hidden-by-admin trip must actually be off sale.
ALTER TABLE "trips" ADD CONSTRAINT chk_admin_hidden_not_live
  CHECK (admin_hidden_at IS NULL OR status <> 'LIVE');
