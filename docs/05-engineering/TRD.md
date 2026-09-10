# TRD — Technical Requirements Document

Related: `system-architecture.md`, `folder-structure.md`, `database/`, `api-specification.md`, module specs.

---

## 1. Architecture summary
- **apps/web** — Next.js (App Router) serving: public website (mostly static/ISR), `/join` sign-up, `/qr`, `/renew`, `/crm` (authenticated), and REST API under `/api/v1` for kiosk, webhooks and client components.
- **apps/worker** — Node process running pg-boss: cron schedules (reminder slots, nightly jobs, digests) and queues (WhatsApp send, receipt PDF, enrolment jobs, webhook processing).
- **apps/kiosk-android** — Kotlin app for face attendance, offline-first, talks to `/api/v1/kiosk/*`.
- **packages/core** — domain services and pure business rules (pricing, dates, fee state, reminder engine, call tasks, attendance rules). No framework imports.
- **packages/db** — Prisma schema, migrations, seed, repository helpers.
- **packages/shared** — Zod schemas, DTO types, constants, IST time utilities, masking helpers.
- **packages/integrations** — adapters: `WhatsAppProvider` (meta_cloud | bsp | simulator), `PaymentProvider` (razorpay | simulated), `StorageDriver` (local | s3), `OtpProvider`.
- **PostgreSQL** — single source of truth, also hosts pg-boss tables. Hosted on **Supabase (Mumbai, ap-south-1)** and reached only through Prisma; see §3.1.
- **Caddy** — reverse proxy with automatic HTTPS.

## 2. Why this shape
| Option considered | Verdict |
|---|---|
| Separate API service (NestJS/Hono) + Next.js front-end | More deployables and duplication for a small team. Rejected for 1.0; service layer in `packages/core` makes extraction easy later. |
| Supabase as a full BaaS (auth, Data API, storage, realtime) | Rejected. Our auth model (PIN for owner, device tokens for kiosk) is custom, and the auto-generated Data API is an attack surface we do not want. **However, we do use Supabase as a managed PostgreSQL host** (Mumbai) — Prisma only, Data API off, RLS on. See §3.1 and ADR-010. |
| Redis + BullMQ | Extra stateful service to run and back up. pg-boss on Postgres is enough for this volume. |
| React Native / Flutter kiosk | Viable, but always-on camera + ML inference + kiosk lock task are most reliable in native Kotlin with CameraX. |
| Cloud face API (per-call) | Needs constant internet, adds latency and recurring cost, sends biometrics off-site. Kept only as a fallback idea. |
| Browser-based kiosk (web page on the phone) | Quick demo, but browsers throttle camera/background, no boot auto-start, weaker kiosk lock. Allowed as a **sales demo** only. |

