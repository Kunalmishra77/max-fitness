# 00 — FIRST PROMPT (Phase 1: Foundation)

**How to use:** open a terminal in the project folder (this extracted package), start your coding agent (e.g., Claude Code), and paste everything inside the box below. Work in one session if possible; if context runs long, finish the current step, update the progress log, and continue in a new session by pasting this prompt again with "Resume from step N".

---

```text
You are the lead engineer for the Max Fitness Platform. This repository currently contains only documentation (docs/), assets/, CLAUDE.md, README.md and .env.example. Your job in this session is PHASE 1 — FOUNDATION. Do not build product screens yet.

STEP 0 — READ FIRST (do not skip)
Read these files fully before writing any code, then give me a 10-line summary of the architecture and the business rules you will encode, plus any contradictions you found:
1. CLAUDE.md
2. docs/01-project/01-project-analysis.md
3. docs/02-product/business-rules.md
4. docs/05-engineering/TRD.md
5. docs/05-engineering/system-architecture.md
6. docs/05-engineering/folder-structure.md
7. docs/05-engineering/database/schema.prisma and database-design.md
8. docs/05-engineering/demo-data-seed-spec.md
9. docs/03-design/design-tokens.json and DESIGN-BLUEPRINT.md (sections 3–5 only)
10. docs/05-engineering/coding-standards.md
Wait for my "go" after the summary.

STEP 1 — MONOREPO & TOOLING
- git init (if not already), keep existing files.
- pnpm workspaces + Turborepo. Root package.json with "packageManager", "engines": { "node": ">=24" }, scripts: dev, build, lint, typecheck, test, test:e2e, db:migrate, db:seed, db:reset, db:studio, format.
- .nvmrc (24), .editorconfig, tsconfig.base.json (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes), eslint flat config with import boundaries per folder-structure.md "Dependency rules", prettier config, vitest workspace.
- Workspaces: apps/web, apps/worker, packages/shared, packages/core, packages/db, packages/integrations, packages/config.
- Before choosing versions, check the current stable releases (npm) and use: Node 24 LTS, Next.js 16.x latest patch (Active LTS), React 19, Tailwind CSS v4, Prisma 7.x stable (NOT an 8.0 RC even if npm "latest" points to it), pg-boss latest stable, Zod latest stable (pin one major and use it consistently), Vitest latest. Record chosen versions in docs/10-delivery/decision-log.md.

STEP 2 — packages/shared
- src/env.ts: Zod env schema matching .env.example; export parseEnv(); fail fast; refuse DEMO_MODE=true when NODE_ENV=production unless ALLOW_DEMO_IN_PRODUCTION=true.
- src/time/: IST helpers with an injectable Clock: todayIST(clock), toISTDate(date), addMonthsClamped(isoDate, months), addDays, diffDays(a,b), fyLabel(isoDate) → "2026-27", slotToUtc(isoDate, "HH:mm"). Represent business dates as branded string type ISTDate ("YYYY-MM-DD"). Use @date-fns/tz or equivalent; no moment.
- src/phone.ts (normalise Indian mobile → E.164, validate ^[6-9]\d{9}$), src/money.ts (formatINR with Indian grouping from paise), src/mask.ts (mask mobile/email).
- src/schemas/settings.ts: GymSettings Zod schema with defaults from business-rules (quiet hours, slots, postExpiryMaxDays=7, renewalGraceDays=5, autoLeftAfterDays=60, checkInCooldownMinutes=180, minAge=16, faceDeleteAfterLeftDays=30, features flags, trust numbers, hours, promo).
- src/constants.ts: fee states, plan codes, reminder rule codes.
- Unit tests for all of the above.

STEP 3 — packages/db
- Prisma 7 setup: copy docs/05-engineering/database/schema.prisma to packages/db/prisma/schema.prisma; create packages/db/prisma.config.ts reading DATABASE_URL; PrismaClient constructed with @prisma/adapter-pg; export a singleton client and a transaction helper.
- Generate the first migration, then append the raw SQL in database-design.md §3 and the v_member_fee view from §4.1 to that migration (or a second migration). Apply locally.
- infra/docker/compose.dev.yml with postgres:17 (port 5432, volume), healthcheck.

STEP 4 — packages/core (pure logic first, TESTS FIRST)
Create ports (Clock, WhatsAppProvider, PaymentProvider, StorageDriver, Outbox) as TypeScript interfaces, and implement with exhaustive unit tests using a FakeClock:
- pricing: planPrice, perMonthDisplay (BR-2.3), savings (BR-2.4), admission fee on first membership (BR-2.6), OTHER gender behaviour (BR-2.5).
- membership dates: endDate (BR-3.1 including the three worked examples), renewal start (BR-3.4), declared membership from month-end date (BR-3.6), no-overlap check (BR-3.5).
- fee state (BR-4.2) with daysLeft and upcoming-membership extension.
- reminder rules & eligibility as pure functions (BR-5.1–5.4, 5.7) — just the functions and tests from docs/08-quality/testing-strategy.md §4 cases R1–R22 that don't need a DB. No sending yet.
- call-task rule predicates (BR-7) as pure functions.
- birthdays (BR-8.1 including 29 Feb).
- attendance cooldown (BR-9.1).
- receipt number formatting per FY (BR-11.2).
- signed tokens (HMAC-SHA256, purpose-bound, expiry; constant-time verify) with tamper tests.
Target ≥ 80% line coverage for packages/core.

STEP 5 — packages/integrations (skeletons)
- whatsapp/simulator.ts implementing WhatsAppProvider by writing MessageLog rows with status SIMULATED and rendering bodyPreview from docs/04-content/whatsapp-templates.md (en + hi for mf_renewal_due, mf_renewal_due_today, mf_membership_expired, mf_payment_receipt).
- payments/simulated.ts implementing PaymentProvider.
- storage/local.ts implementing StorageDriver (writes under STORAGE_LOCAL_PATH, random keys, no public access).
- Leave meta-cloud.ts and razorpay.ts as typed stubs with TODOs referencing the specs.

STEP 6 — SEED (realistic demo data)
Implement packages/db/seed per docs/05-engineering/demo-data-seed-spec.md using assets/demo-data/members_demo.csv. All dates relative to SEED_TODAY or today (IST). Deterministic RNG. Create: gym + settings, 8 plans, reminder rules, 2 staff (demo PINs hashed with Argon2id), members per scenario, membership chains, payments with FY receipt numbers, 60 days of attendance with realistic time-of-day distribution, leads, message logs, call tasks, alerts, one kiosk device. Print a summary table at the end (counts per fee state, today's birthdays, open call tasks, this month's collections). The seed must be idempotent (wipe demo gym data then recreate).

STEP 7 — apps/web skeleton (no product screens)
- Next.js App Router app with src/, next-intl (en, hi) with [locale] segment for public routes and cookie-based locale for /crm.
- Tailwind v4 wired to CSS variables generated from docs/03-design/design-tokens.json (write a tiny script packages/config/scripts/tokens-to-css.ts and commit the generated apps/web/src/styles/tokens.css).
- Fonts Khand (600,700) and Hind (400,500,600) via next/font/google with latin + devanagari subsets.
- A temporary home page that shows: gym name in Khand, the 8 plan prices read from the DB via packages/core pricing, and today's fee-state counts from v_member_fee — this proves the whole stack works. Label it clearly "Foundation check".
- /api/v1/health route returning db status and version.
- Base UI primitives only: Button, Input, Label, Dialog/Sheet (Radix), Toast — styled with tokens, focus rings visible.

STEP 8 — apps/worker skeleton
- Boot pg-boss on DATABASE_URL, register a heartbeat job every minute that upserts the WorkerHeartbeat row (model already in the schema) which the health endpoint reads, graceful shutdown on SIGTERM.
- Register (but do not implement) the schedules listed in docs/05-engineering/crm-module-spec.md §4 with no-op handlers that log "not implemented (Phase N)".

STEP 9 — DOCKER, CI, INFRA
- Dockerfiles for web (standalone output, non-root) and worker (non-root).
- .github/workflows/ci.yml: pnpm install with cache, lint, typecheck, unit tests, integration tests with a Postgres service container, build.
- infra/scripts/bootstrap-vps.sh (per security-plan.md §3.3), infra/caddy/Caddyfile (per deployment-plan.md §3), infra/docker/compose.staging.yml, infra/scripts/deploy.sh, backup.sh, restore.sh — scripts must be safe (set -euo pipefail), idempotent, and commented. Do not run them.

STEP 10 — VERIFY & REPORT
- Run: pnpm lint, pnpm typecheck, pnpm test, pnpm db:reset, pnpm dev. Fix everything until green.
- Show me: tree of the repo (depth 3), test summary with coverage for packages/core, seed summary output, and a screenshot or text dump of the foundation check page.
- Append a session entry to docs/10-delivery/progress-log.md and record decisions in decision-log.md.
- List anything in the docs you believe is wrong or ambiguous, with a proposed fix. Do not silently change business rules.

CONSTRAINTS
- Follow CLAUDE.md rules at all times (money in paise, IST dates, Zod everywhere, logic in packages/core, no PII in logs, i18n for strings).
- Ask before adding any dependency not named in TRD.md.
- Do not start Phase 2 work.
```
