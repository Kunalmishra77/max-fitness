# Progress Log

Append one entry per working session (newest at top). Coding agents must update this at the end of every session.

## Template
```
### YYYY-MM-DD — Phase N — <short title>
Done:
- …
Decisions (also add to decision-log if significant):
- …
Pending / next:
- …
Blockers / questions for client:
- …
```

### 2026-09-12 (evening) — Phase 4 (partial) — Max Register: login, Today, members, take fees
Done:
- **Core (test-first, 77 tests):** the permission matrix for every capability × role (`can`/`assertCan`, with PIN elevation and the reception-payments setting); PIN login with five attempts, a 15-minute lockout, and the same answer for an unknown mobile as for a wrong PIN; `recordDeskPayment` — cash/UPI/card at the desk, the same receipt counter, membership confirmation, member code, activation, call-task closing and outbox as an online payment, with discounts needing permission, a reason and a ceiling.
- **Database:** staff/session store (session looked up by SHA-256 of the token), desk-payment unit of work, and the CRM read models — Home tiles, member list with search and fee filters, member profile, call list — reading fee state from the `member_fee_at` read model (ADR-013) rather than per member.
- **Integrations:** Argon2id PIN verification (memory 19 MiB, 2 iterations) behind a core port.
- **Screens (Hindi first, 56px+ targets):** `/crm/login`; Home "आज" with tiles, calls, birthdays and owner-only money; members list with instant search and fee filters; member profile with fee card, attendance dots and plan/payment history; **take fees in three taps**; read-only calls list.
- **Verified:** eslint clean; typecheck 8/8; unit tests **877 passed**; Playwright **40 tests, 39 green in one pass** — the one failure (journey 3 on the 360px project) passed on its own re-run and was `next dev` slowness, not a product bug; a fresh `pnpm db:seed` afterwards gives clean demo data (215 members, ₹78,900 this month, 65 call tasks).
- **Two real bugs found by the tests:** the login form swallowed the server action's redirect (Next throws to signal one), so login appeared to do nothing; and `/crm` rendered English text under a Hindi `lang` attribute because next-intl had no locale to infer from the URL.

Decisions (decision-log):
- ADR-039 what the CRM slice includes and deliberately leaves out; money owner-only; PIN elevation for sensitive actions; CRM language from the cookie; server actions and the NEXT_REDIRECT rule.

Pending / next (the rest of Phase 4):
- Add-member wizard at the desk, call outcomes, verify queue, attendance marking and undo, leads, reports, settings (prices/hours/promo/staff), privacy export and erasure, undo bar on a payment, PWA shell.
- P9 (desk payment void) with PIN elevation and an audit row; the nightly call-task rules beyond SIGNUP_NOT_PAID.
- Owner co-design review of the low-fidelity screens (Phase 4 prompt step A) before the rest of the UI is built.

Blockers / questions for client:
- Same as Phase 3: payment-failure wording, prices, minimum age, admission fee, PIN confirmation, photos, policy answers, grievance officer.
- Demo staff logins are the seeded ones (owner 9000000001 / 2468, reception 9000000002 / 1357). Real PINs must be set before anyone uses this outside a demo.

### 2026-09-14 — Live demo on Vercel, code on GitHub
Done:
- **Code:** `github.com/Kunalmishra77/max-fitness`, branch `main`. `.env` and every secret stayed out of the repository; only `.env.example` is tracked.
- **Live:** https://max-fitness-kappa.vercel.app — the website at `/` and `/hi`, sign-up at `/join`, and Max Register at `/crm`. Vercel project `max-fitness`, Node 24, functions in Mumbai beside the database, demo mode on deliberately (ADR-044). The repository is connected, so every push to `main` deploys.
- **Checked on the live site, not assumed:** `/` 200, `/hi` 200 with `lang="hi"`, `/join` 200, `/crm` redirects to the login screen, the login screen renders in Hindi, plans come from the database, and a junk path such as `/favicon.ico` is a 404 rather than a 500. The read-only CRM journeys ran against production and **passed 10/10** on phone and desktop sizes: wrong PIN refused, no session sent to login, Today in Hindi with tiles and money, money hidden from reception, search and profile. Journeys that take fees, add members or void payments were **not** run against production, because they would write into the demo data.
- **Four things only a real deployment could have found:**
  1. `next build` had been failing since the CRM slice: the CRM's locale cookie was read during static generation. Every check since then had used `next dev`.
  2. The first fix wrapped that read in try/catch. The build passed, but on Vercel the read succeeded at request time, `/` and `/hi` switched from static to dynamic, and Next served a **500 on the live landing page**. The cookie is now read only when the URL has no locale, which is the CRM.
  3. A clean checkout could not build: the generated Prisma client is gitignored and nothing regenerated it. `prisma generate` now runs on install.
  4. Vercel's Next builder needs `apps/web` as the Root Directory. That is a dashboard field with no CLI flag, so the client set it; a local `vercel build` on Windows could not map route groups, so builds run on Vercel.
- **The health route reports "not ok"** on the live site, correctly: the database is fine, but no worker is running, because Vercel cannot host one.

Pending / next:
- Before real members use it: object storage (S3/R2) for photos and receipt PDFs, which do not survive on Vercel's `/tmp`; a host for the worker (reminders, outbox, nightly call tasks); real Razorpay keys.
- Re-seed the demo data before showing the client (`pnpm db:seed`), because the live site and the local machine share one database.
- Product work unchanged from the entries below: reports, settings, privacy export and erasure, PWA, verify queue with Phase 5, the wizard camera step, and the carried-over fixes.