## 3. Technology stack (pin exact patch versions at Phase 1; use latest stable within these lines)

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js 24 LTS | `.nvmrc`, `engines` field |
| Package manager / monorepo | pnpm workspaces + Turborepo | |
| Language | TypeScript (strict) | `noUncheckedIndexedAccess: true` |
| Web framework | Next.js 16.x (Active LTS line) + React 19 | Track security releases; patch within 72 h for critical |
| Styling | Tailwind CSS v4 + CSS variables from `design-tokens.json` | |
| UI primitives | Radix-based components (shadcn/ui pattern, copied into repo) | Restyled to tokens; no default look |
| Forms & validation | react-hook-form + Zod | Shared schemas |
| i18n | next-intl | `en`, `hi` |
| Carousel | Embla Carousel | Hero slider |
| Client data (CRM) | TanStack Query for interactive lists; Server Actions for mutations | |
| In-browser face check (selfie) | MediaPipe Tasks Vision Face Detector (WASM) | Only detects presence/position; no recognition in browser |
| ORM | Prisma 7.x stable line (npm `latest` tag currently points to an 8.0 release candidate — do not use RCs) | `prisma-client` generator with output path, `prisma.config.ts` holds the datasource URL, `@prisma/adapter-pg` driver adapter; schema validated against the 7.10 engine |
| Database | PostgreSQL 17 on **Supabase** (Mumbai, ap-south-1) | Prisma-only access — no supabase-js, no anon/service-role key. Connection strategy in §3.1. No extensions required (emails normalised in app) |
| Jobs & cron | pg-boss | Cron in IST via explicit tz |
| Auth (CRM) | Custom DB sessions + Argon2id PIN hashing (`@node-rs/argon2`) | httpOnly, Secure, SameSite=Lax cookies |
| Payments | Razorpay Orders API + Standard Checkout + Webhooks | |
| WhatsApp | Meta WhatsApp Cloud API (Graph API, pinned version) | Adapter allows BSP |
| PDF receipts | `@react-pdf/renderer` | Rendered in worker |
| Image processing | `sharp` | Resize, strip EXIF, re-encode |
| Storage | Local encrypted volume (default) or S3-compatible | `StorageDriver` interface |
| Logging | pino (JSON) with PII redaction | |
| Errors | Sentry (web, worker, Android) | PII scrubbing on |
| Analytics | Plausible (self-host or cloud) and/or GA4 with consent | |
| Testing | Vitest, Testing Library, Playwright, MSW | Unit tests need no database. DB integration tests use `TEST_DATABASE_URL` (a separate Supabase project) and skip with a message when it is unset; CI uses a Postgres 17 service container. Testcontainers is **not** used — see §3.2 |
| Android | Kotlin, Jetpack Compose, CameraX, ML Kit Face Detection, LiteRT (TFLite) runtime, Room + SQLCipher, WorkManager, OkHttp/Retrofit, Hilt, Android TextToSpeech | minSdk 29, target latest |
| CI/CD | GitHub Actions → GHCR images → SSH deploy with Docker Compose | |
| Hosting | Ubuntu 24.04 LTS VPS, Mumbai region, 4 vCPU / 8 GB / 160 GB SSD | |
| Proxy | Caddy 2 | Automatic TLS, security headers |
| Backups | `pg_dump` + restic to off-site object storage | Encrypted |
| Monitoring | Uptime Kuma + Sentry + worker heartbeat table | |

### 3.1 Database connection strategy (Supabase)

Supabase provides managed PostgreSQL 17 in `ap-south-1` (Mumbai). We use it as **a database and nothing else**: no `supabase-js`, no anon key, no service-role key, no Storage, no Auth, no Realtime. All access is Prisma over the Postgres wire protocol, so the database stays swappable for self-hosted Postgres on the VPS later.

| Variable | Pooler | Port | Used by | Pool |
|---|---|---|---|---|
| `DATABASE_URL` | Supavisor **transaction** mode | 6543 | `apps/web` runtime, via Prisma + `@prisma/adapter-pg` | max 5 |
| `DIRECT_URL` | Supavisor **session** mode | 5432 | `prisma.config.ts` (migrations), the seed script, and the pg-boss worker | max 3 |
| `SHADOW_DATABASE_URL` | session | 5432 | optional; only when `prisma migrate dev` cannot create a shadow database | — |
| `TEST_DATABASE_URL` | session | 5432 | integration tests, separate project | — |

Why the split:
- Prisma's **Schema Engine uses a single connection and does not work through a transaction pooler**, so every migration path must use session mode. In Prisma 7 the migration URL is `datasource.url` inside `prisma.config.ts` (the old `directUrl` field was removed), and `shadowDatabaseUrl` moved there too.
- **pg-boss needs session-level connections** (advisory locks, `LISTEN`), so the worker also uses `DIRECT_URL`.
- Transaction mode is right for the web runtime: it multiplexes many short-lived requests onto few backend connections. Supavisor transaction mode does **not** support prepared statements; `@prisma/adapter-pg` (node-postgres) issues unnamed queries, so the legacy `?pgbouncer=true` flag is not required — Prisma explicitly recommends against it for PgBouncer ≥ 1.21. This is verified by a live query at Phase 1 Step 3; if it ever regresses, adding `pgbouncer=true` to `DATABASE_URL` is the fallback.

