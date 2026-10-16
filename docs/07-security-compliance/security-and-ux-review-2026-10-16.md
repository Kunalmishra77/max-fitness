# Security and UI/UX review — 2026-10-16

Reviewer: AI agent session. Scope: every page and API route in `apps/web`, the core
permission and token logic in `packages/core`, storage and WhatsApp adapters in
`packages/integrations`, migrations in `packages/db`, CI, and the Dockerfiles.

This closes the "security review" that has been the oldest outstanding item in the
progress log. It is a code review, not a penetration test.

**What I could not do.** There is no `.env` in this environment and the database is
production Supabase, so I did not run the app, render any page, or test anything against
a live host. Everything below is read from the source, except `pnpm typecheck`,
`pnpm lint` and `pnpm test`, which I ran. Two items (HSTS, and whether the edge strips
`X-Forwarded-For`) depend on the deployed proxy and must be verified against the live
host — they are marked as such.

**State of the checks, as of this review:**

| Check | Result |
|---|---|
| `pnpm typecheck` | **pass** — 8/8 packages |
| `pnpm lint` | **fail** — 34 errors |
| `pnpm test` | **fail** — 1 failed, 2045 passed, 86 skipped (2132) |

---

## 1. Security findings

### HIGH

#### S-1. No security headers are set anywhere

`apps/web/next.config.ts` has a `headers()` function, and all it returns is a one-year
cache for `/fonts/:path*`. There is no `Content-Security-Policy`, no
`Strict-Transport-Security`, no `X-Content-Type-Options`, no global `Referrer-Policy`, no
`Permissions-Policy`, and no `frame-ancestors`. A repo-wide grep finds `Referrer-Policy`
on exactly three routes and nothing else.

security-plan.md §3.1 specifies all of them. `docs/09-operations/deployment-plan.md` line 53
says, in parentheses, *"CSP is set by Next.js per route so Razorpay/maps allowances can
differ by page."* It is not set by Next.js on any route. The pre-launch checklist item
"CSP enforced (not report-only) and tested with Razorpay checkout and maps" is unchecked,
and the gym went live earlier today.

Why it matters here specifically: this origin serves member selfies and raw member ID
PDFs inline (`/api/v1/files`, `Content-Disposition: inline`), and the sign-up
`registrationToken` is held in `sessionStorage`. CSP is the layer that limits what a
single injection could reach. The upload pipeline (S-OK-4) is genuinely strong, so there
is no known injection today — this is the missing defence-in-depth, not an active hole.

When adding a CSP, note two existing inline scripts that will need a nonce or hash:
`components/marketing/preloader.tsx` and the JSON-LD blocks in
`(marketing)/page.tsx` and `faq-section.tsx`.

The deployment plan's Caddy block does carry HSTS, but there is no Caddy config in this
repo and `coolify-setup.md` describes the actual deployment. **Verify HSTS against the
live host** — Coolify's proxy may or may not add it.

#### S-2. Every IP rate limit can be bypassed with a spoofed header

`apps/web/src/lib/rate-limit.ts`:

```ts
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  if (first !== undefined && first !== '') return first;
  ...
}
```

The left-most `X-Forwarded-For` entry is taken with no validation and no trusted-hop
count. A reverse proxy *appends* to this header, so a request carrying
`X-Forwarded-For: 203.0.113.9` arrives as `203.0.113.9, <real client>` and the left-most
entry — the one used as the bucket key — is whatever the client chose. Rotating that value
gives an attacker a fresh bucket on every request.

That defeats the IP half of every limiter in the file: `/leads` (10/h), `/otp/send`
(10/h), `/registrations` (10/h), `/checkout/*`, `/selfie/check`, and `/qr/check` — which
is the only guard on the enumeration oracle in S-5.

Not total: the per-mobile limiters key on the normalised number, and the OTP limits that
matter (3 per 15 min per mobile, 5 guesses per code) are counted in the database. So the
realistic impact is spam, enumeration and third-party cost (`/otp/send` and
`/selfie/check` both call paid or CPU-bound services), not account takeover.

Fix: count hops from the right-hand side of `X-Forwarded-For` using the known number of
proxies in front of the app, or read the connection IP the platform exposes. The same
raw left-most read is used for the login audit `ipHash` in `lib/crm.ts:103`; that one only
poisons an audit field, but it should move to the same helper.

### MEDIUM

#### S-3. Kiosk pairing has no rate limit and no attempt counter

