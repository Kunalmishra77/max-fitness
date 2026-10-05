-- The standing instruction's own message purpose (ADR-105).
--
-- Without it the three autopay messages would be logged as `OTHER`, and the owner's message
-- log could not tell an autopay invitation from anything else that had no better label.
--
-- `ADD VALUE IF NOT EXISTS` so re-running is a no-op. Enum values cannot be removed in
-- Postgres, which is reason enough to add one deliberately rather than by accident.
ALTER TYPE "MessagePurpose" ADD VALUE IF NOT EXISTS 'AUTOPAY';
