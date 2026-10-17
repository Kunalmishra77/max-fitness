# Remediation register — 2026-10-16

Companion to `docs/07-security-compliance/security-and-ux-review-2026-10-16.md`, which is
the audit. This is what was done about it.

Branch: `hardening/security-ux-remediation`, fourteen commits, branched from `main` at
`82e44bf`. **Not pushed** — see REL-001.

## Gates

| Check | Baseline (this session, on `main`) | Now |
|---|---|---|
| `pnpm typecheck` | pass, 8/8 packages | pass, 8/8 |
| `pnpm lint` | **fail, 34 errors** | **pass, 0 errors** |
| `pnpm test` | **fail, 1 of 2132** | **pass, 2271 passed / 90 skipped** |
| `next build` | pass | pass |
| `gitleaks` (tree + 195 commits) | not run — no gate existed | **pass, no leaks** |
| `pnpm test:e2e` (incl. axe) | not runnable here | **not run — needs a database** |
| Integration (`|db|`) suites | not runnable here | **not run — needs a database** |

The baseline numbers were re-measured in this session; they are not quoted from the
earlier review.

## What could not be done, and why

| Blocked | Reason | Remedy |
|---|---|---|
| **Push to GitHub** (REL-001) | The clone in this container has **no git remote**, and `GH_TOKEN` is invalid. Attaching `Kunalmishra77/max-fitness` was refused: *"link your GitHub account to let Claude access repositories."* | The owner connects or reconnects GitHub at `https://claude.ai/connect-github` and installs the Claude GitHub App on the repository. Then the branch can be pushed as-is. |
| **Coolify deployment** (REL-002 … REL-005) | No Coolify URL, API token, or credentials are present in the environment, and there is no Coolify CLI. The repository contains no Compose file or Coolify definition to read the topology from — only three Dockerfiles. | The owner deploys, or supplies access. The service mapping below is derived from the Dockerfiles and is **unverified against the running project**. |
| **Integration and e2e tests** | No `.env`, and the only database in the documentation is production Supabase. Running the suite against it is exactly the mistake recorded in the progress log for 2026-10-16. | Run `pnpm db:migrate:test` and the suite against `mfp_test` on a machine that holds the credentials. |
| **Live header verification** | Needs an HTTPS request to the deployed origin. | `curl -sI https://<domain>` and check the list in SEC-001 below. |
| **Meta template approval** (MEM-001) | An external action in Meta Business Manager. | Submit `mf_signup_received` from `docs/04-content/whatsapp-template-submission.md` (now 22 templates). It will fail to send until approved. |

## Ticket register

Status vocabulary: NOT STARTED · IN PROGRESS · BLOCKED · FIXED (implemented) · VERIFIED
(acceptance checks pass) · DEPLOYED.

Nothing in this register is DEPLOYED, because no deployment happened.

Section E was added on 2026-10-17 after the owner reported the CRM as slow. Section F
the same day, once a local database and the production build made the blocked items runnable.

### A. Security

