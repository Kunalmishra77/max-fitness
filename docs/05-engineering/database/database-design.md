# Database Design

Schema: `schema.prisma` (validated against Prisma 7.10 engine). ER diagram: `docs/06-diagrams/diagrams.md` §ERD.

## 1. Principles
1. **One source of truth:** PostgreSQL. Files hold only binary blobs referenced by `MediaFile`.
2. **Tenant column everywhere:** `gymId` on every business table; every query filters by it (repository helpers enforce).
3. **Derive, don't duplicate:** fee state, "active today", days left and birthdays are computed from dates, never stored as flags that can drift.
4. **Money in paise, dates in IST `DATE`, events in UTC `timestamptz`.**
5. **Soft delete where history matters** (`Member.deletedAt`, `Payment.status=VOIDED`); **hard delete** where privacy requires it (face templates, selfies after retention).
6. **Idempotency by unique constraints**, not by application checks alone.

## 2. Entity overview

| Entity | Purpose | Key relations | Notes |
|---|---|---|---|
| `Gym` | Tenant + settings JSON | parent of all | Settings schema in `packages/shared/src/schemas/settings.ts` |
| `Counter` | Gapless sequences | Gym | `member_code`, `receipt:{FY}`; updated with `UPDATE … SET value = value + 1 RETURNING value` in the same transaction |
| `StaffUser`, `Session` | CRM auth | Gym | PIN hash Argon2id; session token hashed |
| `OtpCode` | Mobile OTP | Gym | Code hashed; 5 attempts; 10 min |
| `Plan` | Price catalogue | Memberships | Code `M{months}_{GENDER}` |
| `Member` | Person | Memberships, Payments, Attendance, Consents, Media | `mobile` intentionally not unique |
| `Membership` | A paid (or declared) period | Member, Plan, Payments | `isDeclared` for QR/import records |
| `Payment` | Money in | Member, Membership | Provider IDs unique; receipt unique per gym |
| `Lead` | Enquiry | converts to Member | |
| `VerificationRequest` | QR existing-customer claim | Member | Keeps declared vs approved date |
| `MediaFile` | Private blob metadata | Member | `deleteAfter` drives retention job |
| `Consent` | Consent ledger (append-only) | Member | Withdrawal = new row or `withdrawnAt` |
| `FaceTemplate` | Encrypted embeddings | Member | Model-versioned |
| `EnrollmentJob` | Selfie → template work for kiosk | Member, MediaFile | |
| `KioskDevice` | Paired Android kiosk | Attendance | Token hashed |
| `AttendanceEvent` | Check-in | Member, Kiosk | `clientEventId` unique |
| `ReminderRule` | Configurable reminder schedule | Gym | Seeded with BR-5.1 defaults |
| `MessageLog` | Every WhatsApp in/out | Member, Membership | `idempotencyKey`, `providerMessageId` unique |
| `WebhookEvent` | Raw webhook inbox | — | `(provider, externalId)` unique for replay safety |
| `CallTask` | Owner's call list | Member / Lead | One OPEN per (member, reason) — enforced in service + partial unique index (below) |
| `Alert` | CRM bell items | Member | i18n key + params |
| `AuditLog` | Who did what | — | Append-only |
| `OutboxEvent` | Reliable side effects | — | `dedupeKey` unique |
| `WorkerHeartbeat` | Worker liveness | — | Read by `/api/v1/health` |
| `JobRun` | Scheduled run history | — | `(jobName, runKey)` unique → catch-up & no double slot runs |

## 3. Raw SQL additions (add to first migration manually)

Prisma cannot express partial unique indexes or CHECK constraints; add them in `migration.sql`. The same migration must also enable Row Level Security on every table (§10.2).

