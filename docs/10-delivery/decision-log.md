# Decision Log (lightweight ADRs)

Format: `ADR-NNN — Title` · Date · Status (Proposed/Accepted/Superseded) · Context · Decision · Consequences.

## ADR-001 — Single Next.js app + separate worker
2026-09-10 · Accepted · See `01-project-analysis.md` D1, TRD §2.

## ADR-002 — Reminder engine evaluates at send slots, not per-member scheduled jobs
2026-09-10 · Accepted · Renewal/unsubscribe take effect automatically; eligibility re-checked before sending. Requires efficient candidate SQL and idempotency keys.

## ADR-003 — On-device face recognition in native Kotlin kiosk; licensed engine required for production
2026-09-10 · Accepted · Offline, fast, private. Research-only weights allowed only in POC. Final engine recorded in ADR-0xx after POC.

## ADR-004 — Post-expiry reminder cap (default 7 days), configurable
2026-09-10 · Proposed (needs owner sign-off, question D2) · Protects WhatsApp number quality; members beyond cap go to call list.

## ADR-005 — Gender field added to sign-up
2026-09-10 · Proposed (owner sign-off) · Pricing depends on gender.

## ADR-006 — Prisma 7 stable line; no RC versions
2026-09-10 · Accepted · Schema validated against 7.10 engine; datasource URL in `prisma.config.ts`; driver adapter `@prisma/adapter-pg`.

## ADR-007 — pg-boss instead of Redis/BullMQ
2026-09-10 · Accepted · One less stateful service.

## ADR-008 — Local encrypted volume storage by default
2026-09-10 · Accepted · Simple, in-India, backed up with restic; S3-compatible driver available.

## ADR-009 — Imported register members have WhatsApp opt-in false until confirmed
2026-09-10 · Accepted · Avoid messaging people who never consented; QR confirmation or desk consent enables reminders.

<!-- Add new decisions below. Record: face engine vendor & licence; WhatsApp provider (direct vs BSP) and number; final prices; template approval categories; domain. -->

## ADR-010 — Supabase Postgres (Mumbai), no local Docker
2026-09-10 · Accepted · **Context:** the development machine cannot run Docker, and the blueprint assumed a local `postgres:17` container plus Testcontainers for integration tests. **Decision:** use managed **PostgreSQL 17 on Supabase, `ap-south-1` (Mumbai)** as the database for development, accessed **only through Prisma** — no `supabase-js`, no anon key, no service-role key, no Supabase Auth/Storage/Realtime. `DATABASE_URL` is the Supavisor **transaction** pooler (:6543, pool max 5) for the `apps/web` runtime via `@prisma/adapter-pg`; `DIRECT_URL` is the Supavisor **session** pooler (:5432, pool max 3) for `prisma.config.ts` migrations, the seed script and the pg-boss worker. Optional `SHADOW_DATABASE_URL` (separate empty project) covers the case where the Supabase role lacks `CREATEDB`; optional `TEST_DATABASE_URL` (separate project) runs integration tests, which skip with a message when it is unset. CI runs integration tests against a Postgres 17 **service container**. `infra/docker/compose.dev.yml` is not created; Dockerfiles, Caddy and VPS scripts move to Phase 8.

**Verified against current official documentation (10 Sep 2026), not from memory:**
- Supabase's Prisma guide assigns the **transaction** pooler (:6543) to `DATABASE_URL` for serverless/auto-scaling runtimes and **session** mode (:5432) to migrations — matching the split above.
- Prisma's PgBouncer guide: the Schema Engine "is designed to use a single connection to the database, and does not support connection pooling with PgBouncer", so migrations must use a direct/session connection. It also **recommends against** setting `pgbouncer=true` for PgBouncer 1.21.0 or later, and driver adapters such as `@prisma/adapter-pg` bypass the flag.
- Supabase's Prisma troubleshooting page confirms Supavisor **transaction mode does not support prepared statements**. `@prisma/adapter-pg` uses node-postgres, which issues unnamed queries, so no flag is required. This is proven with a live query at Step 3; adding `pgbouncer=true` to `DATABASE_URL` is the documented fallback.
- Prisma 7 **removed the `directUrl` datasource property**; the migration URL is now `datasource.url` in `prisma.config.ts`, and **`shadowDatabaseUrl` moved into `prisma.config.ts` too** (it lived in `schema.prisma` up to Prisma 6). Our config therefore sets `datasource.url = env("DIRECT_URL")`.
- `prisma migrate dev` needs `CREATEDB` on the connecting role to build its shadow database; providers that forbid creating databases require a manually provisioned one via `shadowDatabaseUrl`. `prisma migrate deploy` needs no shadow database.

**Consequences:** unit tests must never touch a database; the seed must batch its writes because every round trip crosses the internet; Supabase's auto-generated Data API must be neutralised (ADR-011); production database hosting is re-decided in Phase 8 and nothing in the app depends on the answer.