| ID | Title | Status | Evidence |
|---|---|---|---|
| SEC-001 | HTTP security headers | **VERIFIED** (locally) | `src/lib/security-headers.ts` + 27 tests. Three policies (public / crm / api). Verified against the built `routes-manifest.json`: `/`, `/crm`, `/checkin`, `/api/v1/health` each receive exactly **one** CSP. **Live delivery unverified.** |
| SEC-002 | Trusted-proxy client IP | **VERIFIED** | `clientIp()` counts from the right using `TRUSTED_PROXY_HOPS`. 20 tests, written from the attacker's side: a rotating spoofed header must land in one bucket. |
| SEC-003 | Lockout could be held open | **VERIFIED** | A served lockout now resets the attempt count. 4 new tests in `login.test.ts`. |
| SEC-004 | No per-IP limit on sign-in | **VERIFIED** | `crmLoginLimiters`, 20 per 15 min, checked before the PIN. New `RATE_LIMITED` outcome with its own copy in both languages. |
| SEC-005 | Kiosk pairing brute force | **VERIFIED** | Per-IP limit plus a deployment-wide ceiling on *failed* pairings. Turns a ~6%-per-window attack into centuries. |
| SEC-006 | API authorisation and tenant isolation | **VERIFIED by inspection, no change needed** | `assertCan` in all 18 actor-taking core services; `requireCrmContext()` in all 30 server actions; matrix centralised and tested. Re-checked this session. |
| SEC-007 | CI secret scan and static analysis | **FIXED** (secret scan VERIFIED) | gitleaks job + `.gitleaks.toml`; run locally first — tree clean, 195 commits clean — so it starts green. CodeQL added with `continue-on-error` because GHAS availability for this repo could not be determined; **it is not yet a gate** and says so in the file. |
| SEC-008 | Payment and webhook integrity | **VERIFIED by inspection, no change needed** | Raw-body HMAC before parsing, constant-time, unique-event replay protection, server-side pricing, amount mismatch held for review. Live Razorpay webhook config not inspectable from here. |
| SEC-009 | Private files, storage, signed links | **FIXED** | `nosniff` now reaches `/api/*` via SEC-001. `LocalStorageDriver` made uniform: `exists()` no longer swallows a traversal refusal and `signedUrl()` validates instead of signing a key it would refuse to read; it rejects rather than throwing synchronously. Upload pipeline re-verified unchanged. |
| SEC-010 | PII-safe logging | **VERIFIED by inspection, no change needed** | Every `console.*` call site read; none logs a number, name, token or image. |
| SEC-011 | `members/waiting` had no capability check | **VERIFIED** | `can(actor, 'member.view')` added, matching its sibling screens. |
| SEC-012 | Security regression tests | **VERIFIED** | Every fix above ships its own test. 70 new security-specific assertions. |
| SEC-013 | Nonce-based `strict-dynamic` CSP for the CRM | **NOT STARTED** | Deliberate. The CRM is already force-dynamic so it costs nothing, but an unverified enforcing policy on the owner's daily tool could white-screen it, and this environment cannot run the app. Do it with a browser open. |
| SEC-014 | `SESSION_SECRET` is required and unused | **IN PROGRESS** | Documented truthfully in `.env.example` rather than removed, so no deployment breaks. The decision — use it or drop it from the schema — is the owner's. |

### B. Member workflow

| ID | Title | Status | Evidence |
|---|---|---|---|
| MEM-001 | Signup-received WhatsApp message | **FIXED**, send **BLOCKED** on Meta | New `mf_signup_received` template, builder, outbox event and worker handler. Queued in the same transaction as the member; keyed on the verification request so a resubmission cannot send twice. Submission sheet regenerated to 22 templates. |
| MEM-002 | Approval message preserved | **VERIFIED** | `mf_verification_approved` untouched; its test still passes. The two are deliberately separate events — see the commit for why collapsing them would tell somebody they had joined before anybody checked their ID. |
| MEM-003 | Government ID errors mapped correctly | **VERIFIED** | **This was a live bug.** Per-step refusals rendered `stepCheck.<reason>`; only 3 of 17 such keys existed, so a refused ID showed `qrExisting.stepCheck.NAME_MISMATCH` on screen. `stepFailure` routes both paths through the tables that already held the wording. |
| MEM-004 | Every onboarding failure says what to do | **FIXED** | Same change: all 12 selfie reasons and all 5 card reasons now resolve, in both languages, asserted against the real message files. |
| MEM-005 | QR form navigation and state | **FIXED** | `useStepHistory`, 6 tests. The phone's Back button walks back a step instead of leaving the form and discarding the selfie and ID photographs. Persistence deliberately *not* added — see below. |
| MEM-006 | Duplicate submissions and retries | **VERIFIED by inspection** | Idempotency keys with unique DB constraints were already in place on registrations, payments and sends; the new signup message follows the same pattern. |