```sql
-- Only one OPEN call task per member+reason
CREATE UNIQUE INDEX calltask_open_member_reason
  ON "CallTask" ("memberId", "reason") WHERE "status" = 'OPEN' AND "memberId" IS NOT NULL;

-- Money never negative
ALTER TABLE "Payment"    ADD CONSTRAINT payment_amount_positive CHECK ("amountPaise" > 0);
ALTER TABLE "Plan"       ADD CONSTRAINT plan_price_positive     CHECK ("pricePaise" > 0);
ALTER TABLE "Membership" ADD CONSTRAINT membership_dates_valid  CHECK ("startDate" IS NULL OR "startDate" <= "endDate");

-- Fast birthday lookup
CREATE INDEX member_dob_month_day ON "Member" ((EXTRACT(MONTH FROM "dob")), (EXTRACT(DAY FROM "dob")))
  WHERE "status" = 'ACTIVE' AND "deletedAt" IS NULL;

-- Case-insensitive name search (trigram optional later)
CREATE INDEX member_name_lower ON "Member" (lower("fullName"));
```

## 4. Derived views & key queries

### 4.1 Current membership per member (`v_member_current`)
The "current" membership is the confirmed membership covering today; if none, the latest confirmed one by `endDate`. An upcoming confirmed membership that starts right after the current one extends the effective end.

```sql
CREATE VIEW v_member_fee AS
WITH confirmed AS (
  SELECT m.*, ROW_NUMBER() OVER (PARTITION BY m."memberId" ORDER BY m."endDate" DESC) AS rn
  FROM "Membership" m
  WHERE m."status" = 'CONFIRMED'
)
SELECT
  mem."id"          AS "memberId",
  mem."gymId",
  c."id"            AS "latestMembershipId",
  c."endDate"       AS "effectiveEndDate",
  (c."endDate" - (now() AT TIME ZONE 'Asia/Kolkata')::date) AS "daysLeft",
  CASE
    WHEN c."id" IS NULL THEN 'NONE'
    WHEN (now() AT TIME ZONE 'Asia/Kolkata')::date > c."endDate" THEN 'EXPIRED'
    WHEN c."endDate" - (now() AT TIME ZONE 'Asia/Kolkata')::date <= 7 THEN 'DUE_SOON'
    ELSE 'PAID'
  END AS "feeState"
FROM "Member" mem
LEFT JOIN confirmed c ON c."memberId" = mem."id" AND c.rn = 1
WHERE mem."deletedAt" IS NULL;
```
Because memberships never overlap (BR-3.5) and renewals chain contiguously, the latest confirmed `endDate` is the effective end date. The TypeScript `feeState()` in `packages/core` is the canonical implementation; the view exists for fast lists and must be tested against it with the same fixtures. **Tests must not rely on `now()`** — the core function takes `today` as input; integration tests set the DB session time zone and use fixed dates relative to the real clock.

### 4.2 Reminder candidates for a slot
```sql
-- :today (IST date), :slot ('10:00'), :gymId
SELECT f."memberId", f."latestMembershipId", f."effectiveEndDate", r."code", r."templateName"
FROM v_member_fee f
JOIN "Member" mem ON mem."id" = f."memberId"
JOIN "ReminderRule" r ON r."gymId" = f."gymId" AND r."isEnabled" AND :slot = ANY(r."slots")
WHERE f."gymId" = :gymId
  AND mem."status" = 'ACTIVE'
  AND mem."whatsappOptIn" = true
  AND mem."remindersUnsubscribedAt" IS NULL
  AND (mem."remindersPausedUntil" IS NULL OR mem."remindersPausedUntil" < :today)
  AND (:today - f."effectiveEndDate") BETWEEN r."offsetDays" AND COALESCE(r."offsetDaysTo", CASE WHEN r."code" = 'POST' THEN 100000 ELSE r."offsetDays" END);
```
Note the sign: `today − endDate = −7` on the PRE_7 day, `+1..+cap` for POST. The engine inserts `MessageLog` rows with `ON CONFLICT ("idempotencyKey") DO NOTHING`.

