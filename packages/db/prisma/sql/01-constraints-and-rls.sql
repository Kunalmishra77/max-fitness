-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written SQL appended to the first migration.
--
-- Prisma cannot express partial unique indexes, CHECK constraints, expression
-- indexes, views or RLS, so these live here and are concatenated onto the
-- generated `migration.sql` (database-design.md §3, §4.1, §10.2).
--
-- Keep this file as the source of truth: `pnpm db:migrate` appends it, and a
-- reviewer can diff it without reading a generated file.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. Constraints Prisma cannot express (database-design.md §3) ─────────────

-- BR-7: at most one OPEN call task per (member, reason). Enforced in the service
-- *and* here, because a race between the nightly job and an event handler would
-- otherwise put the same call on the owner's list twice.
CREATE UNIQUE INDEX "calltask_open_member_reason"
  ON "CallTask" ("memberId", "reason")
  WHERE "status" = 'OPEN' AND "memberId" IS NOT NULL;

-- Money never negative. CLAUDE.md §2.1 puts money in integer paise; these make a
-- nonsensical amount impossible to store even if a bug reaches the insert.
ALTER TABLE "Payment"    ADD CONSTRAINT "payment_amount_positive" CHECK ("amountPaise" > 0);
ALTER TABLE "Plan"       ADD CONSTRAINT "plan_price_positive"     CHECK ("pricePaise" > 0);

-- BR-3.6 allows a declared membership with no start date, so the check has to
-- tolerate NULL rather than demand an ordering.
ALTER TABLE "Membership" ADD CONSTRAINT "membership_dates_valid"
  CHECK ("startDate" IS NULL OR "startDate" <= "endDate");

-- BR-8.1: the birthday list runs every morning over every active member, so the
-- month/day extraction needs an index of its own.
CREATE INDEX "member_dob_month_day"
  ON "Member" ((EXTRACT(MONTH FROM "dob")), (EXTRACT(DAY FROM "dob")))
  WHERE "status" = 'ACTIVE' AND "deletedAt" IS NULL;

-- Case-insensitive name search for the CRM member list.
CREATE INDEX "member_name_lower" ON "Member" (lower("fullName"));


-- ── 2. Fee-state read model (database-design.md §4.1) ────────────────────────
--
-- ADR-013: `feeState()` in packages/core is the canonical implementation. This
-- view exists only so list screens and dashboard counts are one indexed query
-- instead of N. An integration test diffs the two over the same fixtures; if they
-- disagree, the view is the bug.
--
-- ADR-014: the view takes the confirmed membership with the greatest endDate. That
-- is correct while renewals chain contiguously (BR-3.4/3.5) but would report PAID
-- for a member whose membership lapsed months ago and who has a booking starting
-- next year. Core applies the stricter reading; consumers of this view must not
-- make an irreversible decision (a send, a call task) on it alone.

CREATE VIEW "v_member_fee" AS
WITH confirmed AS (
  SELECT
    m.*,
    ROW_NUMBER() OVER (PARTITION BY m."memberId" ORDER BY m."endDate" DESC) AS rn
  FROM "Membership" m
  WHERE m."status" = 'CONFIRMED'
)
SELECT
  mem."id"                                                     AS "memberId",
  mem."gymId",
  c."id"                                                       AS "latestMembershipId",
  c."endDate"                                                  AS "effectiveEndDate",
  (c."endDate" - (now() AT TIME ZONE 'Asia/Kolkata')::date)     AS "daysLeft",
  CASE
    WHEN c."id" IS NULL                                              THEN 'NONE'
    WHEN (now() AT TIME ZONE 'Asia/Kolkata')::date > c."endDate"     THEN 'EXPIRED'
    WHEN c."endDate" - (now() AT TIME ZONE 'Asia/Kolkata')::date <= 7 THEN 'DUE_SOON'
    ELSE 'PAID'
  END                                                          AS "feeState"
FROM "Member" mem
LEFT JOIN confirmed c ON c."memberId" = mem."id" AND c.rn = 1
WHERE mem."deletedAt" IS NULL;

-- A date-parameterised twin of the view, so integration tests can pin "today"
-- instead of depending on the wall clock (testing-strategy.md §2, ADR-013).
CREATE FUNCTION "member_fee_at"(p_today date)
RETURNS TABLE (
  "memberId" text,
  "gymId" text,
  "latestMembershipId" text,
  "effectiveEndDate" date,
  "daysLeft" integer,
  "feeState" text
)
LANGUAGE sql
STABLE
AS $$
  WITH confirmed AS (
    SELECT m.*, ROW_NUMBER() OVER (PARTITION BY m."memberId" ORDER BY m."endDate" DESC) AS rn
    FROM "Membership" m
    WHERE m."status" = 'CONFIRMED'
  )
  SELECT
    mem."id",
    mem."gymId",
    c."id",
    c."endDate",
    (c."endDate" - p_today)::integer,
    CASE
      WHEN c."id" IS NULL                     THEN 'NONE'
      WHEN p_today > c."endDate"              THEN 'EXPIRED'
      WHEN c."endDate" - p_today <= 7         THEN 'DUE_SOON'
      ELSE 'PAID'
    END
  FROM "Member" mem
  LEFT JOIN confirmed c ON c."memberId" = mem."id" AND c.rn = 1
  WHERE mem."deletedAt" IS NULL;
$$;


-- ── 3. Row Level Security (ADR-011, security-plan.md §3.6) ───────────────────
--
-- Supabase auto-generates a PostgREST "Data API" over the public schema, callable
-- by anyone holding the project's anon key. We do not use it and it must expose
-- nothing.
--
-- Enabling RLS with NO policies denies every row to the `anon` and `authenticated`
-- roles PostgREST connects as. Our Prisma role owns these tables, and a table
-- owner bypasses RLS unless FORCE ROW LEVEL SECURITY is set — which we
-- deliberately do not set — so the application is entirely unaffected.
--
-- This is the second line of defence. The first is clearing `public` from the Data
-- API's exposed schemas in the Supabase dashboard, which is a manual step.
--
-- EVERY future migration that adds a table to `public` must add its ALTER here.
-- A forgotten line silently publishes a table.

ALTER TABLE "Gym"                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Counter"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffUser"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OtpCode"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Plan"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Member"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Lead"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VerificationRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MediaFile"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Consent"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FaceTemplate"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EnrollmentJob"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KioskDevice"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AttendanceEvent"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReminderRule"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MessageLog"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebhookEvent"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CallTask"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Alert"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OutboxEvent"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkerHeartbeat"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobRun"              ENABLE ROW LEVEL SECURITY;

-- Prisma creates `_prisma_migrations` in public before running any migration, so it
-- is not covered by the list above — and the Data API would otherwise expose the
-- migration history. Guarded, because the table name is Prisma's, not ours.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    ALTER TABLE public."_prisma_migrations" ENABLE ROW LEVEL SECURITY;
  END IF;
END
$$;

-- The view runs with the privileges of its owner, so it would otherwise be a way
-- around the tables' RLS. `security_invoker` makes it respect the caller's
-- permissions instead.
ALTER VIEW "v_member_fee" SET (security_invoker = true);

-- Revoke the blanket grants Supabase's default privileges hand to the API roles.
-- RLS alone already denies every row; this removes the grant as well, so an
-- anon-key request gets "permission denied" rather than an empty result.
--
-- Guarded on role existence: `anon` and `authenticated` are Supabase's roles and do
-- not exist on the plain Postgres 17 service container CI runs migrations against,
-- where an unguarded REVOKE would abort the migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
  END IF;
END
$$;
