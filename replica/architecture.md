# Architecture: rafting marketplace (a rebuild of RaftingX's core features)

Reads `replica/recon.md` (2026-10-24). Working name: **rafting-app**. replica-brand renames it before launch.

## Stack

| layer | choice | why |
| --- | --- | --- |
| web | Next.js 16 (App Router) + TypeScript | one codebase for pages and API route handlers; route handlers are the backend |
| styling | Tailwind v4, tokens from replica-design | comes with the scaffold |
| database | Postgres on Supabase (Mumbai region, `ap-south-1`) | managed, daily backups, row level security, close to users |
| data access | `@supabase/supabase-js` + SQL migrations | access rules live in the database (RLS), so every query is checked even if a route forgets |
| auth | Supabase Auth: email one-time code + Google sign-in | no passwords to reset; phone OTP comes later (Indian SMS needs DLT registration first) |
| payments | Razorpay Orders + Checkout + Refunds + webhooks | UPI, cards, net banking; what Indian rafters expect; refunds by API |
| email | Resend from your own domain | simple API, good deliverability once SPF/DKIM are set |
| jobs | one cron route (`/api/cron/tick`, every minute) + outbox tables | expire seat holds, send emails, push refunds to Razorpay, with retries and a dead-letter state |
| hosting | Vercel (Mumbai `bom1` functions) | zero-config for Next.js; cron needs the Pro plan for per-minute runs (or use Supabase `pg_cron` to call the route) |

One database. No microservices. Every money and seat change happens inside one Postgres function, in one transaction.

## Schema

Tables: 26. Access rules: **Postgres RLS on every table**. Users read through RLS. Every write goes through a `security definer` function that checks `auth.uid()` itself. Webhooks and cron use the service role and service-only functions.

Files: `supabase/migrations/*.sql`, `supabase/seed.sql`.

| group | tables |
| --- | --- |
| people | `profiles` (role: rafter or admin), `operator_members` (user ↔ operator, owner or staff) |
| catalogue | `routes`, `rapids`, `route_rapids`, `addons`, `route_zones` (checkpoint geofences) |
| inventory | `slots` (route × start time × capacity, seats held/booked), `closures` (monsoon, weather, state order) |
| bookings | `bookings`, `participants`, `assignments` (fair-rotation history) |
| money | `payments`, `refunds`, `webhook_events` |
| operators | `operators`, `operator_routes` (seats per slot they run), `verifications` (seasonal 8-point check), `guides` |
| trip day | `checkpoints` (3 scans), `gps_pings`, `tracking_links`, `incidents` |
| plumbing | `settings` (ops-tunable numbers), `notifications` (email outbox), `rate_limits` |

Key rules in the schema:

- Money is integer **paise**. Route prices include GST and the platform fee, as the original shows them. The GST share is derived from a configurable rate.
- Times are `timestamptz` in UTC and shown in `Asia/Kolkata`. A "date" filter means an IST calendar day.
- `slots` has `check (seats_held + seats_booked <= capacity)`. Overbooking is impossible at the database level, not just in the UI.
- Age limits, prices, cut-offs and the refund policy each live in exactly one place: the route row or `settings`. This fixes the original's conflicting numbers.