**Row Level Security:** the first migration runs `ALTER TABLE … ENABLE ROW LEVEL SECURITY` on every table the app creates in `public`, with **no policies**. Table owners bypass RLS by default, so our Prisma role is unaffected, while the `anon` and `authenticated` roles behind Supabase's auto-generated Data API can read nothing. Disabling Data API exposure for `public` in the Supabase dashboard is the second, manual layer. Details in `database/database-design.md` §10 and `security-plan.md` §3.6.

### 3.2 Local development (no Docker)

Development on the vendor's Windows machine runs against the remote Supabase development project. **No local command requires Docker.** There is no `compose.dev.yml`; `pnpm dev` starts web and worker only, and all `db:*` scripts talk to Supabase over the poolers above.

Consequences:
- **Unit tests must not need a database.** Everything in `packages/core` and `packages/shared` runs on pure functions with a `FakeClock`.
- **Integration tests** use `TEST_DATABASE_URL` (a separate Supabase project). When it is unset the suite skips with an explicit message rather than failing, so `pnpm test` is green on a fresh clone.
- **CI** (GitHub Actions) runs integration tests against a **Postgres 17 service container** — Docker on GitHub's runners is fine and gives fast, isolated, free runs.
- Package scripts must work on Windows, macOS and Linux: no bash-only syntax, use `cross-env` or Node scripts.
- Dockerfiles, Caddy config and VPS provisioning are deferred to Phase 8 (`deployment-plan.md`).

## 4. Rendering strategy (web)
| Route | Strategy |
|---|---|
| `/` landing | Static with revalidation (e.g., 5 min) for prices/promo/trust numbers; revalidate tag on settings change |
| `/join`, `/qr/*`, `/renew/[token]` | Dynamic, client-heavy forms; no caching of personalised responses |
| `/crm/*` | Dynamic, authenticated, `no-store` |
| `/api/v1/*` | Route handlers, Node runtime (not edge) — needs Prisma, crypto, raw body |
| Legal pages | Static |

## 5. Cross-cutting conventions
- **Errors:** domain errors are typed (`DomainError` with `code`); API maps to HTTP + `{ error: { code, message, details? } }`.
- **IDs:** `cuid2` strings for public IDs; human codes (`MF-0231`) generated from counters.
- **Money:** `Int` paise. Display helper `formatINR(paise)` with Indian grouping.
- **Time:** `packages/shared/time`: `todayIST(clock)`, `toISTDate`, `addMonthsClamped`, `diffDays`, `istSlotToUtc`. Use `@date-fns/tz` or Temporal polyfill; no moment.
- **Phone:** store E.164 (`+91XXXXXXXXXX`); validate Indian mobiles `^[6-9]\d{9}$` after normalisation.
- **Clock injection:** services accept `Clock` interface; tests use `FakeClock`; DEMO_MODE exposes "time travel" only in non-production.
- **Idempotency:** unique `idempotencyKey` columns on `MessageLog`, `Payment.providerPaymentId`, `AttendanceEvent.clientEventId`, `WebhookEvent (provider, externalId)`.
- **Transactions:** renewals, unsubscribe, verification approval run in a single DB transaction; side effects (WhatsApp) enqueued **after commit** (outbox pattern via pg-boss `send` inside transaction using same connection, or an `Outbox` table polled by worker).
- **Feature flags:** simple `Gym.settings.features` booleans (e.g., `otpRequired`, `autoBirthdayWish`, `kioskShadowMode`).
- **Audit:** `AuditLog` for money, status changes, settings changes, exports, deletions, logins.