`POST /api/v1/kiosk/pair` is the one kiosk endpoint without a bearer token, by design. It
is also the only public POST in the app with no limiter at all, and
`packages/core/src/kiosk/pairing.ts` has no failed-attempt counter — a wrong code simply
returns `INVALID_CODE` and the code stays live for the rest of its ten minutes.

The code is six digits (`issuePairingCode`) and is looked up by peppered hash across
devices. At a modest 100 requests/second an attacker gets ~60,000 guesses inside one
10-minute window — roughly a 6% chance per window, compounding across windows, and the
owner opens a window every time they set up a phone. A paired rogue device can read member
names and signed photo URLs through `/api/v1/checkin/lookup` and write attendance events.

The route's own doc comment reasons carefully about not distinguishing "wrong code" from
"expired" — the brute-force rate was the part left out. Fix: an IP limiter plus a
per-device attempt counter that burns the code after a handful of failures. Cheap, and it
makes the existing design hold.

#### S-4. CRM sign-in has no IP rate limit

security-plan.md §3.1 specifies "Argon2id + lockout + rate limit" for CRM authentication.
The Argon2id hashing and the lockout are both there and correct
(`packages/core/src/crm/login.ts`: 5 attempts, 15-minute lockout, counted against the
account rather than the identifier typed, same error for unknown user and wrong PIN). The
IP rate limit is not.

Two consequences. The lockout bounds guessing at ~480 attempts/day against a 4–6 digit
PIN, which is slow but not nothing for a 4-digit PIN. More practically, it is a cheap
denial of service in the other direction: anyone who knows the owner's mobile number or
`admin@` address can send five wrong PINs every fifteen minutes and keep them out of their
own CRM indefinitely. Fix: an IP limiter on the sign-in server action.

#### S-5. `/api/v1/qr/check` confirms whether a number belongs to a member

The route's doc comment states the rule it is meant to follow:

> **It says as little as it can.** A number or a date that belongs to somebody is
> answered with *that it does*, never with whose — that would turn the form into a way
> of asking "is this person a member here".

Answering *that it does* is the enumeration. `step=mobile` returns `MOBILE_IN_USE` for any
number in the register, from an unauthenticated endpoint, before any OTP; `step=dob`
likewise confirms a date of birth exists. Withholding the name limits the damage but does
not change what the endpoint answers, and its only guard is the IP limiter defeated by
S-2.

Under DPDP this is a disclosure about identifiable people (gym membership, inferable
health interest) to an anonymous caller. Options: move the mobile check behind the
OTP-proven step, or accept it as the cost of the eight-screen form and record the decision
in `decision-log.md` with the limiter hardened per S-2. The current state is neither.

#### S-6. The CI quality gate is red, so it is not gating

Run locally in this session:

- `pnpm lint` — **34 errors**. Mostly scripts and test files (`smoke-crm.mjs`,
  `smoke-public.mjs`, `audit-members.ts`, `backup-members.ts`, `enrol-faces.ts`,
  `qr-poster.ts`, `seo.test.ts`, `messages.test.ts`), but two are in shipped runtime
  code: `apps/web/src/components/checkin/use-screen-awake.ts:45` (a forbidden non-null
  assertion, flagged twice) and
  `packages/db/src/repositories/message-log-read.repository.ts:138`. Both are type-assertion
  nits, not defects.
- `pnpm test` — **1 failed**, 2045 passed, 86 skipped. See S-10; the failure is a test
  defect, not a vulnerability.

`.github/workflows/ci.yml` runs both in the "Lint, typecheck, unit tests" job, so that job
fails on every push to `main`. A gate that is already red cannot report a regression. The
progress log recorded the lint errors as pre-existing and not touched; with the gym now
live, that should be closed out rather than carried.

(`pnpm typecheck` passes cleanly across all 8 packages.)

#### S-7. Two required CI security gates are missing

security-plan.md §4 requires CodeQL on every PR; §6 requires a gitleaks run before launch.
Neither appears in `.github/workflows/ci.yml`. The dependency audit *is* there and
correctly configured (`pnpm audit --audit-level critical`, with a comment explaining why
lower severities do not block).

I did the secret scan by hand as part of this review: no provider-format secrets
(`rzp_live_*`, Meta `EAA*`, `sk-ant-*`, `AKIA*`) in the working tree or anywhere in git
history, and no `.env` committed. `.env.example` carries only placeholders. That is a
clean result today, not a substitute for the gate.

Separately, the progress log notes the owner's Meta App Secret and the Razorpay secret
were pasted into a chat and need rotating. That is still outstanding and is not something
this review can verify.

### LOW / INFORMATIONAL

#### S-8. `SESSION_SECRET` is required and unused

