# Recon map: RaftingX (mobile-first web)

Scope: the rafter's booking loop (browse routes → pick one → book and pay → confirmation → trip day) plus the operator and admin side a marketplace needs to fulfil it (verified operators, fair-rotation assignment, QR checkpoints, GPS tracking).
For: assumed to be a new rafting / adventure-activity marketplace product (scope questions were skipped, so confirm this).
Date: 2026-10-24
Method: public pages only, read one at a time (about 10 page reads). The booking app at app.raftingx.com sits behind a sign-in, so nothing past that was seen. Screens behind it are marked **not seen** and inferred from what the public pages say about booking.

## Terms check

- raftingx.com/terms §3 forbids "Scrape, crawl, or use automated tools to extract data from the Site without our prior written consent". This recon read a handful of pages by hand and copied no content, so it stays within that clause.
- Site content and the RaftingX marks are protected by copyright and trademark. Use none of their copy, photos, reels, route write-ups or name.
- No clause found that forbids building a competing service.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | marketing home | https://raftingx.com/ | filter tabs, route cards, safety cards, reels, FAQ (incl. cancellation policy) |
| 2 | planning guide | https://raftingx.com/plan | first-timer guide, indicative price table, 12 FAQs, "book on WhatsApp" steps |
| 3 | safety standards | https://raftingx.com/safety | operator verification, gear rules, GPS, emergency sequence, age/health rules |
| 4 | route page | https://raftingx.com/routes/shivpuri/ | facts block, rapids table, inclusions, price incl. GST + platform fee |
| 5 | other route pages (linked, not read) | /routes/marine-drive/, /routes/brahmpuri/, /routes/phool-chatti/, /routes/marine-drive-shivpuri/, /routes/kaudiyala/ | same template assumed |
| 6 | terms / refunds | https://raftingx.com/terms | payments via Razorpay, refunds in 7–10 business days, liability, eligibility |
| 7 | blog posts | https://raftingx.com/blog/what-to-expect-first-rafting-trip/ , https://raftingx.com/blog/rishikesh-rafting-cost-guide/ | trip-day sequence; "bookings handled on WhatsApp", public launch planned for September |
| 8 | booking app | https://app.raftingx.com/book | sign-in wall only. Not explored |
| 9 | social | instagram.com/_raftingx, facebook.com/raftingx, youtube.com/@raftingx | not read |
| 10 | app store listing | none found | no native app found in either store |
| 11 | the user's own account | — | not used. Would show the real booking screens S09–S16 |

## Core loop

A rafter picks a named stretch of the Ganga, books a seat with a verified operator for a date, pays online, and rafts with a GPS-tracked, checkpoint-verified trip.

## Screens

