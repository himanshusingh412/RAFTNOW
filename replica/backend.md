# Backend: rafting-app

Date: 2026-10-24. Reads `replica/architecture.md`. Status: **built and tested locally in test mode. Not yet connected to your accounts.**

## What's built

| area | what | where |
| --- | --- | --- |
| auth | email 6-digit code sign-in, Google sign-in callback, sign out here or everywhere, account deletion | `src/app/api/auth/*`, `src/app/auth/callback`, `src/app/api/account` |
| sessions | http-only cookies via `@supabase/ssr`, refreshed on every request in `src/proxy.ts` (Next 16's renamed middleware) | `src/proxy.ts` |
| roles | rafter, admin (`profiles.role`), operator owner or staff (`operator_members`) | migrations 1 and 3 |
| database | 26 tables, 4 migrations, seed with fake operators and users | `supabase/migrations`, `supabase/seed.sql` |
| access rules | RLS on every table; all writes go through checked functions; a second user gets nothing back (tested) | `…_access.sql` |
| bookings | seat hold with an overbooking-proof update, age/health/consent checks, server-side pricing with GST share and platform fee | `create_booking` |
| payments | Razorpay order per booking, Checkout signature check, payment re-fetched from Razorpay before confirming, webhooks | `src/app/api/bookings`, `…/payments/verify`, `…/webhooks/razorpay` |
| refunds | tiered policy (48 h+ full, later 50%, started 0), closure refunds, late-payment and double-payment refunds, sent by the job runner with retries; never twice | `refund_quote`, `cancel_booking`, `src/lib/jobs.ts` |
| reschedule | free until 24 h before, same route, seats moved atomically, operator re-offered | `reschedule_booking` |
| operators | seasonal 8-point verification, permit expiry, fair rotation (least recently assigned first), accept or decline | `verify_operator`, `assign_operator`, `operator_respond` |
| trip day | 3 QR checkpoint scans in order, geofence check, GPS pings, family tracking link with no personal data, incidents | `record_checkpoint`, `get_tracking`, `report_incident` |
| closures | close one route or the whole river: slots closed, trips cancelled, full refunds, emails, in one transaction | `close_river` |
| email | 12 templates written fresh, sent from an outbox with retries and a dead state | `src/lib/email.ts` |
| jobs | one cron route each minute: expire holds, reminders, refunds, emails | `src/app/api/cron/tick`, `vercel.json` |
| settings | hold time, cut-offs, refund policy, group size, ops email, support phone are database rows, not code | `…_default_settings.sql` |

## Tests

- `npm run test:db` runs all migrations and the seed on a throwaway Postgres, then **96 database checks**. They cover pricing, holds, overbooking, double payments, late payments, the refund tiers, reschedule rules, closures, rotation and decline, verification, checkpoints, tracking privacy, job leasing, rate limits, deletion, and what each of five users can and cannot see.
- `npm test` runs **19 unit checks**. Signatures are checked against Razorpay's own SDK, plus webhook replay and failure handling, every email template, input validation and error mapping.
- `npx tsc --noEmit`, `npx eslint`, `next build`: clean. `npm audit`: 0 vulnerabilities.
- **Not yet tested against real Supabase and Razorpay.** That needs your keys (steps below), then one test-mode booking end to end.

## Security checklist

- [x] secrets only in env vars, `.env*` in `.gitignore`. Server modules import `server-only`, and the browser gets only the Supabase URL and publishable key.
- [x] input validated on the server with zod on every route. Prices are never taken from the client.
- [x] authorisation checked on every read and write (RLS plus checks inside each function), tested with a second user, a second operator and anon
- [x] rate limits on code requests (per email and per IP), code checks, booking, cancel/reschedule and tracking links. Supabase Auth adds its own. No SMS is sent yet.
- [x] webhooks verify signatures on the raw body and store event ids
- [ ] uploads: none yet. Operator permit uploads go in a private Storage bucket when that screen is built.
- [x] no personal data in URLs or logs. Logs carry error codes only, and the tracking token is opaque.
- [x] dependencies audited (`npm audit`: 0)
- [ ] privacy policy lists every processor: **Supabase** (database, auth; AWS Mumbai), **Razorpay** (payments), **Resend** (email), **Vercel** (hosting). Write it with `/replica-launch`.
- [ ] backups: daily backups need Supabase **Pro**. Turn them on before real bookings.

## Your setup steps (you create every account; I never handle your keys)

1. **Supabase**: create a project in the **Mumbai (ap-south-1)** region. Install the Supabase CLI, then run `supabase link` and `npm run db:push` to apply the migrations. Don't run the seed in production.
   - Authentication → Email Templates → Magic Link: paste `supabase/templates/otp.html` so the email shows the 6-digit code.
   - Authentication → URL Configuration: site URL, plus `https://<your-domain>/auth/callback`.
   - Optional Google sign-in: create an OAuth client in your own Google Cloud project with only the email and profile scopes. Basic scopes need no Google review; you still configure a consent screen. Then paste the client into Supabase → Auth → Providers.
2. **Razorpay (test mode)**: copy the `rzp_test_` key id and secret.
   - Account & Settings → Payment Capture: **automatic**.
   - Webhooks: add `https://<site>/api/webhooks/razorpay` with a secret, for `payment.captured`, `payment.failed`, `order.paid`, `refund.processed` and `refund.failed`.
   - Start **KYC and live activation now**. It takes days, and replica-deploy needs it.
3. **Resend**: verify your sending domain (SPF and DKIM records) and create an API key.
4. Copy `.env.example` to `.env.local` and fill it in. `CRON_SECRET` comes from `openssl rand -hex 32`.
5. Set `ops_email` and `support_phone` in the `settings` table, and put real prices and the GST rate on the routes **with your accountant**. The seed values are placeholders.
6. Locally: `supabase start` (needs Docker Desktop), `supabase db reset` (migrations plus fake seed), `npm run dev`. Test card and UPI details are in Razorpay's test-mode docs.

## Not done yet (honest list)

- **Screens**: none. This is the backend only, and `/replica-build` builds the pages on these routes.
- **Phone sign-in by SMS**: Indian SMS needs DLT registration of your sender ID and templates. Add it in Supabase Auth once that's done.
- **WhatsApp messages**: confirmations go by email for now. WhatsApp needs Meta's Cloud API with approved templates.
- **Operator payouts**: money collects in your Razorpay account and is not yet split to operators. That needs Razorpay Route linked accounts, with KYC for each operator.
- **GST invoices**: the totals and GST share are stored, but invoice PDFs and numbering are not built.
- **Admin screens** for routes, prices and settings: today that's SQL or the Supabase dashboard.
- **Trip-day phone app** for guides: the API is ready (scans, pings, incidents), but the app is not.

Next: `/replica-test`, or `/replica-build` first so there are screens to click through.