### 4.3 Home dashboard counts (single round trip)
```sql
SELECT
  COUNT(*) FILTER (WHERE mem."status"='ACTIVE' AND f."feeState" IN ('PAID','DUE_SOON'))        AS active_paid,
  COUNT(*) FILTER (WHERE mem."status"='ACTIVE' AND f."feeState"='DUE_SOON')                   AS due_this_week,
  COUNT(*) FILTER (WHERE mem."status"='ACTIVE' AND f."feeState"='EXPIRED')                    AS overdue,
  COUNT(*) FILTER (WHERE mem."status"='PENDING_VERIFICATION')                                   AS to_verify
FROM "Member" mem JOIN v_member_fee f ON f."memberId" = mem."id"
WHERE mem."gymId" = :gymId AND mem."deletedAt" IS NULL;
```
"Total members" tile definition: `ACTIVE` members whose fee state is not `EXPIRED` beyond `autoLeftAfterDays` — i.e., shown as `active_paid + overdue`; tile label reads "कुल मेंबर". Keep definition in `packages/core/src/dashboard/definitions.ts` with a comment.

### 4.4 Absent ≥ 7 days
```sql
SELECT mem."id" FROM "Member" mem JOIN v_member_fee f ON f."memberId"=mem."id"
WHERE mem."gymId"=:gymId AND mem."status"='ACTIVE' AND f."feeState" IN ('PAID','DUE_SOON')
  AND (mem."lastAttendanceAt" IS NULL OR mem."lastAttendanceAt" < now() - interval '7 days');
```
`Member.lastAttendanceAt` is a denormalised cache updated on attendance ingest (acceptable: it's recomputable).

## 5. Indexing rationale
- `Membership(gymId, status, endDate)` — reminder candidates and fee lists.
- `Membership(memberId, endDate)` — current membership per member.
- `AttendanceEvent(gymId, attendanceDate)` — today's list and reports.
- `MessageLog(idempotencyKey)` unique — no duplicate sends.
- `CallTask(gymId, status, dueDate, priority)` — Home list ordering.
- Revisit with `EXPLAIN ANALYZE` on seeded 2k-member dataset before launch.

## 6. Transactions & concurrency
| Operation | Isolation / locking |
|---|---|
| Receipt number allocation | Row-level lock via `UPDATE … RETURNING` on `Counter` |
| Payment confirmation | `SELECT … FOR UPDATE` on `Payment`; if already `PAID`, return existing result |
| Renewal start date calc | Lock member's latest membership row (`FOR UPDATE`) to prevent double renewals |
| Unsubscribe | Single transaction updating Member + inserting CallTask/Alert/Audit + Outbox |
| Attendance ingest | Insert with `ON CONFLICT (clientEventId) DO NOTHING`; cooldown checked in same transaction |

## 7. Data retention (implemented by `nightly-lifecycle` job)
| Data | Retention | Action |
|---|---|---|
| Face templates of `LEFT`/`BLOCKED` members or withdrawn face consent | 30 days after event (`faceDeleteAfterLeftDays`) | Hard delete rows; kiosk removes on next sync |
| Enrolment frames | 30 days after template creation | Hard delete blob + row |
| Selfie/profile photo of `LEFT` members | 12 months after `leftAt` | Hard delete blob, null `photoMediaId` |
| Check-in snapshots (if enabled) | 7 days (setting) | Hard delete |
| OTP codes | 24 h | Delete |
| Sessions | Expired + 7 days | Delete |
| WebhookEvent payloads | 90 days | Delete |
| MessageLog | 24 months | Delete older |
| Leads not converted | 12 months | Anonymise name/mobile |
| Members `LEFT` | 3 years after `leftAt` (accounting/tax needs for payments — confirm with accountant) | Anonymise personal fields; keep payments with pseudonymous id |
| AuditLog | 3 years | Delete older |

## 8. Migrations & environments
- `prisma migrate dev` locally **against the Supabase dev project** (there is no local Postgres and no Docker — see §10.1); `prisma migrate deploy` in CI/CD before new containers start.
- Every migration that creates a table in `public` must `ALTER TABLE … ENABLE ROW LEVEL SECURITY` in the same migration (§10.2).
- Never edit an applied migration; create a new one.
- Destructive migrations require a backup snapshot step in the deploy script.
- Seed only in local/staging; production gets `seed:production` that creates Gym, plans, reminder rules and the owner account with a one-time PIN.

## 9. Encryption
- Disk: VPS volume encryption where the provider supports it; backups encrypted by restic.
- Field-level: `FaceTemplate.vectorEnc` AES-256-GCM with `FIELD_ENCRYPTION_KEY` (key id prefix in ciphertext for rotation).
- Hashing: Argon2id for PINs; SHA-256 for tokens (high-entropy random); HMAC-SHA256 for signed links.

## 10. Hosting, connections and Row Level Security (Supabase)

The database is managed **PostgreSQL 17 on Supabase, `ap-south-1` (Mumbai)**. It is used as a database only — Prisma over the Postgres wire protocol. We do not use `supabase-js`, the anon key, the service-role key, Supabase Auth, Storage or Realtime. Nothing outside `packages/db` knows the database is hosted by Supabase, so moving to self-hosted Postgres on the VPS later is a connection-string change.

### 10.1 Connection strategy

| Variable | Supavisor mode | Port | Consumers | Pool max |
|---|---|---|---|---|
| `DATABASE_URL` | transaction | 6543 | `apps/web` runtime (Prisma + `@prisma/adapter-pg`) | 5 |
| `DIRECT_URL` | session | 5432 | `prisma.config.ts` migrations · seed script · pg-boss worker | 3 |
| `SHADOW_DATABASE_URL` | session | 5432 | optional, `prisma migrate dev` only | — |
| `TEST_DATABASE_URL` | session | 5432 | integration tests (separate project) | — |

- **Migrations must use session mode.** Prisma's Schema Engine holds a single connection and does not work behind a transaction pooler. In Prisma 7 the migration URL is `datasource.url` in `packages/db/prisma.config.ts`; the `directUrl` datasource field of Prisma ≤ 6 no longer exists, and `shadowDatabaseUrl` also moved into `prisma.config.ts`.
- **pg-boss must use session mode** (advisory locks and `LISTEN`), so the worker connects with `DIRECT_URL`.
- **The web runtime uses transaction mode**, which multiplexes short-lived requests. Supavisor transaction mode does not support prepared statements; `@prisma/adapter-pg` issues unnamed queries through node-postgres, so `?pgbouncer=true` is not needed (Prisma recommends against it for PgBouncer ≥ 1.21). Fallback if this ever regresses: append `pgbouncer=true` to `DATABASE_URL`.
- **Shadow database.** `prisma migrate dev` creates a temporary shadow database, which needs `CREATEDB` on the connecting role. If the Supabase role lacks it, set `SHADOW_DATABASE_URL` to a **separate, empty** Supabase project — Prisma resets that database on every `migrate dev`, so it must never hold real data. `prisma migrate deploy` (used in CI/CD) needs no shadow database.

### 10.2 Row Level Security

Supabase can auto-generate a PostgREST **Data API** over the `public` schema, reachable with the project's anon key. We do not use it and it must expose nothing.

The **first migration enables RLS on every table the application creates in `public`**, with **no policies at all**:

```sql
ALTER TABLE "Member" ENABLE ROW LEVEL SECURITY;
-- … one line per app table, including WorkerHeartbeat and JobRun
```

Why this is safe and sufficient:
- **The app is unaffected.** Our Prisma role owns these tables, and PostgreSQL table owners bypass RLS unless `FORCE ROW LEVEL SECURITY` is set. We deliberately do not force it.
- **The Data API sees nothing.** PostgREST connects as `anon` / `authenticated`. With RLS enabled and zero policies, every row is filtered out for those roles.
- **pg-boss is unaffected** — it creates its own `pgboss` schema, which the Data API does not expose.

Every future migration that adds a table to `public` must enable RLS on it in the same migration. Belt and braces: the Supabase dashboard must also have **Data API → exposed schemas** cleared of `public` (a manual step, recorded in the runbook).