`packages/shared/src/env.ts:89` requires `SESSION_SECRET` at ≥32 characters, and nothing
in the codebase reads it — only the env schema, its test, and three CI job definitions.
The CRM session is a 256-bit random token stored as a SHA-256 hash; nothing is signed with
a secret. `.env.example` describes it as "CRM session cookie signing", which is misleading:
an operator rotating it on staff departure would believe they had invalidated sessions, and
they would not have. Either use it or remove it and update `.env.example`.

#### S-9. `/api/v1/files` and `/api/v1/gallery/[id]` omit `nosniff`

`/api/v1/files` sets `Content-Type` from the stored `mediaFile.mimeType` with
`Content-Disposition: inline`. Not currently exploitable — every write path sets the MIME
type server-side to a literal `'image/jpeg'` or `'application/pdf'`, never from the upload
— but this route is the one that serves raw, un-re-encoded member ID PDFs (a PDF cannot be
re-encoded through sharp the way images are), and `X-Content-Type-Options: nosniff` is one
line. Add it to both routes.

#### S-10. The failing storage test is a test defect, not a vulnerability

`packages/integrations/src/storage/local.test.ts:68` expects
`driver.delete('..\\..\\windows\\system32\\config')` to reject. It resolves on this machine.

The guard is correct. `LocalStorageDriver.#pathFor` resolves the joined path and refuses
anything not under the root, using the platform `sep`. On Linux and macOS a backslash is a
legal filename character, so `..\..\windows\system32\config` is a *single* path segment
inside the root — no traversal occurs, and `rm(..., { force: true })` resolving is the right
answer. The assertion only holds on Windows. The POSIX traversal case on the line above
(`../../../etc/passwd`) passes. Fix the test, not the driver. Note also that production uses
the S3/Supabase driver, so this path is development-only either way.

#### S-11. `members/waiting` is the one member list with no capability check

Every other CRM page that lists or shows members calls `can(actor, 'member.view', now)`
and renders a refusal in place (`members/page.tsx`, `members/[id]/page.tsx`,
`messages/page.tsx`, `verify/page.tsx`, and so on).
`app/crm/(app)/members/waiting/page.tsx` calls `requireCrmContext()` and goes straight to
rendering full names and unmasked mobile numbers.

No impact today: all four roles hold `member.view`, so the check would pass anyway. It
matters as a pattern — security-plan.md §3.1 says "deny by default", and if `member.view`
were ever narrowed, this is the page that would quietly keep showing.

#### S-12. Minor notes

- `issuePairingCode` uses `random(4).readUInt32BE(0) % 1_000_000`, which biases codes
  below 967296 by about 0.02%. Negligible, mentioned only because the surrounding comment
  reasons deliberately about the code range.
- `/api/v1/health` is unauthenticated and reports database and worker reachability. It is
  careful never to surface a driver message or an env value, which is the part that
  matters.
- The in-memory limiter is correct for one instance and says so in its own comment. If
  the web tier is ever scaled to two replicas, IP limits silently double. Worth a note in
  the runbook next to any scaling instruction.

### Verified sound

This is most of the surface, and it is good work. Recording it so a future reader knows it
was checked rather than skipped.

- **Session handling.** Cookie is `HttpOnly; SameSite=Lax`, `Secure` in production; token
  is 32 random bytes handed over once and stored only as SHA-256; 12-hour idle, 30-day
  trusted; revocation on logout, on PIN change (all other devices), and on staff
  deactivation — the last two covered by e2e tests.
- **Authorisation.** `assertCan` is called in every core service that takes an actor (18
  files; I diffed actor-taking modules against `assertCan` callers, and the only three
  without it are `elevate`, `own-pin` and webhook `unsubscribe`, none of which should have
  one). All 30 server actions in `app/crm/actions.ts` begin with `requireCrmContext()`.
  The matrix is centralised in `permissions.ts` with its own test file, and five sensitive
  capabilities require a PIN entered within 5 minutes.
- **Webhooks.** Both Razorpay and Meta read the raw body and verify the HMAC before
  parsing anything, compare in constant time, and store one row per event under a unique
  `(provider, externalId)` index so a redelivery cannot act twice. The Razorpay webhook
  returns 404 in `DEMO_MODE` so the simulator's fixed marker cannot confirm a payment.
- **Signed links.** HMAC over `version|purpose|subject|exp|nonce`; purpose-bound;
  signature checked before expiry so a forgery and an expiry are indistinguishable;
  comparison is length-blind constant-time; secret floor of 32 characters; `verifyToken`
  returns a result rather than throwing. The test file covers forgery, subject swapping,
  expiry extension, purpose confusion and malformed input.