## 6. Non-functional requirements
| Category | Requirement |
|---|---|
| Performance (web) | Mobile LCP ≤ 2.5 s (4G, mid-range Android), CLS ≤ 0.1, INP ≤ 200 ms, landing JS ≤ 170 KB gz excluding video |
| Performance (CRM) | Home TTI ≤ 2 s on 4G; list search results ≤ 300 ms for 2k members |
| Performance (API) | p95 ≤ 300 ms for CRUD; kiosk sync p95 ≤ 800 ms |
| Kiosk | Face-in-frame → greeting median ≤ 1.2 s; runs 16 h/day; 24 h offline without data loss |
| Availability | Web/CRM 99.5% monthly; worker restart within 1 min (Docker restart policy) |
| Reminder timing | Messages dispatched within 10 min after slot time |
| Scalability | Headroom: 2k members, 150 check-ins/hour, 20k messages/month on one VPS |
| Security | See `docs/07-security-compliance/security-plan.md` |
| Privacy | See `privacy-and-dpdp-compliance.md` |
| Backups | RPO 24 h (DB nightly + WAL optional later), RTO 4 h; monthly restore test |
| Observability | All jobs log start/end/count; failed jobs alert; kiosk heartbeat alerts |
| Accessibility | WCAG 2.2 AA public site |
| Browser support | Last 2 versions Chrome, Edge, Safari (iOS 16+), Samsung Internet, Firefox |
| Localisation | Hindi/English; Indian number formats; IST everywhere |
| Maintainability | 80% line coverage for `packages/core`; ADRs in decision log |

## 7. Integrations
| Integration | Direction | Auth | Key events/calls |
|---|---|---|---|
| Razorpay | Out: create order, fetch payment. In: webhook | Key ID/secret (Basic); webhook HMAC-SHA256 with webhook secret over raw body | `payment.captured`, `payment.failed`, `order.paid` |
| WhatsApp Cloud API | Out: `POST /{phone-number-id}/messages`. In: webhook | Bearer system-user token; webhook `X-Hub-Signature-256` = HMAC-SHA256(app secret, raw body); GET verify token | Message statuses, inbound `button`, `interactive`, `text` |
| Google Maps | Embed (click-to-load), directions link | none | — |
| Sentry | Out | DSN | errors |
| Plausible/GA4 | Out (browser) | consent | events |

## 8. Environments
| Env | URL | Data | Payments | WhatsApp |
|---|---|---|---|---|
| local | localhost:3000 | seed, on the Supabase **dev** project (no local Postgres, no Docker) | simulated | simulator |
| test (integration) | — | `TEST_DATABASE_URL`: separate Supabase project, or the CI Postgres 17 service container | n/a | n/a |
| staging | staging.{domain} | seed (refreshable) | Razorpay test mode | simulator or test number + allowlist |
| production | {domain} | real | Razorpay live | Meta live number |

## 9. Environment variables
Defined and commented in root `.env.example`. Validation at boot with a Zod `env` schema in `packages/shared/src/env.ts`; the app refuses to start if required production vars are missing or `DEMO_MODE=true` in production without an explicit override. Database URLs are split across `DATABASE_URL` (transaction pooler) and `DIRECT_URL` (session pooler) per §3.1; `SHADOW_DATABASE_URL` and `TEST_DATABASE_URL` are optional.

## 10. Kiosk ↔ server contract summary
Pairing code → device token (hashed at rest). Delta sync of gallery (members eligible + face templates), batched attendance upload with client event IDs, enrolment jobs pulled by kiosk, heartbeat. Details: `attendance-face-recognition-system.md` §8 and `api-specification.md` §7.

## 11. Constraints & assumptions
- Single gym, single kiosk in 1.0 (schema supports many).
- Internet at gym may be unreliable; kiosk must be offline-tolerant, CRM assumes connectivity.
- The WhatsApp API number cannot simultaneously be used as a normal consumer WhatsApp account; if the owner wants to keep chatting from the WhatsApp Business app on the same number, evaluate Meta's Business App coexistence onboarding with the chosen provider before choosing the number.
- Payment gateway live activation depends on KYC and website review.