### 2026-09-12 (end of day) — Phase 4 — Enquiries: the website's leads finally reach the owner
Done:
- **The enquiries screen (ADR-043; BR-10.1)** under "और": Open and All tabs, each enquiry with the date it came, its goal, its notes, and the two things staff do — call or WhatsApp — plus one button to say what came of it. Enquiries have been arriving since Phase 2 (the website form writes them, rings the bell and queues the owner's WhatsApp), but nobody could see a single one of them in the CRM; all 25 seeded enquiries were invisible.
- **`advanceLead` moves an enquiry forward only.** `NEW → CONTACTED → TRIAL_BOOKED → VISITED → CONVERTED | LOST`, with skips allowed — a real enquiry phones at noon and walks in at six — and backwards refused, because a status that can move both ways tells the owner nothing about whether it is still worth a call. `CONVERTED` and `LOST` are final. Notes are appended with the IST date, never replaced, so one enquiry reads as a history.
- **No new capability:** enquiry work reuses `member.edit` (owner and reception, not trainers). The permission matrix is enumerated and tested row by row, and a second row meaning the same thing is a liability.
- **A separate unit of work** from the website's lead path: that one creates and merges enquiries as they arrive, this one only moves an existing one along.
- **Named as missing rather than assumed done:** BR-10.2's automatic conversion (a member registering with the same mobile within 60 days) is still unimplemented anywhere; and marking an enquiry contacted does not yet close its open `NEW_LEAD` call task, so the calls list can still show one already handled from the enquiries screen.
- **Test finding:** the end-to-end journey picked "the first open enquiry", which an earlier run had already contacted — and an enquiry only moves forward, so the button it wanted was correctly not offered. The product behaved right; the test assumed fresh data. It now picks a *new* enquiry and writes a unique note.
- **Verification:** unit **916 passed** (72 files); database integration **40 passed**; Playwright **44 passed, 1 failed, 11 skipped** — that one failure being the test-data assumption above, fixed and re-run green; eslint clean; typecheck **6/6 packages**. Demo data re-seeded afterwards.

Pending / next:
- Rest of Phase 4: verify queue, reports, settings, privacy export and erasure, PWA shell; the wizard's camera step.
- Carried over: the session-lookup logout (a transient database error signs staff out), `EXPIRED_BUT_VISITING` from a manual check-in, BR-10.2 auto-conversion, closing `NEW_LEAD` tasks from the enquiries screen.
- `TEST_DATABASE_URL` is still empty in `.env`; these runs set it explicitly.
- Nothing committed yet; CI has never run these tests.

### 2026-09-12 (late night, continued) — Phase 4 — Attendance by hand, with undo
Done:
- **The attendance tab is real (ADR-042; crm-ux-blueprint §11):** search → mark → undo bar; today's list with the time and how it was recorded; and a "नहीं आ रहे" tab — members who have paid but stopped coming for ⚙ 7 days or more, each with a call button. The kiosk is Phase 7, so until then this is how every visit is recorded.
- **`markAttendance` reuses the kiosk's own cooldown rule** (BR-9.1), so "one visit per 180 minutes" cannot mean two things depending on which door recorded it. Every tap carries a `clientEventId`: a double press at a busy counter is one visit, not two.
- **Undo voids the check-in rather than deleting it** — every read already ignores voided events, and a correction that leaves no trace is not a correction.
- **`Member.lastAttendanceAt` is maintained at runtime for the first time**, in the same transaction as the event, and rewound on undo to the previous visit that still counts. Nothing updated it before — only the seed set it — yet it is what the cooldown and "not coming" are both read from. **The kiosk must do the same in Phase 7** or the two readings drift.
- **The fee state the desk could see is stored on the check-in** (`feeStateAtCheckIn`), ready for the `EXPIRED_BUT_VISITING` follow-up (BR-7, priority 1). Raising that call task from a manual check-in is not in this slice.
- **Bug found by the end-to-end journey:** `MemberSearch` was hardcoded to navigate to `/crm/members`, so searching on the attendance screen took staff away from the mark button. It now takes a `basePath`.
- **A teardown bug in my own integration test:** attendance rows reference members, so the cleanup could not delete them — the suite reported 39 passing tests inside a failing file until the cleanup deleted events first.
- **One flake, reported as a flake:** in the full 43-test Playwright run the attendance journey failed at *login* — the screen stayed on `/crm/login` with no error, meaning the session did not resolve on the request straight after signing in. It passed alone and 10/10 on a clean re-run, so it is not fixed, it is unexplained. **Worth doing next:** `currentActor` swallows a session-lookup failure and redirects to the login screen, so a transient database hiccup silently signs staff out mid-work; it should retry once, or say something, rather than log them out.
- **Verification:** unit **907 passed** (71 files); database integration **39 passed**; Playwright **43 passed, 1 failed (that flake), 10 skipped**, with the CRM desktop suite re-run **10/10**; eslint clean; typecheck **6/6 packages**. Demo data re-seeded: 196 ACTIVE members, 51 open call tasks, 5,299 attendance events.

Pending / next:
- Rest of Phase 4: verify queue, leads, reports, settings, privacy export and erasure, PWA shell — plus the owner's co-design review.
- The session-lookup logout above; `EXPIRED_BUT_VISITING` raised from a manual check-in; the wizard's camera step.
- `TEST_DATABASE_URL` is still empty in `.env`; these runs set it explicitly.
- Nothing committed yet; CI has never run these tests.

### 2026-09-12 (late night) — Phase 4 — Adding a member at the desk
Done:
- **The walk-in wizard (ADR-041; crm-ux-blueprint §7):** one question per screen — photo, name, mobile, gender, date of birth, consent — then straight into the fee flow, so someone who joins and pays in one visit never leaves the counter. The ＋ button on Home and Members now opens it; it pointed at the members list before.
- **`registerAtDesk` reuses the website's parts:** the same registration store and unit of work (no new repository), the same Zod schema, and the same age and consent rules. "At least 16" and "a minor's own tick is not enough for face attendance" (BR-12.2) are decided once for both doors into the gym.
- **The photo is optional at the desk** — a camera that will not open must not stop someone joining — and **the staff member is recorded**: `Member.createdById`, plus `recordedById` and `channel = "crm_desk"` on every consent row. Both columns already existed and are now mapped, with an integration test that reads them back.
- **Two findings, both from tests rather than from reading the code:** an end-to-end test typed a name containing digits and the server refused it — correct, the schema allows letters only, and the wizard sent the staff member back to the name question, which is exactly the behaviour that step exists for. And the call-outcome journey assumed one open call task per member; the seed has a member with two (the unique index is per member **and** reason), so the locator matched two rows. The test was wrong, not the product.
- **Verification:** unit **899 passed** (70 files); database integration **37 passed** against Supabase; Playwright CRM **14 passed, 4 skipped** (the four that write members or money run on desktop only); eslint clean; typecheck **6/6 packages**. Demo data re-seeded afterwards: 220 members, 196 ACTIVE, 65 open call tasks.

Pending / next:
- Rest of Phase 4: attendance marking with undo, verify queue, leads, reports, settings, privacy export and erasure, the undo bar, PWA shell — plus the owner's co-design review.
- The wizard's camera step is "not now" only; the website's selfie sheet can be dropped in without touching the service, which already accepts a photo.
- At delivery: Razorpay test-mode run with real keys, then live keys and the dashboard webhook (ADR-037).
- `TEST_DATABASE_URL` is still empty in `.env` (see the entry below); these runs set it explicitly.
- Nothing committed yet; CI has never run these tests.

### 2026-09-12 (night) — Phase 4 — Call outcomes, P9 void with a PIN re-entry, snooze bug fixed
Done:
- **Call outcomes (BR-7), so the calls list is no longer read-only:** six buttons under each call — will renew, call later, no answer, done, wrong number, left the gym. `recordCallOutcome` applies the existing rules (check back in two days, retry a no-answer tomorrow and give up after the third try, close the task and mark the member LEFT) and refuses a task someone else already closed.
- **P9, voiding a desk payment (ADR-040):** the last open case in the P1–P9 matrix. Payment goes VOIDED with the reason and who did it, the membership returns to PENDING_PAYMENT, an audit row records before and after, and **the receipt number stays** — the next payment takes the next number instead of filling the gap (BR-11.2).
- **PIN re-entry:** `elevateSession` re-checks the PIN and writes `Session.lastSeenAt`, which is what the next five minutes of elevation are read from. It reuses the login's five-attempt lockout — otherwise this screen would be an unlimited PIN oracle around the login limit. `mayAfterPinEntry` lets a screen decide whether to offer the PIN at all, and the server checks the role before it looks at a PIN, so a receptionist never spends an attempt or learns whether a PIN was right.
- **Bug found and fixed:** today's call list ignored `snoozedUntil`, so "call later" changed nothing the owner could see — a snoozed task stayed on today's list. `callTasks` now returns a task only when it is not snoozed past today. Found by a new integration test, not by reading the code.
- **The row lock was proved, not assumed:** with `FOR UPDATE` removed, the concurrent-void test failed with two successful voids; restored, one succeeds and the other gets `PAYMENT_ALREADY_SETTLED`.
- **Finding — the integration suites were skipping silently:** `TEST_DATABASE_URL` is **empty** in `.env`, so all 36 database tests skipped themselves while `pnpm test` still reported green (ADR-010 chose that skip so a fresh clone passes). These runs set it explicitly from the direct connection. It needs filling in locally and in CI, or the safety net is decorative.
- **Verification:** unit **890 passed** (69 files); database integration **36 passed** against Supabase, including the new `crm-desk.integration.test.ts` (P9, the double-void race, the receipt series, call outcomes, the snooze filter); Playwright CRM **13 passed, 3 skipped** (the three that write money run on desktop only); eslint clean; typecheck 6/6 packages. Demo data re-seeded afterwards, because the E2E run takes real fees, voids one payment and closes a call task.

Pending / next:
- Rest of Phase 4: add-member wizard at the desk, attendance marking with undo, verify queue, leads, reports, settings (prices/hours/promo/staff), privacy export and erasure, the undo bar, PWA shell — plus the owner's co-design review of the low-fidelity screens.
- At delivery: Razorpay test-mode run with real keys, then live keys and the dashboard webhook (ADR-037).
- Nothing committed yet; CI has never run these tests.

Blockers / questions for client:
- Unchanged from the entry below: payment-failure wording, 3/6/12-month prices, minimum age, admission fee, PIN confirmation, consented photos, facility and policy answers, grievance officer.

### 2026-09-12 (later) — Phase 3 — Sign-up modal, private media route, demo payments confirmed
Done:
- **Client decision (ADR-037):** payments stay in DEMO_MODE for now; real Razorpay is connected at delivery. The demo dialog already posts through the real verify and confirmation path, so switching is configuration: three Razorpay secrets, `DEMO_MODE=false`, and the dashboard webhook.
- **Sign-up modal (ADR-038), the item ADR-036 had deferred:** intercepted routes under `[locale]/@modal` for `/join`, `/join/plan`, `/join/pay` and `/join/done`. "Sign up" and "Choose" open a sheet over the landing page; the same URLs opened directly are full pages; closing goes back. The confirmation is intercepted too, because a parallel slot keeps its content across a client-side navigation and the pay step otherwise stayed on screen behind it.
- **Landing page measured after the modal (production build, DevTools throttling, medians of 3):** `/` LCP **2.34 s** (budget 2.5 s), `/hi` **2.91 s** (budget 3.0 s), CLS 0, accessibility 0.97 — no regression, slightly better than the ADR-033 baseline. The gate passed with only the existing TBT warnings.
- **`GET /api/v1/files`:** private media behind the storage driver's signed URL (5-minute TTL, `private, max-age=60`, noindex, no referrer). The renew page now shows the member's photo through it.
- **Bug found by journey 6:** the file route used `instanceof LocalStorageDriver`. Next bundles a route handler separately from the container, so the class arrives as two constructors and every valid signed URL 404'd. It now recognises the driver by shape.
- **Verification:** eslint clean; typecheck 8/8; unit tests **800 passed**; database integration **29 passed** against Supabase; `next build` passed; Playwright **29 passed** against `next start` (journeys 3–6, the two landing entry paths, and axe on the open modal).

Pending / next:
- Phase 4 (CRM): the CRM halves of journeys 3 and 5, P9 desk void, the 7-day reservation cancellation, and the rest of the nightly call tasks.
- WhatsApp receipts and owner alerts wait in the outbox for Phase 6; kiosk enrolment for Phase 7.
- At delivery: Razorpay test-mode run with real keys, then live keys and the dashboard webhook.
- Optional server-side face re-check; Hindi receipt PDF (needs an embedded Devanagari font).
- Nothing committed yet; CI has never run these tests.

Blockers / questions for client:
- Confirm the payment-failure wording (copy deck flagged it): "If money was debited, your bank returns it automatically, usually within 5–7 working days."
- Still open: 3/6/12-month prices, minimum age (default 16), admission fee (default ₹0), PIN confirmation, consented photos, facility/policy answers, grievance officer.

### 2026-09-12 — Phase 3 — Sign-up, selfie, payment, confirmation, renewal, receipts
Done:
- **Core (test-first):** registration and checkout rules; `registerMember` (selfie stored first, deleted if the transaction fails); `createCheckoutOrder` (server pricing; a retry reuses the pending membership only at the same price and within the 48 h hold); a single `confirmPayment` for verify, webhook and demo, with bell alerts; `verifyCheckout` (signature, then the gateway's own record); `handleRazorpayWebhook` (event recorded once; unfinished events are retried); `amountInWordsINR`; `attachReceiptPdf`; the outbox dispatcher; `raiseSignupNotPaidTasks`.
- **Database:** Prisma units of work and readers for registration, checkout, confirmation (`FOR UPDATE` on the payment, upsert-locked counters), webhooks, receipts, the outbox claim (`SKIP LOCKED` + lease) and call tasks. Integration tests P1–P8 plus outbox, receipt PDF and SIGNUP_NOT_PAID cases run against PostgreSQL: **29 passed** on the Supabase dev database under a throwaway gym, with no rows left behind. Removing `FOR UPDATE` makes P3 fail with a double activation.
- **Integrations:** Razorpay adapter over `fetch` (orders, payment fetch, checkout and webhook HMAC with constant-time compare, 10 s timeout, Zod-checked responses); the simulated gateway accepts an explicit outcome; `resolveStorageRoot`.
- **API:** `POST /registrations` (multipart; magic bytes; sharp re-encode to a ≤ 720 px JPEG with no EXIF), `GET /plans`, `POST /checkout/orders`, `POST /checkout/verify`, `GET /checkout/status`, `POST /checkout/simulate` (demo only), `POST /webhooks/razorpay` (raw-body HMAC, 401 on a bad signature, 404 in demo mode), `GET /renew/{token}`, `GET /receipts/{token}/pdf`. A live smoke test of every route and error path passed on the dev server; the smoke member was deleted.
- **UI:** `/join` details (DOB selects, consents: face attendance off and unavailable to minors), `SelfieCapture` (explainer, camera errors, self-hosted MediaPipe face check, oval guide, capture and compress, phone-camera fallback, in-app browser banner, camera switched off on close), plan step (monthly first, savings, start date ≤ 15 days, end-date preview), pay step (Razorpay Checkout or demo dialog, polling, failure, review, pay at reception), confirmation, `/renew/{token}`, `/r/{token}` receipt page. EN/HI message parity: 439 keys each.
- **Worker:** outbox poller (every 2 s), `receipt-pdf` queue rendering an A5 PDF with `@react-pdf/renderer`, and the SIGNUP_NOT_PAID part of the 06:00 job. A live run dispatched 6 outbox events and attached 6 PDFs; one was downloaded through the web route (200, application/pdf, private).
- **Dependencies (TRD-named, pinned in the catalog):** sharp 0.35.4, @mediapipe/tasks-vision 1.0.1, @react-pdf/renderer 4.9.0 (+ react in the worker as its peer).
- **Verification at the end of the session:** eslint clean; typecheck 8/8; unit tests **800 passed** (23 DB tests skipped without TEST_DATABASE_URL); `next build` passed; Playwright **24 passed, 4 skipped** against `next start` (demo mode). That includes journey 3 (fake camera with the real face detector → plan → simulated payment → confirmation → refresh → receipt page), journey 4 (camera blocked → phone photo), journey 5 (failure → try again → pay at reception) and journey 6 (renew link → chained start date → paid).

Decisions (decision-log):
- ADR-034 one confirmation path, two row locks, webhook as source of truth, no webhooks in demo mode.
- ADR-035 open checkout details: optional email, 48 h hold derived from `createdAt`, reuse rules, `PLAN_GENDER_MISMATCH`, LEFT members may renew, token headers, 90-day receipt links, selfie pipeline, keyed IP hash, checkout rate limits, no Razorpay SDK, container on `globalThis`, **P9 moved to Phase 4** (desk void needs the CRM fee desk).
- ADR-036 pages instead of the intercepted modal (for now), session state, "Use phone camera" in the explainer, generated camera fixture, fixed renewal start, English Helvetica PDF, proxy matcher by extension, workspace-rooted storage, bell alerts, outbox claims only implemented types, SIGNUP_NOT_PAID once per sign-up.

Pending / next:
- Intercepted `@modal/(.)join` from the landing page (deferred, ADR-036).
- CRM halves of journeys 3 and 5 and P9 (desk void) — Phase 4. Also Phase 4: the 7-day reservation cancellation and the rest of the nightly call tasks.
- `whatsapp.receipt` and `alert.owner` outbox events wait for the WhatsApp engine (Phase 6); `kiosk.enroll` waits for Phase 7.
- `/api/v1/files/{id}` signed media route (the renew page shows no photo yet); optional server-side face re-check; Hindi receipt PDF (needs an embedded Devanagari font).
- Run the real Razorpay test mode once keys exist: only unit tests and the simulated gateway have exercised the adapter so far.
- First CI run of the new integration and E2E tests on GitHub (not run; nothing committed yet).

Blockers / questions for client:
- Razorpay test keys (key id, secret, webhook secret) to try real checkout in test mode.
- Confirm the payment-failure wording ("If money was debited, your bank returns it automatically, usually within 5–7 working days") — the copy deck flagged it for verification.
- Still open from earlier: 3/6/12-month prices, minimum age (default 16) and admission fee (default ₹0), PIN confirmation, consented photos, facility/policy answers, grievance officer.
- Local E2E runs register real members in the development database (names "Esha Tester", "Ravi Renewer") and use real receipt numbers. Re-seed before any client demo if a clean series matters.

### 2026-09-11 (late night) — Phase 2 — Real gym facts from Google, static caching, LCP work
Done:
- Researched the client-supplied Google Business Profile (listing, all visible reviews, Maps pin, hours, owner note), plus Justdial/Magicpin snippets and web searches for the owner. Findings and decisions in ADR-031; facts saved to project memory.
- Content: removed the unverified "national champion" positioning. Meta, hero slide 1, trust strip, About, nav and the plaque (now an owner section for Ajay Kuliyal, quoting a member's review verbatim) now use verified facts. Six real 5★ Google reviews replace demo reviews. Personal training (₹3,000/month with diet plan) and diet plans are confirmed extras; "changing area" removed. Timings and personal-training FAQs are verified. Unverified free-trial and 2-hour call-back promises are out of live copy. EN/HI parity 281 keys. Copy deck v1.1 and the content strategy were updated.
- Data: seed hours now Mon–Sat 4:30 am–10 pm, Sunday closed. Address line from Google with PIN 201014. Re-seeded Supabase (13.4 s, core = SQL). Map, directions and JSON-LD use the verified pin and place ID; JSON-LD gains `geo`, `hasMap`, `sameAs`.
- Rendering (ADR-032): landing, contact and legal pages are statically cached with `revalidate = 300` (cache HIT, `s-maxage=300`); `next build` no longer needs the database. Trust strip and About show the weekly hours line. Today's hours row is highlighted in the browser in IST (new `HoursTable`, tested across a UTC/IST day boundary).
- First paint (ADR-033): Latin-only font preloads (10 → 3), `content-visibility` on off-screen sections, the lead form's Zod schema loaded on first use, and the menu sheet and gallery lightbox dialogs loaded on open.

Measured (mobile, production build, this machine — CPU benchmark index ~1,000–1,300):

| Step | LCP real throttling | LCP Lighthouse CI (simulated) `/` · `/hi` | Script KB |
|---|---|---|---|
| Per-request render (start of session) | — | 5.0 · 5.0 s | 306 |
| Static cache | 4.3–4.4 s | 4.8 · 4.8 s | 306 |
| Latin-only font preloads | 3.0–3.4 s | 3.9 · 4.5 s | 306 |
| Deferred sections + lazy JS | **2.2–2.3 s** | 3.5 · 4.0 s | 207 |
| Self-hosted fonts, per-language preloads (gate run, real throttling) | `/` median **2.38 s ✓** · `/hi` 2.93–3.03 s ✗ | (report only) | 207 |
| + skip layout of off-screen hero slides (reverted, no gain) | `/` median 2.43 s ✓ · `/hi` 3.05–3.14 s | (report only) | 207 |

LCP budgets agreed with the client: English ≤ 2.5 s, Hindi ≤ 3.0 s for now. The Hindi gate is at its limit on this machine; see ADR-033.

CLS 0 throughout; simulated TBT now ~170 ms.

Verified: web + shared typecheck clean, lint clean, Vitest 499 passed (web, shared, core).

Found and fixed after the rendering changes:
- `/join` returned 500 in production: the empty `generateStaticParams` makes the segment static, and the page reads `?plan=`. Added `dynamic = 'force-dynamic'` and recorded the rule in ADR-032.
- Mobile axe reported contrast and target-size issues on off-screen sections. axe cannot measure elements skipped by `content-visibility: auto`, so the audit now renders deferred sections before analysing; the real colours and sizes were already compliant.

Pending / next:
- LCP gate decided by the client: enforce with real (DevTools) throttling; simulated estimate kept as a report-only warning (ADR-033, `lighthouserc.json` + `lighthouserc.simulated.json`, CI step `continue-on-error`).
- Re-run Playwright journeys after the lazy menu/gallery change (running at time of writing).
- Phase 3 plan, for approval before coding.

Blockers / questions for client:
- Confirm PIN 201014 and correct the Google listing if so (it shows 201020); align the listing name to "Max Fitness Gym" (content strategy §5).
- Original photos (equipment, space, owner portrait) and consent for any member who appears.
- Female washroom and changing rooms, free trial, lockers, water, parking, AC, minimum age, pause and refund policies, grievance officer.
- Any championship or title, with proof, if it should appear on the site.

### 2026-09-11 (night) — Phase 2 — Landing page, legal pages, SEO, tests
Done:
- Landing page at `app/[locale]/(marketing)/page.tsx`, sections in wireframe order: promo bar, sticky nav, hero (Embla, 3 slides, rep-tally progress buttons, pause/play, 7 s advance that holds on hover/keyboard focus, reduced-motion and Save-Data → posters only) with the call-back form, trust strip, about, facilities by zone, how to start, fee board (men/women toggle, table from `md`, one gold best value, Choose → `/join?plan=CODE`), promo banner, champion plaque (placeholder, labelled, hidden in production until verified), testimonials (demo-labelled outside production), gallery with keyboard lightbox, visit + contact (hours from settings with today highlighted, click-to-load map), FAQ with FAQPage JSON-LD, final CTA, footer, mobile sticky bar, desktop WhatsApp button. EN + HI copy (279 keys each, parity checked).
- Lead capture: shared `LeadFormSchema`/`LeadCreateSchema`; `packages/core` lead service (7-day dedupe merge with note, else Lead + NEW_LEAD Alert + `alert.owner` outbox event in one transaction); Prisma unit of work; `POST /api/v1/leads` with per-IP and per-mobile sliding-window limits (hashed keys), body cap, honeypot + minimum fill time, api-spec error envelope.
- Settings-driven content: trust numbers, promo bar and banner (`activePromos`), hours (`todayStatus`, `weekHours`, `groupHours`), years operating; cached landing read with `plans`/`settings` tags.
- `/join` placeholder (Phase 3), `/foundation` (dev only), Privacy / Terms / Refund drafts in `apps/web/content/legal/*.md` via a safe Markdown subset, `/contact`, DRAFT banner outside production, Hindi notice on legal routes.
- SEO: localized metadata, canonical + hreflang, OG image, ExerciseGym JSON-LD (no aggregateRating, no geo), `sitemap.xml`, `robots.txt` (disallow all unless production with DEMO_MODE=false).
- Consent-gated analytics (Plausible/GA4 only after consent; banner only when a provider is configured) and `data-track` click events for PRD §7 site events.
- Placeholder hero media generator (ffmpeg, no people, seamless loops, grain for realistic poster entropy).
- Tests: web Vitest project (happy-dom) — fee board toggle, lead form with msw (validation, success, 429, server field errors, offline), rate limiter, analytics gating, legal Markdown parser, `cn`; core tests for lead rules/service, hours, promo, groupHours. Playwright journeys 1–2 + axe on `/`, `/hi`, `/legal/privacy`, `/contact`, `/join` at 360 and 1440; Lighthouse CI config; main-only CI job for E2E, axe and Lighthouse.
- Design check at 360/768/1024/1440 with screenshots in `.playwright-mcp/`; accessory removed: gold rule under the champion title.

Found and fixed:
- `cn()` (tailwind-merge) dropped design-token classes: headings lost their size and red buttons lost white text (axe contrast failures). Configured the token scales (ADR-025).
- Horizontal scroll at 360px from the final CTA row; contrast of placeholder captions and "You save" text; scrollable rows without keyboard access; duplicate landmark line; form alignment below `lg`.
- Hero video became the LCP element and hydration blocked the poster paint; lead form shipped the whole `@mfp/shared` barrel to the browser (ADR-030).

Verified:
- `pnpm typecheck` 8/8, lint clean, Vitest 551 passed / 6 skipped (DB tests without TEST_DATABASE_URL), `next build` OK.
- Production build (`next start`): Playwright 19 passed, 1 skipped by design (real lead submit runs on desktop only); axe clean at 360 and 1440.
- Lighthouse (mobile emulation, 3 runs, median, this machine): CLS 0 ✓, accessibility ≥ 0.95 ✓, **LCP ≈ 5.0 s ✗ (budget 2.5 s)** on `/` and `/hi`, TBT 0.5–0.8 s (warning). LCP element is the hero poster image. First run ~5.1 s (video became LCP) → video deferred and posters made realistic → ~5.1 s with the poster as LCP but painting behind hydration → preload + sync decode + native FAQ → ~5.0 s: render delay fell from ~3.2 s to 1.3–1.9 s, but TTFB (0.9–1.3 s, per-request render) and load delay (~1.45 s) remain. Host CPU benchmark index 1,000–1,300 makes the 4× throttle somewhat pessimistic; not used as a reason to relax the budget. **Budget not met — needs a decision (see pending).**

Decisions:
- ADR-025 `cn()` token scales; ADR-026 page composition (contact folded into visit, `/foundation`, `/join`, scoped client messages); ADR-027 consent banner only with a configured provider; ADR-028 legal pages English drafts + indexing only on the real production site; ADR-029 E2E scope (CRM half of journey 2 in Phase 4); ADR-030 hero LCP and narrow client imports, FAQ as native disclosure widgets.

Pending / next:
- Phase 3 (online sign-up) only on explicit go-ahead.
- LCP budget: options, largest effect first — (a) serve the landing HTML statically with revalidation and compute "open now"/today's row on the client, removing per-request render time (changes ADR-022); (b) render the first hero slide as plain HTML and load Embla, the other slides and the form script after idle; (c) move the rest of the page's interactive islands (nav sheet, gallery lightbox) to load on first use; (d) measure on CI hardware and with real photo posters before deciding.
- First CI run on GitHub to prove the new `web-e2e` job (seed + `next start` + Lighthouse) — unverified locally.
- `@radix-ui/react-accordion` is now unused by the site; remove it or keep it for the CRM.

Blockers / questions for client (content still needed):
- Real hero footage and posters, facility and gallery photos, owner portrait, certificate and medal photos (assets checklist §3–5); an approved logo.
- Owner interview: full name, discipline, championship, year, story facts, quote.
- 3–6 real Google reviews to feature and the Google Business Profile URL; Justdial and Instagram links; GBP map pin latitude/longitude.
- Confirm facilities: personal training (and price), changing area, lockers, drinking water, parking, air conditioning.
- FAQ answers: free first session, women's environment, pausing, refund policy, personal training, minimum age (settings default 16).
- Confirm opening hours (settings show Mon–Sat 5 am–10 pm, Sun 6–11 am) and trust numbers (Google 4.8/231, Justdial 4.9/262).
- Promo bar and banner texts and dates, if any.
- Grievance officer name, email and phone; owner policies for refunds, cancellation, pausing, lockers; Hindi review of all copy and whether legal pages need Hindi versions.

### 2026-09-11 (evening) — Phase 1 — Live on Supabase: migrate, seed, web + worker verified
Done:
- Owner created the Supabase dev project (Mumbai) and filled DATABASE_URL / DIRECT_URL in `.env`.
- Connection probe: session pooler :5432 and transaction pooler :6543 both reachable; PostgreSQL 17.6; role `postgres` (not superuser, CREATEDB); Prisma 7.10 + adapter-pg through the transaction pooler ran 11 parameterised queries with no `pgbouncer=true` (ADR-010 updated).
- `pnpm db:deploy` applied `20260910000000_init`. Live check: 27 public tables (26 app + `_prisma_migrations`), RLS on all 27; view `v_member_fee` with `security_invoker=true`; `member_fee_at()`; partial/expression indexes; CHECK constraints; `anon` and `authenticated` can SELECT from 0 tables and not the view.
- `pnpm db:migrate` (migrate dev): "Already in sync" — shadow database works through the pooler; no drift against schema.prisma.
- `pnpm db:seed`: 220 members (196 ACTIVE / 12 LEFT / 7 PENDING_VERIFICATION / 5 PENDING_PAYMENT), 3,306 memberships and payments, 5,229 check-ins, 1,379 message-log rows, 64 call tasks (49 open), 16 counters; fee states core = SQL (PAID 143 / DUE_SOON 28 / EXPIRED 25 / NONE 0); birthdays today 3, next 6 days 7; September collections ₹79,000 from 44 payments; 18.2 s. Re-run in 11.0 s produced identical counts (idempotent).
- DB integration tests run against the dev database (TEST_DATABASE_URL set for that command only): 6/6 pass; no leftover test rows.
- `pnpm dev`: `/api/v1/health` 200 with db ok and worker ok; Foundation page shows the 8 plan prices with core per-month/savings figures and fee-state tiles 143/28/25/0, in English and Hindi, no connection strings or mobile numbers in HTML; checked at 360px.

Found and fixed:
- Worker crashed on boot: pg-boss 12 rejects `:` in queue names (`reminder-slot:09:30`). Renamed to `reminder-slot-0930` style; new worker test project checks names, uniqueness, one cron per BR-5.1 slot, cron shape and crm-module-spec coverage.
- Health reported "worker ok" for a crashed worker, because the heartbeat started before job registration and the one beat stayed inside the 3-minute window. Heartbeat now starts only after every schedule and queue is registered. Verified: 9 cron schedules in `pgboss.schedule`, all `tz=Asia/Kolkata`; heartbeat advancing.
- `pnpm dev` failed once from a stale shell working directory (`packages/db`); started from the repo root it works.

Verified at end of session:
- Tests 20 files / 448 passed, 6 skipped (DB tests without TEST_DATABASE_URL); lint clean; all 7 workspaces typecheck with 0 errors. Earlier in the session: `pnpm build` 3/3 and `pnpm install --frozen-lockfile` up to date.

Pending / next:
- Owner, Supabase dashboard: remove `public` from Data API exposed schemas; 2FA for all org members.
- Optional: a second Supabase project for TEST_DATABASE_URL so integration tests do not share the dev database.
- Decisions: collections target (month-to-date vs full month); ₹1,330 vs ₹1,333 per-month display (ADR-016).
- First commit of Phase 1 and a first GitHub CI run, when requested; install Node 24 LTS.
- Phase 2 only on explicit go-ahead.

### 2026-09-11 (later) — Phase 1 — Hardening while waiting for the Supabase project
Done:
- Local `.env` generated (git-ignored) with fresh SESSION/LINK/KIOSK/FIELD secrets; only DATABASE_URL and DIRECT_URL remain placeholders for the owner to paste.
- Security: `_prisma_migrations` (created by Prisma, not our DDL) now gets RLS through a guarded statement; CI's RLS check no longer exempts it. Migration rebuilt offline: 26 tables, RLS on all 26 plus `_prisma_migrations`. Added `migration_lock.toml`.
- Bug fixed in `packages/shared/src/env.ts`: the Razorpay rule was inverted (it demanded a secret in demo-mode production and let live production boot without one). Four tests now pin both directions.
- Secret hygiene: Prisma client no longer logs at `error` level. It printed the raw driver message, including the Supabase project ref/username, and Next dev forwarded it to the browser console. Verified after a server restart: 0 such lines in the server log and 0 browser console errors.
- Web: `src/proxy.ts` (Next 16 convention) with next-intl locale routing for public pages only (`/api`, `/crm`, static files excluded); cookie-based CRM locale helper; Foundation page renders separate config-error and database-error states instead of a 500; page labels, title and description moved to en/hi messages; app icon added (was a console 404).
- Layout: `breakpoint.sm = 360px` from design tokens overrides Tailwind's 640px `sm`, so `sm:grid-cols-2` produced two columns on phones and clipped content. Page moved to `md:`; ADR-021 records the rule.
- DB integration tests (`packages/db/tests/integration.test.ts`): RLS on every public table, `member_fee_at()` vs core `feeState()` parity, the documented ADR-014 divergence, message-log idempotency (R15), one-OPEN-task index, money CHECK. They skip with an explicit message when TEST_DATABASE_URL is unset.
- Build-initial-migration script fixed for Node 22 on Windows (spawns Prisma's JS entry with `process.execPath`, Prisma 7 `--to-schema` flag; ignores `migration_lock.toml`).

Verified:
- `pnpm typecheck` 8/8, `pnpm lint` clean, `pnpm test:coverage` 441 passed / 6 skipped (DB tests), core coverage 99.38% lines, `pnpm build` 3/3 (proxy + icon), `pnpm install --frozen-lockfile` up to date.
- `next dev` against unreachable placeholder DB URLs: `/` 200 lang=en and `/hi` 200 lang=hi, each with the designed database-error panel; `/en` 307 to `/`; `/api/v1/health` 503 `db: down`; localized `<title>`/description; no connection strings or usernames in HTML, server log or browser console. Screenshots checked at 360px and 1440px in English and Hindi (Devanagari renders in Khand/Hind; nothing clipped).
- `next start` correctly refuses `DEMO_MODE=true` under NODE_ENV=production (guard working as designed).

Decisions:
- ADR-021 `sm` = 360px; multi-column layouts start at `md`.

Pending / next:
- Owner: create the Supabase project (Mumbai), paste DATABASE_URL (:6543) and DIRECT_URL (:5432) into `.env`; optional second project for TEST_DATABASE_URL.
- Then: `pnpm db:migrate`, `pnpm db:seed`, `pnpm dev` (web + worker), live Foundation page, health db + worker ok, run the integration tests against TEST_DATABASE_URL.
- Keyboard-focus check: the Foundation page has no focusable elements; focus rings on the UI primitives get checked when the first interactive screen uses them (Phase 2).
- Phase 2 note: `NextIntlClientProvider` sends the whole message catalogue to the client; scope messages per route before the landing-page JS budget (TRD §6) matters.

### 2026-09-11 — Phase 1 — Foundation (Supabase, no local Docker) — code complete, database steps pending
Done:
- Step 0: blueprint updated for this environment — `.env.example` (DIRECT_URL, SHADOW_DATABASE_URL, TEST_DATABASE_URL, ALLOW_DEMO_IN_PRODUCTION, WORKER_ID, WORKER_DB_POOL_MAX, SEED_TODAY), TRD §3.1/§3.2, database-design §10, security-plan §3.6, deployment-plan note, testing-strategy, api-specification health contract, folder-structure infra deferral, CLAUDE.md §3. ADR-010 to ADR-020 recorded.
- Step 1: pnpm 11 workspaces + Turborepo, version catalog in `pnpm-workspace.yaml`, strict `tsconfig.base.json`, ESLint 10 flat config enforcing the folder-structure dependency rules (specifier + resolved path), Prettier, Vitest projects, 7 workspaces.
- Step 2 `packages/shared`: Zod env (demo-in-production guard, never echoes values), IST time helpers with branded `ISTDate` and injectable Clock/FakeClock, phone, money (paise, Indian grouping), masking + pino redact paths, `GymSettings` with every ⚙ default, constants.
- Step 3 `packages/db`: schema copied; `prisma.config.ts` uses DIRECT_URL (session pooler) and optional shadow URL; runtime client over DATABASE_URL (transaction pooler) with `@prisma/adapter-pg`, pool 5, transaction helper; `PrismaMessageLogWriter` port implementation. Initial migration built offline: 26 tables, RLS enabled on all 26, constraints, partial unique index, `v_member_fee` (security_invoker) and date-pinned `member_fee_at()`, Supabase-role REVOKE guarded for plain Postgres.
- Step 4 `packages/core`: ports, DomainError, pricing, membership dates, fee state (ADR-013/014), reminder rules + send-time eligibility, call-task rules/outcomes, birthdays (29 Feb), attendance cooldown + gallery eligibility + kiosk greeting, receipt/member codes, HMAC signed links. Tests first, fake clock.
- Step 5 `packages/integrations`: WhatsApp simulator (logs via port, idempotent, allowlist-aware) with en/hi bodies for the four templates, simulated payments (deterministic failure amount), local storage driver (random keys, traversal-safe, signed URLs), typed stubs for Meta Cloud and Razorpay.
- Step 6 seed: deterministic builder (`seed/build.ts`) using the real core rules, chunked `createMany` writer with timings and a core-vs-SQL fee-state cross-check, idempotent wipe of the demo gym.
- Step 7 `apps/web`: next-intl (en/hi), Khand + Hind with Devanagari, tokens.css generated from design-tokens.json (79 tokens), Foundation check page, `/api/v1/health` (db + worker heartbeat, 503 when down), Button/Input/Label/Dialog+Sheet/Toast primitives, DI container.
- Step 8 `apps/worker`: pg-boss 12 on DIRECT_URL (pool 3), heartbeat upsert every 60 s, 9 schedules + 4 event queues registered as no-ops naming their phase, per-queue retention, graceful SIGTERM.
- Step 9: `.github/workflows/ci.yml` only (lint, typecheck, coverage, tokens drift, integration job on a Postgres 17 service container with an RLS-coverage assertion, build, audit). Dockerfiles/Caddy/VPS scripts deferred to Phase 8.

Verified (Windows, Node 22.18.0):
- `pnpm install --frozen-lockfile` up to date; `pnpm typecheck` 8/8; `pnpm lint` clean; `pnpm test` 19 files / 437 tests pass; `packages/core` coverage 99.38% lines, 97.01% branches, 100% functions (gate 80%); `pnpm build` 3/3.
- Worker without env exits 1 listing the missing keys, with no values or connection strings printed.
- Seed builder dry run (in memory, SEED_TODAY=2026-09-10): all schema invariants hold — 220 members (196 ACTIVE, 12 LEFT, 7 PENDING_VERIFICATION, 5 PENDING_PAYMENT); ACTIVE fee states PAID 143 / DUE_SOON 28 / EXPIRED 25; every scenario in its expected fee state; birthdays today 3, next 6 days 7; 50 open call tasks; 3,307 memberships and payments, 5,312 check-ins, 1,422 message-log rows.

Not yet verified (needs Supabase credentials in `.env`):
- `pnpm db:migrate` against Supabase, whether the role has CREATEDB for the shadow database, Postgres accepting the migration SQL, RLS state on the live tables.
- `pnpm db:seed` against Supabase, and the core-vs-SQL fee-state cross-check it prints.
- `pnpm dev`: Foundation check page with live data, `/api/v1/health` db + worker ok, pg-boss boot and schedule registration, heartbeat writes.
- Transaction-pooler behaviour with `@prisma/adapter-pg` (no `pgbouncer=true`), per ADR-010.
- CI on GitHub (never run); `storeDir: E:/.pnpm-store` on Linux runners (ADR-019).

Decisions (see decision-log):
- ADR-010 Supabase Postgres via Prisma, no local Docker (verified against Prisma and Supabase docs); ADR-011 RLS on every public table; ADR-012 TypeScript 6.0.3; ADR-013/014 fee state canonical in core, no extension across gaps; ADR-015 POST cap lives on ReminderRule; ADR-016 BR-2.3 per-month rounding; ADR-017 integrations write through ports; ADR-018 health reports worker heartbeat; ADR-019 ESLint 10 + import-x, project-local pnpm store, pnpm 11 `allowBuilds`; ADR-020 extensionless relative imports (Turbopack cannot map `.js` to `.ts`).
- Environment findings fixed along the way: cross-volume pnpm store; pnpm 11 ignores `onlyBuiltDependencies`; Zod 4 `.default()` no longer parses (use `.prefault()`); pg-boss 12 has a named export and per-queue retention; Prisma 7 `env()` throws on unset vars and `migrate diff` uses `--to-schema`; Node 22 refuses to spawn `.cmd` without a shell.

Pending / next:
- Create `.env` (Supabase DATABASE_URL :6543, DIRECT_URL :5432, optional TEST/SHADOW URLs, four secrets), then run `pnpm db:migrate`, `pnpm db:seed`, `pnpm dev`, and check the Foundation page and `/api/v1/health`.
- Integration tests under `packages/db/tests` (view-vs-core diff, message-log idempotency) once TEST_DATABASE_URL exists.
- Install Node 24 LTS locally to match `.nvmrc` and CI (Node 22.18 works today; engines warn).
- First commit of Phase 1 work, and a first CI run, when requested.

Blockers / questions for client:
- Seed spec §4 says current-month collections of roughly ₹1.2–1.6 lakh. The seed produces ₹73,100 from 41 payments month-to-date on 10 Sep (about ₹2.2 lakh a month at that pace). Confirm whether the target is month-to-date or a full month before tuning.
- Supabase dashboard actions (manual): remove `public` from Data API exposed schemas; 2FA for every org member; rotate the database password away from the project default.

### 2026-09-10 — Phase 0 — Blueprint package created
Done:
- Full documentation set, Prisma schema (validated), demo dataset, prompts.
Pending / next:
- Send client inputs sheet; start Meta verification and Razorpay KYC; run `docs/11-prompts/00-FIRST-PROMPT.md`.