- **Uploads.** Declared content type ignored; magic-byte sniffing; 40M-pixel
  decompression-bomb limit; re-encoded from raw pixels through sharp, which drops EXIF
  (phone photos carry home locations) and anything a polyglot appended; random object
  keys; MIME type chosen by the server; nothing served from the storage path.
- **Payments.** Priced server-side from the plan row and gym settings — the client sends a
  plan id and a date, never an amount. An amount mismatch is held for review instead of
  activating a membership. An autopay token is explicitly refused at checkout.
- **RLS.** Now complete: I diffed every `CREATE TABLE` against every
  `ALTER TABLE … ENABLE ROW LEVEL SECURITY` across the migration history and got 36/36,
  with no gaps either way. The `20261016120000_rls_on_later_tables` migration closed the
  nine that were previously only fixed by hand on production. There is also a `check:rls`
  script and a CI step that enforces it. **Still pending: `pnpm db:deploy` on production
  so the migration is recorded there.**
- **Logging.** I read every `console.*` call site in `apps/web`, `packages/*` and
  `apps/worker`. Not one logs a mobile number, email, name, token, PIN or image — they log
  an error class name and a request id. This is unusually disciplined and matches
  CLAUDE.md §2.8 exactly.
- **Service worker.** Caches the versioned shell and one offline page only. Never
  intercepts `/api/`, never caches a CRM page, refuses any non-GET.
- **Analytics.** No script loads before explicit consent; declining is given equal visual
  weight to accepting; GA4 gets `anonymize_ip`.
- **Output encoding.** The legal-page parser renders React elements, never HTML, with an
  href allowlist, so a stray `<script>` in a policy draft shows as text. All three
  `dangerouslySetInnerHTML` uses are safe — one static string and two JSON-LD blocks
  through `jsonLd()`, which escapes `<`.
- **Containers.** Both `Dockerfile.web` and `Dockerfile.face` drop to a non-root user; no
  secrets baked in.
- **Face service.** Bearer-token authorised on both endpoints, and it refuses to start
  rather than run open if the token is unset.

---

## 2. UI/UX findings

### HIGH

#### U-1. The app has no error, loading or not-found pages at all

There is not one `error.tsx`, `loading.tsx`, `not-found.tsx` or `global-error.tsx` in
`apps/web/src/app`. The only Suspense boundary in the codebase wraps the CRM sidebar.

Two user-visible consequences:

