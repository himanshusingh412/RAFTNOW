# RaftNow — Rishikesh rafting marketplace

Booking marketplace for white-water rafting in Rishikesh: customers book seats or private rafts from licensed operators, operators manage departures and check passengers in by QR, and the RaftNow team runs river closures, KYC review and payouts.

> **Status: NOT production ready.** Core booking, closure, admin and check-in flows are implemented and verified against a real PostgreSQL database and a running Docker stack, but payments, phone OTP, payouts and notification delivery have **not** been exercised against real Razorpay / Firebase / provider accounts. See [Implementation status](#implementation-status).

---

## Repository layout

```
raftnow/
├── apps/
│   ├── api/        NestJS 10 + Prisma 5 + PostgreSQL 16 + pg-boss (jobs)
│   ├── web/        Vite + React 18 + Tailwind — customer booking, operator portal, admin console
│   └── mobile/     Expo SDK 52 — customer tickets + operator camera QR scanner
├── packages/
│   └── shared/     money (integer paise), booking codes, cancellation policy — built to dist/
├── scripts/
│   └── smoke-test.mjs   HTTP smoke test against a running API
└── docker-compose.yml   postgres, redis, api, web (nginx)
```

## Quick start (Docker)

```bash
cp .env.example .env              # optional — dev defaults work without it
docker compose build
docker compose up -d              # api runs `prisma migrate deploy` on start
docker compose exec api npx prisma db seed   # admin, stretches, a LIVE dev operator
docker compose ps                 # postgres/redis/api healthy, web running
node scripts/smoke-test.mjs       # 21 HTTP checks against http://localhost:4000
```

| URL | What |
|---|---|
| http://localhost | Web app (Nginx serves the SPA and proxies `/api/` to the API) |
| http://localhost/login | Sign-in: customers and operators by phone one-time code; RaftNow team by email + password + 2FA. `/vendor` and `/admin` redirect here when signed out |
| http://localhost:4000 | API root (`/api/v1/...`) |
| http://localhost:4000/api/docs | Swagger (non-production only) |
| http://localhost:4000/api/v1/health | Health + which integrations are configured |

Departures are generated from operator templates by the `slots.generate` job at API start-up and every 15 minutes, so seed first and then give the API a moment (or `docker compose restart api`).

**Local sign-in without Firebase.** With `AUTH_DEV_BYPASS=true` (the compose default, refused when `APP_ENV=production`) the web app offers a clearly-labelled *developer sign-in*. The seeded operator owner is `vendor-owner` / `+919876543210`. The seeded admin is `admin@raftnow.in` with `SEED_ADMIN_PASSWORD` (dev default `ChangeMe-Dev-Only-123`). TOTP 2FA enrolment is forced at first admin login.

**Existing dev databases.** The old `00_constraints` migration could never succeed on an empty database. The API entrypoint marks that one failed record as rolled back automatically. If your database was instead created with `prisma db push`, reset it once: `docker compose down -v && docker compose up -d`.

## Local development (without Docker for the apps)

```bash
npm install
docker compose up -d postgres redis
cd apps/api
npx prisma migrate deploy && npx prisma db seed
npm run dev                         # API on :4000 (reads ../../.env)
npm run dev --workspace=apps/web    # web on :3000, proxies /api → :4000
EXPO_PUBLIC_API_URL=http://<LAN-IP>:4000/api/v1 npm run start --workspace=apps/mobile
```

## Tests

```bash
npm run typecheck                                   # all workspaces (turbo)
npm run test:unit --workspace=apps/api              # 63 unit tests, no DB

# Integration tests — REAL PostgreSQL, real services, real row locks
createdb -h localhost -p 5434 -U raftnow raftnow_test       # once
DATABASE_URL="$DATABASE_URL_TEST" npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
DATABASE_URL_TEST=postgresql://raftnow:raftnow_dev@localhost:5434/raftnow_test \
  npm run test:integration --workspace=apps/api     # 19 tests
```

The concurrency suite fires 50 simultaneous `createBooking` calls at a slot with 8 seats through the real `BookingsService` and PostgreSQL: exactly 8 succeed and all 42 failures are `SLOT_FULL`. Removing the `FOR UPDATE` lock makes the test fail, so it is a real guard.

## Architecture notes

- **Money** is integer paise everywhere (`BIGINT`, `bigint`). Commission is in basis points and snapshotted on each booking.
- **Inventory**: booking creation locks the slot row (`SELECT … FOR UPDATE`, READ COMMITTED), sweeps lapsed holds, checks combined shared + private-raft capacity, then holds seats. DB `CHECK` constraints (including `chk_combined_capacity`) are the backstop. A single lock order (slot → booking) is used everywhere.
- **River closures** are rows in `closures`. Closing a stretch blocks bookings at once (checked under the slot lock), cancels and fully refunds affected bookings (idempotent and resumable), notifies customers and writes an audit entry in the same transaction.
- **Payments**: Razorpay order → checkout → signed webhook (authoritative). The checkout callback confirms only from Razorpay's own payment record. Late or duplicate captures are refunded automatically.
- **Refunds and payouts** are claimed in the database before Razorpay is called. Unknown gateway outcomes are reconciled by `notes.refund_id` / `notes.transfer_id` before any retry, so a job running twice cannot move money twice. Payouts are Razorpay Route direct transfers released `TRANSFER_HOLD_HOURS` after the trip. This is a payout delay held in the platform account, **not** a regulated escrow.
- **Jobs**: pg-boss (PostgreSQL) runs 12 cron jobs: hold expiry, slot generation, notification dispatch, webhook retry, payment / refund / transfer reconciliation, refund submission, payout release, auto-completion, closure processing and licence expiry.
- **Notifications** use an outbox: rows are written in the same transaction as the state change, and the dispatcher delivers via FCM, SendGrid or Fast2SMS when credentials exist. Otherwise rows are recorded as `SKIPPED`, never as sent.
- **KYC**: PAN, bank account and TOTP secrets are AES-256-GCM encrypted. Documents go to private storage (S3 or local), and access is only through signed links that expire after 5 minutes. Every access is audited. `audit_logs` and `booking_events` are append-only, enforced by database triggers.
- **Admin**: bcrypt passwords, account lockout, mandatory TOTP with replay protection, typed JWTs with server-side revocation, and role-based permissions (`SUPER_ADMIN`, `OPS`, `FINANCE`) enforced by `AdminAuthGuard`.

## Implementation status

See the latest engineering report for the verified / partial / blocked breakdown. In short, these need real credentials and end-to-end testing before launch: Razorpay orders, captures, refunds and Route payouts (test mode), Firebase phone OTP (web; mobile is not implemented), notification providers, and S3 storage.
