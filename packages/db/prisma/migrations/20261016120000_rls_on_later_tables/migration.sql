-- Row Level Security on the nine tables that were added after the init migration.
--
-- ADR-011 requires RLS on every table in `public`, and the init migration enables it on
-- every table it creates. The migrations that came later — the bot, diet plans, personal
-- training, announcements, the website gallery — created their tables and did not.
--
-- Production was correct, because somebody ran `check:rls` and applied the ALTERs it
-- printed by hand. The migration history was not: standing the schema up from scratch
-- produced nine unprotected tables. That was found on 2026-10-16 when a fresh test
-- database was created and the RLS test failed against it — the test had only ever been
-- run against the database that had been fixed by hand.
--
-- A hand-run fix is not a guarantee. This makes it one, for the test database, for any
-- future environment, and for the day production has to be restored from nothing.
--
-- Enabling RLS on a table that already has it is a no-op, so this is safe to apply to
-- production, where all nine are already protected.

ALTER TABLE "Announcement"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BotConfig"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BotDocument"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BotReply"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DietFollowUp"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DietPlan"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DietProfile"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GalleryPhoto"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PtEnrolment"   ENABLE ROW LEVEL SECURITY;