**Thrown errors.** Any server component that throws lands the user on Next's built-in
error page — unstyled, English, "Application error: a server-side exception has occurred".
This is not hypothetical: `currentActor()` already wraps its session lookup in
`withOneRetry` *because* a passing Supabase hiccup is expected ("otherwise a passing
database hiccup signs staff out in the middle of their work"). The retry handles that one
read. Every other read on every other page has no such net. The result, for a Hindi-first
tool at a reception desk with a member waiting, is an English stack-trace page and no way
forward.

**`notFound()`.** It is called in seven places — member, member edit, member renew, legal
slug, QR reference, locale validation, foundation page — and all seven land on Next's
default 404, again unstyled and English, including on the brand-forward public site that
the DESIGN-BLUEPRINT is otherwise followed so closely for.

This contradicts the definition of done ("loading, empty and error states designed") and
CLAUDE.md §2.9 ("No hard-coded UI strings"), and it is the single largest gap I found on
the UX side.

Fix: a `not-found.tsx` and `error.tsx` for each of the three sections (`[locale]`, `crm`,
`checkin`) with their own i18n copy, plus a `global-error.tsx`. One thing to watch while
doing it: the root `app/layout.tsx` deliberately renders `children` alone with no
`<html>`/`<body>` — each section supplies its own — so each new boundary needs to carry its
own document shell, and the result should be checked in a browser rather than assumed.

### MEDIUM

#### U-2. Both QR forms discard everything on a back gesture or a refresh

`qr-existing-form.tsx` (8 steps) and `qr-new-form.tsx` (12 steps) hold the current step in
plain `useState(0)`. No history entry per step, nothing in `sessionStorage`.

So on Android — where the back gesture *is* how people navigate — a member on step 5 who
swipes back leaves the form and loses all five steps, including the selfie and the
photographs of their ID card they just took. Same for a refresh, a locked screen that
drops the tab, or a mis-tap. There is an in-page Back button
(`qr-existing-form.tsx:726`), but it does not help someone who used the phone's own.

The website sign-up gets this right: `join-state.ts` keeps progress in `sessionStorage`
under `mfp_join`, validated field by field on read, deliberately not `localStorage` "on a
shared phone". The QR flow — the gym's primary on-site onboarding path, filled in at the
desk with a queue behind — does not. Fix: reuse the `join-state.ts` pattern and push a
history entry per step.

#### U-3. The members list caps at 100 with no way to page

`members/page.tsx` sets `LIMIT = 100` and shows "showing 100 of N" when truncated. There
is no next page and no cursor. Past about 100 members the owner can only reach the rest by
searching or by using a fee filter.

Capping the query is right and every read in `crm-read.repository.ts` is bounded, which is
good discipline. The missing half is the paging control. The same applies to the inbox
(`conversations` caps at 50) and the thread (200 messages, already noted as a known limit
in the progress log). The members list is the one that will be felt first.

#### U-4. No automated accessibility coverage on the CRM

Axe runs on two pages: the landing page and the join modal. The CRM is 24 pages, is the
owner's daily tool, and is Hindi-first — and has no axe assertion anywhere.
`playwright.config.ts` already defines both a 360×780 mobile project and a 1440×900
desktop one, and `crm.spec.ts` already signs in and walks real journeys, so adding an axe
pass to the screens it already visits is a small change. The progress log's open item
"CRM screenshots for the UI pass" is the same gap seen from a different angle.

#### U-5. Seven consecutive expiry messages is a UX decision worth revisiting now

Restating what the last progress-log entry raised, because it is live and about to fire:
`postExpiryMaxDays = 7` means an expired member receives a daily "your membership has
expired" message every day from +1 to +7. Three members are in that window. On a WhatsApp
number a few days old, that is both a poor experience and the mechanism by which a quality
rating falls and templates get paused. It is the documented rule (BR-5.2) and the owner can
change it in Settings — recommend lowering it to one or two before the next run.

### Verified sound

- **i18n.** 1829 keys in `en.json` and 1829 in `hi.json`, exact parity in both directions,
  held down by `messages.test.ts`. No orphans either way.
- **Empty states.** 36 dedicated keys. I checked every list screen in the CRM and each one
  has an empty state — members, waiting, leads, calls, attendance, verify, diet, gallery,
  announcements, kiosk devices, messages, the bot log, and every report panel.
- **Touch targets.** 95 uses of `min-h-14` / `min-h-[56px]` across CRM and QR components,
  meeting the ≥56px rule. The `crm-pointer` body class in `globals.css` then relaxes them
  to 40–48px when the CRM is driven with a mouse — the right call, and a detail most
  projects miss.
- **Focus.** A global `:focus-visible { outline: 3px solid …; outline-offset: 2px }`, with
  the comment citing WCAG 2.2 AA.
- **360px.** A 360×780 Playwright project runs in CI. No fixed width above 360px anywhere
  in the codebase. Exactly one `overflow-x-auto`, in the report charts, deliberately.
- **Dialogs.** Built on Radix, so focus trapping, focus restore, Escape, scroll locking
  and `aria-modal` all come from the primitive rather than from hand-rolled code. The
  bottom sheet respects `env(safe-area-inset-bottom)`.
- **Announcements.** 32 components carry `role="status"`, `role="alert"` or `aria-live`,
  so results of actions are announced rather than only shown.
- **Other.** A skip-to-content link; `maximumScale: 5` rather than zoom disabled; fonts
  self-hosted with per-locale preload (Devanagari faces preloaded on Hindi pages, which
  was measured as a 1.7s main-thread saving); every capability-refused state rendered
  in-page instead of a bare redirect; Lighthouse mobile budgets gated in CI.

---

## 3. Suggested order of work

1. **S-1** security headers, CSP first. Unchecked pre-launch item, and the gym is live.
2. **U-1** error and not-found pages. Largest user-visible gap; cheap to fix.
3. **S-6** get lint and the test suite green so CI gates again (includes **S-10**).
4. **S-2** trusted-proxy handling for `clientIp`, which restores every IP rate limit.
5. **S-3** and **S-4** rate limits on kiosk pairing and CRM sign-in.
6. **U-2** persist QR form progress. Cheapest large win for members at the desk.
7. **S-5** decide the `/qr/check` disclosure question and record it either way.
8. **S-7** CodeQL and gitleaks in CI. **S-8**, **S-9**, **S-11** alongside.
9. **U-3**, **U-4**, **U-5**.

Also still open from the progress log and unchanged by this review: `pnpm db:deploy` on
production for the RLS migration; rotation of the Meta App Secret and Razorpay secret;
the simulator's gym/member attribution; MF-0001's 338×338 PAN photograph; face consent
for three members.
