# Remediation register — 2026-10-16

Companion to `docs/07-security-compliance/security-and-ux-review-2026-10-16.md`, which is
the audit. This is what was done about it.

Branch: `hardening/security-ux-remediation`, thirteen commits, branched from `main` at
`82e44bf`. **Not pushed** — see REL-001.

## Gates

| Check | Baseline (this session, on `main`) | Now |
|---|---|---|
| `pnpm typecheck` | pass, 8/8 packages | pass, 8/8 |
| `pnpm lint` | **fail, 34 errors** | **pass, 0 errors** |
| `pnpm test` | **fail, 1 of 2132** | **pass, 2271 passed / 86 skipped** |
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
| DASH-001 | Dashboard attendance and operational summaries | **NOT STARTED** | The period helpers are now reusable for it. |

59 tests cover the date arithmetic alone, asserting the boundaries rather than the happy
path: "last month" from the 1st and from 31 March, "last week" from a Monday and a Sunday,
February in a leap year, 1 January.

### D. CRM routes and UI

| ID | Title | Status | Evidence |
|---|---|---|---|
| U-1 | Error, loading and not-found screens | **FIXED** | 8 new files. There was not one `error.tsx`, `not-found.tsx` or `loading.tsx` in the application. `global-error.tsx` and the root `not-found.tsx` carry their own `<html>`/`<body>`, because `app/layout.tsx` renders only `children`. No error screen reads the database. |
| U-3 | Members list caps at 100 with no paging | **NOT STARTED** | Still shows "100 of N" with no next page. |
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
| REL-001 | GitHub commit and push | **FIXED** (committed) / **BLOCKED** (push) | Thirteen commits on `hardening/security-ux-remediation`. No remote. |
| REL-002 | Docker service dependency map | **FIXED** (derived) / **BLOCKED** (verification) | Below. Derived from the Dockerfiles; **not verified against the running project**. |
| REL-003 | Coolify deployment per service | **BLOCKED** | No access. |
| REL-004 | Production smoke checks | **BLOCKED** | No access. |
| REL-005 | Rollback readiness | **FIXED** (documented) | Below. |

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

**New environment variables**, both optional with safe defaults — names only:

- `TRUSTED_PROXY_HOPS` — default `1`. **Set this deliberately.** Too low reads an address
  the client chose and SEC-002 is undone. 1 for Coolify's proxy alone; 2 with a CDN in front.
- `CSP_REPORT_ONLY` — unset means the CSP is **enforced**. Set to `true` to watch it first.

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