States in *italics* were not seen. They are the ones the clone must build anyway.

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Home | `/` | Sell the marketplace, show routes | header + filter tabs (All, Family, Moderate, Expert, Photo + Video), theme toggle, hero with stat row and featured route card, route cards grid, stats band, 4 safety cards, reels row, FAQ, closing CTA, footer | filled; *Expert tab empty (no matching card)*, *loading*, *mobile nav* |
| S02 | Route detail | `/routes/:slug` (6 routes) | Everything about one stretch | breadcrumb, eyebrow, facts block (distance, water time, rapid count, grade, min age, from-price), hero image, audience bullets, experience timeline, rapids table (#, name, grade, what it does), included / bring / extra lists, safety section, price + group-rate note, FAQ accordion, related routes | filled |
| S03 | Plan guide | `/plan` | First-timer planning | breadcrumb, quick-stats bar (season, distances, min ages, swim needed, travel time, budget), 4-step summary, long-form sections, indicative price table, 12 FAQs, related guides | filled |
| S04 | Safety standards | `/safety` | Trust: how operators are checked | verification checklist, grade explainer, gear standards, GPS, numbered emergency sequence, age and health rules | filled |
| S05 | Blog index | `/blog` | SEO content | post list | *not read* |
| S06 | Blog post | `/blog/:slug` | SEO guides that end in a booking CTA | article, inline links, "Book on WhatsApp" CTA | filled |
| S07 | Corporate | `/corporate` | Group / offsite enquiries | *linked from S02, not read* | — |
| S08 | Legal | `/privacy`, `/terms`, `/terms#refunds` | Terms, privacy, refunds | long text, anchors | filled; *refunds anchor has no dedicated policy text* |
| S09 | Sign in | `app.raftingx.com/book` | Gate before booking | *probably phone + OTP (guess)* | page title only |
| S10 | Pick trip | after S09 (**not seen**) | Route, date, slot, group size | route picker, date picker (season-limited), slot list, group-size stepper, live price | *empty, filled, sold out, closed day (monsoon/weather)* |
| S11 | Rafter details | **not seen** | Who is going | per-participant name, age, phone; health declaration; consent; photo-ID reminder | *validation error, under-age rejection* |
| S12 | Add-ons + summary | **not seen** | Extras and price | add-ons (photographer, cliff jump, camping, hotel pickup), price incl. GST + platform fee, cancellation terms shown | *filled* |
| S13 | Payment | Razorpay checkout (**not seen**) | Take payment | Razorpay sheet (UPI, card, net banking) | *success, failed, pending UPI* |
| S14 | Booking confirmed | **not seen** | Proof + next steps | booking ID, operator, reporting point and time, on-call number, what to bring, tracking-link option | *filled* |
| S15 | My bookings | **not seen** | Manage | list, detail, reschedule, cancel with refund preview | *empty, upcoming, past, cancelled* |
| S16 | Live trip tracking | link shared with family (**not seen**) | Watch the raft | map, last ping, checkpoint ticks | *not started, live, completed, signal lost* |
| S17 | WhatsApp booking (today's real channel) | `wa.me/919910337488` with prefilled text | Human-assisted booking | prefilled message: route, date, group size | seen |
| S18 | Operator: bookings | **not seen** | Assigned trips via fair rotation | day list, accept/decline, raft + guide assignment | *empty, assigned, full* |
| S19 | Operator: checkpoint scan | **not seen** | 3 timestamped, GPS-validated QR scans per trip | scanner, location check, result | *valid, out of zone, duplicate* |
| S20 | Admin: operator verification | **not seen** | Seasonal 8-point check, permit on file | checklist, permit upload + expiry, pass/fail, remove from rotation | *pending, verified, suspended* |
| S21 | Admin: incidents | **not seen** | Log and follow up incidents | incident form, timeline, status | *open, resolved* |
| S22 | Reels | "See all reels" (URL not exposed) | Social proof | video grid, rafter name, route, quote | *not read* |

## Flows

```
F01 Visitor books on WhatsApp (today's real channel)
    S01 -> S02 -> S17
    happy path clicks: 2 (route card / route page -> "Book on WhatsApp"), then a chat
    edge: outside WhatsApp hours, price quoted differs from page, no slots that day

F02 Visitor books online (inferred, behind sign-in)
    S01 -> route card "Book" -> S09 -> S10 -> S11 -> S12 -> S13 -> S14
    happy path clicks: ~8 plus OTP (estimate, not counted)
    edge: OTP fails, slot fills mid-checkout, participant under the route's min age,
          group bigger than one raft (6–8), UPI pending, payment captured but booking not created

F03 First-timer plans then books
    S06 (blog) or S03 -> S02 -> F01 or F02
    edge: picks a route their group's youngest member is too young for

F04 Rafter reschedules or cancels (policy from the S01 FAQ)
    S15 -> booking -> reschedule | cancel -> refund preview -> confirm
    rules: free reschedule up to 24 h before; cancel 48 h+ = full refund; inside 48 h = 50%; no-show = 0
    refund to original method in 7–10 business days
    edge: cancelling exactly at 48 h, rescheduling into the monsoon closure, partial group cancels

F05 River closes (weather or state order)
    admin closes a date or route -> affected bookings notified -> full refund or reschedule
    edge: closure on trip morning, season end (30 Jun) and reopen (15 Sep)

F06 Booking assigned to an operator by fair rotation (inferred)
    booking created -> rotation picks the next verified operator with capacity -> S18 accept
    edge: operator declines, suspended operator skipped, no capacity

F07 Trip day
    report at put-in -> consent + ID -> gear-up -> briefing -> S19 scan 1 -> on water (S16 live)
    -> S19 scan 2 -> take-out -> S19 scan 3 -> trip complete
    edge: GPS signal lost in the gorge, scan outside its zone, rafter no-show

F08 Seasonal operator verification
    S20 -> permit + 8-point checklist -> verified (in rotation) | failed (out until fixed)

F09 Incident
    guide/operator raises -> S21 -> follow-up -> closed

F10 Corporate / large group enquiry
    S02 group note or S07 -> enquiry -> custom quote
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Header / nav | desktop, mobile | default, scrolled, menu open | all public |
| Filter tabs | All, Family, Moderate, Expert, Photo + Video | selected, empty result | S01 |
| Theme toggle | light / dark | — | S01 |
| Button | primary (Book), secondary (See routes), WhatsApp | default, hover, focus, loading, disabled | all |
| Stat row / stat band | 4 stats | — | S01 |
| Route card | featured (hero), grid | default, hover, sold out* | S01 |
| Rating badge | stars + text | — | S01 |
| Difficulty indicator | family / moderate / expert | — | S01, S02 |
| Facts block | 6 facts | — | S02 |
| Quick-stats bar | 6 facts | — | S03 |
| Rapids table | — | — | S02 |
| Include / bring / extra lists | 3 lists | — | S02 |
| Safety card | 4 | — | S01 |
| Numbered step list | 4-step, emergency sequence | — | S03, S04 |
| FAQ accordion | — | collapsed, open | S01, S02, S03 |
| Video reel card | — | idle, playing | S01, S22 |
| Breadcrumb | — | — | S02, S03 |
| Footer | — | — | all public |
| Payment badges | UPI, Visa, Mastercard, RuPay, Razorpay | — | footer |
| Date picker* | season-bounded | closed days, sold out | S10 |
| Slot list* | — | available, few left, full | S10 |
| Stepper* | group size | min, max | S10 |
| Participant form* | repeatable | error | S11 |
| Price summary* | with GST + platform fee | — | S12, S14 |
| Map / tracker* | live, replay | no signal | S16 |
| QR scanner* | — | valid, invalid, out of zone | S19 |

*inferred, not seen

## Inferred data model

```
Route        id, slug, name, put_in, take_out, distance_km (range), water_time_min (range),
             grade (e.g. "III, IV opener"), min_age, max_age, rapid_count, category
             (family | moderate | expert), rating, from_price_paise, season_open, season_close
             evidence: S01 cards, S02 facts block · confidence: high

Rapid        id, name, grade, description · RouteRapid(route_id, rapid_id, order)
             evidence: S02 rapids table · confidence: high

Operator     id, name, permit_number, permit_expiry, status (pending | verified | suspended),
             rotation_position · evidence: S04 · confidence: medium

Verification id, operator_id, season, checklist (gear, guides, briefing, kayaker, GPS,
             incident reporting, service, permit), result, checked_by, checked_at
             evidence: S04 ("8-point", checked each season) · confidence: medium

Guide        id, operator_id, name, swiftwater_rescue_cert, river_experience
Raft         id, operator_id, capacity (6–8), gps_device_id
             evidence: S04 · confidence: medium

Departure    id, route_id, date, slot_time, operator_id, raft_id, guide_id, kayaker, status
             evidence: guess (slots, fair rotation) · confidence: guess

Booking      id, user_id, route_id, departure_id, date, group_size, status
             (pending_payment | confirmed | rescheduled | cancelled | completed | no_show),
             amount_paise, gst_paise, platform_fee_paise, addons, channel (web | whatsapp | walk_in)
             evidence: S02 price note, S01 FAQ, terms · confidence: medium

Participant  id, booking_id, name, age, phone, health_declaration, consent_at, id_checked
             evidence: S04 health rules, terms (photo ID), blog (consent form) · confidence: medium

Payment      id, booking_id, razorpay_order_id, razorpay_payment_id, method, status
Refund       id, payment_id, amount_paise, reason (customer_48h+ | customer_<48h | closure), status
             evidence: terms, S01 FAQ · confidence: high

Checkpoint   id, departure_id, seq (1–3), scanned_at, lat, lng, in_zone
GpsPing      departure_id, ts, lat, lng · TrackingLink(token, departure_id, expires_at)
             evidence: S01 safety cards, S04 · confidence: medium

Closure      id, route_id (nullable = all), date_from, date_to, reason (monsoon | weather | order)
Incident     id, departure_id, severity, notes, status, followed_up_at
             evidence: S04 · confidence: medium

User         id, phone, name, email · evidence: S09 sign-in · confidence: guess
```

Relationships: Route 1-n RouteRapid n-1 Rapid; Operator 1-n Guide, Raft, Verification; Route 1-n Departure; Departure 1-n Booking; Booking 1-n Participant; Booking 1-n Payment 1-n Refund; Departure 1-n Checkpoint, GpsPing.

## Observations worth keeping (data quality on the original)

The public site's route facts disagree with themselves. Your clone should keep each fact in one table and render it everywhere:

- Shivpuri price: ₹1,000 (hero), ₹1,250 (card), ₹917 (route page), ₹1,500–2,200 (plan + route FAQ).
- Minimum age: 14–65 on cards, 16+ for Marine Drive in the FAQ, 14+ for everyone in the terms.
- Shivpuri rapids: 10 on the card, 8 named on the route page. Distance 14 km vs 14–16 km.
- "Expert" filter has no route behind it. "Cross Fire" vs "Crossfire". Refund-policy link lands on terms with no refund table.

## Feature matrix

See `features.csv`. Must: 24, should: 14, could: 8, skip: 6.

## Out of scope (cannot or should not be cloned)

- Their operator network (300+ operators, 600+ rafts) and its stats. You recruit your own.
- Uttarakhand Tourism rafting permits. These are held by operators, so your operators need their own.
- GPS hardware on rafts. The software can be cloned, but the devices are hardware.
- Their reels, photos, route write-ups, blog posts and brand. These are their content.
- A bundled insurance partner. This is a partner deal that they're still evaluating.

## Size

Screens 22 (8 seen, 14 inferred), flows 10, entities 16.
Hard parts: (1) two-sided marketplace logic: capacity, fair rotation, operator accept or decline; (2) payments with Razorpay, a time-based refund policy and closure refunds; (3) trip-day ops: QR checkpoints validated against GPS zones, and live tracking with bad signal in the gorge.
Size: **L** (a quarter) for the full scope. The rafter loop plus admin-assigned operators, with no live GPS, is **M** (a few weeks).
