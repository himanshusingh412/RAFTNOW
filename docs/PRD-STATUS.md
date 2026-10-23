# RaftNow — PRD requirement status

Audit of this repository against PRD 7 (functional requirements), 22 Oct 2026 (updated the same evening after the P0 gap pass).
**Done** = implemented in code. It is not necessarily tested against live Razorpay, Firebase or SMS providers (see README "Implementation status").
**Partial** = core works, part of the requirement is missing. **Missing** = not built.

## Customer app (C)

| ID | Pri | Status | Notes |
|---|---|---|---|
| C-01 | P0 | Done | Firebase phone OTP (native module needs `GOOGLE_SERVICE_INFO_PLIST` / `GOOGLE_SERVICES_JSON` at prebuild); dev bypass for local |
| C-02 | P0 | Done | Mobile: browse signed out, sign-in sheet opens at checkout / My trips |
| C-03 | P0 | Done | Date chips today…+60, stretch or "Any stretch" (`GET /slots` without `stretch_id`), guest stepper |
| C-04 | P0 | Done | Time, stretch, vendor, licence badge, price, seats left; sort earliest / cheapest |
| C-05 | P1 | Partial | Private-raft filter + sort; no time-of-day or price-range filter |
| C-06 | P0 | Done | `GET /trips/:id`: up to 8 photos (swipeable gallery with captions; cover thumbnail on search results), inclusions, meeting point + Google Maps link, age rules, policy, vendor phone. No embedded map (link only) |
| C-07 | P0 | Done | Shared seats / private raft |
| C-08 | P0 | Done | Name + age per guest, validated in app and server |
| C-09 | P0 | Done | Declaration text + checkbox; version + accepted_at stored |
| C-10 | P0 | Done | Price × guests, taxes included, total |
| C-11 | P0 | Done | 10-min server hold, live countdown, seats released on back |
| C-12 | P0 | Done, unverified | `react-native-razorpay` native checkout → `/payments/verify` → webhook. Needs Razorpay test keys and a dev-client rebuild |
| C-13 | P0 | Done | Signed QR + 6-char code; saved under My trips |
| C-14 | P0/P1 | Partial | Outbox + SMS/email drivers exist; providers not configured; WhatsApp (P1) missing |
| C-15 | P0 | Done | Upcoming / past, status, refund status |
| C-16 | P0 | Done | `GET /me/bookings/:id/cancel-quote` preview, then cancel |
| C-17 | P1 | **Missing** | No 6 pm day-before reminder job |
| C-18 | P0 | Done | Call / WhatsApp (set `EXPO_PUBLIC_SUPPORT_PHONE`) + FAQ |
| C-19 | P1 | **Missing** | Share trip deep link |
| C-20 | P1 | **Missing** | GST invoice download |
| C-21 | P0 | Done | `DELETE /me` erases PII, frees phone; refused with upcoming bookings. Firebase user record itself is not deleted yet |
| — | PRD 9 | Done | Bookings + tickets cached on device; ticket opens offline |

## Vendor dashboard (V)

| ID | Pri | Status | Notes |
|---|---|---|---|
| V-01 | P0/P1 | Partial | Owner login done; **staff invite / roles (P1) missing**, no `/vendor/members` |
| V-02 | P0 | Done | Onboarding form + document upload |
| V-03 | P0 | Done | Draft → Under review → Live → Suspended |
| V-04 | P0 | Done | Trips CRUD + photos: upload (JPEG/PNG/WebP, re-encoded to ≤1600 px JPEG, EXIF/GPS stripped), cover/reorder, delete; max 8 enforced under a row lock |
| V-05 | P0 | Done | Departure templates → generated slots |
| V-06 | P0 | Done | Block / unblock slots, change rafts |
| V-07 | P0 | Done | Bookings by date with guests |
| V-08 | P0 | Done | QR scan or typed booking code (`POST /bookings/check-in` with `booking_code`; tolerant of case, spaces, dashes, `RF` prefix) on mobile and vendor web; another company's code reads as not found; method recorded on the booking timeline |
| V-09 | P0 | Done | Vendor cancel with reason, full refund, reliability penalty |
| V-10 | P0 | Done | Outbox notifications (SMS driver unconfigured) |
| V-11 | P0 | Done | Payouts page |
| V-12 | P1 | **Missing** | Manifest PDF / CSV |
| V-13 | P1 | Partial | Dashboard endpoint; weekly / monthly stats not checked |

## Admin panel (A)

