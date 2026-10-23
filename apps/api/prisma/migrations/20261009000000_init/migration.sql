-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'OPS', 'FINANCE');

-- CreateEnum
CREATE TYPE "VendorStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'LIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "VendorMemberRole" AS ENUM ('OWNER', 'MANAGER', 'GUIDE');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('LICENCE', 'PAN', 'GSTIN_CERTIFICATE', 'CANCELLED_CHEQUE', 'BANK_STATEMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('DRAFT', 'LIVE', 'HIDDEN');

-- CreateEnum
CREATE TYPE "SlotStatus" AS ENUM ('OPEN', 'BLOCKED', 'CLOSED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING_PAYMENT', 'EXPIRED', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'CANCELLED_CUSTOMER', 'CANCELLED_VENDOR', 'CANCELLED_ADMIN', 'DISPUTED');

-- CreateEnum
CREATE TYPE "BookingMode" AS ENUM ('SHARED', 'PRIVATE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('CREATED', 'ON_HOLD', 'PROCESSING', 'RELEASED', 'SETTLED', 'REVERSED', 'FAILED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firebase_uid" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "full_name" TEXT,
    "email" TEXT,
    "avatar_key" TEXT,
    "push_token" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "name" TEXT,
    "password_hash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL,
    "totp_secret" TEXT,
    "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "totp_last_used_step" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legal_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT,
    "owner_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "address_city" TEXT,
    "address_state" TEXT,
    "address_postal_code" TEXT,
    "logo_key" TEXT,
    "status" "VendorStatus" NOT NULL DEFAULT 'DRAFT',
    "rejection_reason" TEXT,
    "business_type" TEXT,
    "licence_number" TEXT,
    "licence_expiry" TIMESTAMPTZ,
    "licence_verified" BOOLEAN NOT NULL DEFAULT false,
    "licence_verified_at" TIMESTAMPTZ,
    "licence_verified_by" UUID,
    "pan" TEXT,
    "pan_last4" TEXT,
    "gstin" TEXT,
    "bank_account_number" TEXT,
    "bank_account_last4" TEXT,
    "bank_account_holder_name" TEXT,
    "ifsc" TEXT,
    "bank_account_verified" BOOLEAN NOT NULL DEFAULT false,
    "razorpay_linked_account_id" TEXT,
    "razorpay_stakeholder_id" TEXT,
    "razorpay_route_product_id" TEXT,
    "razorpay_kyc_status" TEXT,
    "razorpay_onboarded_at" TIMESTAMPTZ,
    "submitted_at" TIMESTAMPTZ,
    "approved_at" TIMESTAMPTZ,
    "suspended_at" TIMESTAMPTZ,
    "suspension_reason" TEXT,
    "reviewed_by" UUID,
    "review_notes" TEXT,
    "reliability_score" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vendor_id" UUID NOT NULL,
    "firebase_uid" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "VendorMemberRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vendor_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vendor_id" UUID NOT NULL,
    "type" "DocumentType" NOT NULL,
    "s3_key" TEXT NOT NULL,
    "storage_driver" TEXT NOT NULL DEFAULT 'local',
    "original_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ,
    "rejection_reason" TEXT,
    "uploaded_by" UUID,
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_commissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vendor_id" UUID NOT NULL,
    "commission_bps" INTEGER NOT NULL,
    "effective_from" TIMESTAMPTZ NOT NULL,
    "effective_to" TIMESTAMPTZ,
    "set_by_admin" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stretches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "distance_km" DECIMAL(5,1) NOT NULL,
    "grade" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "put_in_point" TEXT NOT NULL,
    "take_out_point" TEXT NOT NULL,
    "min_age" INTEGER NOT NULL DEFAULT 14,
    "max_age" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "stretches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "closures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "stretch_id" UUID,
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ,
    "reason" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ,
    "revoked_by" UUID,
    "revoke_reason" TEXT,
    "affected_bookings_count" INTEGER,
    "bookings_processed_at" TIMESTAMPTZ,

    CONSTRAINT "closures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vendor_id" UUID NOT NULL,
    "stretch_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "inclusions" TEXT[],
    "exclusions" TEXT[],
    "meeting_point" TEXT NOT NULL,
    "meeting_lat" DECIMAL(9,6),
    "meeting_lng" DECIMAL(9,6),
    "min_age" INTEGER NOT NULL DEFAULT 14,
    "max_age" INTEGER,
    "raft_capacity" INTEGER NOT NULL,
    "per_seat_price_paise" BIGINT NOT NULL,
    "private_raft_price_paise" BIGINT,
    "status" "TripStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "trip_id" UUID NOT NULL,
    "s3_key" TEXT NOT NULL,
    "caption" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slot_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "trip_id" UUID NOT NULL,
    "departure_time" TEXT NOT NULL,
    "days_of_week" INTEGER[],
    "rafts_count" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "slot_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "trip_id" UUID NOT NULL,
    "start_time" TIMESTAMPTZ NOT NULL,
    "end_time" TIMESTAMPTZ NOT NULL,
    "total_rafts" INTEGER NOT NULL,
    "raft_capacity" INTEGER NOT NULL,
    "total_seats" INTEGER NOT NULL,
    "seats_booked" INTEGER NOT NULL DEFAULT 0,
    "seats_held" INTEGER NOT NULL DEFAULT 0,
    "private_rafts_booked" INTEGER NOT NULL DEFAULT 0,
    "private_rafts_held" INTEGER NOT NULL DEFAULT 0,
    "status" "SlotStatus" NOT NULL DEFAULT 'OPEN',
    "blocked_reason" TEXT,
    "generated_from" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "slot_id" UUID NOT NULL,
    "booking_code" TEXT NOT NULL,
    "mode" "BookingMode" NOT NULL,
    "seat_count" INTEGER NOT NULL,
    "rafts_required" INTEGER NOT NULL,
    "per_seat_price_paise" BIGINT NOT NULL,
    "private_raft_price_paise" BIGINT,
    "amount_paise" BIGINT NOT NULL,
    "commission_bps" INTEGER NOT NULL,
    "platform_commission_paise" BIGINT NOT NULL,
    "vendor_payout_paise" BIGINT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "hold_expires_at" TIMESTAMPTZ NOT NULL,
    "safety_declaration_version" TEXT NOT NULL,
    "safety_declaration_accepted_at" TIMESTAMPTZ NOT NULL,
    "contact_name" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "cancelled_at" TIMESTAMPTZ,
    "cancellation_reason" TEXT,
    "cancellation_trigger" TEXT,
    "cancelled_by" UUID,
    "confirmed_at" TIMESTAMPTZ,
    "checked_in_at" TIMESTAMPTZ,
    "checked_in_by" UUID,
    "completed_at" TIMESTAMPTZ,
    "disputed_at" TIMESTAMPTZ,
    "dispute_reason" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_guests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "age" INTEGER NOT NULL,

    CONSTRAINT "booking_guests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "razorpay_order_id" TEXT NOT NULL,
    "razorpay_payment_id" TEXT,
    "amount_paise" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "captured_at" TIMESTAMPTZ,
    "failed_at" TIMESTAMPTZ,
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "linked_account_id" TEXT,
    "amount_paise" BIGINT NOT NULL,
    "original_amount_paise" BIGINT,
    "status" "TransferStatus" NOT NULL DEFAULT 'ON_HOLD',
    "razorpay_transfer_id" TEXT,
    "razorpay_settlement_id" TEXT,
    "utr" TEXT,
    "hold_reason" TEXT,
    "release_at" TIMESTAMPTZ NOT NULL,
    "released_at" TIMESTAMPTZ,
    "settled_at" TIMESTAMPTZ,
    "reversed_at" TIMESTAMPTZ,
    "failed_at" TIMESTAMPTZ,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "claimed_at" TIMESTAMPTZ,
    "last_error" TEXT,
    "reversed_amount_paise" BIGINT,
    "razorpay_reversal_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "payment_id" UUID,
    "razorpay_refund_id" TEXT,
    "amount_paise" BIGINT NOT NULL,
    "reversal_amount_paise" BIGINT,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "initiated_by_type" TEXT NOT NULL,
    "initiated_by_id" UUID,
    "failure_reason" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ,
    "submitted_at" TIMESTAMPTZ,
    "processed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "gateway" TEXT NOT NULL DEFAULT 'razorpay',
    "gateway_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed_at" TIMESTAMPTZ,
    "processing_error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "vendor_id" UUID,
    "channel" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "provider" TEXT,
    "provider_message_id" TEXT,
    "idempotency_key" TEXT,
    "sent_at" TIMESTAMPTZ,
    "failed_at" TIMESTAMPTZ,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_id" UUID,
    "actor_type" TEXT NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_firebase_uid_key" ON "users"("firebase_uid");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_members_firebase_uid_key" ON "vendor_members"("firebase_uid");

-- CreateIndex
CREATE INDEX "vendor_documents_vendor_id_type_idx" ON "vendor_documents"("vendor_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "stretches_name_key" ON "stretches"("name");

-- CreateIndex
CREATE INDEX "closures_stretch_id_starts_at_ends_at_idx" ON "closures"("stretch_id", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "trips_vendor_id_status_idx" ON "trips"("vendor_id", "status");

-- CreateIndex
CREATE INDEX "trips_stretch_id_status_idx" ON "trips"("stretch_id", "status");

-- CreateIndex
CREATE INDEX "trip_photos_trip_id_position_idx" ON "trip_photos"("trip_id", "position");

-- CreateIndex
CREATE INDEX "slots_trip_id_start_time_status_idx" ON "slots"("trip_id", "start_time", "status");

-- CreateIndex
CREATE INDEX "slots_start_time_status_idx" ON "slots"("start_time", "status");

-- CreateIndex
CREATE UNIQUE INDEX "slots_trip_id_start_time_key" ON "slots"("trip_id", "start_time");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_booking_code_key" ON "bookings"("booking_code");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_idempotency_key_key" ON "bookings"("idempotency_key");

-- CreateIndex
CREATE INDEX "bookings_user_id_created_at_idx" ON "bookings"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "bookings_slot_id_status_idx" ON "bookings"("slot_id", "status");

-- CreateIndex
CREATE INDEX "bookings_status_hold_expires_at_idx" ON "bookings"("status", "hold_expires_at");

-- CreateIndex
CREATE INDEX "bookings_booking_code_idx" ON "bookings"("booking_code");

-- CreateIndex
CREATE UNIQUE INDEX "booking_guests_booking_id_position_key" ON "booking_guests"("booking_id", "position");

-- CreateIndex
CREATE INDEX "booking_events_booking_id_created_at_idx" ON "booking_events"("booking_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_razorpay_order_id_key" ON "payments"("razorpay_order_id");

-- CreateIndex
CREATE INDEX "payments_booking_id_idx" ON "payments"("booking_id");

-- CreateIndex
CREATE INDEX "payments_status_created_at_idx" ON "payments"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_booking_id_key" ON "transfers"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_razorpay_transfer_id_key" ON "transfers"("razorpay_transfer_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_razorpay_reversal_id_key" ON "transfers"("razorpay_reversal_id");

-- CreateIndex
CREATE INDEX "transfers_status_release_at_idx" ON "transfers"("status", "release_at");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_razorpay_refund_id_key" ON "refunds"("razorpay_refund_id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_idempotency_key_key" ON "refunds"("idempotency_key");

-- CreateIndex
CREATE INDEX "refunds_booking_id_idx" ON "refunds"("booking_id");

-- CreateIndex
CREATE INDEX "refunds_status_created_at_idx" ON "refunds"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_gateway_event_id_key" ON "webhook_events"("gateway_event_id");

-- CreateIndex
CREATE INDEX "webhook_events_event_type_created_at_idx" ON "webhook_events"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "webhook_events_processed_at_created_at_idx" ON "webhook_events"("processed_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_idempotency_key_key" ON "notifications"("idempotency_key");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_vendor_id_created_at_idx" ON "notifications"("vendor_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_status_next_attempt_at_idx" ON "notifications"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- AddForeignKey
ALTER TABLE "vendor_members" ADD CONSTRAINT "vendor_members_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_documents" ADD CONSTRAINT "vendor_documents_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_commissions" ADD CONSTRAINT "vendor_commissions_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "closures" ADD CONSTRAINT "closures_stretch_id_fkey" FOREIGN KEY ("stretch_id") REFERENCES "stretches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_stretch_id_fkey" FOREIGN KEY ("stretch_id") REFERENCES "stretches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_photos" ADD CONSTRAINT "trip_photos_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_templates" ADD CONSTRAINT "slot_templates_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slots" ADD CONSTRAINT "slots_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_guests" ADD CONSTRAINT "booking_guests_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