## ADR-011 — RLS enabled on every public table, with no policies
2026-09-10 · Accepted · **Context:** Supabase auto-generates a PostgREST **Data API** over the `public` schema, callable with the project's anon key. Our tables would otherwise be readable by anyone holding that key. **Decision:** the first migration runs `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on **every** table the application creates in `public`, with **no policies**, and every later migration does the same for new tables. Additionally, `public` is removed from the Data API's exposed schemas in the dashboard (manual). **Why it is safe:** PostgreSQL table owners bypass RLS unless `FORCE ROW LEVEL SECURITY` is set, and our Prisma role owns the tables — so the application is unaffected — while the `anon`/`authenticated` roles PostgREST connects as match zero rows. pg-boss is unaffected because it lives in its own `pgboss` schema, which the Data API does not expose. **Consequences:** a migration that forgets the `ALTER TABLE` silently exposes a table, so it belongs on the migration review checklist and in the pre-launch security checklist.

## ADR-012 — TypeScript 6.0.x, not the `latest` TypeScript 7
2026-09-10 · Accepted · **Context:** npm `latest` for `typescript` is **7.0.2**, but `typescript-eslint@8.70.0` declares `typescript: ">=4.8.4 <6.1.0"`. Adopting TS 7 would mean dropping type-aware linting, which is what enforces our `strict` / `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` conventions. **Decision:** pin **TypeScript 6.0.3**, the newest stable release inside the supported range. **Consequences:** revisit when typescript-eslint ships TS 7 support; fall back to 5.9.3 if Next 16 or the Prisma 7 client generator prove incompatible with 6.x.

## ADR-013 — Fee state is canonical in TypeScript; `v_member_fee` is a read-model
2026-09-10 · Accepted · **Context:** `database-design.md` §4.1 defines `v_member_fee` using `now()`, which conflicts with CLAUDE.md §2.2 (inject a clock, never call `new Date()` in domain code) and with `testing-strategy.md` §2 ("tests must not rely on `now()`"). **Decision:** `feeState(today, membership...)` in `packages/core` is the single canonical implementation. `v_member_fee` stays as a fast read-model for list queries and dashboard counts only, and an integration test diffs it against the core function over the same fixtures at fixed dates. **Consequences:** no business decision (a reminder, a call task, a kiosk greeting) is ever taken from the view alone; if they disagree, the view is the bug.

## ADR-014 — Fee state ignores a non-contiguous future membership
2026-09-10 · Accepted · **Context:** BR-4.2 derives fee state "from the membership covering today or the latest ended one", and adds "If an upcoming membership starts the day after, use its end date". `v_member_fee` instead takes the confirmed membership with the greatest `endDate`, which would report `PAID` for a member whose membership ended in March and who has a booking starting next January. **Decision:** core takes the membership covering today; failing that, the latest **ended** one; and it extends the effective end date through a future membership **only when that membership starts within one day of the current end** (a genuine renewal chain). This is the literal reading of BR-4.2, not a new rule. **Consequences:** the view carries the same guard; documented as a known divergence risk in the view/core diff test.

## ADR-015 — `ReminderRule.offsetDaysTo` is authoritative for the post-expiry cap
2026-09-10 · Accepted · **Context:** the cap exists in two places — `settings.postExpiryMaxDays` (BR-5.2, default 7) and `ReminderRule.offsetDaysTo` on the `POST` rule (schema, `null` = no limit). **Decision:** `offsetDaysTo` is what the engine evaluates; it is written from `postExpiryMaxDays` whenever settings are saved, and settings validation rejects a state where the two disagree. **Consequences:** one query path, no drift; the settings screen stays the owner-facing control.

## ADR-016 — BR-2.3 "effective per month" reading
2026-09-10 · Proposed (display only; owner may adjust) · **Context:** BR-2.3 says "`floor(pricePaise / durationMonths)` rounded to nearest ₹10", which specifies two conflicting roundings. **Decision:** the displayed figure is `round(pricePaise / months / 1000) × 1000` paise — e.g. ₹4,000 ÷ 3 = ₹1,333.33 → **₹1,330**. This value is for plan-card display only and never used to charge anyone; `Membership.pricePaise` is always the plan price copied at purchase (BR-2.8). **Consequences:** if the owner wants "₹1,330" to read "₹1,333", change one function and its tests.

## ADR-017 — Integrations write through ports, never through `packages/db`
2026-09-10 · Accepted · **Context:** the WhatsApp simulator is specified to write `MessageLog` rows, but `folder-structure.md` restricts `packages/integrations` to `shared` and `core/ports`, and that boundary is ESLint-enforced. **Decision:** add a `MessageLogWriter` port in `packages/core/src/ports`, implemented in `packages/db` and injected at the app boundary (`apps/*/container.ts`). The simulator depends on the interface only. **Consequences:** the dependency rule stays mechanically enforceable, and the simulator is unit-testable with an in-memory writer.

## ADR-018 — `/api/v1/health` reports the worker heartbeat
2026-09-10 · Accepted · **Context:** `api-specification.md` §3 specifies `{ ok, db, version }`, but the worker is a separate process with no inbound ports, so its liveness is only observable through the `WorkerHeartbeat` table the schema already provides. **Decision:** extend the response to `{ ok, db, worker: { ok, lastBeatAt, ageSeconds }, version }`, with `worker.ok` false when the last beat is older than **3 minutes** (the threshold the schema comment states) and top-level `ok` false if either component is down. No secrets, no counts. **Consequences:** Uptime Kuma gets one URL covering both processes; `api-specification.md` §3 is updated to match.