| ID | Pri | Status | Notes |
|---|---|---|---|
| A-01 | P0 | Done | Email + password + TOTP, roles |
| A-02 | P0 | Done | Review queue, approve / reject / suspend |
| A-03 | P0 | Done, unverified | Route linked account onboarding |
| A-04 | P0 | Done | Commission bps per vendor |
| A-05 | P0 | Done | Stretch add/edit/deactivate (River control tab). Season calendar: planned closures by IST day for one stretch or the whole river; departures inside are unbookable, already-sold bookings refunded, customers see the dates in the app before picking a day |
| A-06 | P0 | Done | Close stretch / river → bulk cancel + full refund |
| A-07 | P0 | Done | Booking search |
| A-08 | P0 | Done | Manual full/partial refund via admin cancel; `POST /admin/bookings/:id/dispute` holds the vendor payout, `…/dispute/resolve` restores the prior status (refund instead = cancel). Buttons in admin Bookings |
| A-09 | P0 | Done | Hold / unhold transfers, refund retry |
| A-10 | P0 | Done | Suspend vendor; admin Trips tab hides / unhides any trip (`/admin/trips/:id/hide`), vendor cannot republish while hidden, DB constraint keeps hidden trips off sale |
| A-11 | P0 | Done | `/admin/reports/summary` by IST day or operator (GMV, refunds, payouts, commission earned after refunds) and `/admin/reports/bookings.csv` (exact rupees, formula-injection safe, export audited). Panel in admin Finance |
| A-12 | P1 | **Missing** | Editable legal texts |
| A-13 | P0 | Done | Append-only audit log |

## System (S)

| ID | Status |
|---|---|
| S-01 | Done: row lock + CHECK constraints, 50-parallel concurrency test |
| S-02 | Done: `holds.expire` every minute |
| S-03 | Done: `bookings.complete` |
| S-04 | Done: `transfers.release` |

## Verified on 22 Oct 2026

- API: typecheck clean, 63 unit tests and 19 integration tests pass (real PostgreSQL, including 50 parallel bookings on 8 seats).
- New endpoints exercised with curl: `GET /slots` without stretch, `GET /trips/:id` (+ 404), `GET /me/bookings/:id/cancel-quote` (unpaid, paid > 24 h = 100%), `DELETE /me` (refused with an active booking, then succeeds; the same phone can sign up again).
- iOS simulator (iPhone 17, iOS 27), dev client: browse signed out → trip → checkout → under-age guest blocked → sign-in sheet → hold with countdown → `PAYMENTS_NOT_CONFIGURED` shown → (payment simulated) → My trips → QR ticket → cancel with 50% refund preview → refund initiated.
- **Not verified:** Razorpay native checkout (no test keys), Firebase phone OTP on device, Android build, offline ticket with network off.

### Local dev notes

- Postgres: Homebrew `postgresql@18` on port 5434 (`LC_ALL=en_US.UTF-8 pg_ctl -D /opt/homebrew/var/postgresql@18 -o "-p 5434" start`).
- CocoaPods needs `LANG=en_US.UTF-8`. `ios/` is generated: `npx expo prebuild --platform ios`. The iOS 27 UIScene fix and React Native Firebase pod settings live in `apps/mobile/plugins/`.
- Simulator: `EXPO_PUBLIC_API_URL=http://localhost:4000/api/v1 npx expo run:ios`.
- Paying without Razorpay keys (dev only): `DATABASE_URL_TEST=$DATABASE_URL npx ts-node --transpile-only scripts/dev-simulate-payment.ts <booking-id>` from `apps/api`.

## Remaining P0 work, suggested order

All P0 functional requirements are now built. What stands between this and launch:

1. Live credentials: Razorpay test mode end-to-end, Firebase phone auth on device, SMS DLT templates
2. C-21 follow-up: also delete the Firebase user record on account deletion

## Change log

- **23 Oct, gap pass 3:** A-05, V-04, C-06 done. Migration `20261023000000_closure_kind` (`ClosureKind` enum, `chk_season_has_end`). Public media storage (`STORAGE_PUBLIC_DIR` locally; `S3_BUCKET_PUBLIC` + `PUBLIC_MEDIA_BASE_URL` on S3). Tests: 85 unit, 37 integration.

- **22 Oct, gap pass 2:** V-08, A-08, A-10, A-11 done. Migration `20261022000000_trip_admin_hide` (3 nullable columns + `chk_admin_hidden_not_live`). Tests: 85 unit, 27 integration. Also fixed: mobile sign-out now clears an open checkout from the previous account.
- **22 Oct, gap pass 1:** customer mobile booking flow, any-stretch search, trip detail, cancel quote, account deletion.