**MEM-005, the deliberate omission.** The obvious fix is to mirror `join-state.ts` and keep
progress in `sessionStorage`. That would be wrong here. The website sign-up runs on the
member's own phone and holds no identity documents; the QR form runs on the gym's phone at
the counter, passed from member to member, and holds a photograph of somebody's Aadhaar
card. A part-filled form reappearing for the next person in the queue is a worse failure
than retyping a name. So navigation — the common case, and the one that was destroying work
— is fixed, and a refresh still clears, by decision rather than by omission.

### C. Attendance and reporting

| ID | Title | Status | Evidence |
|---|---|---|---|
| ATT-001 | Monthly attendance calendar | **FIXED** | `monthCalendar` in core + `AttendanceCalendar`. Whole Monday-to-Sunday weeks, intensity relative to the busiest day in the month shown. |
| ATT-002 | Previous / next month navigation | **FIXED** | Links, not state. The next arrow is not drawn when that month has not happened. |
| ATT-003 | Week, month, year and custom filters | **FIXED** | 8 presets plus a custom GET form. "This week" and "this month" stop at **today**, so the future is not reported as an empty gym. |
| ATT-004 | Daily detail and counts | **FIXED** | Tapping a day lists its arrivals. A day with nobody is drawn differently from a day that has not happened. |
| ATT-005 | Attendance analytics | **FIXED** | Visits, distinct members, average per **elapsed** day, busiest day. The unique figure is its own query — summing each day's distinct members counts a regular five times over. |
| ATT-006 | Member-wise attendance history | **FIXED** (mostly pre-existing) | The profile already had a month strip and a full per-month history. Added the missing piece: first and last attendance dates, derived from days already counted, so zero extra queries. |
| ATT-007 | Secure CSV export | **FIXED** | Authorised in the route, not on the button. Carries who/when/how/code only — no numbers, email, photographs or documents. Every field through `csvField`, which neutralises a leading `=`, `+`, `-`, `@` or tab, with the apostrophe **inside** the quotes. 18 tests. |
| REP-001 | Report period filters | **VERIFIED** | Week, month, year and custom dates. `MONTH` delegates to the existing `monthBoundsFor` and a test asserts equality with it, so the month view the owner reads daily is byte-identical. Month arrows and `?month=` untouched; hidden off the month view, where they would have been a quiet lie. |
| REP-002 | Comparisons and aggregation | **VERIFIED** | Like-for-like extended from the month rule to every period, measured in **elapsed days** so 29 February has no counterpart to fail on. A finished period gets the whole previous one. 30 tests, mostly boundaries. **No card's arithmetic changed** — the pipeline already took a window plus the window before it. |
| REP-003 | Authorised report export | **VERIFIED** | Behind `money.view` checked in the route, not on the button. Same two resolution calls and same `inputs` as the page, so a download cannot describe a different period. Long format (`section,label,value`); rupee decimals for a human reader; renewal rate and kiosk share written **empty rather than zero** where they are genuinely unknown. |
| DASH-001 | Dashboard operational summaries | **FIXED** | `verificationsPending` was being queried on **every** dashboard load and rendered nowhere, so a QR sign-up waiting for approval was invisible on the first screen the owner opens while the member sat waiting. Now a "Waiting on you" strip above the tiles with that and the ADR-125 waiting-for-payment queue, shown only when there is something to do, and approvals only to an actor who could actually approve one. The rest of the wishlist (today's attendance, attendance trend, fees due, trials, alerts) was already there and is untouched. |

59 tests cover the date arithmetic alone, asserting the boundaries rather than the happy
path: "last month" from the 1st and from 31 March, "last week" from a Monday and a Sunday,
February in a leap year, 1 January.

### D. CRM routes and UI

| ID | Title | Status | Evidence |
|---|---|---|---|
| U-1 | Error, loading and not-found screens | **FIXED** | 8 new files. There was not one `error.tsx`, `not-found.tsx` or `loading.tsx` in the application. `global-error.tsx` and the root `not-found.tsx` carry their own `<html>`/`<body>`, because `app/layout.tsx` renders only `children`. No error screen reads the database. |
| U-3 | Members list caps at 100 with no paging | **FIXED** | Cursor paging keyed on **the member id**, not the name — names are not unique here (three members share one name, two share another), so a name cursor would skip or repeat a duplicate run at a page boundary, and an id keeps members' names out of URLs. Four integration tests, including one that pages two-at-a-time through a three-way duplicate and asserts every member appears exactly once. **Those run in CI, not here** — they need Postgres. |
| U-4 | Accessibility coverage on the CRM | **FIXED, NOT VERIFIED** | Axe added across 13 CRM screens at both 360px and 1440px. **The suite has not been run** — it needs a seeded database. It may find violations on its first run; that is what it is for. |
| U-5 | `postExpiryMaxDays = 7` | **NOT STARTED — owner's decision** | Seven consecutive daily "your membership has expired" messages. Lower it in Settings before the next run. |
| CRM-AUDIT | Audit-trail screen | **VERIFIED** | `/crm/more/audit`, owner-only behind a new `audit.view` capability with PIN elevation, and linked from the menu — it had been written to since the first migration with nothing linking to it. Read-only by construction: no action on the page, no write side in the repository. Cursor paging on `(createdAt, id)`, because an append-only table under offset paging is the one screen guaranteed to get slower every day. Before/after snapshots are never printed raw — `auditChanges` reduces them to the fields that moved, with a **name-based** denylist, 34 tests. |
| CRM-REDESIGN | Phase 7 visual redesign | **NOT STARTED** | Deliberately not begun. A redesign applied to some of 24 screens and not others leaves the product less coherent than before, and this session could not render a single page to judge the result. It needs a browser and the owner in the loop. |
| IMPORT-BOM | Import template could not be imported back | **VERIFIED** | Found while writing the CSV helpers. `/crm/import/template` wrote the four characters `FEFF` instead of `﻿`, so the first header read `FEFFfull_name` and the parser — which strips a BOM by code point — did not strip it. **The template the CRM handed the owner was unusable.** Now round-tripped in a test. |

### E. QA and release

| ID | Title | Status | Evidence |
|---|---|---|---|
| QA-001 | Baseline failures resolved | **VERIFIED** | lint 34 → 0, tests 1 failing → 0. 17 of the lint errors were the config describing the Playwright smoke scripts wrongly; two were in shipped code. The test failure was a **test defect**, not a vulnerability — and writing it properly exposed the real `exists()`/`signedUrl()` inconsistency in SEC-009. |
| QA-002 | Unit and integration tests | **FIXED** (unit) / **BLOCKED** (integration) | +70 unit tests. `|db|` suites need a database. |
| QA-003 | Critical end-to-end journeys | **BLOCKED** | Specs exist and typecheck; running them needs a database and a server. |
| QA-004 | Accessibility and localisation | **FIXED** (i18n) / **BLOCKED** (axe run) | i18n parity holds at every step: 1829 → 1884 keys, equal in both languages, enforced by `messages.test.ts`. |
| QA-005 | Production build and Docker validation | **FIXED** (build) / **NOT STARTED** (Docker) | `next build` clean. Docker images not built — no registry access and nothing to deploy them to. |
| REL-001 | GitHub commit and push | **FIXED** (committed) / **BLOCKED** (push) | Fourteen commits on `hardening/security-ux-remediation`. No remote. |
| REL-002 | Docker service dependency map | **FIXED** (derived) / **BLOCKED** (verification) | Below. Derived from the Dockerfiles; **not verified against the running project**. |
| REL-003 | Coolify deployment per service | **BLOCKED** | No access. |
| REL-004 | Production smoke checks | **BLOCKED** | No access. |
| REL-005 | Rollback readiness | **FIXED** (documented) | Below. |

### E. Performance (raised by the owner on 2026-10-17)

The client reported Max Register and the site as slow. These were found by reading the hot
path rather than by profiling, because this session has no database credentials and cannot
time a live request — so each entry says what was measured and what was only reasoned.

| ID | Title | Status | Evidence |
|---|---|---|---|
| PERF-001 | CRM request waterfall: six serial round trips before a screen's first query | **VERIFIED** (by construction) | `requireCrmContext()` loaded the gym itself *and* again inside `currentActor()`, and is called twice per screen — once in the `(app)` layout, once in the page. Both are now memoised with React `cache` (per-request, so a settings change still applies to the next request), and the gym and session rows are read together because `receptionMayTakePayments` was never part of the session query. **Six queries become two, in one wave.** Counted from the call graph; the saving in milliseconds depends on the round-trip time to Mumbai, which only the owner can measure. |
| PERF-002 | The dashboard's two unbounded reads | **VERIFIED** | It fetched *every confirmed membership the gym had ever sold* to price the due-this-week tile, and *every trial ever run* with a correlated sub-select to count three numbers, reducing both in JavaScript. Now one join on `latestMembershipId` and three `FILTER` clauses. Arrivals were a row per check-in to take a list length; now `COUNT(DISTINCT)`. Proven equivalent by `packages/db/tests/dashboard.integration.test.ts`, which was committed first and **passed against the previous implementation** in CI (`be202e2`) before the rewrite landed. |
| PERF-003 | Every member's fee state fetched three times per dashboard load | **FIXED** | Once for the tiles, once to annotate five call tasks, once more through a separate `memberCounts()` call that existed to read one number. That number now comes back with the tiles. `#feeStates` gained an optional member filter, used where the caller already knows the member — the member profile scanned the whole gym to read one row. Deliberately **not** used where fee states are fetched in parallel with the rows they annotate: narrowing those trades a cheap wider query for an extra round trip, which at this gym's size is the worse bargain. |
| PERF-004 | Connection-pool starvation serialising every fan-out screen | **FIXED** | `poolMax` was hard-coded to 5. The home screen issues ~20 reads in one `Promise.all`, so they ran in **four serial waves** — four round trips to Mumbai where one would do. Now `WEB_DB_POOL_MAX`, default 16. This adds no load; the same queries run either way. Transaction pooling on :6543 is what makes it safe (ADR-010). |
| PERF-005 | Client JavaScript | **VERIFIED — not a cause** | Measured from the build output: 2.7 MB of chunks uncompressed across *all* routes, largest 428 KB, and the large ones are React/`react-dom` framework code. No heavy library leaks into the CRM — the MediaPipe face detector is not in the shared chunks. Ruled out rather than fixed. |
| PERF-006 | Reports page reads every confirmed membership ever | **NOT STARTED** | Same pattern as PERF-002, in `reports-read.repository.ts`. Left alone on purpose: reports is opened occasionally, the dashboard on every login and again every minute, and this read feeds the money figures. It needs its own pinning tests before it is touched, which is not work to rush the day of a deployment. |
| PERF-007 | Where the application is hosted | **BLOCKED — owner** | The one thing that could outweigh all of the above. Every CRM screen is `force-dynamic` and reads Supabase in Mumbai (`ap-south-1`). If the Coolify host is not in the same region, each remaining round trip costs 150–250 ms instead of 5–20 ms, and no amount of query work recovers it. **Needs the owner to say which region the Coolify server is in.** |
| PERF-008 | The home screen refreshes itself every 60 s | **NOT STARTED** | `AutoRefresh seconds={60}` re-runs the heaviest read in the application on every open tab. It is already gated on tab visibility, and after PERF-002/003/004 the refresh is far cheaper, so this is left as it is pending a real measurement — but it is the first dial to turn if the owner's own tab feels slow while idle.

### F. Found and fixed by actually running it (2026-10-17)

A local PostgreSQL 16 cluster and the production standalone build turned out to be available
in this session after all. That unblocked everything the earlier rounds had marked BLOCKED
for want of a database or a browser — and the first ten minutes of running the thing found a
defect worse than anything in the review.

| ID | Title | Status | Evidence |
|---|---|---|---|
| WEB-001 | **The entire English website answered "307 → itself"** | **VERIFIED (fixed)** | Every English URL — `/`, `/contact`, `/qr`, `/qr/new`, `/legal/*` — redirected to itself, so a browser shows `ERR_TOO_MANY_REDIRECTS`. Hindi and the CRM were fine. Traced with a probe inside the proxy: the standalone server feeds a `proxy` rewrite back through `proxy`, so `/` rewrote to `/en`, the re-entered `/en` was redirected back to `/` (an explicit default-locale prefix is not canonical under `as-needed`), and that redirect became the answer to `/`. **Invisible in `next dev`, and invisible on Vercel, which does not use the standalone output** — it broke only in the image that serves the site. Fixed by letting a request through once next-intl has resolved its locale; 18 tests pin both the guard and the `/en` → `/` redirect it must not eat. Verified against a rebuilt image-identical runtime on every public route. |
| A11Y-001 | CRM contrast and chart labelling | **VERIFIED (fixed)** | The suite had never run. Nine of thirteen screens failed. Fee chips measured 3.86 / 3.31 / 2.84:1 on their own tints against AA's 4.5 — the amber one is how reception sees who owes money. Colours darkened by the smallest hue-preserving amount that clears it; `opacity-70`/`-80` removed from text on those tints (185 failing nodes on the members screen alone); the calendar's 1.65:1 inactive dates fixed; `role="img"` added to chart segments whose `aria-label` was being discarded. **38/38 axe assertions now pass** — 13 CRM screens and 5 public pages, at 360px and 1440px. |
| SEC-001 | HTTP security headers — **live delivery** | **VERIFIED** | Previously "verified locally, live delivery unverified". Now checked against a running production build: exactly **one** CSP per area, the right one for `/`, `/crm/login`, `/checkin` and `/api/v1/health/live`; `nosniff`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy` and HSTS on all of them; `Cache-Control: no-store` on the CRM; no `x-powered-by`. The negative-lookahead source works in a real server, so no path gets two policies. |
| SEC-004 | Login limiter locked out the gym, not the attacker | **VERIFIED (fixed)** | The per-address limit counted *successful* logins, because the check must run before the PIN is judged. The gym's staff and kiosk share one connection, so twenty sign-ins a quarter hour was the whole building's allowance. A success is now refunded; the limit counts failures. ADR-131. Six tests. |
| QA-002 | Integration tests | **VERIFIED** | **119 integration tests pass** against a real database locally, and in CI against Postgres 17. Previously BLOCKED. |
| QA-004 | Accessibility | **VERIFIED** | Above. Previously BLOCKED for want of a browser. |
| QA-006 | The accessibility suite could never have passed | **VERIFIED (fixed)** | Two faults in the suite itself, both of which would have failed CI on merge. The login limiter above, and `waitForHydration` — it waits for a hydrated `<input>`, and seven of these screens have no text field, so each burned a thirty-second timeout before axe ran. The suite took 8 minutes to report nothing; it now finishes in 46 seconds. |
| PERF-002 | Dashboard reads — **measured** | **VERIFIED** | No longer "reasoned". Against the seeded register (220 members, 3,299 memberships, 5,308 check-ins), 20 runs each: **median 17.1 ms → 9.6 ms**, mean 16.8 → 9.7. And every number it returns is byte-identical between the two implementations — active members, arrivals, fees due, the expected-fee total, both months' takings. That is at **zero** network latency; the saving grows with the round trip. |
| OPS-001 | `DEMO_MODE` defaults to **true**, and production refuses it | **FOUND — owner must set it** | `DEMO_MODE: bool(true)` in the env schema, and a guard refuses `DEMO_MODE=true` when `NODE_ENV=production` unless `ALLOW_DEMO_IN_PRODUCTION=true`. The image sets `NODE_ENV=production`. So a deployment that does not set `DEMO_MODE=false` explicitly **fails env validation and 500s every page**. The guard is right; this is a note for the deploy checklist. If the live site is up today, it is already set. |
| PERF-007 | Hosting: Coolify in Lithuania, Supabase in Mumbai | **OPEN — the biggest remaining item** | Confirmed by the owner. The database is ~6,500 km from the application, and the gym's own staff are in Ghaziabad, so a tap travels India → Lithuania → Mumbai → Lithuania → India. No query work recovers that. See the progress log for what it costs and the options. |

## Service mapping (REL-002) — derived, not verified

Three Dockerfiles exist: `Dockerfile.web`, `Dockerfile.worker`, `Dockerfile.face`. There is
no Compose file and no Coolify definition in the repository, so the real service names must
be read off the Coolify project.

| Changed | Service | Why | Redeploy |
|---|---|---|---|
| `apps/web/**` — headers, error screens, attendance calendar and export, QR forms, login | **web** | Directly its own source. | **Yes** |
| `packages/core/**` — attendance history, CSV helpers, login lockout, outbox event type, signup message builder | **web** *and* **worker** | Both `transpilePackages` it from source. The worker gains the `whatsapp.signup_received` handler, so a web-only deploy would queue events nothing dispatches. | **Yes, both** |
| `packages/db/**` — new attendance queries, outbox enqueue, first/last dates | **web** *and* **worker** | Shared Prisma layer. | **Yes, both** |
| `packages/integrations/**` — new WhatsApp template, storage driver | **web** *and* **worker** | The worker is what sends. | **Yes, both** |
| `packages/shared/**` — `TRUSTED_PROXY_HOPS` in the env schema | **web** *and* **worker** | Env validation runs at boot in both. | **Yes, both** |
| `apps/face/**` | **face** | **Untouched.** No Python file changed. | **No** |
| `.github/workflows`, `.gitleaks.toml`, docs | none | Not in any image. | **No** |

**Deploy the worker and the web app together.** The ordering that matters: MEM-001 queues
`whatsapp.signup_received` from the web app and the worker holds the only handler for it.
Deploying web first queues events nothing dispatches, so the acknowledgement is silently
not sent — recoverable (the rows wait) but confusing. Worker first is the safe order.

**No migration.** Nothing in these nine commits changes the schema. `VERIFICATION` already
existed as a `MessagePurpose`, and both attendance indexes already existed. The only
outstanding migration is the pre-existing one from the review: production still needs
`pnpm db:deploy` for `20261016120000_rls_on_later_tables`.

**New environment variables**, all optional with safe defaults — names only:

- `TRUSTED_PROXY_HOPS` — default `1`. **Set this deliberately.** Too low reads an address
  the client chose and SEC-002 is undone. 1 for Coolify's proxy alone; 2 with a CDN in front.
- `CSP_REPORT_ONLY` — unset means the CSP is **enforced**. Set to `true` to watch it first.
- `WEB_DB_POOL_MAX` — default `16` (PERF-004). Connections **per web container** on the
  transaction pooler. Leave it alone unless the container count changes; if several web
  containers are run, keep `containers × WEB_DB_POOL_MAX` inside the pooler's client limit.

**Rollback (REL-005).** Every change is additive and schema-free, so rolling back is
redeploying the previous image, with two caveats worth knowing in advance: a rolled-back web
app stops setting the security headers, and a rolled-back worker leaves any queued
`whatsapp.signup_received` rows undispatched until it returns (they are keyed, so nothing
double-sends). If only the CSP misbehaves, set `CSP_REPORT_ONLY=true` and redeploy rather
than reverting the branch.

## Recommended first steps for the owner

1. Connect GitHub, then push the branch and let CI run — that is the first independent check
   of everything above.
2. Deploy **worker then web**, with `CSP_REPORT_ONLY=true` and `TRUSTED_PROXY_HOPS` set
   correctly for the topology.
3. Verify the headers on the live origin, then clear `CSP_REPORT_ONLY`.
4. Run `pnpm db:deploy` on production for the RLS migration.
5. Submit `mf_signup_received` to Meta.
6. Run the e2e and axe suites somewhere with a test database, and expect the CRM axe pass to
   find real violations.
7. Lower `postExpiryMaxDays`.

## Appendix — the end-to-end suite, run for the first time (2026-10-17)

33 of 37 pass at 360px against a seeded database. The four that do not, and what each is:

| Spec | Why it fails | Mine? |
|---|---|---|
| `crm.spec.ts` — "searches members and opens a profile" | **Fixed.** `a[href^="/crm/members/"]` took the *waiting-for-payment banner*, which sits above the register and links to `/crm/members/waiting`. That path matches `[\w-]+`, so the URL assertion passed; the waiting screen has its own "फीस लें" link, so that passed too; and the test spent 45 seconds looking for a fee state on a screen that has none. It was auditing the wrong page and only the last assertion noticed. The banner (ADR-125) arrived after the test was written. Now scoped to a list row and asserted against the href it clicked — 47s → 1.4s, passing at both widths. | No — pre-existing |
| `signup.spec.ts` × 3 | `test.use({ launchOptions: { args: [fake camera] } })` replaces the whole `launchOptions` object, including the `executablePath` this container needs, so Playwright looks for a `chrome-headless-shell` build that is not installed here. An artefact of **this** machine; CI installs the matching browsers. | No — environment |
| `qr.spec.ts` — existing member by QR | **A stale test, and worth someone's attention.** It is written for the one-page form of ADR-075 — it fills name, mobile, date of birth and nine more fields in one go, and asserts no "Question _n_ of _m_" text. The form is a **nine-step wizard**: ADR-080 reverted the one-page design after the gym watched members struggle with it on a phone. The test's guard never caught the change, because the stepper reads "1 / 9" and not "Question 1 of 9". It has been failing since ADR-080 and is nothing to do with this branch. | No — pre-existing |

**`qr.spec.ts` was then rewritten**, once the nine steps' real field order was read out of
`STEP_KEYS` rather than guessed: name and number, date of birth and gender, the selfie, the
plan and the paid-until date, how they pay, when they train, the ID photographs, the optional
step, consent. Four things had drifted, not one:

- Two whole steps had been added since — how the member pays (ADR-105) and when they train.
- Three labels had changed: `3 months` → `3 Months`, `Which ID are you showing?` →
  `Upload a Govt ID`, `Photo of the front` → `Front of the card`.
- The approve button on the verification queue had lost its tick: `✓ सही है` → `सही है`.
- The last assertion opened the register and looked for the new member by name. The list is
  alphabetical and cut to a page, so somebody called "Qr …" is not on it once the gym has two
  hundred members — it passed against an empty database and could not against a real one. It
  searches now.

Advancing a step waits for the **counter**, not for the next field, because a step is checked
against the server before it will advance. And the date-of-birth check can return a *soft*
warning — a date somebody else already has is common enough that the member is asked to
confirm rather than refused — so the helper races the counter against that confirm button
instead of testing for it immediately, which is what made the first rewrite flaky.

**3.9 seconds, passing. It had been failing for three minutes.**

Final state at 360px: **34 passed, 3 failed**, the three being the `signup.spec.ts` browser
mismatch above, which is this container and not the code. The suite went from 4.9 minutes of
mostly-timeouts to 1.0 minute.

**`web-e2e` is not a merge gate** — it is `if: github.event_name == 'push' && github.ref ==
'refs/heads/main'` — so none of this blocks the merge, and the three environment failures
will not reproduce in CI. The QR one will.
