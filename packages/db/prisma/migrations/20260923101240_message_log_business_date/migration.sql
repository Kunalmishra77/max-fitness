-- AlterTable
ALTER TABLE "MessageLog" ADD COLUMN     "businessDate" DATE;

-- CreateIndex
CREATE INDEX "MessageLog_toNumber_businessDate_idx" ON "MessageLog"("toNumber", "businessDate");

-- Backfill: every message already logged belongs to the IST day it was created on.
-- A UTC date would put an 11 pm message on the wrong day, which is exactly the
-- mistake the column exists to prevent.
UPDATE "MessageLog"
SET "businessDate" = ("createdAt" AT TIME ZONE 'Asia/Kolkata')::date
WHERE "businessDate" IS NULL;
