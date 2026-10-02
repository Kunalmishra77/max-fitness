-- Sign-in by address as well as by number (ADR-094).
-- Nullable on purpose: the desk's own staff are known by their phone, and nobody should
-- be made to invent an email to keep their login working. In Postgres a NULL never
-- collides, so the unique index holds for the accounts that do have one.

-- AlterTable
ALTER TABLE "StaffUser" ADD COLUMN     "email" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "StaffUser_gymId_email_key" ON "StaffUser"("gymId", "email");