## API

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| POST /api/auth/otp | email a 6-digit code | anyone (rate limited) | email | ok | F02 |
| POST /api/auth/verify | verify code, set session cookie | anyone | email, code | ok | F02 |
| GET /auth/callback | finish Google sign-in | anyone | code | redirect | F02 |
| POST /api/auth/signout | sign out here or everywhere | signed in | scope | ok | — |
| DELETE /api/account | delete account, scrub personal data | signed in | — | ok | — |
| GET /api/routes | list active routes | public | category? | routes | F01 F03 |
| GET /api/routes/[slug] | route + rapids + add-ons | public | — | route | F01 |
| GET /api/routes/[slug]/slots | open slots for an IST day | public | date | slots with seats left | F02 |
| POST /api/bookings | hold seats + create Razorpay order | signed in (rate limited) | slotId, participants[], addons[] | booking, order, key id | F02 |
| POST /api/payments/verify | check Checkout signature, confirm | booking owner | order id, payment id, signature | booking | F02 |
| POST /api/webhooks/razorpay | payment and refund events | Razorpay (signature) | raw body | 200 | F02 F04 |
| GET /api/bookings | my bookings | signed in | — | bookings | F04 |
| GET /api/bookings/[id] | one booking | owner, its operator, admin | — | booking | F04 |
| GET /api/bookings/[id]/refund-quote | what cancelling now refunds | owner | — | percent, amount | F04 |
| POST /api/bookings/[id]/cancel | cancel + queue refund | owner | — | refund | F04 |
| POST /api/bookings/[id]/reschedule | move to another slot | owner | slotId | booking | F04 |
| POST /api/bookings/[id]/tracking-link | make a family tracking link | owner | — | url | F07 |
| GET /api/track/[token] | live position + checkpoints | anyone with the link | — | track | F07 |
| GET /api/operator/bookings | my operator's trips for a day | operator member | date | bookings | F06 |
| POST /api/operator/bookings/[id]/respond | accept or decline an offer | operator member | accept | booking | F06 |
| POST /api/operator/bookings/[id]/checkpoints | QR scan with GPS | operator member | seq, lat, lng | checkpoint | F07 |
| POST /api/operator/bookings/[id]/pings | GPS position | operator member | lat, lng | ok | F07 |
| POST /api/operator/incidents | log an incident | operator member | booking, severity, notes | incident | F09 |
| POST /api/admin/slots | generate slots for a date range | admin | route, from, to, times, capacity | count | — |
| POST /api/admin/closures | close a route or the river | admin | route?, from, to, reason | cancelled count | F05 |
| POST /api/admin/operators/[id]/verifications | record the seasonal check | admin | season, checks, permit | verification | F08 |
| GET /api/cron/tick | run due jobs | cron (secret) | — | counts | all |

Webhooks in: Razorpay `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`. Each is checked against `X-Razorpay-Signature` and stored by `x-razorpay-event-id`, so a repeated delivery does nothing.
Webhooks out: none yet.
Jobs (all run on each `/api/cron/tick`):
- `expire_holds`: releases seats from unpaid bookings after `hold_minutes`.
- `process_refunds`: sends pending refunds to Razorpay, retrying with backoff; failures go to dead after 5 tries.
- `send_notifications`: sends emails from the outbox the same way.
- `queue_reminders`: emails a reminder about 18 hours before each confirmed trip.

## The parts that bite

- **Time zones:** slots are stored in UTC and "a day" means IST. The cut-off rules are hour-based (24 h reschedule, 48 h refund) and computed in SQL with `now()`, never on the client.
- **Idempotency:** Razorpay retries webhooks, and the browser and the webhook both report the same payment. `confirm_payment` is keyed on the Razorpay order id and safe to run twice. Refunds carry a unique idempotency key.
- **Races:** two rafters taking the last seats at once. `hold_seats` does a single conditional `UPDATE … WHERE capacity - held - booked >= n`. Fair rotation locks operator rows with `FOR UPDATE SKIP LOCKED`.
- **Payment after the hold expired:** the seats are re-taken if still free. Otherwise the booking is marked for a full automatic refund and the rafter is emailed.
- **Closures:** closing the river cancels every confirmed booking in the range with a full refund in one transaction, then emails offering a reschedule.
- **Rate limits:** OTP, booking creation and cancellation are limited per user and IP. Supabase Auth adds its own OTP limits.
- **Deliverability:** emails come from your domain with SPF, DKIM and DMARC set (replica-deploy).
- **GPS in the gorge:** pings arrive late or not at all. The tracking page shows "last seen" and never treats a gap as an emergency.
- **Data deletion:** deleting an account scrubs names and phones from participants and keeps the money records anonymised. Tax records must be kept, so the bookings themselves are not deleted.
- **Multi-tenancy:** operator staff see only their own operator's bookings, enforced by RLS. A second operator's user gets nothing back.

## Build order

1. **Vertical slice:** routes and slots read → sign in → hold seats → Razorpay test payment → confirmed booking → email. Tables: routes, slots, bookings, participants, payments, notifications. Screens S01, S02, S09–S14.
2. **Must-haves:** cancel and reschedule with refunds (S15), closures, operators and verification (S20), fair rotation and operator accept or decline (S18), admin slot generation.
3. **Should-haves:** QR checkpoints and GPS pings (S19), family tracking link (S16), incidents (S21), add-ons, group rates, WhatsApp hand-off (S17).
4. **Fixes from replica-entrepreneur:** after it runs.
